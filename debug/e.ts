import { match } from "../src/match";

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

function h(x: string, y: number): number {
  return match([x, y] as const)
    .returns<number>()
    .case<["zero", 0]>(() => 0)
    .case<["one", 1]>(() => 1)
    .case<["two", 2]>(() => 2)
    .case<["hello", number]>(() => 3)
    .default(() => -1);
}
