import {
  InfiniteBufferedChannel, uint8Array, base64ToBytes, bytesToBase64, taeq,
} from '/util.mjs';
import {
  ByteSplitStream, ChunkwiseJSONParseStream, NullSeparatedJSONStringifyStream,
  ChecksumStream,
} from '/stream.mjs';
import { DH, Cipher } from '/crypto.mjs';
import {
  Host, Relay, RelayReadableStream, RelayWritableStream,
} from '/api.mjs';

export class CipherSocket {
  #cipher;
  #enc;
  #dec;
  #loc;
  #sendLoopPromise;
  #recvLoopPromise;
  #closed;

  constructor(cipher, loc) {
    this.#cipher = cipher;
    this.#enc = cipher.createEncryptStream();
    this.#dec = cipher.createDecryptStream();
    this.#loc = loc;
  }

  start() {
    this.#sendLoopPromise = this.#sendLoop();
    this.#recvLoopPromise = this.#recvLoop();
    this.#closed = Promise.all([
      this.#sendLoopPromise,
      this.#recvLoopPromise,
    ]);
  }

  async closed() {
    return this.#closed;
  }

  async #sendLoop() {
    await this.#enc.readable.pipeTo(new RelayWritableStream(this.#loc));
  }

  async #recvLoop() {
    await new RelayReadableStream(this.#loc).pipeTo(this.#dec.writable);
  }

  get writable() {
    return this.#enc.writable;
  }

  get readable() {
    return this.#dec.readable;
  }
}

export class ControlSocket {
  #loc;
  #dh;
  #key;
  #checkPubkey;
  #cipher;
  #cipherSocket;
  #writer;
  #reader;
  #endPromise;
  #hbflag;
  #hbinterval;
  #hbTimeout;
  #fileMap;
  #recvFileQueue;
  #challenge;

  constructor(loc, dh, pubkey) {
    this.#loc = loc;
    this.#dh = dh;
    this.#hbTimeout = 30000;
    this.#recvFileQueue = new InfiniteBufferedChannel();
    this.#checkPubkey = uint8Array(pubkey);
    this.#fileMap = new Map();
  }

  async start() {
    await this.#handshake();

    this.#cipherSocket = new CipherSocket(this.#cipher, this.#loc);

    const sendStream = new NullSeparatedJSONStringifyStream();
    this.#writer = sendStream.writable.getWriter();
    this.#reader = this.#cipherSocket.readable.
      pipeThrough(new ByteSplitStream(0)).
      pipeThrough(new ChunkwiseJSONParseStream()).
      getReader();
    this.#endPromise = Promise.all([
      sendStream.readable.pipeTo(this.#cipherSocket.writable),
      this.#recvLoop(),
    ]);

    this.#cipherSocket.start();

    this.#hbinterval = setInterval(() => this.#hbHandler(), this.#hbTimeout);

    const challenge = window.crypto.randomUUID();
    this.#send({
      type: 'challenge',
      challenge,
    });
    await new Promise((resolve, reject) => {
      this.#challenge = {
        challenge,
        resolve,
        reject,
      }
    });
  }

  async #send(obj) {
    this.#hbflag = false;
    await this.#writer.write(obj);
  }

  async #hbHandler() {
    if (this.#hbflag) {
      clearInterval(this.#hbinterval);
      await this.#writer.write({
        type: 'heartbeat',
      });
      this.#hbinterval = setInterval(() => this.#hbHandler(), this.#hbTimeout);
    }

    this.#hbflag = true;
  }

  async #recvLoop() {
    for (;;) {
      const { value: obj, done } = await this.#reader.read();
      if (done) break;
      switch (obj.type) {
        case 'heartbeat':
          break;
        case 'sendFile':
          if (this.#fileMap.has(obj.id)) throw new Error(`duplicate id: ${obj.id}`);
          const d = {
            metadata: obj.metadata,
            loc: obj.loc,
            iv: obj.iv,
            checksum: undefined,
            resolveChecksum: undefined,
          };
          d.checksum = new Promise((resolve) => {
            d.resolveChecksum = resolve;
          });
          this.#fileMap.set(obj.id, d);
          this.#recvFileQueue.send(obj.id);
          break;
        case 'checksum':
          const file = this.#fileMap.get(obj.id);
          if (!file) throw new Error(`no such id: ${obj.id}`);
          file.resolveChecksum(obj.checksum);
          break;
        case 'challenge':
          await this.#send({
            type: 'challengeResponse',
            response: obj.challenge,
          });
          break;
        case 'challengeResponse':
          if (!this.#challenge) break;
          if (this.#challenge.challenge != obj.response) {
            this.#challenge.reject(new Error('challenge failed'));
          }
          this.#challenge.resolve();
          // At least one knows the other's public key from the QR code,
          // and generates the correct symmetric key.
          // This challenge checks if the two are sharing the same key.
          break;
        default:
          throw new Error(`unknown command: ${obj.type}`);
      }
    }
  }

  async #handshake() {
    const [, pk] = await Promise.all([
      Relay.send(this.#loc, await this.#dh.publicKey),
      Relay.recv(this.#loc).then(uint8Array),
    ]);
    if (this.#checkPubkey && !taeq(pk, this.#checkPubkey))
      throw new Error('wrong public key');
    this.#key = await this.#dh.deriveKey(pk);
    this.#cipher = new Cipher(this.#key);
    const [, iv] = await Promise.all([
      Relay.send(this.#loc, this.#cipher.iv),
      Relay.recv(this.#loc),
    ]);
    this.#cipher.initDecrypt(iv);
  }

  async sendFile(metadata, stream) {
    const loc = await Host.connect();
    const cipher = new Cipher(this.#key);
    const id = window.crypto.randomUUID();
    await Promise.all([this.#send({
      type: 'sendFile',
      id,
      metadata,
      loc,
      iv: bytesToBase64(cipher.iv),
    }), Relay.open(loc)]);
    const sock = new CipherSocket(cipher, loc);
    const [s1, s2] = stream.tee();
    const cksumS = new ChecksumStream();
    const checksumSent = s2.pipeTo(cksumS).then(() => cksumS.digest).then((checksum) => this.#send({
      type: 'checksum',
      id,
      checksum: bytesToBase64(checksum),
    }));
    const fileSent = s1.pipeTo(sock.writable).then(() => sock.closed());
    sock.start();
    return {
      fileSent,
      checksumSent,
    };
  }

  async recvFile() {
    const id = await this.#recvFileQueue.recv();
    const d = this.#fileMap.get(id);
    await Relay.open(d.loc);
    const cipher = new Cipher(this.#key);
    cipher.initDecrypt(base64ToBytes(d.iv));
    const sock = new CipherSocket(cipher, d.loc);
    const { ThroughputStream } = await import('/stream.mjs');
    const [s1, s2] = sock.readable.tee();
    const cksumS = new ChecksumStream();
    const cp = s2.pipeTo(cksumS).then(() => cksumS.digest);
    const ts = new TransformStream({
      start() {},
      async flush(controller) {
        const [a, b] = await Promise.all([cp.then(uint8Array), base64ToBytes(await d.checksum)]);
        if (!taeq(a, b)) {
          const err = new Error(`wrong checksum: '${bytesToBase64(a)}' != '${bytesToBase64(b)}'`);
          controller.error(err);
          return;
        }
      },
    });
    s1.pipeTo(ts.writable).catch(() => {});
    sock.start();
    return {
      metadata: d.metadata,
      readable: ts.readable,
    };
  }
}
