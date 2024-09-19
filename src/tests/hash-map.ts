import assert from "assert";
import { Hasher, HashMap } from "../hash-map";

type Key = { a: number; b: boolean; c: string };

function hashKey(hasher: Hasher, key: Key) {
  hasher.number(key.a);
  hasher.boolean(key.b);
  hasher.string(key.c);
}

function sameKey(a: Key, b: Key): boolean {
  return a.a === b.a && a.b === b.b && a.c === b.c;
}

function main() {
  const keyValuePairs: [Key, number][] = [];
  for (const a of [1, 2, 3]) {
    for (const b of [false, true]) {
      for (const c of ["foo", "bar", "hello", "world", "abc"]) {
        keyValuePairs.push([{ a, b, c }, keyValuePairs.length]);
      }
    }
  }

  const hashMap = new HashMap<Key, number>(hashKey, sameKey);

  for (const [key, value] of keyValuePairs) {
    assert(hashMap.set(key, value) === undefined);
  }
  assert(hashMap.size() === keyValuePairs.length);

  for (const [key, value] of hashMap.entries()) {
    assert(keyValuePairs.some(([k, v]) => sameKey(key, k) && value === v));
  }

  for (const [key, value] of keyValuePairs) {
    assert(hashMap.set(key, value) === value);
  }
  assert(hashMap.size() === keyValuePairs.length);

  for (const [key, value] of keyValuePairs) {
    assert(hashMap.get(key) === value);
  }
  assert(hashMap.get({ a: 1, b: false, c: "def" }) === undefined);
  assert(hashMap.get({ a: 123, b: true, c: "xyz" }) === undefined);

  for (const [key, value] of keyValuePairs) {
    assert(hashMap.remove(key) === value);
  }
  for (const [key] of keyValuePairs) {
    assert(hashMap.get(key) === undefined);
  }
  assert(hashMap.size() === 0);
}

main();
