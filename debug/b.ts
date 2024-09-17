declare function match<T, U>(t: T): Match<T, U>;

type Match<T, U> = {
  case<V extends T>(
    f: (v: V) => U,
  ): Exclude<T, V> extends never ? U : Match<Exclude<T, V>, U>;
  caseWhen<V extends T>(
    predicate: (v: V) => boolean,
    f: (v: V) => U,
  ): Match<T, U>;
  default(f: (t: T) => U): U;
};

function f4(x: unknown) {
  type T1 = [string, boolean];
  type T2 = { foo: boolean[] };

  return match(x)
    .case<T1>(() => true)
    .case<T2>(() => true)
    .default(() => false);
}
