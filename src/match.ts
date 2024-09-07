export function match<T>(t: T): MatchWithoutReturnType<T> {
  t;
  throw new Error("match should not be called at runtime");
}

export type MatchWithoutReturnType<T> = {
  returns<U = unknown>(): Match<T, U>;
};

export type Match<T, U> = {
  case<V extends T>(
    f: (v: V) => U,
  ): Exclude<T, V> extends never ? U : Match<Exclude<T, V>, U>;
  default(f: (t: T) => U): U;
};
