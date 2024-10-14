import assert from "assert";
import ts from "typescript";
import type { TransformerExtras, PluginConfig } from "ts-patch";
import { Hasher, HashMap } from "./hash-map";

function unreachable(_: never): never {
  throw new Error("should be unreachable");
}

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

type Literal =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "bigint"; value: ts.PseudoBigInt }
  | { kind: "undefined" }
  | { kind: "null" };

type Primitive = "string" | "number" | "bigint" | "boolean";

type CheckableType =
  | { kind: "unknown" }
  | { kind: "literal"; literal: Literal }
  | { kind: "primitive"; primitive: Primitive }
  | { kind: "union"; elements: CheckableType[] }
  | { kind: "tuple"; minLength: number; elements: CheckableType[] }
  | { kind: "array"; element: CheckableType }
  | { kind: "object"; fields: [string, CheckableType][] };

type TesteeAccessor =
  | { kind: "property-access"; name: string }
  | { kind: "index-access"; index: number };

type TypeofResult =
  | "undefined"
  | "boolean"
  | "number"
  | "bigint"
  | "string"
  | "symbol"
  | "function"
  | "object";

type Test =
  | { kind: "strict-equal"; want: Literal; accessors: TesteeAccessor[] }
  | { kind: "not-null"; accessors: TesteeAccessor[] }
  | { kind: "typeof"; want: TypeofResult; accessors: TesteeAccessor[] }
  | { kind: "is-array"; accessors: TesteeAccessor[] }
  | { kind: "range"; min: number; max: number; accessors: TesteeAccessor[] }
  | { kind: "for-all"; tree: TestTree; accessors: TesteeAccessor[] }
  | { kind: "has-property"; name: string; accessors: TesteeAccessor[] }
  | { kind: "and"; tests: Test[] }
  | { kind: "or"; tests: Test[] };

type TestTreeResult =
  | { kind: "case-index"; index: number }
  | { kind: "for-all-element-pass" };

type TestTree =
  | {
      kind: "node";
      test: Test;
      trueBranch: TestTree;
      falseBranch: TestTree;
    }
  | { kind: "leaf-success"; result: TestTreeResult }
  | { kind: "leaf-fail" };

function cloneTestTree(tree: TestTree): TestTree {
  return structuredClone(tree);
}

function replaceLeaves(
  tree: TestTree,
  leafKind: "leaf-success" | "leaf-fail",
  replacement: TestTree,
): TestTree {
  switch (tree.kind) {
    case "leaf-success":
    case "leaf-fail":
      if (tree.kind === leafKind) {
        return cloneTestTree(replacement);
      } else {
        return tree;
      }

    case "node":
      tree.trueBranch = replaceLeaves(tree.trueBranch, leafKind, replacement);
      tree.falseBranch = replaceLeaves(tree.falseBranch, leafKind, replacement);
      return tree;

    default:
      unreachable(tree);
  }
}

function hashLiteral(hasher: Hasher, literal: Literal) {
  hasher.string(literal.kind);
  switch (literal.kind) {
    case "number":
      hasher.number(literal.value);
      break;
    case "string":
      hasher.string(literal.value);
      break;
    case "boolean":
      hasher.boolean(literal.value);
      break;
    case "bigint":
      hasher.boolean(literal.value.negative);
      hasher.string(literal.value.base10Value);
      break;
    case "undefined":
    case "null":
      break;
    default:
      unreachable(literal);
  }
}

function hashTesteeAccessor(hasher: Hasher, accessor: TesteeAccessor) {
  hasher.string(accessor.kind);
  switch (accessor.kind) {
    case "property-access":
      hasher.string(accessor.name);
      break;
    case "index-access":
      hasher.number(accessor.index);
      break;
    default:
      unreachable(accessor);
  }
}

function hashTesteeAccessors(hasher: Hasher, accessors: TesteeAccessor[]) {
  for (const accessor of accessors) {
    hashTesteeAccessor(hasher, accessor);
  }
}

