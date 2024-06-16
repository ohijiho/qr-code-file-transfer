var Util = (() => {
  async function postRaw(uri, body, contentType, opts) {
    const res = await fetch(uri, {
      method: 'POST',
      body,
      ...opts,
      headers: {
        'Content-Type': contentType,
        ...opts?.headers,
      },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res;
  }

  async function post(uri, body, opts) {
    const res = await Util.postRaw(uri, JSON.stringify(body ?? {}), 'application/json', opts);
    return res.json();
  }

  async function readAll(stream) {
    const reader = stream.getReader();
    const buf = [];
    let len = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buf.push(value);
      len += value.byteLength;
    }
    const ret = new Uint8Array(len);
    let off = 0;
    for (const x of buf) {
      ret.set(x, off);
      off += x.byteLength;
    }
    return ret;
  }

  return { post, postRaw, readAll };
})();

var Host = (() => {
  async function open() {
    return (await Util.post('/api/host/open')).hid;
  }

  async function accept(hid) {
    return Util.post(`/api/host/accept/${hid}`);
  }

  async function connect(hid, message) {
    return (await Util.post(`/api/host/connect/${hid}`, { message })).location;
  }

  async function close(hid) {
    await Util.post(`/api/host/close/${hid}`);
  }

  return { open, accept, connect, close };
})();

var Relay = (() => {
  async function open(loc) {
    await Util.post(`${loc}/open`);
  }

  async function send(loc, data) {
    await Util.postRaw(`${loc}/send`, data, 'application/octet-stream');
  }

  async function recv(loc) {
    const res = await Util.postRaw(`${loc}/recv`, new ArrayBuffer(), 'application/octet-stream');
    return res.body;
  }

  async function close(loc) {
    await Util.post(`${loc}/close`);
  }

  return { open, send, recv, close };
})();
