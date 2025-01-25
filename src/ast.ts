import { DecisionTree } from "./decision-tree";
import { createEiife } from "./eiife";
import { MatchTable } from "./match-table";
import {
  Literal,
  ObjectField,
  Occurrence,
  Type,
  Union,
  unionFlatten,
} from "./type";
import { exactlyOne, filterMap, unreachable } from "./util";
import assert from "assert";
import ts from "typescript";

function isTupleType(
  typeChecker: ts.TypeChecker,
  type: ts.Type,
): type is ts.TupleTypeReference {
  // TODO: understand what this function does exactly
  return typeChecker.isTupleType(type);
}

function isObjectType(type: ts.Type): type is ts.ObjectType {
  return (type.getFlags() & ts.TypeFlags.Object) !== 0;
}

function isSymbolOptional(s: ts.Symbol): boolean {
  return (s.getFlags() & ts.SymbolFlags.Optional) !== 0;
}

function createLogicalAnds(expressions: ts.Expression[]): ts.BinaryExpression {
  if (expressions.length < 2) {
    throw new Error("at least 2 expressions are required");
  } else if (expressions.length === 2) {
    return ts.factory.createLogicalAnd(expressions[0], expressions[1]);
  } else {
    const left = createLogicalAnds(expressions.slice(0, -1));
    assert(left !== undefined);
    const right = expressions[expressions.length - 1];
    return ts.factory.createLogicalAnd(left, right);
  }
}

function createIsArray(e: ts.Expression): ts.CallExpression {
  return ts.factory.createCallExpression(
    ts.factory.createPropertyAccessExpression(
      ts.factory.createIdentifier("Array"),
      "isArray",
    ),
    undefined,
    [e],
  );
}

function literalToExpression(l: Literal): ts.Expression {
  switch (l.kind) {
    case "string":
      return ts.factory.createStringLiteral(l.value);
    case "number":
      return ts.factory.createNumericLiteral(l.value);
    case "bigint":
      return ts.factory.createBigIntLiteral(l.value);
    case "boolean":
      return l.value ? ts.factory.createTrue() : ts.factory.createFalse();
    case "undefined":
      return ts.factory.createIdentifier("undefined");
    case "null":
      return ts.factory.createNull();
    default:
      unreachable(l);
  }
}

function getBooleanLiteralValue(t: ts.Type): boolean | undefined {
  if (!(t.getFlags() & ts.TypeFlags.BooleanLiteral)) {
    return undefined;
  }
  assert("intrinsicName" in t);
  assert(t.intrinsicName === "true" || t.intrinsicName === "false");
  return t.intrinsicName === "true";
}

function tsTypeToLiteral(t: ts.Type): Literal | undefined {
  if (t.isLiteral()) {
    switch (typeof t.value) {
      case "number":
        return { kind: "number", value: t.value };
      case "string":
        return { kind: "string", value: t.value };
      case "object":
        return { kind: "bigint", value: t.value };
      default:
        unreachable(t.value);
    }
  }

  const booleanLiteralValue = getBooleanLiteralValue(t);
  if (booleanLiteralValue !== undefined) {
    return { kind: "boolean", value: booleanLiteralValue };
  }

  const typeFlags = t.getFlags();
  if (typeFlags & ts.TypeFlags.Undefined) {
    return { kind: "undefined" };
  } else if (typeFlags & ts.TypeFlags.Null) {
    return { kind: "null" };
  }
}

function replaceBooleanLiteralsWithPrimitive(u: Union): Union {
  let hasTrue = false;
  let hasFalse = false;
  for (const t of u) {
    if (t.kind === "literal" && t.literal.kind === "boolean") {
      if (t.literal.value) {
        hasTrue = true;
      } else {
        hasFalse = true;
      }
    }
  }

  if (!(hasTrue && hasFalse)) {
    return Array.from(u);
  }

  const newUnion: Union = [{ kind: "primitive", primitive: "boolean" }];
  for (const t of u) {
    if (!(t.kind === "literal" && t.literal.kind === "boolean")) {
      newUnion.push(t);
    }
  }
  return newUnion;
}