function hashTest(hasher: Hasher, test: Test) {
  hasher.string(test.kind);
  switch (test.kind) {
    case "strict-equal":
      hashLiteral(hasher, test.want);
      hashTesteeAccessors(hasher, test.accessors);
      break;
    case "typeof":
      hasher.string(test.want);
      hashTesteeAccessors(hasher, test.accessors);
      break;
    case "range":
      hasher.number(test.min);
      hasher.number(test.max);
      hashTesteeAccessors(hasher, test.accessors);
      break;
    case "for-all":
      hashTestTree(hasher, test.tree);
      hashTesteeAccessors(hasher, test.accessors);
      break;
    case "has-property":
      hasher.string(test.name);
      hashTesteeAccessors(hasher, test.accessors);
      break;
    case "not-null":
    case "is-array":
      hashTesteeAccessors(hasher, test.accessors);
      break;
    case "and":
    case "or":
      for (const t of test.tests) {
        hashTest(hasher, t);
      }
      break;
    default:
      unreachable(test);
  }
}

function hashTestTreeResult(hasher: Hasher, result: TestTreeResult) {
  hasher.string(result.kind);
  switch (result.kind) {
    case "case-index":
      hasher.number(result.index);
      break;
    case "for-all-element-pass":
      break;
    default:
      unreachable(result);
  }
}

function hashTestTree(hasher: Hasher, tree: TestTree) {
  hasher.string(tree.kind);
  switch (tree.kind) {
    case "leaf-success":
      hashTestTreeResult(hasher, tree.result);
      break;
    case "leaf-fail":
      break;
    case "node":
      hashTest(hasher, tree.test);
      hashTestTree(hasher, tree.trueBranch);
      hashTestTree(hasher, tree.falseBranch);
      break;
    default:
      unreachable(tree);
  }
}

function sameLiteral(a: Literal, b: Literal): boolean {
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

function sameTesteeAccessor(a: TesteeAccessor, b: TesteeAccessor): boolean {
  switch (a.kind) {
    case "property-access":
      return b.kind === "property-access" && a.name === b.name;
    case "index-access":
      return b.kind === "index-access" && a.index === b.index;
    default:
      unreachable(a);
  }
}

function sameTesteeAccessors(
  a: TesteeAccessor[],
  b: TesteeAccessor[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!sameTesteeAccessor(a[i], b[i])) {
      return false;
    }
  }
  return true;
}

function sameTest(a: Test, b: Test): boolean {
  switch (a.kind) {
    case "strict-equal":
      return (
        b.kind === "strict-equal" &&
        sameLiteral(a.want, b.want) &&
        sameTesteeAccessors(a.accessors, b.accessors)
      );
    case "not-null":
      return (
        b.kind === "not-null" && sameTesteeAccessors(a.accessors, b.accessors)
      );
    case "typeof":
      return (
        b.kind === "typeof" &&
        a.want === b.want &&
        sameTesteeAccessors(a.accessors, b.accessors)
      );
    case "is-array":
      return (
        b.kind === "is-array" && sameTesteeAccessors(a.accessors, b.accessors)
      );
    case "range":
      return (
        b.kind === "range" &&
        a.min === b.min &&
        a.max === b.max &&
        sameTesteeAccessors(a.accessors, b.accessors)
      );
    case "for-all":
      return (
        b.kind === "for-all" &&
        sameTestTree(a.tree, b.tree) &&
        sameTesteeAccessors(a.accessors, b.accessors)
      );
    case "has-property":
      return (
        b.kind === "has-property" &&
        a.name === b.name &&
        sameTesteeAccessors(a.accessors, b.accessors)
      );
    case "and":
      return b.kind === "and" && sameTests(a.tests, b.tests);
    case "or":
      return b.kind === "or" && sameTests(a.tests, b.tests);
    default:
      unreachable(a);
  }
}

function sameTests(a: Test[], b: Test[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!sameTest(a[i], b[i])) {
      return false;
    }
  }
  return true;
}

function sameTestTreeResult(a: TestTreeResult, b: TestTreeResult): boolean {
  switch (a.kind) {
    case "case-index":
      return b.kind === "case-index" && a.index === b.index;
    case "for-all-element-pass":
      return b.kind === "for-all-element-pass";
    default:
      unreachable(a);
  }
}

