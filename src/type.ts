import ts from "typescript";
import { map, unreachable, zip } from "./util";

export type Literal =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "bigint"; value: ts.PseudoBigInt }
  | { kind: "undefined" }
  | { kind: "null" };

export type Primitive = "string" | "number" | "bigint" | "boolean";

export type Type =
  | { kind: "unknown" }
  | { kind: "literal"; literal: Literal }
  | { kind: "primitive"; primitive: Primitive }
  | { kind: "tuple"; elements: Union[] }
  | { kind: "array"; element: Union }
  | { kind: "object"; fields: Map<string, Union> }
  | { kind: "record"; value: Union };

export type Union = Type[];

export type Accessor =
  | { kind: "property"; name: string }
  | { kind: "index"; index: number }
  | { kind: "array-element" }
  | { kind: "record-values" };

export type Occurrence = Accessor[];

// Equality functions {{{

export function literalEqual(a: Literal, b: Literal): boolean {
  switch (a.kind) {
    case "number":
      return b.kind === "number" && a.value === b.value;
    case "string":
      return b.kind === "string" && a.value === b.value;
    case "boolean":
      return b.kind === "boolean" && a.value === b.value;
    case "bigint":
      return (
        b.kind === "bigint" &&
        a.value.negative === b.value.negative &&
        a.value.base10Value === b.value.base10Value
      );
    case "undefined":
      return b.kind === "undefined";
    case "null":
      return b.kind === "null";
    default:
      unreachable(a);
  }
}

export function primitiveEqual(a: Primitive, b: Primitive): boolean {
  return a === b;
}

function objectFieldsEqual(
  a: Map<string, Union>,
  b: Map<string, Union>,
): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [ak, av] of a.entries()) {
    const bv = b.get(ak);
    if (!(bv !== undefined && unionEqual(av, bv))) {
      return false;
    }
  }
  return true;
}

export function typeEqual(a: Type, b: Type): boolean {
  switch (a.kind) {
    case "unknown":
      return b.kind === "unknown";
    case "literal":
      return b.kind === "literal" && literalEqual(a.literal, b.literal);
    case "primitive":
      return b.kind === "primitive" && primitiveEqual(a.primitive, b.primitive);
    case "tuple":
      return b.kind === "tuple" && unionAllEqual(a.elements, b.elements);
    case "array":
      return b.kind === "array" && unionEqual(a.element, b.element);
    case "object":
      return b.kind === "object" && objectFieldsEqual(a.fields, b.fields);
    case "record":
      return b.kind === "record" && unionEqual(a.value, b.value);
    default:
      unreachable(a);
  }
}

export function unionEqual(a: Union, b: Union): boolean {
  if (a.length !== b.length) {
    return false;
  }
  a = Array.from(a);
  b = Array.from(b);
  for (const at of a) {
    let removed = false;
    for (let i = 0; i < b.length; i++) {
      if (typeEqual(at, b[i])) {
        b.splice(i, 1);
        removed = true;
        break;
      }
    }
    if (!removed) {
      return false;
    }
  }
  return true;
}

export function unionAllEqual(as: Union[], bs: Union[]): boolean {
  if (as.length !== bs.length) {
    return false;
  }
  for (let i = 0; i < as.length; i++) {
    if (!unionEqual(as[i], bs[i])) {
      return false;
    }
  }
  return true;
}

// }}} Equality functions

// Subtype functions {{{

export function literalIsSubtypeOfPrimitive(a: Literal, b: Primitive): boolean {
  switch (a.kind) {
    case "number":
      return b === "number";
    case "string":
      return b === "string";
    case "boolean":
      return b === "boolean";
    case "bigint":
      return b === "bigint";
    case "undefined":
      return false;
    case "null":
      return false;
    default:
      unreachable(a);
  }
}

/**
 * `as` and `bs` are the elements of tuples.
 */
function tupleIsSubtype(as: Union[], bs: Union[]): boolean {
  if (as.length !== bs.length) {
    return false;
  }
  for (let i = 0; i < as.length; i++) {
    if (!unionIsSubtype(as[i], bs[i])) {
      return false;
    }
  }
  return true;
}

