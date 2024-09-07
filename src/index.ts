import assert from "assert";
import ts from "typescript";
import type { TransformerExtras, PluginConfig } from "ts-patch";

function exactlyOne<T>(ts: Iterable<T>): T | undefined {
  let maybeT: T | undefined = undefined;
  for (const t of ts) {
    if (maybeT === undefined) {
      maybeT = t;
    } else {
      return undefined;
    }
  }
  return maybeT;
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

function isTupleType(
  typeChecker: ts.TypeChecker,
  type: ts.Type,
): type is ts.TupleTypeReference {
  return typeChecker.isTupleType(type);
}

type Literal =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "bigint"; value: ts.PseudoBigInt };

type Primitive =
  | "string"
  | "number"
  | "bigint"
  | "boolean"
  | "undefined"
  | "null";

type CheckableType =
  | { kind: "unknown" }
  | { kind: "literal"; literal: Literal }
  | { kind: "primitive"; primitive: Primitive }
  | { kind: "union"; elements: CheckableType[] }
  | { kind: "tuple"; minLength: number; elements: CheckableType[] }
  | { kind: "array"; element: CheckableType }
  | { kind: "object"; fields: [string, CheckableType][] };

function createTupleTests(
  testee: ts.Expression,
  notOkStatement: ts.Statement,
  types: CheckableType[],
): ts.Statement[] {
  const fields = types.map((type, i) => [i, type] as const);
  fields.reverse();
  function f(): ts.Statement[] {
    const maybeLastField = fields.pop();
    if (maybeLastField === undefined) {
      return [];
    }
    const [index, type] = maybeLastField;
    const [statements, check] = createTests(
      ts.factory.createElementAccessExpression(testee, index),
      type,
    );
    // TODO: eliminate nested ifs when statements = []
    statements.push(
      ts.factory.createIfStatement(
        check,
        ts.factory.createBlock(f()),
        notOkStatement,
      ),
    );
    return statements;
  }
  return f();
}

function createFieldTests(
  testee: ts.Expression,
  notOkStatement: ts.Statement,
  fields: [string, CheckableType][],
): ts.Statement[] {
  fields = fields.toReversed();
  function f(): ts.Statement[] {
    const maybeLastField = fields.pop();
    if (maybeLastField === undefined) {
      return [];
    }
    const [fieldName, fieldType] = maybeLastField;
    const [statements, check] = createTests(
      ts.factory.createPropertyAccessExpression(testee, fieldName),
      fieldType,
    );
    // TODO: eliminate nested ifs when statements = []
    statements.push(
      ts.factory.createIfStatement(
        check,
        ts.factory.createBlock(f()),
        notOkStatement,
      ),
    );
    return statements;
  }
  return f();
}

function createUnionTests(
  testee: ts.Expression,
  okStatement: ts.Statement,
  constituents: CheckableType[],
): ts.Statement[] {
  constituents = constituents.toReversed();
  function f(): ts.Statement[] {
    const lastConstituent = constituents.pop();
    if (lastConstituent === undefined) {
      return [];
    }
    const [statements, check] = createTests(testee, lastConstituent);
    // TODO: eliminate nested ifs when statements = []
    statements.push(
      ts.factory.createIfStatement(
        check,
        okStatement,
        ts.factory.createBlock(f()),
      ),
    );
    return statements;
  }
  return f();
}

