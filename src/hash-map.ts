function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

function rotateLeft(x: number, amount: number): number {
  return (x << amount) | (x >>> (32 - amount));
}

function wrappingMul(a: number, b: number): number {
  return Number((BigInt(a) * BigInt(b)) & BigInt(0xffffffff));
}

// Fx hash
// https://github.com/cbreeden/fxhash
// TODO: this is slightly wrong because numbers are treated as i32
function hash(h: number, newValue: number): number {
  h = rotateLeft(h, 5);
  h ^= newValue;
  h = wrappingMul(h, 0x9e_37_79_b9);
  return h;
}

function hashBytes(h: number, bytes: Uint8Array): number {
  const n = Math.ceil(bytes.length / 4);
  for (let i = 0; i < n; i++) {
    let x = 0;
    for (let j = 0; j < 4; j++) {
      const k = 4 * i + j;
      if (k < bytes.length) {
        x |= bytes[k];
      }
      if (j != 3) {
        x <<= 4;
      }
    }
    h = hash(h, x);
  }
  return h;
}

export class Hasher {
  private hash = 0x9a8b7c6d;

  getHash(): number {
    return this.hash;
  }

  boolean(v: boolean) {
    this.hash = hash(this.hash, v ? 1 : 0);
  }

  number(v: number) {
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleLE(v);
    this.hash = hashBytes(this.hash, bytes);
  }

  string(v: string) {
    const bytes = new TextEncoder().encode(v);
    this.hash = hashBytes(this.hash, bytes);
  }
}

type HashMapElement<K, V> = { key: K; value: V };

export class HashMap<K, V> {
  private buckets: HashMapElement<K, V>[][] = [];
  private elementCount = 0;

  constructor(
    private hashKey: (h: Hasher, k: K) => void,
    private sameKey: (a: K, b: K) => boolean,
  ) {
    for (let i = 0; i < 5; i++) {
      this.buckets.push([]);
    }
  }

  private keyToBucket(key: K): HashMapElement<K, V>[] {
    const hasher = new Hasher();
    hasher.number(this.buckets.length);
    this.hashKey(hasher, key);
    return this.buckets[mod(hasher.getHash(), this.buckets.length)];
  }

  private loadFactor(): number {
    return this.elementCount / this.buckets.length;
  }

  private expand() {
    const oldBuckets = this.buckets;
    this.buckets = [];
    for (let i = 0; i < 2 * oldBuckets.length; i++) {
      this.buckets.push([]);
    }
    for (const bucket of oldBuckets) {
      for (const element of bucket) {
        this.keyToBucket(element.key).push(element);
      }
    }
  }

  size(): number {
    return this.elementCount;
  }

  get(key: K): V | undefined {
    const bucket = this.keyToBucket(key);
    for (const element of bucket) {
      if (this.sameKey(key, element.key)) {
        return element.value;
      }
    }
  }

  set(key: K, value: V): V | undefined {
    if (this.loadFactor() > HashMap.MAX_LOAD_FACTOR) {
      this.expand();
    }
    const bucket = this.keyToBucket(key);
    for (const element of bucket) {
      if (this.sameKey(key, element.key)) {
        const oldValue = element.value;
        element.value = value;
        return oldValue;
      }
    }
    bucket.push({ key, value });
    this.elementCount++;
  }

  remove(key: K): V | undefined {
    const bucket = this.keyToBucket(key);
    for (let i = 0; i < bucket.length; i++) {
      const element = bucket[i];
      if (this.sameKey(key, element.key)) {
        bucket.splice(i, 1);
        this.elementCount--;
        return element.value;
      }
    }
  }

  *entries(): Generator<[K, V], void, void> {
    for (const bucket of this.buckets) {
      for (const { key, value } of bucket) {
        yield [key, value];
      }
    }
  }

  private static MAX_LOAD_FACTOR = 0.75;
}