function objectIsSubtype(
  a: Map<string, Union>,
  b: Map<string, Union>,
): boolean {
  for (const [ak, av] of a.entries()) {
    const bv = b.get(ak);
    if (!(bv !== undefined && unionIsSubtype(av, bv))) {
      return false;
    }
  }
  return true;
}

/**
 * Returns true if `a` is a subtype of `b`.
 */
export function typeIsSubtype(a: Type, b: Type): boolean {
  switch (b.kind) {
    case "unknown":
      return true;
    case "literal":
      return a.kind === "literal" && literalEqual(a.literal, b.literal);
    case "primitive":
      return (
        (a.kind === "literal" &&
          literalIsSubtypeOfPrimitive(a.literal, b.primitive)) ||
        (a.kind === "primitive" && primitiveEqual(a.primitive, b.primitive))
      );
    case "tuple":
      return a.kind === "tuple" && tupleIsSubtype(a.elements, b.elements);
    case "array":
      return (
        (a.kind === "tuple" &&
          unionIsSubtype(unionFlatten(a.elements), b.element)) ||
        (a.kind === "array" && unionIsSubtype(a.element, b.element))
      );
    case "object":
      return a.kind === "object" && objectIsSubtype(a.fields, b.fields);
    case "record":
      // TODO: do a bit more research about the key type
      return (
        (a.kind === "object" &&
          unionIsSubtype(unionFlatten(a.fields.values()), b.value)) ||
        (a.kind === "record" && unionIsSubtype(a.value, b.value))
      );
    default:
      unreachable(b);
  }
}

/**
 * Returns true if `a` is a subtype of `b`.
 */
export function unionIsSubtype(a: Union, b: Union): boolean {
  return a.every((at) => b.some((bt) => typeIsSubtype(at, bt)));
}

// }}} Subtype functions

export function typeCanonicalize(t: Type): Type {
  switch (t.kind) {
    case "unknown":
      return t;
    case "literal":
      return t;
    case "primitive":
      return t;
    case "tuple":
      return { kind: "tuple", elements: t.elements.map(unionCanonicalize) };
    case "array":
      return { kind: "array", element: unionCanonicalize(t.element) };
    case "object":
      return {
        kind: "object",
        fields: new Map(
          map(t.fields.entries(), ([k, v]) => [k, unionCanonicalize(v)]),
        ),
      };
    case "record":
      return { kind: "record", value: unionCanonicalize(t.value) };
    default:
      unreachable(t);
  }
}

export function unionCanonicalize(u: Union): Union {
  return typeMaxima(u).map(typeCanonicalize);
}

export function unionDedupe(u: Union): Union {
  const newUnion: Union = [];
  for (const t1 of u) {
    let alreadyExists = false;
    for (const t2 of newUnion) {
      if (typeEqual(t1, t2)) {
        alreadyExists = true;
        break;
      }
    }
    if (!alreadyExists) {
      newUnion.push(t1);
    }
  }
  return newUnion;
}

export function unionFlatten(us: Iterable<Union>): Union {
  return unionDedupe(Array.from(us).flat());
}

export function typeMinima(ts: Type[]): Type[] {
  const minima: Type[] = [];
  for (const t1 of ts) {
    let isMinimum = true;
    for (const t2 of ts) {
      if (!(!typeIsSubtype(t2, t1) || typeEqual(t1, t2))) {
        isMinimum = false;
      }
    }
    if (isMinimum) {
      minima.push(t1);
    }
  }
  return minima;
}

export function typeMaxima(ts: Type[]): Type[] {
  const maxima: Type[] = [];
  for (const t1 of ts) {
    let isMaximum = true;
    for (const t2 of ts) {
      if (!(!typeIsSubtype(t1, t2) || typeEqual(t1, t2))) {
        isMaximum = false;
      }
    }
    if (isMaximum) {
      maxima.push(t1);
    }
  }
  return maxima;
}