function createTests(
  testee: ts.Expression,
  targetType: CheckableType,
): [ts.Statement[], ts.Expression] {
  switch (targetType.kind) {
    case "unknown": {
      // TODO: remove `if (true)` entirely?
      return [[], ts.factory.createTrue()];
    }

    case "literal": {
      let literal: ts.Expression;
      switch (targetType.literal.kind) {
        case "string":
          literal = ts.factory.createStringLiteral(targetType.literal.value);
          break;
        case "number":
          literal = ts.factory.createNumericLiteral(targetType.literal.value);
          break;
        case "bigint":
          literal = ts.factory.createBigIntLiteral(targetType.literal.value);
          break;
        case "boolean":
          literal = targetType.literal.value
            ? ts.factory.createTrue()
            : ts.factory.createFalse();
          break;
      }
      return [[], ts.factory.createStrictEquality(testee, literal)];
    }

    case "primitive": {
      if (targetType.primitive === "null") {
        return [
          [],
          ts.factory.createStrictEquality(testee, ts.factory.createNull()),
        ];
      } else {
        return [
          [],
          ts.factory.createStrictEquality(
            ts.factory.createTypeOfExpression(testee),
            ts.factory.createStringLiteral(targetType.primitive),
          ),
        ];
      }
    }

    // TODO: use switch?
    case "union": {
      const okVariable = ts.factory.createTempVariable(undefined, true);
      const okStatement = ts.factory.createExpressionStatement(
        ts.factory.createAssignment(okVariable, ts.factory.createTrue()),
      );

      const statements: ts.Statement[] = [
        ts.factory.createVariableStatement(undefined, [
          ts.factory.createVariableDeclaration(
            okVariable,
            undefined,
            undefined,
            ts.factory.createFalse(),
          ),
        ]),
        ...createUnionTests(testee, okStatement, targetType.elements),
      ];

      return [statements, okVariable];
    }

    case "tuple": {
      const okVariable = ts.factory.createTempVariable(undefined, true);
      const notOkStatement = ts.factory.createExpressionStatement(
        ts.factory.createAssignment(okVariable, ts.factory.createFalse()),
      );

      const statements: ts.Statement[] = [
        ts.factory.createVariableStatement(undefined, [
          ts.factory.createVariableDeclaration(
            okVariable,
            undefined,
            undefined,
            ts.factory.createTrue(),
          ),
        ]),
      ];

      // TODO: should we accept "function" type too? exclude arrays?
      const conditions: ts.Expression[] = [
        ts.factory.createCallExpression(
          ts.factory.createPropertyAccessExpression(
            ts.factory.createIdentifier("Array"),
            "isArray",
          ),
          undefined,
          [testee],
        ),
        ts.factory.createLessThanEquals(
          ts.factory.createNumericLiteral(targetType.minLength),
          ts.factory.createPropertyAccessExpression(testee, "length"),
        ),
        ts.factory.createLessThanEquals(
          ts.factory.createPropertyAccessExpression(testee, "length"),
          ts.factory.createNumericLiteral(targetType.elements.length),
        ),
      ];

      // TODO: check cheapest ones first?
      const fieldTests = createTupleTests(
        testee,
        notOkStatement,
        targetType.elements,
      );
      const rootIf = ts.factory.createIfStatement(
        createLogicalAnds(conditions),
        ts.factory.createBlock(fieldTests),
        notOkStatement,
      );
      statements.push(rootIf);

      return [statements, okVariable];
    }

    case "array": {
      const okVariable = ts.factory.createTempVariable(undefined, true);
      const loopVariable = ts.factory.createLoopVariable(true);

      const [loopStatements, check] = createTests(
        loopVariable,
        targetType.element,
      );
      loopStatements.push(
        ts.factory.createIfStatement(
          ts.factory.createLogicalNot(check),
          ts.factory.createBlock([
            ts.factory.createExpressionStatement(
              ts.factory.createAssignment(okVariable, ts.factory.createFalse()),
            ),
            ts.factory.createBreakStatement(),
          ]),
        ),
      );

      const statements = [
        ts.factory.createVariableStatement(undefined, [
          ts.factory.createVariableDeclaration(
            okVariable,
            undefined,
            undefined,
            ts.factory.createTrue(),
          ),
        ]),
        ts.factory.createIfStatement(
          ts.factory.createCallExpression(
            ts.factory.createPropertyAccessExpression(
              ts.factory.createIdentifier("Array"),
              "isArray",
            ),
            undefined,
            [testee],
          ),
          ts.factory.createForOfStatement(
            undefined,
            ts.factory.createVariableDeclarationList([
              ts.factory.createVariableDeclaration(loopVariable),
            ]),
            testee,
            ts.factory.createBlock(loopStatements),
          ),
          ts.factory.createExpressionStatement(
            ts.factory.createAssignment(okVariable, ts.factory.createFalse()),
          ),
        ),
      ];

      return [statements, okVariable];
    }

    case "object": {
      const okVariable = ts.factory.createTempVariable(undefined, true);
      const notOkStatement = ts.factory.createExpressionStatement(
        ts.factory.createAssignment(okVariable, ts.factory.createFalse()),
      );

      const statements: ts.Statement[] = [
        ts.factory.createVariableStatement(undefined, [
          ts.factory.createVariableDeclaration(
            okVariable,
            undefined,
            undefined,
            ts.factory.createTrue(),
          ),
        ]),
      ];

      // TODO: should we accept "function" type too? exclude arrays?
      const conditions: ts.Expression[] = [
        ts.factory.createStrictEquality(
          ts.factory.createTypeOfExpression(testee),
          ts.factory.createStringLiteral("object"),
        ),
      ];
      for (const [key] of targetType.fields) {
        conditions.push(
          ts.factory.createBinaryExpression(
            ts.factory.createStringLiteral(key),
            ts.SyntaxKind.InKeyword,
            testee,
          ),
        );
      }

      // TODO: check cheapest ones first?
      const fieldTests = createFieldTests(
        testee,
        notOkStatement,
        Array.from(targetType.fields),
      );
      const rootIf = ts.factory.createIfStatement(
        createLogicalAnds(conditions),
        ts.factory.createBlock(fieldTests),
        notOkStatement,
      );
      statements.push(rootIf);

      return [statements, okVariable];
    }
  }
}

