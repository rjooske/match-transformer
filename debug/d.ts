function d() {
  type B = number | boolean;
  type C = { ccc: boolean };

  type A__ = { aaa: string };
  const b__: { bbb: number } = { bbb: 42 };
  const c__: false = false;
  const d__: number = 42;
  const e__: B = 0 as any;
  const f__: boolean | 0 = 0;
  const g__: boolean = true;
  const h__: 2 = 2;
  const i__: number[] = [1, 2, 3];
  const j__: C = 0 as any;
  const k__: [boolean, number, number?] = [false, 0];
  const l__: unknown = 0;
  const m__: string | "foo" = "a";
  const n__: string | "foo" | unknown = "a";

  type List = { kind: "nil" } | { kind: "cons"; next: List; element: string };
  const list__: List = 0 as any;

  const x = 1 + 2;
  return x;
}
