import cryptoJs from 'crypto-js';
import { Queue, LRUMap } from './collections.mjs';
import { noopLogger } from './util.mjs';

export class RelayServer {
  #timeout;
  #map;

  dbgTotalUnfulfilled;
  dbgTotalQueued;
  logger;

  constructor(timeout, opts) {
    this.#timeout = timeout;
    this.#map = new LRUMap();

    this.dbgTotalUnfulfilled = 0;
    this.dbgTotalQueued = 0;

    this.logger = opts?.logger ?? noopLogger;
  }

  get dbgSocksOpen() {
    return this.#map.size;
  }

  #expires() {
    return new Date().getTime() + this.#timeout;
  }

  open(id, key) {
    let conn = this.#map.get(id);

    if (!conn) {
      conn = {
        id,
        expires: this.#expires(),
        socks: new Map(),
        cancelPromise: null,
        canceled: false,
        cancel: null,
      };
      conn.cancelPromise = new Promise((_, reject) => {
        conn.cancel = reject;
      }).finally(() => {
        conn.canceled = true;
      });
      conn.cancelPromise.catch(() => { });
      this.#map.set(id, conn);

      const sock = {
        closed: false,
        sendQueue: new Queue(),
        recvQueue: new Queue(),
        counter: {
          closed: false,
          sendQueue: new Queue(),
          recvQueue: new Queue(),
        }
      };
      sock.counter.counter = sock;

      conn.socks.set(key, sock);
    }

    if (conn.socks.has(key)) return;

    if (conn.socks.size == 2)
      throw new RelayServerError('already established', RelayServer.ErrorCode.alreadyEstablished);

    conn.socks.set(key, [...conn.socks.values()][0].counter);
  }

  close(id, key) {
    const { sock } = this.#getSock(id, key);

    if (sock.closed)
      throw new RelayServerError('already closed', RelayServer.ErrorCode.alreadyClosed);

    sock.closed = true;

    this.#endSock(sock.counter);

    this.#checkAndDeleteSock(id, sock);
  }

  isClosed(id, key) {
    if (!this.#map.has(id)) return true;

    const { sock } = this.#getSock(id, key);

    return sock.counter.sendQueue.isEmpty() && sock.counter.closed;
  }

  async send(id, key, stream) {
    const { conn, sock } = this.#getSock(id, key);

    if (sock.closed)
      throw new RelayServerError('already closed', RelayServer.ErrorCode.alreadyClosed);

    if (sock.counter.recvQueue.isEmpty()) {
      return new Promise((resolve, reject) => {
        sock.sendQueue.enqueue({ stream, resolve, reject });
        this.dbgTotalUnfulfilled++;
        this.dbgTotalQueued++;
      });
    }

    const { stream: dst, resolve, reject } = sock.counter.recvQueue.dequeue();
    this.dbgTotalQueued--;
    this.dbgTotalUnfulfilled++;

    try {
      await this.#pipe(stream, dst, conn);
      resolve();
    } catch (e) {
      reject(e);
      throw e;
    } finally {
      this.#checkAndDeleteSock(id, sock);
      this.dbgTotalUnfulfilled -= 2;
    }
  }

  async recv(id, key, stream) {
    const { conn, sock } = this.#getSock(id, key);

    if (sock.counter.closed)
      return;

    if (sock.counter.sendQueue.isEmpty()) {
      return new Promise((resolve, reject) => {
        sock.recvQueue.enqueue({ stream, resolve, reject });
        this.dbgTotalUnfulfilled++;
        this.dbgTotalQueued++;
      });
    }

    const { stream: src, resolve, reject } = sock.counter.sendQueue.dequeue();
    this.dbgTotalQueued--;
    this.dbgTotalUnfulfilled++;

    try {
      await this.#pipe(src, stream, conn);
      resolve();
    } catch (e) {
      reject(e);
      throw e;
    } finally {
      this.#checkAndDeleteSock(id, sock);
      this.dbgTotalUnfulfilled -= 2;
    }
  }

  prune(opts) {
    const now = new Date().getTime();
    while (!this.#map.isEmpty()) {
      const oldest = this.#map.lruValue();

      if (oldest.expires > now) break;

      oldest.cancel(new RelayServerError('timeout', RelayServer.ErrorCode.timeout));

      for (const sock of oldest.socks.values()) {
        this.#shutSock(sock, new RelayServerError('timeout', RelayServer.ErrorCode.timeout));
      }
      this.#deleteSock(oldest.id, [...oldest.socks.values()][0]);

      (opts?.logger ?? logger).info(`socket closed: ${oldest.id}`);
    }
  }

  #getSock(id, key) {
    const conn = this.#map.get(id);

    if (!conn)
      throw new RelayServerError(`no such socket: ${id}`, RelayServer.ErrorCode.noSuchSocket);

    const sock = conn.socks.get(key);

    if (!sock)
      throw new RelayServerError(`wrong key: ${cryptoJs.SHA256(key)}`, RelayServer.ErrorCode.wrongKey);

    return { conn, sock };
  }

  #pipe(send, recv, conn) {
    return new Promise((resolve, reject) => {
      send.pipe(recv);
      send.on('data', () => {
        conn.expires = this.#expires();
        this.#map.use(conn.id);
      });
      send.on('end', () => {
        if (conn.canceled) reject(conn.cancelPromise);
        else resolve();
      });
      send.on('error', reject);
      recv.on('error', reject);
      conn.cancelPromise.then(resolve, reject);
    });
  }

  #checkAndDeleteSock(id, sock) {
    if (!(sockIsEnd(sock) && sockIsEnd(sock.counter))) return;

    this.#deleteSock(id, sock);
  }

  #deleteSock(id, sock) {
    this.#endSock(sock);
    this.#endSock(sock.counter);
    this.#map.delete(id);
  }

  #shutSock(sock, reason) {
    while (!sock.recvQueue.isEmpty()) {
      sock.recvQueue.dequeue().reject(reason);
      this.dbgTotalUnfulfilled--;
      this.dbgTotalQueued--;
    }
    while (!sock.sendQueue.isEmpty()) {
      sock.sendQueue.dequeue().reject(reason);
      this.dbgTotalUnfulfilled--;
      this.dbgTotalQueued--;
    }
  }

  #endSock(sock) {
    while (!sock.recvQueue.isEmpty()) {
      sock.recvQueue.dequeue().resolve();
      this.dbgTotalUnfulfilled--;
      this.dbgTotalQueued--;
    }
  }
}

function sockIsEnd(sock) {
  return sock.closed && sock.sendQueue.isEmpty();
}

class RelayServerError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const ErrorCode = {
  noSuchSocket: 'no such socket',
  wrongKey: 'wrong key',
  alreadyEstablished: 'already established',
  alreadyClosed: 'already closed',
  timeout: 'timeout',
};
Object.freeze(ErrorCode);
Object.defineProperty(RelayServer, 'ErrorCode', { value: ErrorCode, writable: false });