function unreachable(_: never): never {
  throw new Error("should be unreachable");
}

function getBooleanLiteralValue(type: ts.Type): boolean | undefined {
  if (!(type.flags & ts.TypeFlags.BooleanLiteral)) {
    return undefined;
  }
  assert("intrinsicName" in type);
  assert(type.intrinsicName === "true" || type.intrinsicName === "false");
  return type.intrinsicName === "true";
}

function isObjectType(type: ts.Type): type is ts.ObjectType {
  return (type.getFlags() & ts.TypeFlags.Object) !== 0;
}

function tsTypeToCheckableType(
  typeChecker: ts.TypeChecker,
  type: ts.Type,
): CheckableType | undefined {
  if (type.isLiteral()) {
    let literal: Literal;
    switch (typeof type.value) {
      case "number":
        literal = { kind: "number", value: type.value };
        break;
      case "string":
        literal = { kind: "string", value: type.value };
        break;
      case "object":
        literal = { kind: "bigint", value: type.value };
        break;
      default:
        unreachable(type.value);
    }
    return { kind: "literal", literal };
  }

  const booleanLiteralValue = getBooleanLiteralValue(type);
  if (booleanLiteralValue !== undefined) {
    return {
      kind: "literal",
      literal: { kind: "boolean", value: booleanLiteralValue },
    };
  }

  const typeFlags = type.getFlags();
  if (typeFlags & ts.TypeFlags.AnyOrUnknown) {
    return { kind: "unknown" };
  } else if (typeFlags & ts.TypeFlags.String) {
    return { kind: "primitive", primitive: "string" };
  } else if (typeFlags & ts.TypeFlags.Number) {
    return { kind: "primitive", primitive: "number" };
  } else if (typeFlags & ts.TypeFlags.Boolean) {
    return { kind: "primitive", primitive: "boolean" };
  } else if (typeFlags & ts.TypeFlags.BigInt) {
    return { kind: "primitive", primitive: "bigint" };
  } else if (typeFlags & ts.TypeFlags.Undefined) {
    return { kind: "primitive", primitive: "undefined" };
  } else if (typeFlags & ts.TypeFlags.Null) {
    return { kind: "primitive", primitive: "null" };
  }

  // TODO: intersection
  // TODO: normalize boolean
  if (type.isUnion()) {
    const elements: CheckableType[] = [];
    for (const t of type.types) {
      const element = tsTypeToCheckableType(typeChecker, t);
      if (element === undefined) {
        return undefined;
      }
      elements.push(element);
    }
    return { kind: "union", elements: elements };
  }

  const arrayElementType = typeChecker.getElementTypeOfArrayType(type);
  if (arrayElementType !== undefined) {
    const element = tsTypeToCheckableType(typeChecker, arrayElementType);
    if (element === undefined) {
      return undefined;
    }
    return { kind: "array", element };
  }

  if (isTupleType(typeChecker, type)) {
    const elements: CheckableType[] = [];
    for (const elementType of type.typeArguments ?? []) {
      const element = tsTypeToCheckableType(typeChecker, elementType);
      if (element === undefined) {
        return undefined;
      }
      elements.push(element);
    }
    return { kind: "tuple", minLength: type.target.minLength, elements };
  }

  // Check if the type is object AFTER checking if the type is array or tuple
  // since Array<T> is an object as well
  if (isObjectType(type)) {
    const fields: [string, CheckableType][] = [];
    for (const symbol of type.getProperties()) {
      const fieldName = symbol.getName();
      const fieldType = typeChecker.getTypeOfSymbol(symbol);
      const fieldCheckableType = tsTypeToCheckableType(typeChecker, fieldType);
      if (fieldCheckableType === undefined) {
        return undefined;
      }
      fields.push([fieldName, fieldCheckableType]);
    }
    return { kind: "object", fields };
  }

  return undefined;
}