function sameTestTree(a: TestTree, b: TestTree): boolean {
  switch (a.kind) {
    case "leaf-success":
      return (
        b.kind === "leaf-success" && sameTestTreeResult(a.result, b.result)
      );
    case "leaf-fail":
      return b.kind === "leaf-fail";
    case "node":
      return (
        b.kind === "node" &&
        sameTest(a.test, b.test) &&
        sameTestTree(a.trueBranch, b.trueBranch) &&
        sameTestTree(a.falseBranch, b.falseBranch)
      );
    default:
      unreachable(a);
  }
}

function createObjectOrTupleTestTree(
  accessors: TesteeAccessor[],
  fields: [TesteeAccessor, CheckableType][],
  result: TestTreeResult,
): TestTree {
  fields = fields.toReversed();

  function f(): TestTree {
    const field = fields.pop();
    if (field === undefined) {
      return {
        kind: "leaf-success",
        result,
      };
    } else {
      const [accessor, type] = field;
      const tree = createTestTree([...accessors, accessor], type, result);
      return replaceLeaves(tree, "leaf-success", f());
    }
  }

  return f();
}

function createHasPropertyTestTree(
  accessors: TesteeAccessor[],
  propertyNames: string[],
  result: TestTreeResult,
): TestTree {
  propertyNames = propertyNames.toReversed();

  function f(): TestTree {
    const name = propertyNames.pop();
    if (name === undefined) {
      return { kind: "leaf-success", result };
    } else {
      return {
        kind: "node",
        test: { kind: "has-property", name, accessors },
        trueBranch: f(),
        falseBranch: { kind: "leaf-fail" },
      };
    }
  }

  return f();
}

function createTestTree(
  accessors: TesteeAccessor[],
  type: CheckableType,
  result: TestTreeResult,
): TestTree {
  switch (type.kind) {
    case "unknown": {
      return { kind: "leaf-success", result };
    }

    case "literal": {
      return {
        kind: "node",
        test: { kind: "strict-equal", want: type.literal, accessors },
        trueBranch: { kind: "leaf-success", result },
        falseBranch: { kind: "leaf-fail" },
      };
    }

    case "primitive": {
      return {
        kind: "node",
        test: { kind: "typeof", want: type.primitive, accessors },
        trueBranch: { kind: "leaf-success", result },
        falseBranch: { kind: "leaf-fail" },
      };
    }

    case "array": {
      return {
        kind: "node",
        test: { kind: "is-array", accessors },
        trueBranch: {
          kind: "node",
          test: {
            kind: "for-all",
            tree: createTestTree([], type.element, {
              kind: "for-all-element-pass",
            }),
            accessors,
          },
          trueBranch: { kind: "leaf-success", result },
          falseBranch: { kind: "leaf-fail" },
        },
        falseBranch: { kind: "leaf-fail" },
      };
    }

    case "object": {
      const hasPropertyTestTree = createHasPropertyTestTree(
        accessors,
        type.fields.map(([name]) => name),
        result,
      );
      // TODO: order
      const propertyTestTree = createObjectOrTupleTestTree(
        accessors,
        type.fields.map(([name, type]) => [
          { kind: "property-access", name },
          type,
        ]),
        result,
      );
      return {
        kind: "node",
        test: { kind: "typeof", want: "object", accessors },
        trueBranch: {
          kind: "node",
          test: { kind: "not-null", accessors },
          trueBranch: replaceLeaves(
            hasPropertyTestTree,
            "leaf-success",
            propertyTestTree,
          ),
          falseBranch: { kind: "leaf-fail" },
        },
        falseBranch: { kind: "leaf-fail" },
      };
    }

    case "tuple": {
      // TODO: order
      const fields: [TesteeAccessor, CheckableType][] = type.elements.map(
        (type, index) => [{ kind: "index-access", index }, type],
      );
      return {
        kind: "node",
        test: { kind: "is-array", accessors },
        trueBranch: {
          kind: "node",
          test: {
            kind: "range",
            min: type.minLength,
            max: type.elements.length,
            accessors,
          },
          trueBranch: createObjectOrTupleTestTree(accessors, fields, result),
          falseBranch: { kind: "leaf-fail" },
        },
        falseBranch: { kind: "leaf-fail" },
      };
    }

    case "union": {
      // TODO: order
      const types = type.elements.toReversed();
      const f = (): TestTree => {
        const type = types.pop();
        if (type === undefined) {
          return { kind: "leaf-fail" };
        } else {
          const tree = createTestTree(accessors, type, result);
          return replaceLeaves(tree, "leaf-fail", f());
        }
      };
      return f();
    }

    default:
      unreachable(type);
  }
}

