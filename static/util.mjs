export function uint8Array(x) {
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x))
    return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  throw new Error("invalid chunk");
}

export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder();

export class Queue {
  #first;
  #last;

  enqueue(value) {
    const n = {
      value,
      next: null,
    };
    if (!this.#first) {
      this.#first = this.#last = n;
      return;
    }
    this.#last.next = n;
    this.#last = n;
  }

  isEmpty() {
    return !this.#first;
  }

  front() {
    return this.#first.value;
  }

  dequeue() {
    const { value } = this.#first;
    this.#first = this.#first.next;
    return value;
  }
}

export class InfiniteBufferedChannel {
  #buf;
  #waiters;

  constructor() {
    this.#buf = new Queue();
    this.#waiters = new Queue();
  }

  send(value) {
    if (this.#waiters.isEmpty()) {
      this.#buf.enqueue(value);
      return;
    }

    this.#waiters.dequeue()(value);
  }

  async recv() {
    if (this.#buf.isEmpty()) {
      return new Promise((resolve) => {
        this.#waiters.enqueue(resolve);
      });
    }

    return this.#buf.dequeue();
  }
}

export function base64ToBytes(base64) {
  const binString = atob(base64);
  return Uint8Array.from(binString, (m) => m.charCodeAt(0));
}

export function bytesToBase64(bytes) {
  const binString = Array.from(uint8Array(bytes), (x) =>
    String.fromCharCode(x),
  ).join("");
  return btoa(binString);
}

export async function readAll(stream) {
  const reader = stream.getReader();
  const buf = [];
  let len = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buf.push(uint8Array(value));
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

export function taeq(a, b) {
  if (a.length != b.length || a.byteLength != b.byteLength) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }

  return true;
}
