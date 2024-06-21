import { uint8Array } from '/util.mjs';

class HTTPError extends Error {
  constructor(res, msg) {
    super(msg ?? `${res.status} ${res.statusText}`);
    this.res = res;
    this.status = res.status;
  }
}

async function postRaw(uri, body, contentType, opts) {
  const res = await fetch(uri, {
    method: 'POST',
    body,
    ...opts,
    headers: {
      'Content-Type': contentType,
      ...opts?.headers,
    },
    duplex: 'half',
  });
  if (!res.ok) throw new HTTPError(res);
  return res;
}

async function post(uri, body, opts) {
  const res = await postRaw(uri, JSON.stringify(body ?? {}), 'application/json', opts);
  return res.json();
}

async function get(uri, opts) {
  const res = await fetch(uri, opts);
  if (!res.ok) throw new HTTPError(res);
  return res.json();
}

export const Host = {
  async open() {
    return (await post('/api/host/open')).hid;
  },
  async accept(hid) {
    return post(`/api/host/accept/${hid}`);
  },
  async connect(hid, message) {
    if (!hid)
      return (await post(`/api/host/connect`, {})).location;
    return (await post(`/api/host/connect/${hid}`, { message })).location;
  },
  async close(hid) {
    await post(`/api/host/close/${hid}`);
  },
};

async function recvResponse(loc) {
  return postRaw(`${loc}/recv`, new ArrayBuffer(), 'application/octet-stream');
}

export const Relay = {
  async open(loc) {
    await post(`${loc}/open`);
  },
  async send(loc, data) {
    await postRaw(`${loc}/send`, data, 'application/octet-stream');
  },
  async recvStream(loc) {
    return (await recvResponse(loc)).body;
  },
  async recv(loc) {
    return (await recvResponse(loc)).arrayBuffer();
  },
  async close(loc) {
    await post(`${loc}/close`);
  },
  async isClosed(loc) {
    return (await get(`${loc}/closed`)).closed;
  },
};

export class RelayWritableStream extends WritableStream {
  constructor(loc, highWaterMark) {
    if (!highWaterMark) highWaterMark = 1 << 28;
    const buf = [];
    let len = 0;
    let sig = () => {};
    let close = false;
    let ready = () => {};
    let total = 0;
    let totN = 0;

    const done = (async () => {
      while (len || !close) {
        while (len === 0) {
          await new Promise((resolve) => {
            sig = resolve;
          });
        }

        const b = new Uint8Array(len);
        len = 0;
        let off = 0;
        for (const x of buf.splice(0, buf.length)) {
          b.set(x, off);
          off += x.byteLength;
        }

        await Relay.send(loc, b);

        ready();
      }

      await Relay.close(loc);
    })();

    super({
      async write(chunk, controller) {
        chunk = uint8Array(chunk);
        buf.push(chunk);
        total += chunk.byteLength;
        totN++;
        len += chunk.byteLength;
        sig();
        if (len >= highWaterMark) {
          await new Promise((resolve) => {
            ready = resolve;
          });
        }
      },
      async close(controller) {
        close = true;
        sig();
        await done;
      },
    });
  }
}

export class RelayReadableStream extends ReadableStream {
  constructor(loc) {
    super({
      async pull(controller) {
        const s = await Relay.recvStream(loc);
        const r = s.getReader();
        let empty = true;
        for (;;) {
          const { value, done } = await r.read();
          if (done) break;
          controller.enqueue(value);
          empty = false;
        }
        if (empty && await Relay.isClosed(loc)) {
          controller.close();
        }
      },
    });
  }
}