/**
 * Enumerates all terminal tests (tests that are not `"and"` or `"or"`) in
 * `test`.
 */
function* terminalTestsInTest(test: Test): Generator<Test, void, void> {
  switch (test.kind) {
    case "and":
    case "or":
      for (const t of test.tests) {
        yield* terminalTestsInTest(t);
      }
      break;
    case "strict-equal":
    case "not-null":
    case "typeof":
    case "is-array":
    case "range":
    case "for-all":
    case "has-property":
      yield test;
      break;
    default:
      unreachable(test);
  }
}

function mergeTests(tree: TestTree) {
  if (tree.kind !== "node") {
    return;
  }

  for (const test of terminalTestsInTest(tree.test)) {
    if (test.kind === "for-all") {
      mergeTests(test.tree);
    }
  }

  if (
    tree.trueBranch.kind === "node" &&
    sameTestTree(tree.falseBranch, tree.trueBranch.falseBranch)
  ) {
    if (tree.test.kind === "and") {
      tree.test.tests.push(tree.trueBranch.test);
    } else {
      tree.test = { kind: "and", tests: [tree.test, tree.trueBranch.test] };
    }
    tree.trueBranch = tree.trueBranch.trueBranch;
    mergeTests(tree);
  }

  if (
    tree.falseBranch.kind === "node" &&
    sameTestTree(tree.trueBranch, tree.falseBranch.trueBranch)
  ) {
    if (tree.test.kind === "or") {
      tree.test.tests.push(tree.falseBranch.test);
    } else {
      tree.test = { kind: "or", tests: [tree.test, tree.falseBranch.test] };
    }
    tree.falseBranch = tree.falseBranch.falseBranch;
    mergeTests(tree);
  }

  mergeTests(tree.trueBranch);
  mergeTests(tree.falseBranch);
}

function propagatePriorTestResult(tree: TestTree) {
  const testToBranchTaken = new HashMap<Test, boolean>(hashTest, sameTest);

  const f = (tree: TestTree): TestTree | undefined => {
    if (tree.kind !== "node") {
      return undefined;
    }

    for (const test of terminalTestsInTest(tree.test)) {
      if (test.kind === "for-all") {
        propagatePriorTestResult(test.tree);
      }
    }

    const branchTaken = testToBranchTaken.get(tree.test);
    switch (branchTaken) {
      case undefined: {
        testToBranchTaken.set(tree.test, true);
        while (true) {
          const newTrueBranch = f(tree.trueBranch);
          if (newTrueBranch !== undefined) {
            tree.trueBranch = newTrueBranch;
          } else {
            break;
          }
        }

        testToBranchTaken.set(tree.test, false);
        while (true) {
          const newFalseBranch = f(tree.falseBranch);
          if (newFalseBranch !== undefined) {
            tree.falseBranch = newFalseBranch;
          } else {
            break;
          }
        }

        testToBranchTaken.remove(tree.test);
        return undefined;
      }
      case true:
        return tree.trueBranch;
      case false:
        return tree.falseBranch;
      default:
        unreachable(branchTaken);
    }
  };

  f(tree);
}