function typeIntersection(a: Type, b: Type): Type | undefined {
  switch (a.kind) {
    case "unknown":
      return b;
    case "literal":
      if (typeIsSubtype(a, b)) {
        return a;
      } else if (typeIsSubtype(b, a)) {
        return b;
      } else {
        return undefined;
      }
    case "primitive":
      if (typeIsSubtype(a, b)) {
        return a;
      } else if (typeIsSubtype(b, a)) {
        return b;
      } else {
        return undefined;
      }
    case "tuple":
      if (b.kind === "tuple") {
        if (a.elements.length === b.elements.length) {
          return {
            kind: "tuple",
            elements: Array.from(
              map(zip(a.elements, b.elements), ([a, b]) =>
                unionIntersection(a, b),
              ),
            ),
          };
        } else {
          return undefined;
        }
      } else {
        // TODO: intersection with an array
        return undefined;
      }
    case "array":
      if (b.kind === "array") {
        return {
          kind: "array",
          element: unionIntersection(a.element, b.element),
        };
      } else {
        // TODO: intersection with a tuple
        return undefined;
      }
    case "object":
      if (b.kind === "object") {
        const fields = new Map(a.fields.entries());
        for (const [bk, bv] of b.fields.entries()) {
          const u = fields.get(bk);
          if (u === undefined) {
            fields.set(bk, bv);
          } else {
            fields.set(bk, unionIntersection(u, bv));
          }
        }
        return { kind: "object", fields };
      } else {
        // TODO: intersection with a record
        return undefined;
      }
    case "record":
      if (b.kind === "record") {
        return {
          kind: "record",
          value: unionIntersection(a.value, b.value),
        };
      } else {
        // TODO: intersection with an object
        return undefined;
      }
    default:
      unreachable(a);
  }
}

export function unionIntersection(a: Union, b: Union): Union {
  const newUnion: Union = [];
  for (const at of a) {
    for (const bt of b) {
      const newType = typeIntersection(at, bt);
      if (newType !== undefined) {
        newUnion.push(newType);
      }
    }
  }
  return newUnion;
}

function objectFieldNamesEqual(
  a: Map<string, Union>,
  b: Map<string, Union>,
): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const ak of a.keys()) {
    if (!b.has(ak)) {
      return false;
    }
  }
  return true;
}

export function typeEqualConstructor(a: Type, b: Type): boolean {
  switch (a.kind) {
    case "unknown":
      return b.kind === "unknown";
    case "literal":
      return b.kind === "literal" && literalEqual(a.literal, b.literal);
    case "primitive":
      return b.kind === "primitive" && primitiveEqual(a.primitive, b.primitive);
    case "tuple":
      return b.kind === "tuple" && a.elements.length === b.elements.length;
    case "array":
      return b.kind === "array";
    case "object":
      return b.kind === "object" && objectFieldNamesEqual(a.fields, b.fields);
    case "record":
      return b.kind === "record";
    default:
      unreachable(a);
  }
}

export function typeIsNumber(t: Type): boolean {
  return t.kind === "primitive" && t.primitive === "number";
}

export function typeIsString(t: Type): boolean {
  return t.kind === "primitive" && t.primitive === "string";
}

export function typeAccessUnion(t: Type, a: Accessor): Union | undefined {
  switch (a.kind) {
    case "property":
      if (t.kind === "unknown") {
        return [{ kind: "unknown" }];
      } else if (t.kind === "object") {
        const value = t.fields.get(a.name);
        if (value === undefined) {
          return [{ kind: "unknown" }];
        } else {
          return value;
        }
      } else if (t.kind === "record") {
        return t.value;
      }
      break;
    case "index":
      // TODO: string primitive and literal?
      if (t.kind === "unknown") {
        return [{ kind: "unknown" }];
      } else if (t.kind === "tuple") {
        const element = t.elements.at(a.index);
        if (element === undefined) {
          return [{ kind: "unknown" }];
        } else {
          return element;
        }
      } else if (t.kind === "array") {
        return t.element;
      }
      break;
    case "array-element":
      if (t.kind === "unknown") {
        return [{ kind: "unknown" }];
      } else if (t.kind === "array") {
        return t.element;
      } else if (t.kind === "tuple") {
        return unionFlatten(t.elements);
      }
      break;
    case "record-values":
      // TODO: object type?
      if (t.kind === "unknown") {
        return [{ kind: "unknown" }];
      } else if (t.kind === "record") {
        return t.value;
      }
      break;
    default:
      unreachable(a);
  }
}

