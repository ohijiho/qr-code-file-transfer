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
  constructor(loc) {
    super({
      async write(chunk, controller) {
        await Relay.send(loc, chunk);
      },
      async close(controller) {
        await Relay.close(loc);
      },
    });
  }
}

export class RelayReadableStream extends ReadableStream {
  constructor(loc) {
    super({
      async pull(controller) {
        const b = await Relay.recv(loc);
        if (b.byteLength === 0 && await Relay.isClosed(loc)) {
          controller.close();
          return;
        }
        controller.enqueue(b);
      },
    });
  }
}