function caseTypesToTestTree(
  types: CheckableType[],
  hasDefault: boolean,
): TestTree {
  let tree: TestTree = { kind: "leaf-fail" };
  for (let i = 0; i < types.length; i++) {
    const newTree = createTestTree([], types[i], {
      kind: "case-index",
      index: i,
    });
    tree = replaceLeaves(tree, "leaf-fail", newTree);
    propagatePriorTestResult(tree);
  }
  if (hasDefault) {
    tree = replaceLeaves(tree, "leaf-fail", {
      kind: "leaf-success",
      result: { kind: "case-index", index: types.length },
    });
  }
  while (true) {
    const newTree = cloneTestTree(tree);
    mergeTests(newTree);
    if (sameTestTree(tree, newTree)) {
      break;
    } else {
      tree = newTree;
    }
  }
  return tree;
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

function createLogicalOrs(expressions: ts.Expression[]): ts.BinaryExpression {
  if (expressions.length < 2) {
    throw new Error("at least 2 expressions are required");
  } else if (expressions.length === 2) {
    return ts.factory.createLogicalOr(expressions[0], expressions[1]);
  } else {
    const left = createLogicalOrs(expressions.slice(0, -1));
    assert(left !== undefined);
    const right = expressions[expressions.length - 1];
    return ts.factory.createLogicalOr(left, right);
  }
}

function literalToExpression(literal: Literal): ts.Expression {
  switch (literal.kind) {
    case "string":
      return ts.factory.createStringLiteral(literal.value);
    case "number":
      return ts.factory.createNumericLiteral(literal.value);
    case "bigint":
      return ts.factory.createBigIntLiteral(literal.value);
    case "boolean":
      return literal.value ? ts.factory.createTrue() : ts.factory.createFalse();
    case "undefined":
      return ts.factory.createIdentifier("undefined");
    case "null":
      return ts.factory.createNull();
    default:
      unreachable(literal);
  }
}

function applyTesteeAccessors(
  testee: ts.Expression,
  accessors: TesteeAccessor[],
): ts.Expression {
  for (const accessor of accessors) {
    switch (accessor.kind) {
      case "index-access":
        testee = ts.factory.createElementAccessExpression(
          testee,
          accessor.index,
        );
        break;
      case "property-access":
        testee = ts.factory.createPropertyAccessExpression(
          testee,
          accessor.name,
        );
        break;
      default:
        unreachable(accessor);
    }
  }
  return testee;
}

/**
 * `forAllTestTreeToFunctionName` must be populated using
 * `assignFunctionNamesToForAllTestTrees()`.
 */
function testToExpression(
  test: Test,
  testee: ts.Expression,
  forAllTestTreeToFunctionName: HashMap<TestTree, ts.Identifier>,
): ts.Expression {
  switch (test.kind) {
    case "strict-equal":
      return ts.factory.createStrictEquality(
        applyTesteeAccessors(testee, test.accessors),
        literalToExpression(test.want),
      );
    case "not-null":
      return ts.factory.createStrictInequality(
        applyTesteeAccessors(testee, test.accessors),
        ts.factory.createNull(),
      );
    case "typeof":
      return ts.factory.createStrictEquality(
        ts.factory.createTypeOfExpression(
          applyTesteeAccessors(testee, test.accessors),
        ),
        ts.factory.createStringLiteral(test.want),
      );
    case "is-array":
      return ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(
          ts.factory.createIdentifier("Array"),
          "isArray",
        ),
        undefined,
        [applyTesteeAccessors(testee, test.accessors)],
      );
    case "range":
      return ts.factory.createLogicalAnd(
        ts.factory.createLessThanEquals(
          ts.factory.createNumericLiteral(test.min),
          ts.factory.createPropertyAccessExpression(
            applyTesteeAccessors(testee, test.accessors),
            "length",
          ),
        ),
        ts.factory.createLessThanEquals(
          ts.factory.createPropertyAccessExpression(
            applyTesteeAccessors(testee, test.accessors),
            "length",
          ),
          ts.factory.createNumericLiteral(test.max),
        ),
      );
    case "for-all": {
      const f = forAllTestTreeToFunctionName.get(test.tree);
      if (f === undefined) {
        console.log(test.tree);
      }
      assert(f !== undefined);
      return ts.factory.createCallExpression(f, undefined, [
        applyTesteeAccessors(testee, test.accessors),
      ]);
    }
    case "has-property":
      return ts.factory.createBinaryExpression(
        ts.factory.createStringLiteral(test.name),
        ts.SyntaxKind.InKeyword,
        applyTesteeAccessors(testee, test.accessors),
      );
    case "and":
      return createLogicalAnds(
        test.tests.map((test) =>
          testToExpression(test, testee, forAllTestTreeToFunctionName),
        ),
      );
    case "or":
      return createLogicalOrs(
        test.tests.map((test) =>
          testToExpression(test, testee, forAllTestTreeToFunctionName),
        ),
      );
    default:
      unreachable(test);
  }
}

