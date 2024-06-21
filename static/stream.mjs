import { uint8Array, textEncoder, textDecoder } from '/util.mjs';

export class ByteSplitStream extends TransformStream {
  constructor(byte) {
    const buf = [];
    let len = 0;
    super({
      start() {},
      transform(chunk, controller) {
        chunk = uint8Array(chunk);
        for (;;) {
          const i = chunk.indexOf(byte);
          if (i === -1) {
            buf.push(chunk);
            len += chunk.byteLength;
            break;
          }

          const b = new Uint8Array(len + i);
          let off = 0;
          for (const x of buf) {
            b.set(x, off);
            off += x.byteLength;
          }
          b.set(off, new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteOffset + i));
          controller.enqueue(b);
          buf.splice(0, buf.length);
          len = 0;

          chunk = new Uint8Array(chunk.buffer, chunk.byteOffset + i + 1, chunk.byteLength - i - 1);
        }
      },
      flush(controller) {
        if (buf.length !== 0)
          controller.enqueue(buf[0]);
      },
    })
  }
}

export class ChunkwiseJSONParseStream extends TransformStream {
  constructor() {
    super({
      start() {},
      transform(chunk, controller) {
        controller.enqueue(JSON.parse(textDecoder.decode(chunk)));
      },
    });
  }
}

export class NullSeparatedJSONStringifyStream extends TransformStream {
  constructor() {
    super({
      start() {},
      transform(chunk, controller) {
        controller.enqueue(textEncoder.encode(JSON.stringify(chunk)));
        controller.enqueue(new Uint8Array(1));
      },
    })
  }
}

class ChunkwiseChecksumStream extends WritableStream {
  #digest;

  constructor() {
    let d = new Uint8Array();
    let setResult, abort;
    const digest = new Promise((resolve, reject) => {
      setResult = resolve;
      abort = reject;
    });
    super({
      async write(chunk, controller) {
        chunk = uint8Array(chunk);
        const b = new Uint8Array(d.byteLength + chunk.byteLength);
        b.set(d, 0);
        b.set(chunk, d.byteLength);
        d = await window.crypto.subtle.digest('SHA-256', b);
      },
      close(controller) {
        setResult(d);
      },
      abort,
    });
    this.#digest = digest;
  }

  get digest() {
    return this.#digest;
  }
}

class SlicingStream extends TransformStream {
  constructor(bs) {
    const buf = [];
    let totalLen = 0;
    super({
      start() {},
      transform(chunk, controller) {
        chunk = uint8Array(chunk);
        totalLen += chunk.byteLength;
        while (totalLen >= bs) {
          const b = new Uint8Array(bs);
          let off = 0;
          for (const x of buf) {
            b.set(x, off);
            off += x.byteLength;
          }
          const rem = bs - off;
          b.set(new Uint8Array(chunk.buffer, chunk.byteOffset, rem), off);
          controller.enqueue(b);
          chunk = new Uint8Array(chunk.buffer, chunk.byteOffset + rem, chunk.byteLength - rem);
          totalLen -= bs;
          buf.splice(0, buf.length);
        }
      },
      flush(controller) {
        const b = new Uint8Array(totalLen);
        let off = 0;
        for (const x of buf) {
          b.set(x, off);
          off += x.byteLength;
        }
        controller.enqueue(b);
      },
    })
  }
}

export class ChecksumStream {
  constructor() {
    const st = new SlicingStream(1024);
    const cw = new ChunkwiseChecksumStream();
    st.readable.pipeTo(cw);

    Object.defineProperty(st.writable, 'digest', {
      value: cw.digest,
      writable: false,
    });

    return st.writable;
  }
}