type Case = {
  type: CheckableType;
  action: ts.Expression;
};

type Match = {
  testee: ts.Expression;
  cases: Case[];
  defaultAction: ts.Expression | undefined;
};

function findMatchExpression(
  typeChecker: ts.TypeChecker,
  node: ts.Node,
): Match | undefined {
  const cases: Case[] = [];
  let defaultAction: ts.Expression | undefined = undefined;

  function f(node: ts.Node): Match | undefined {
    if (!ts.isCallExpression(node)) {
      return undefined;
    }

    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      if (callee.name.text === "default") {
        defaultAction = node.arguments[0];
        return f(callee.expression);
      } else if (callee.name.text === "case") {
        const typeNode = exactlyOne(node.typeArguments ?? []);
        if (typeNode === undefined) {
          return undefined;
        }
        const type = typeChecker.getTypeFromTypeNode(typeNode);
        const t = tsTypeToCheckableType(typeChecker, type);
        if (t === undefined) {
          return undefined;
        }
        // TODO: [0]
        cases.push({ type: t, action: node.arguments[0] });
        return f(callee.expression);
      } else if (callee.name.text === "returns") {
        return f(callee.expression);
      }
    } else if (ts.isIdentifier(callee) && callee.text === "match") {
      // TODO: [0]
      cases.reverse();
      return { testee: node.arguments[0], cases, defaultAction };
    }

    return undefined;
  }

  return f(node);
}

function matchToExpression(match: Match): ts.Expression {
  const testee = ts.factory.createTempVariable(undefined, true);
  const statements: ts.Statement[] = [
    ts.factory.createVariableStatement(undefined, [
      ts.factory.createVariableDeclaration(
        testee,
        undefined,
        undefined,
        match.testee,
      ),
    ]),
  ];

  for (const c of match.cases) {
    const [s, e] = createTests(testee, c.type);
    statements.push(...s);
    statements.push(
      ts.factory.createIfStatement(
        e,
        ts.factory.createReturnStatement(
          ts.factory.createCallExpression(c.action, undefined, [testee]),
        ),
      ),
    );
  }

  if (match.defaultAction !== undefined) {
    statements.push(
      ts.factory.createReturnStatement(
        ts.factory.createCallExpression(match.defaultAction, undefined, [
          testee,
        ]),
      ),
    );
  }

  return ts.factory.createImmediatelyInvokedArrowFunction(statements);
}

export default (
    program: ts.Program,
    _config: PluginConfig,
    _extras: TransformerExtras,
  ) =>
  (context: ts.TransformationContext): ts.Transformer<ts.SourceFile> =>
  (sourceFile: ts.SourceFile): ts.SourceFile => {
    const typeChecker = program.getTypeChecker();

    function visitor(node: ts.Node): ts.Node {
      // if (ts.isIdentifier(node) && node.text.includes("__")) {
      //   const symbol = typeChecker.getSymbolAtLocation(node);
      //   if (symbol !== undefined) {
      //     const type = typeChecker.getTypeOfSymbol(symbol);
      //     console.log(node.text);
      //     console.log(type);
      //     console.log();
      //   }
      // }

      const match = findMatchExpression(typeChecker, node);
      if (match !== undefined) {
        return matchToExpression(match);
      }

      return ts.visitEachChild(node, visitor, context);
    }

    // return ts.visitNode(sourceFile, visitor, ts.isSourceFile);
    sourceFile = ts.visitNode(sourceFile, visitor, ts.isSourceFile);
    console.log(ts.createPrinter().printFile(sourceFile));
    process.exit(0);

    return sourceFile;
  };