function tsTypeToUnion(
  typeChecker: ts.TypeChecker,
  t: ts.Type,
): Union | undefined {
  const literal = tsTypeToLiteral(t);
  if (literal !== undefined) {
    return [{ kind: "literal", literal }];
  }

  const typeFlags = t.getFlags();
  if (typeFlags & ts.TypeFlags.AnyOrUnknown) {
    return [{ kind: "unknown" }];
  } else if (typeFlags & ts.TypeFlags.String) {
    return [{ kind: "primitive", primitive: "string" }];
  } else if (typeFlags & ts.TypeFlags.Number) {
    return [{ kind: "primitive", primitive: "number" }];
  } else if (typeFlags & ts.TypeFlags.Boolean) {
    return [{ kind: "primitive", primitive: "boolean" }];
  } else if (typeFlags & ts.TypeFlags.BigInt) {
    return [{ kind: "primitive", primitive: "bigint" }];
  }

  const arrayElementType = typeChecker.getElementTypeOfArrayType(t);
  if (arrayElementType !== undefined) {
    const element = tsTypeToUnion(typeChecker, arrayElementType);
    if (element === undefined) {
      return undefined;
    }
    return [{ kind: "array", element }];
  }

  if (isTupleType(typeChecker, t)) {
    const elements: Union[] = [];
    for (const elementType of t.typeArguments ?? []) {
      const element = tsTypeToUnion(typeChecker, elementType);
      if (element === undefined) {
        return undefined;
      }
      elements.push(element);
    }
    return [{ kind: "tuple", elements }];
  }

  const recordType = getRecordType(t);
  if (recordType !== undefined) {
    const value = tsTypeToUnion(typeChecker, recordType.value);
    if (value === undefined) {
      return undefined;
    }
    return [{ kind: "record", value }];
  }

  // Check if the type is object AFTER checking if the type is array, tuple, or
  // record since they an object type as well
  if (isObjectType(t)) {
    const fields = new Map<string, ObjectField>();
    for (const symbol of t.getProperties()) {
      const fieldName = symbol.getName();
      const fieldType = typeChecker.getTypeOfSymbol(symbol);
      let fieldUnion = tsTypeToUnion(typeChecker, fieldType);
      if (fieldUnion === undefined) {
        return undefined;
      }
      const optional = isSymbolOptional(symbol);
      if (optional) {
        fieldUnion = fieldUnion.filter(
          (t) => !(t.kind === "literal" && t.literal.kind === "undefined"),
        );
      }
      fields.set(fieldName, {
        union: fieldUnion,
        optional: isSymbolOptional(symbol),
      });
    }
    return [{ kind: "object", fields }];
  }

  // TODO: intersection
  // TODO: normalize boolean
  if (t.isUnion()) {
    const unions: Union[] = [];
    for (const child of t.types) {
      const union = tsTypeToUnion(typeChecker, child);
      if (union === undefined) {
        return undefined;
      }
      unions.push(union);
    }
    return replaceBooleanLiteralsWithPrimitive(unionFlatten(unions));
  }
}

function isTypeScriptLibFile(path: string): boolean {
  return path.match(/typescript\/lib\/lib.*\.d\.ts$/) !== null;
}

type RecordType = { key: ts.Type; value: ts.Type };

function getRecordType(t: ts.Type): RecordType | undefined {
  if (
    !(
      t.aliasSymbol !== undefined &&
      t.aliasSymbol.getName() === "Record" &&
      t.aliasSymbol.declarations !== undefined &&
      t.aliasTypeArguments !== undefined &&
      t.aliasTypeArguments.length === 2
    )
  ) {
    return undefined;
  }

  const declaration = exactlyOne(t.aliasSymbol.declarations);
  if (
    !(
      declaration !== undefined &&
      ts.isSourceFile(declaration.parent) &&
      isTypeScriptLibFile(declaration.parent.path)
    )
  ) {
    return undefined;
  }

  return { key: t.aliasTypeArguments[0], value: t.aliasTypeArguments[1] };
}

type Match = {
  table: MatchTable;
  testee: ts.Expression;
  caseBodies: ts.Expression[];
  defaultCaseBody: ts.Expression | undefined;
};

