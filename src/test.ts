import { match } from "./match";
import assert from "assert";

function literals(x: unknown): number {
  return match(x)
    .returns<number>()
    .case<undefined>(() => 0)
    .case<null>(() => 1)
    .case<true>(() => 2)
    .case<false>(() => 3)
    .case<65>(() => 4)
    .case<42n>(() => 5)
    .case<"hello world">(() => 6)
    .default(() => 7);
}

function testLiterals() {
  const tests = [
    [undefined, 0],
    [null, 1],
    [true, 2],
    [false, 3],
    [65, 4],
    [42n, 5],
    ["hello world", 6],
    [{ foo: 1 }, 7],
    [[1, 2, 3], 7],
  ];
  for (const [input, want] of tests) {
    const got = literals(input);
    assert(got === want);
  }
}

function primitives(x: unknown): number {
  return match(x)
    .returns<number>()
    .case<boolean>(() => 0)
    .case<number>(() => 1)
    .case<bigint>(() => 2)
    .case<string>(() => 3)
    .default(() => 4);
}

function testPrimitives() {
  const tests = [
    [false, 0],
    [true, 0],
    [123, 1],
    [321n, 2],
    ["foo", 3],
    ["bar", 3],
    [{ bar: 2 }, 4],
    [[true, true], 4],
  ];
  for (const [input, want] of tests) {
    const got = primitives(input);
    assert(got === want);
  }
}

function arrays(x: unknown): number {
  return match(x)
    .returns<number>()
    .case<boolean[]>(() => 0)
    .case<number[][]>(() => 1)
    .case<unknown[]>(() => 2)
    .default(() => 3);
}

function testArrays() {
  const tests = [
    [[], 0],
    [[false, true, false, true], 0],
    [
      [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
      1,
    ],
    [[{ a: "a" }, "b", ["c"]], 2],
    ["string", 3],
    [456, 3],
  ];
  for (const [input, want] of tests) {
    const got = arrays(input);
    assert(got === want);
  }
}

function tuples(x: unknown): number {
  return match(x)
    .returns<number>()
    .case<[string, string, string]>(() => 0)
    .case<[unknown, number]>(() => 1)
    .default(() => 2);
}

function testTuples() {
  const tests = [
    [["a", "b", "c"], 0],
    [["a", "b", "c", "d"], 2],
    [[8], 2],
    [["7", 7], 1],
    [[false, undefined], 2],
    [[], 2],
    [{ id: 789 }, 2],
  ];
  for (const [input, want] of tests) {
    const got = tuples(input);
    assert(got === want);
  }
}

function unions(x: unknown): number {
  return match(x)
    .returns<number>()
    .case<boolean | number>(() => 0)
    .case<string | undefined>(() => 1)
    .case<string | "foo" | unknown>(() => 2)
    .default(() => 3);
}

function testUnions() {
  const tests = [
    [true, 0],
    [false, 0],
    [42, 0],
    [undefined, 1],
    ["foo", 1],
    [null, 2],
    [[3, 2, 1], 2],
    [{ c: "c" }, 2],
  ];
  for (const [input, want] of tests) {
    const got = unions(input);
    assert(got === want);
  }
}

function records(x: unknown): number {
  return match(x)
    .returns<number>()
    .case<Record<string, boolean>>(() => 0)
    .case<Record<string, [1, 2]>>(() => 1)
    .case<Record<string, "foo">>(() => 2)
    .default(() => -1);
}

function testRecords() {
  const tests = [
    [{ yes: true, no: false }, 0],
    [{ yes: true, no: false, 42: true }, 0],
    [{}, 0],
    [{ one: [1, 2], two: [1, 2] }, 1],
    [{ a: "foo", b: "foo", c: "foo" }, 2],
    [{ foo: "bar" }, -1],
    [999, -1],
  ];
  for (const [input, want] of tests) {
    const got = records(input);
    assert(got === want);
  }
}

function objects(x: unknown): number {
  return match(x)
    .returns<number>()
    .case<{ a: "A" }>(() => 0)
    .case<{ b: number | number[] }>(() => 1)
    .case<{ c: [string | boolean, boolean] }>(() => 2)
    .case<{ kind: "ok"; message: string } | { kind: "err"; code: number }>(
      () => 3,
    )
    .default(() => 4);
}

function testObjects() {
  const tests = [
    [{ a: "A" }, 0],
    [{ b: [6, 5] }, 1],
    [{ b: 1 }, 1],
    [{ c: [false, true] }, 2],
    [{ c: ["foo", false] }, 2],
    [{ c: ["bar", true] }, 2],
    [{ kind: "ok", message: "hello world" }, 3],
    [{ kind: "err", code: 3 }, 3],
    [{ kind: "err", code: 3, reason: "who knows" }, 3],
    [{ kind: "ok" }, 4],
    [[5, 4, 3, 2, 1], 4],
  ];
  for (const [input, want] of tests) {
    const got = objects(input);
    assert(got === want);
  }
}

function useTestee(x: unknown): string {
  return match(x)
    .returns<string>()
    .case<number>((x) => x.toString())
    .case<string>((x) => x)
    .case<[number, string, number]>(([_a, b, _c]) => b)
    .case<{ foo: boolean; bar: string }>(({ bar }) => bar)
    .default(() => "default");
}

function testUseTestee() {
  const tests = [
    [42, "42"],
    ["hello", "hello"],
    [[1, "2", 3], "2"],
    [{ foo: false, bar: "bar" }, "bar"],
    [true, "default"],
    [{ abc: "abc" }, "default"],
  ];
  for (const [input, want] of tests) {
    const got = useTestee(input);
    assert(got === want);
  }
}

// TODO: non unknown input
function main() {
  testLiterals();
  testPrimitives();
  testArrays();
  testTuples();
  testUnions();
  testRecords();
  testObjects();
  testUseTestee();
}

main();
