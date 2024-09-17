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

function f1(x: string, y: number): number {
  return match<[string, number], number>([x, y])
    .case<["foo", 11]>(() => 0)
    .case<["foo", 22]>(() => 1)
    .case<["bar", 33]>(() => 2)
    .case<["bar", 44]>(() => 3)
    .default(() => 4);
}

type T =
  | { kind: "ab"; a: string; b: number[] }
  | { kind: "cd"; c: string[]; d: number[][] };

function validate(x: unknown): boolean {
  return match<unknown, boolean>(x)
    .case<{ kind: "ab"; a: string; b: number[] }>(() => true)
    .case<{ kind: "cd"; c: string[]; d: number[][] }>(() => true)
    .default(() => false);
}

type U = "a" | "bb" | "ccc";

function f2(u: U): number {
  return match<U, number>(u)
    .case<"a">((u) => u.length)
    .case<"bb">((u) => u.length)
    .case<"ccc">((u) => u.length);
}

function f3(u: U): number {
  return match<U, number>(u)
    .caseWhen<"a">(
      (_) => true,
      (u) => u.length,
    )
    .case<"a">((u) => u.length)
    .case<"bb">((u) => u.length)
    .case<"ccc">((u) => u.length);
}