export function nodeToMatch(
  typeChecker: ts.TypeChecker,
  node: ts.Node,
): Match | undefined {
  const patterns: Union[] = [];
  const caseBodies: ts.Expression[] = [];
  let defaultCaseBody: ts.Expression | undefined;

  function f(node: ts.Node): Match | undefined {
    if (!ts.isCallExpression(node)) {
      return undefined;
    }

    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      if (callee.name.text === "default") {
        // TODO: [0]
        defaultCaseBody = node.arguments[0];
        return f(callee.expression);
      } else if (callee.name.text === "case") {
        const typeNode = exactlyOne(node.typeArguments ?? []);
        if (typeNode === undefined) {
          return undefined;
        }
        const type = typeChecker.getTypeFromTypeNode(typeNode);
        const union = tsTypeToUnion(typeChecker, type);
        if (union === undefined) {
          return undefined;
        }
        // TODO: [0]
        patterns.push(union);
        caseBodies.push(node.arguments[0]);
        return f(callee.expression);
      } else if (callee.name.text === "returns") {
        // TODO: match table input type
        return f(callee.expression);
      }
    } else if (ts.isIdentifier(callee) && callee.text === "match") {
      const signature = typeChecker.getResolvedSignature(node);
      if (
        !(
          signature !== undefined &&
          signature.mapper !== undefined &&
          signature.mapper.kind === ts.TypeMapKind.Simple
        )
      ) {
        return undefined;
      }
      const input = tsTypeToUnion(typeChecker, signature.mapper.target);
      if (input === undefined) {
        return undefined;
      }

      patterns.reverse();
      caseBodies.reverse();

      return {
        table: {
          input,
          occurrences: [[]],
          caseIndices: patterns.map((_, i) => i),
          patternRows: patterns.map((p) => [p]),
        },
        // TODO: [0]
        testee: node.arguments[0],
        caseBodies,
        defaultCaseBody,
      };
    }

    return undefined;
  }

  return f(node);
}

function createTest(t: Type, testee: ts.Expression): ts.Expression {
  switch (t.kind) {
    case "unknown":
      return ts.factory.createTrue();
    case "literal":
      return ts.factory.createStrictEquality(
        testee,
        literalToExpression(t.literal),
      );
    case "primitive":
      return ts.factory.createStrictEquality(
        ts.factory.createTypeOfExpression(testee),
        ts.factory.createStringLiteral(t.primitive),
      );
    case "tuple":
      return ts.factory.createLogicalAnd(
        createIsArray(testee),
        ts.factory.createStrictEquality(
          ts.factory.createPropertyAccessExpression(testee, "length"),
          ts.factory.createNumericLiteral(t.elements.length),
        ),
      );
    case "array":
      return createIsArray(testee);
    case "object":
      return createLogicalAnds([
        ts.factory.createStrictEquality(
          ts.factory.createTypeOfExpression(testee),
          ts.factory.createStringLiteral("object"),
        ),
        ts.factory.createStrictInequality(testee, ts.factory.createNull()),
        ...filterMap(t.fields.entries(), ([k, v]) =>
          v.optional
            ? undefined
            : ts.factory.createBinaryExpression(
                ts.factory.createStringLiteral(k),
                ts.SyntaxKind.InKeyword,
                testee,
              ),
        ),
      ]);
    case "record":
      return ts.factory.createLogicalAnd(
        ts.factory.createStrictEquality(
          ts.factory.createTypeOfExpression(testee),
          ts.factory.createStringLiteral("object"),
        ),
        ts.factory.createStrictInequality(testee, ts.factory.createNull()),
      );
    default:
      unreachable(t);
  }
}

