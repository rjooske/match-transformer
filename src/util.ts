export function unreachable(_: never): never {
  throw new Error("should be unreachable");
}

export function todo(message?: string): never {
  throw new Error("TODO: " + message);
}

export function exactlyOne<T>(ts: Iterable<T>): T | undefined {
  let maybeT: T | undefined;
  for (const t of ts) {
    if (maybeT === undefined) {
      maybeT = t;
    } else {
      return undefined;
    }
  }
  return maybeT;
}

export function* map<T, U>(
  ts: Iterable<T>,
  f: (t: T) => U,
): Generator<U, void, void> {
  for (const t of ts) {
    yield f(t);
  }
}

export function every<T>(
  ts: Iterable<T>,
  predicate: (t: T) => boolean,
): boolean {
  for (const t of ts) {
    if (!predicate(t)) {
      return false;
    }
  }
  return true;
}

export function* zip<A, B>(
  as: Iterable<A>,
  bs: Iterable<B>,
): Generator<[A, B], void, void> {
  const ai = as[Symbol.iterator]();
  const bi = bs[Symbol.iterator]();
  while (true) {
    const a = ai.next();
    const b = bi.next();
    if (a.done === true || b.done === true) {
      break;
    }
    yield [a.value, b.value];
  }
}

export function* cartesianProduct<T>(
  arrays: T[][],
): Generator<T[], void, void> {
  const n = arrays.reduce<number>((acc, array) => acc * array.length, 1);

  const divisors: number[] = [1];
  for (let i = 1; i < arrays.length; i++) {
    divisors.push(divisors[i - 1] * arrays[i - 1].length);
  }

  for (let i = 0; i < n; i++) {
    const ts = new Array<T>(arrays.length);
    for (let j = 0; j < arrays.length; j++) {
      const divisor = divisors[j];
      const length = arrays[j].length;
      const k = Math.floor(i / divisor) % length;
      ts[j] = arrays[j][k];
    }
    yield ts;
  }
}