/**
 * `forAllTestTreeToFunctionName` must be populated using
 * `assignFunctionNamesToForAllTestTrees()`.
 */
function testTreeToStatement(
  tree: TestTree,
  testee: ts.Expression,
  forAllTestTreeToFunctionName: HashMap<TestTree, ts.Identifier>,
): ts.Statement {
  switch (tree.kind) {
    case "leaf-success":
      switch (tree.result.kind) {
        case "case-index":
          return ts.factory.createReturnStatement(
            ts.factory.createNumericLiteral(tree.result.index),
          );
        case "for-all-element-pass":
          return ts.factory.createBlock([]);
        default:
          unreachable(tree.result);
      }
    case "leaf-fail":
      return ts.factory.createReturnStatement(ts.factory.createFalse());
    case "node": {
      return ts.factory.createIfStatement(
        testToExpression(tree.test, testee, forAllTestTreeToFunctionName),
        testTreeToStatement(
          tree.trueBranch,
          testee,
          forAllTestTreeToFunctionName,
        ),
        testTreeToStatement(
          tree.falseBranch,
          testee,
          forAllTestTreeToFunctionName,
        ),
      );
    }
    default:
      unreachable(tree);
  }
}

/**
 * `forAllTestTreeToFunctionName` must be populated using
 * `assignFunctionNamesToForAllTestTrees()`.
 */
function forAllTestTreeToFunctionDeclaration(
  tree: TestTree,
  functionName: ts.Identifier,
  forAllTestTreeToFunctionName: HashMap<TestTree, ts.Identifier>,
): ts.FunctionDeclaration {
  const parameter = ts.factory.createTempVariable(undefined, true);
  const loopVariable = ts.factory.createLoopVariable(true);
  const statement = testTreeToStatement(
    tree,
    loopVariable,
    forAllTestTreeToFunctionName,
  );
  return ts.factory.createFunctionDeclaration(
    undefined,
    undefined,
    functionName,
    undefined,
    [ts.factory.createParameterDeclaration(undefined, undefined, parameter)],
    undefined,
    ts.factory.createBlock([
      ts.factory.createForOfStatement(
        undefined,
        ts.factory.createVariableDeclarationList([
          ts.factory.createVariableDeclaration(loopVariable),
        ]),
        parameter,
        statement,
      ),
      ts.factory.createReturnStatement(ts.factory.createTrue()),
    ]),
  );
}

function* forAllTestTreesInTestTreeRecursive(
  tree: TestTree,
): Generator<TestTree, void, void> {
  if (tree.kind !== "node") {
    return;
  }
  for (const test of terminalTestsInTest(tree.test)) {
    if (test.kind === "for-all") {
      yield test.tree;
      yield* forAllTestTreesInTestTreeRecursive(test.tree);
    }
  }
  yield* forAllTestTreesInTestTreeRecursive(tree.trueBranch);
  yield* forAllTestTreesInTestTreeRecursive(tree.falseBranch);
}

function assignFunctionNamesToForAllTestTrees(
  tree: TestTree,
  forAllTestTreeToFunctionName: HashMap<TestTree, ts.Identifier>,
) {
  for (const t of forAllTestTreesInTestTreeRecursive(tree)) {
    const functionName = forAllTestTreeToFunctionName.get(t);
    if (functionName === undefined) {
      forAllTestTreeToFunctionName.set(
        t,
        ts.factory.createTempVariable(undefined, true),
      );
    }
  }
}