function createTestAtOccurrence(
  t: Type,
  o: Occurrence,
  testee: ts.Expression,
): ts.Expression {
  const a = o.at(0);
  if (a === undefined) {
    return createTest(t, testee);
  }
  o = o.slice(1);

  switch (a.kind) {
    case "property":
      return ts.factory.createLogicalOr(
        ts.factory.createLogicalNot(
          ts.factory.createBinaryExpression(
            ts.factory.createStringLiteral(a.name),
            ts.SyntaxKind.InKeyword,
            testee,
          ),
        ),
        createTestAtOccurrence(
          t,
          o,
          ts.factory.createPropertyAccessExpression(testee, a.name),
        ),
      );
    case "index":
      return createTestAtOccurrence(
        t,
        o,
        ts.factory.createElementAccessExpression(testee, a.index),
      );
    case "array-element": {
      const param = ts.factory.createTempVariable(undefined, true);
      const loopVar = ts.factory.createTempVariable(undefined, true);
      return createEiife({
        parameters: [
          ts.factory.createParameterDeclaration(undefined, undefined, param),
        ],
        arguments: [testee],
        statements: [
          ts.factory.createForOfStatement(
            undefined,
            ts.factory.createVariableDeclarationList([
              ts.factory.createVariableDeclaration(loopVar),
            ]),
            param,
            ts.factory.createIfStatement(
              ts.factory.createLogicalNot(
                createTestAtOccurrence(t, o, loopVar),
              ),
              ts.factory.createReturnStatement(ts.factory.createFalse()),
            ),
          ),
          ts.factory.createReturnStatement(ts.factory.createTrue()),
        ],
      });
    }
    case "record-values": {
      const param = ts.factory.createTempVariable(undefined, true);
      const loopVar = ts.factory.createTempVariable(undefined, true);
      return createEiife({
        parameters: [
          ts.factory.createParameterDeclaration(undefined, undefined, param),
        ],
        arguments: [testee],
        statements: [
          ts.factory.createForOfStatement(
            undefined,
            ts.factory.createVariableDeclarationList([
              ts.factory.createVariableDeclaration(loopVar),
            ]),
            ts.factory.createCallExpression(
              ts.factory.createPropertyAccessExpression(
                ts.factory.createIdentifier("Object"),
                "values",
              ),
              undefined,
              [param],
            ),
            ts.factory.createIfStatement(
              ts.factory.createLogicalNot(
                createTestAtOccurrence(t, o, loopVar),
              ),
              ts.factory.createReturnStatement(ts.factory.createFalse()),
            ),
          ),
          ts.factory.createReturnStatement(ts.factory.createTrue()),
        ],
      });
    }
    default:
      unreachable(a);
  }
}

export function decisionTreeToExpression(
  d: DecisionTree,
  testee: ts.Expression,
): ts.Expression {
  if (d.kind === "fail") {
    return ts.factory.createPrefixMinus(ts.factory.createNumericLiteral(1));
  } else if (d.kind === "success") {
    return ts.factory.createNumericLiteral(d.caseIndex);
  }

  return ts.factory.createConditionalExpression(
    createTestAtOccurrence(d.type, d.occurrence, testee),
    undefined,
    decisionTreeToExpression(d.success, testee),
    undefined,
    decisionTreeToExpression(d.fail, testee),
  );
}

// function main() {
//   const d = decisionTreeCompile({
//     input: [
//       {
//         kind: "tuple",
//         elements: [[{ kind: "unknown" }], [{ kind: "unknown" }]],
//       },
//     ],
//     occurrences: [[]],
//     caseIndices: [1, 2, 3, 4],
//     patternRows: [
//       [
//         [
//           {
//             kind: "tuple",
//             elements: [
//               [{ kind: "literal", literal: { kind: "string", value: "foo" } }],
//               [{ kind: "primitive", primitive: "number" }],
//             ],
//           },
//         ],
//       ],
//       [
//         [
//           {
//             kind: "tuple",
//             elements: [
//               [{ kind: "literal", literal: { kind: "string", value: "bar" } }],
//               [{ kind: "literal", literal: { kind: "number", value: 5 } }],
//             ],
//           },
//         ],
//       ],
//       [
//         [
//           {
//             kind: "tuple",
//             elements: [
//               [{ kind: "primitive", primitive: "string" }],
//               [{ kind: "primitive", primitive: "boolean" }],
//             ],
//           },
//         ],
//       ],
//       [
//         [
//           {
//             kind: "object",
//             fields: new Map<string, Union>([
//               [
//                 "kind",
//                 [{ kind: "literal", literal: { kind: "string", value: "ok" } }],
//               ],
//               ["message", [{ kind: "primitive", primitive: "string" }]],
//             ]),
//           },
//         ],
//       ],
//     ],
//   });
//
//   const expr = decisionTreeToExpression(
//     d,
//     ts.factory.createIdentifier("testee"),
//   );
//
//   const dummySourceFile = ts.createSourceFile(
//     "dummy.ts",
//     "",
//     ts.ScriptTarget.Latest,
//     false,
//     ts.ScriptKind.TS,
//   );
//
//   // Print the node
//   const result = ts
//     .createPrinter()
//     .printNode(ts.EmitHint.Unspecified, expr, dummySourceFile);
//   console.log(result);
// }
//
// main();
