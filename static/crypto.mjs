import { uint8Array } from '/util.mjs';

const ecdh = { name: 'ECDH', namedCurve: 'P-256' };
const aes = { name: 'AES-CTR', length: 256 };
const chunkSize = 16384;

export class DH {
  #key;
  #pubkey;

  constructor() {
    this.#key = window.crypto.subtle.generateKey(ecdh, false, ['deriveKey']);
    this.#pubkey = this.#key.then((key) => window.crypto.subtle.exportKey('raw', key.publicKey));
  }

  get publicKey() {
    return this.#pubkey;
  }

  async deriveKey(publicKey) {
    return window.crypto.subtle.deriveKey(
      {
        name: 'ECDH',
        public: await window.crypto.subtle.importKey('raw', publicKey, ecdh, true, []),
      },
      (await this.#key).privateKey,
      aes,
      false,
      ['encrypt', 'decrypt'],
    );
  }
}

export class Cipher {
  #key;
  #iv;
  #cnt;
  #dcnt;

  constructor(key, iv) {
    this.#key = key;
    const ivbuf = new Uint8Array(16);
    if (iv) ivbuf.set(uint8Array(iv));
    else window.crypto.getRandomValues(ivbuf);
    this.#iv = new Uint32Array(ivbuf.buffer);
    this.#cnt = this.#iv.slice(0);
  }

  get iv() {
    return this.#iv.slice(0);
  }

  encryptCounter() {
    return this.#cnt.slice(0);
  }

  decryptCounter() {
    return this.#dcnt.slice(0);
  }

  setEncryptCounter(cnt) {
    cnt = uint8Array(cnt);
    const b = new Uint8Array(16);
    b.set(cnt);
    this.#cnt = new Uint32Array(b.buffer);
  }

  setDecryptCounter(cnt) {
    cnt = uint8Array(cnt);
    const b = new Uint8Array(16);
    b.set(cnt);
    this.#dcnt = new Uint32Array(b.buffer);
  }

  initDecrypt(iv) {
    if (this.#dcnt) throw new Error('already initialized');
    this.setDecryptCounter(iv);
  }

  async encrypt(data) {
    const cnt = this.#cnt.slice(0);
    this.#cnt[0]++;

    return window.crypto.subtle.encrypt(
      { name: 'AES-CTR', counter: cnt, length: 32 },
      this.#key,
      data,
    );
  }

  async decrypt(data) {
    const cnt = this.#dcnt.slice(0);
    this.#dcnt[0]++;

    return window.crypto.subtle.decrypt(
      { name: 'AES-CTR', counter: cnt, length: 32 },
      this.#key,
      data,
    );
  }

  createEncryptStream() {
    return new TransformStream({
      start() {},
      transform: async (chunk, controller) => {
        chunk = uint8Array(chunk);

        for (let i = 0; i < chunk.byteLength; i += chunkSize) {
          const d = await this.encrypt(new Uint8Array(
            chunk.buffer, chunk.byteOffset + i, Math.min(chunkSize, chunk.byteLength - i)));
          const lenbuf = new ArrayBuffer(2);
          new DataView(lenbuf).setUint16(0, d.byteLength);
          controller.enqueue(lenbuf);
          controller.enqueue(d);
        }
      },
    });
  }

  createDecryptStream() {
    const buf = [];
    let len = null;
    let remaining = 2;
    return new TransformStream({
      start() {},
      transform: async (chunk, controller) => {
        if (chunk.byteLength === 0) return;
        buf.push(uint8Array(chunk));
        remaining -= chunk.byteLength;

        while (remaining <= 0) {
          if (len === null) {
            // buf.len = 1 or buf.len = 2

            if (buf[0].byteLength >= 2) { // buf.len = 1
              len = new DataView(new Uint8Array([buf[0][0], buf[0][1]]).buffer).getUint16(0);
              buf[0] = new Uint8Array(buf[0].buffer, buf[0].byteOffset + 2);
            } else { // buf.len = 2
              len = new DataView(new Uint8Array([buf[0][0], buf[1][0]]).buffer).getUint16(0);
              buf[0] = new Uint8Array(buf[1].buffer, buf[1].byteOffset + 1);
              buf.pop();
            }
            remaining = len - buf[0].byteLength;
            continue;
          }

          const last = buf[buf.length - 1];
          const left = new Uint8Array(
            last.buffer,
            last.byteOffset + last.byteLength + remaining,
            -remaining);
          buf[buf.length - 1] = new Uint8Array(
            last.buffer,
            last.byteOffset,
            last.byteLength + remaining);

          const b = new Uint8Array(len);
          let off = 0;
          for (const x of buf) {
            b.set(x, off);
            off += x.byteLength;
          }

          const d = await this.decrypt(b);
          controller.enqueue(d);

          if (left.byteLength === 0) {
            buf.splice(0, buf.length);
            len = null;
            remaining = 2;
            break;
          }

          buf.splice(0, buf.length, left);
          len = null;
          remaining = 2 - left.byteLength;
        }
      },
    });
  }
}
