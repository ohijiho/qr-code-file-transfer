import * as uuid from 'uuid';
import cryptoJs from 'crypto-js';
import { Queue, LRUMap } from './collections.js';

export class HostServer {
  #superKey;
  #map;
  #relayers;

  constructor(relayers) {
    this.#relayers = relayers;

    this.#map = new LRUMap();
    this.#superKey = Symbol();

    this.dbgTotalListeners = 0;
  }

  get superKey() {
    return this.#superKey;
  }

  get relayers() {
    return this.#relayers;
  }

  get dbgHostsOpen() {
    return this.#map.size;
  }

  open(key, expires) {
    const hid = uuid.v4();
    this.#map.set(hid, {
      hid,
      expires,
      key,
      buf: new Queue(),
      listeners: new Queue(),
    });

    console.log(`host open: ${hid} (key: ${cryptoJs.SHA256(key)})`);

    return hid;
  }

  close(id, key) {
    const host = this.#getHost(id, key);

    this.#map.delete(id);

    while (!host.listeners.isEmpty()) {
      host.listeners.dequeue()();
    }
  }

  async accept(id, key) {
    const host = this.#getHost(id, key);

    this.dbgTotalListeners++;

    if (host.buf.isEmpty()) {
      await new Promise((resolve) => {
        host.listeners.enqueue(resolve);
      });
    }

    this.dbgTotalListeners--;

    if (host.buf.isEmpty()) {
      return null;
    }

    return host.buf.dequeue();
  }

  connect(id, message) {
    const host = this.#getHost(id, this.superKey);

    const location = this.relayers[Math.floor(Math.random() * this.relayers.length)] + uuid.v4();

    host.buf.enqueue({
      location,
      message,
    });

    if (!host.listeners.isEmpty())
      host.listeners.dequeue()();
    return location;
  }

  prune() {
    const now = new Date().getTime();
    while (!this.#map.isEmpty()) {
      const oldest = this.#map.lruValue();

      if (oldest.expires > now) break;

      this.#map.popLRU();

      while (!oldest.listeners.isEmpty()) {
        oldest.listeners.dequeue()();
      }

      console.log(`host closed: ${oldest.hid}`);
    }
  }

  #getHost(id, key) {
    const host = this.#map.get(id);

    if (!host) {
      throw new HostServerError(`no such host: ${id}`, HostServer.ErrorCode.noSuchHost);
    }

    if (key !== this.superKey && key !== host.key) {
      throw new HostServerError(`wrong key: ${cryptoJs.SHA256(key)} != ${cryptoJs.SHA256(host.key)}`, HostServer.ErrorCode.wrongKey);
    }

    return host;
  }
}

class HostServerError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const ErrorCode = {
  noSuchHost: 'no such host',
  wrongKey: 'wrong key',
};
Object.freeze(ErrorCode);
Object.defineProperty(HostServer, 'ErrorCode', { value: ErrorCode, writable: false });
