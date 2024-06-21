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

class List {
  end;

  constructor() {
    this.end = {
      prev: null,
      next: null,
    };
    this.end.prev = this.end.next = this.end;
  }

  static insert(before, value) {
    List.insertNode(before, {
      value,
      prev: null,
      next: null,
    });
  }

  static insertNode(before, n) {
    n.prev = before.prev;
    n.next = before;
    n.prev.next = n;
    n.next.prev = n;
  }

  static pop(n) {
    n.prev.next = n.next;
    n.next.prev = n.prev;
    return n.value;
  }

  isEmpty() {
    return this.end.next == this.end;
  }

  frontNode() {
    return this.end.next;
  }

  backNode() {
    return this.end.prev;
  }

  pushFront(value) {
    List.insert(this.end.next, value);
  }

  pushBack(value) {
    List.insert(this.end, value);
  }
}

export class Deque {
  #list;

  constructor() {
    this.#list = new List();
  }

  isEmpty() {
    return this.#list.isEmpty();
  }

  front() {
    return this.#list.frontNode().value;
  }

  back() {
    return this.#list.backNode().value;
  }

  pushFront(value) {
    this.#list.pushFront(value);
  }

  pushBack(value) {
    this.#list.pushBack(value);
  }

  popFront() {
    return List.pop(this.#list.frontNode());
  }

  popBack() {
    return List.pop(this.#list.backNode());
  }
}

export class LRUMap {
  #list;
  #map;

  constructor() {
    this.#list = new List();
    this.#map = new Map();
  }

  isEmpty() {
    return this.#map.size == 0;
  }

  lruValue() {
    return this.#list.frontNode().value.value;
  }

  lruKey() {
    return this.#list.frontNode().value.key;
  }

  popLRU() {
    const n = this.#list.frontNode();
    List.pop(n);
    this.#map.delete(n.value.key);
  }

  use(key) {
    const n = this.#map.get(key);
    if (!n) return;
    List.pop(n);
    List.insertNode(this.#list.end, n);
  }

  get(key) {
    return this.#map.get(key)?.value?.value;
  }

  has(key) {
    return this.#map.has(key);
  }

  delete(key) {
    const n = this.#map.get(key);
    if (!n) return;
    List.pop(n);
    this.#map.delete(key);
  }

  set(key, value) {
    if (this.#map.has(key)) {
      this.#map.get(key).value.value = value;
      return;
    }
    this.#list.pushBack({ key, value });
    this.#map.set(key, this.#list.backNode());
  }

  get size() {
    return this.#map.size;
  }
}