// FIXME
function rootTestTreeToFunctionDeclarations(
  tree: TestTree,
  testTreeToFunctionName: HashMap<TestTree, ts.Identifier>,
  testTreeToFunctionDeclaration: HashMap<TestTree, ts.FunctionDeclaration>,
) {
  assignFunctionNamesToForAllTestTrees(tree, testTreeToFunctionName);
  for (const [key, value] of testTreeToFunctionName.entries()) {
    if (testTreeToFunctionDeclaration.get(key) === undefined) {
      const d = forAllTestTreeToFunctionDeclaration(
        key,
        value,
        testTreeToFunctionName,
      );
      testTreeToFunctionDeclaration.set(key, d);
    }
  }

  const rootFunctionName = ts.factory.createTempVariable(undefined, true);
  testTreeToFunctionName.set(tree, rootFunctionName);
  const testee = ts.factory.createTempVariable(undefined, true);
  testTreeToFunctionDeclaration.set(
    tree,
    ts.factory.createFunctionDeclaration(
      undefined,
      undefined,
      rootFunctionName,
      undefined,
      [ts.factory.createParameterDeclaration(undefined, undefined, testee)],
      undefined,
      ts.factory.createBlock([
        testTreeToStatement(tree, testee, testTreeToFunctionName),
      ]),
    ),
  );
}

function isTupleType(
  typeChecker: ts.TypeChecker,
  type: ts.Type,
): type is ts.TupleTypeReference {
  // TODO: understand what this function does exactly
  return typeChecker.isTupleType(type);
}

function getBooleanLiteralValue(type: ts.Type): boolean | undefined {
  if (!(type.getFlags() & ts.TypeFlags.BooleanLiteral)) {
    return undefined;
  }
  assert("intrinsicName" in type);
  assert(type.intrinsicName === "true" || type.intrinsicName === "false");
  return type.intrinsicName === "true";
}

function tsTypeToLiteral(type: ts.Type): Literal | undefined {
  if (type.isLiteral()) {
    switch (typeof type.value) {
      case "number":
        return { kind: "number", value: type.value };
      case "string":
        return { kind: "string", value: type.value };
      case "object":
        return { kind: "bigint", value: type.value };
      default:
        unreachable(type.value);
    }
  }

  const booleanLiteralValue = getBooleanLiteralValue(type);
  if (booleanLiteralValue !== undefined) {
    return { kind: "boolean", value: booleanLiteralValue };
  }

  const typeFlags = type.getFlags();
  if (typeFlags & ts.TypeFlags.Undefined) {
    return { kind: "undefined" };
  } else if (typeFlags & ts.TypeFlags.Null) {
    return { kind: "null" };
  }

  return undefined;
}

function isObjectType(type: ts.Type): type is ts.ObjectType {
  return (type.getFlags() & ts.TypeFlags.Object) !== 0;
}

function tsTypeToCheckableType(
  typeChecker: ts.TypeChecker,
  type: ts.Type,
): CheckableType | undefined {
  const literal = tsTypeToLiteral(type);
  if (literal !== undefined) {
    return { kind: "literal", literal };
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
  action: ts.ArrowFunction;
};

type Match = {
  testee: ts.Expression;
  cases: Case[];
  defaultAction: ts.ArrowFunction | undefined;
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
        // FIXME:
        assert(ts.isArrowFunction(node.arguments[0]));
        // TODO: [0]
        cases.push({ type: t, action: node.arguments[0] });
        return f(callee.expression);
      } else if (callee.name.text === "returns") {
        return f(callee.expression);
      }
    } else if (ts.isIdentifier(callee) && callee.text === "match") {
      // TODO: [0]
      cases.reverse();
      // FIXME:
      assert(defaultAction === undefined || ts.isArrowFunction(defaultAction));
      return { testee: node.arguments[0], cases, defaultAction };
    }

    return undefined;
  }

  return f(node);
}

export { match } from "./match";

