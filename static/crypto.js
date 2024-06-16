var cryptoutil = (() => {
  const ecdh = { name: 'ECDH', namedCurve: 'P-256' };
  const aes = { name: 'AES-CTR', length: 256 };
  const chunkSize = 16384;

  class DH {
    #key;
    #pubkey;

    constructor() {
      this.#key = window.crypto.subtle.generateKey(ecdh, false, ['deriveKey']);
      this.#pubkey = this.#key.then((key) => window.crypto.subtle.exportKey('raw', key.publicKey));
    }

    async publicKey() {
      return this.#pubkey;
    }

    async deriveKey(publicKey) {
      return window.crypto.subtle.deriveKey(
        {
          name: 'ECDH',
          public: await window.crypto.subtle.importKey('raw', publicKey, ecdh, true, []),
        },
        await this.#key,
        aes,
        false,
        ['encrypt', 'decrypt'],
      );
    }
  }

  class Cipher {
    #key;
    #iv;
    #cnt;
    #dcnt;

    constructor(key) {
      this.#key = key;
      this.#iv = window.crypto.getRandomValues(new Uint32Array(4));
      this.#cnt = this.#iv.slice(0);
    }

    get iv() {
      return this.#iv.slice(0);
    }

    initDecrypt(iv) {
      if (this.#dcnt) throw new Error('already initialized');
      this.#dcnt = iv;
    }

    async encrypt(data) {
      const cnt = this.#cnt.slice(0);
      this.#cnt[0]++;

      return window.crypto.subtle.encrypt(
        { name: 'AES-CTR', counter: ctr, length: 32 },
        this.#key,
        data,
      );
    }

    async decrypt(data) {
      const cnt = this.#dcnt.slice(0);
      this.#dcnt[0]++;

      return window.crypto.subtle.decrypt(
        { name: 'AES-CTR', counter: ctr, length: 32 },
        this.#key,
        data,
      );
    }

    createEncryptStream() {
      return new TransformStream({
        async transform(chunk, controller) {
          console.log(`transforming ${chunk.length} bytes chunk`);

          chunk = uint8Array(chunk);

          for (let i = 0; i < chunk.byteLength; i += chunkSize) {
            const d = await this.encrypt(new Uint8Array(
              chunk.buffer, chunk.byteOffet + i, Math.min(chunkSize, chunk.byteLength - i)));
            controller.enqueue(new Uint16Array([d.byteLength]));
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
        async transform(chunk, controller) {
          if (chunk.byteLength === 0) return;
          buf.push(uint8Array(chunk));
          remaining -= chunk.byteLength;

          while (remaining <= 0) {
            if (len === null) {
              // buf.len = 1 or buf.len = 2

              if (buf[0].byteLength >= 2) { // buf.len = 1
                len = new DataView(new Uint8Array([buf[0][0], buf[0][1]])).getUint16(0);
                buf[0] = new Uint8Array(buf[0].buffer, buf[0].byteOffset + 2);
              } else { // buf.len = 2
                len = new DataView(new Uint8Array([buf[0][0], buf[1][0]])).getUint16(0);
                buf[0] = new Uint8Array(buf[1].buffer, buf[1].byteOffset + 1);
                buf.pop();
              }
              remaining = len - buf[0].byteLength;
              continue;
            }

            const last = buf[buf.length - 1];
            const left = new Uint8Array(
              last.buffer,
              last.ByteOffset + last.byteLength + remaining,
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

            controller.enqueue(await this.decrypt(b));

            buf.splice(0, buf.length, left);
          }
        },
      });
    }
  }

  function uint8Array(x) {
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    throw new Error('invalid chunk');
  }

  return {
    DH, Cipher,
  };
})();
