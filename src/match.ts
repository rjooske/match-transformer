export function match<T>(t: T): MatchWithoutReturnType<T> {
  t;
  throw new Error("match should not be called at runtime");
}

export type MatchWithoutReturnType<T> = {
  returns<U = unknown>(): Match<T, U>;
};

export type Match<T, U> = {
  case<V extends T>(f: (v: V) => U): Match<T, U>;
  default(f: (t: T) => U): U;
};

// export function match<T>(t: T): MatchWithoutReturnType<T> {
//   t;
//   throw new Error("match should not be called at runtime");
// }
//
// export type MatchWithoutReturnType<T> = {
//   returns<U = unknown>(): Match<T, U>;
// };
//
// export type Match<Input, Return> = {
//   case<Pattern>(
//     f: (v: Input & Pattern) => Return,
//   ): Exclude<Input, Pattern> extends never
//     ? Return
//     : Match<Exclude<Input, Pattern>, Return>;
//   default(f: (t: Input) => Return): Return;
// };
