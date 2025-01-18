function f(x: unknown): string {
  return match(x)
    .returns<string>()
    .case<["foo", number]>(() => "a")
    .case<["bar", 5]>(() => "b")
    .case<[string, boolean]>(() => "c")
    .default(() => "d");
}

function g(x: unknown): number {
  return match(x)
    .returns<number>()
    .case<Record<string, boolean>>(() => 0)
    .default(() => -1);
}