function unionAt(u: Union, o: Occurrence): Union | undefined {
  const a = o.at(0);
  if (a === undefined) {
    return u;
  }
  o = o.slice(1);

  const unions: Union[] = [];
  for (const t of u) {
    const union = typeAccessUnion(t, a);
    if (union === undefined) {
      return undefined;
    }
    unions.push(union);
  }

  return unionAt(unionFlatten(unions), o);
}

export function typeGetArguments(t: Type): [Union, Accessor][] {
  switch (t.kind) {
    case "unknown":
      return [];
    case "literal":
      return [];
    case "primitive":
      return [];
    case "tuple":
      return t.elements.map((e, index) => [
        e,
        { kind: "index", index } satisfies Accessor,
      ]);
    case "array":
      return [[t.element, { kind: "array-element" }]];
    case "object":
      return Array.from(t.fields.entries()).map(([name, v]) => [
        v,
        { kind: "property", name } satisfies Accessor,
      ]);
    case "record":
      return [[t.value, { kind: "record-values" }]];
    default:
      unreachable(t);
  }
}

function makeObjectFieldsUnknown(
  fields: Map<string, Union>,
): Map<string, Union> {
  const result = new Map<string, Union>();
  for (const k of fields.keys()) {
    result.set(k, [{ kind: "unknown" }]);
  }
  return result;
}

export function typeMakeArgumentsUnknown(t: Type): Type {
  switch (t.kind) {
    case "unknown":
      return { kind: "unknown" };
    case "literal":
      return structuredClone(t);
    case "primitive":
      return structuredClone(t);
    case "tuple":
      return {
        kind: "tuple",
        elements: t.elements.map(() => [{ kind: "unknown" }] satisfies Union),
      };
    case "array":
      return { kind: "array", element: [{ kind: "unknown" }] };
    case "object":
      return { kind: "object", fields: makeObjectFieldsUnknown(t.fields) };
    case "record":
      return { kind: "record", value: [{ kind: "unknown" }] };
    default:
      unreachable(t);
  }
}

function typeReplaceAt(
  t: Type,
  a: Accessor,
  o: Occurrence,
  replacement: Union,
): Type | undefined {
  switch (a.kind) {
    case "property":
      if (t.kind === "object") {
        const fields = new Map(t.fields.entries());
        const union = fields.get(a.name);
        if (union === undefined) {
          fields.set(a.name, replacement);
        } else {
          fields.set(a.name, unionReplaceAt(union, o, replacement));
        }
        return { kind: "object", fields };
      }
      break;
    case "index":
      if (t.kind === "tuple") {
        if (a.index >= t.elements.length) {
          return undefined;
        }
        const elements = Array.from(t.elements);
        elements[a.index] = unionReplaceAt(elements[a.index], o, replacement);
        return { kind: "tuple", elements };
      }
      break;
    case "array-element":
      if (t.kind === "array") {
        return {
          kind: "array",
          element: unionReplaceAt(t.element, o, replacement),
        };
      }
      break;
    case "record-values":
      if (t.kind === "record") {
        return {
          kind: "record",
          value: unionReplaceAt(t.value, o, replacement),
        };
      }
      break;
    default:
      unreachable(a);
  }
}

export function unionReplaceAt(
  u: Union,
  o: Occurrence,
  replacement: Union,
): Union {
  const a = o.at(0);
  if (a === undefined) {
    return replacement;
  }
  o = o.slice(1);

  const newUnion: Union = [];
  for (const t of u) {
    const newType = typeReplaceAt(t, a, o, replacement);
    if (newType !== undefined) {
      newUnion.push(newType);
    }
  }

  return newUnion;
}