export default (
    program: ts.Program,
    _config: PluginConfig,
    _extras: TransformerExtras,
  ) =>
  (context: ts.TransformationContext): ts.Transformer<ts.SourceFile> =>
  (sourceFile: ts.SourceFile): ts.SourceFile => {
    const typeChecker = program.getTypeChecker();

    const forAllTestTreeToFunctionName = new HashMap<TestTree, ts.Identifier>(
      hashTestTree,
      sameTestTree,
    );
    const forAllTestTreeToFunctionDeclaration = new HashMap<
      TestTree,
      ts.FunctionDeclaration
    >(hashTestTree, sameTestTree);

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

      // if (ts.isIdentifier(node) && node.text.includes("__")) {
      //   const fd = ts.factory.createFunctionDeclaration(
      //     undefined,
      //     undefined,
      //     node.text,
      //     undefined,
      //     [],
      //     undefined,
      //     ts.factory.createBlock([
      //       ts.factory.createExpressionStatement(
      //         ts.factory.createStringLiteral(node.text),
      //       ),
      //     ]),
      //   );
      //   fds.push(fd);
      // }

      const match = findMatchExpression(typeChecker, node);
      if (match !== undefined) {
        const types = match.cases.map((c) => c.type);
        const tree = caseTypesToTestTree(
          types,
          match.defaultAction !== undefined,
        );
        // console.dir(t, { depth: Infinity });
        // console.log();
        // return ts.factory.createIdentifier("undefined");

        // const logFail = ts.factory.createExpressionStatement(
        //   ts.factory.createCallExpression(
        //     ts.factory.createPropertyAccessExpression(
        //       ts.factory.createIdentifier("console"),
        //       "log",
        //     ),
        //     undefined,
        //     [ts.factory.createStringLiteral("fail")],
        //   ),
        // );

        rootTestTreeToFunctionDeclarations(
          tree,
          forAllTestTreeToFunctionName,
          forAllTestTreeToFunctionDeclaration,
        );

        const functionName = forAllTestTreeToFunctionName.get(tree);
        assert(functionName !== undefined);

        const testee = ts.factory.createTempVariable(undefined, true);
        const caseActions = match.cases.map((c) => c.action);
        if (match.defaultAction !== undefined) {
          caseActions.push(match.defaultAction);
        }
        const clauses = caseActions.map((action, i) => {
          const statements: ts.Statement[] = [];

          // FIXME
          if (action.parameters.length === 1) {
            statements.push(
              ts.factory.createVariableStatement(undefined, [
                ts.factory.createVariableDeclaration(
                  action.parameters[0].name,
                  undefined,
                  undefined,
                  testee,
                ),
              ]),
            );
          }

          if (ts.isExpression(action.body)) {
            statements.push(ts.factory.createReturnStatement(action.body));
          } else {
            for (const s of action.body.statements) {
              statements.push(s);
            }
          }
          return ts.factory.createCaseClause(
            ts.factory.createNumericLiteral(i),
            [ts.factory.createBlock(statements)],
          );
        });

        const af = ts.factory.createArrowFunction(
          undefined,
          undefined,
          [ts.factory.createParameterDeclaration(undefined, undefined, testee)],
          undefined,
          undefined,
          ts.factory.createBlock([
            ts.factory.createSwitchStatement(
              ts.factory.createCallExpression(functionName, undefined, [
                testee,
              ]),
              ts.factory.createCaseBlock(clauses),
            ),
          ]),
        );

        return ts.factory.createCallExpression(af, undefined, [match.testee]);
      }

      return ts.visitEachChild(node, visitor, context);
    }

    // return ts.visitNode(sourceFile, visitor, ts.isSourceFile);
    sourceFile = ts.visitNode(sourceFile, visitor, ts.isSourceFile);
    const statements = Array.from(sourceFile.statements);
    for (const [, d] of forAllTestTreeToFunctionDeclaration.entries()) {
      statements.push(d);
    }
    sourceFile = ts.factory.updateSourceFile(sourceFile, statements);
    console.log(ts.createPrinter().printFile(sourceFile));
    // if (sourceFile.fileName.endsWith("test.ts")) {
    //   process.exit(0);
    // }

    return sourceFile;
  };
