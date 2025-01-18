import assert from "node:assert";
import ts from "typescript";

/**
 * Extractable IIFE
 */
type Eiife = {
  statements: ts.Statement[];
  parameters: ts.ParameterDeclaration[];
  arguments: ts.Expression[];
};

function nodeToEiife(node: ts.Node): Eiife | undefined {
  if (
    !(
      ts.isCallExpression(node) &&
      ts.isParenthesizedExpression(node.expression) &&
      ts.isArrowFunction(node.expression.expression) &&
      node.arguments.length === node.expression.expression.parameters.length &&
      ts.isBlock(node.expression.expression.body)
    )
  ) {
    return undefined;
  }

  const firstStatement = node.expression.expression.body.statements.at(0);
  if (
    !(
      firstStatement !== undefined &&
      ts.isExpressionStatement(firstStatement) &&
      ts.isStringLiteral(firstStatement.expression) &&
      firstStatement.expression.text === "eiife"
    )
  ) {
    return undefined;
  }

  return {
    statements: node.expression.expression.body.statements.slice(1),
    parameters: Array.from(node.expression.expression.parameters),
    arguments: Array.from(node.arguments),
  };
}

function eiifeToFunctionDeclaration(
  e: Eiife,
  name: ts.Identifier,
): ts.FunctionDeclaration {
  return ts.factory.createFunctionDeclaration(
    undefined,
    undefined,
    name,
    undefined,
    e.parameters,
    undefined,
    ts.factory.createBlock(e.statements),
  );
}

const EIIFE_SYMBOL = Symbol();

function createEiifePlaceholder(e: Eiife): ts.Identifier {
  const placeholder = ts.factory.createIdentifier("__placeholder__");
  Object.defineProperty(placeholder, EIIFE_SYMBOL, { value: e });
  return placeholder;
}

function getEiife(node: ts.Node): Eiife | undefined {
  const eiife = (node as any)[EIIFE_SYMBOL];
  if (eiife === undefined) {
    return undefined;
  }
  // EIIFE_SYMBOL should only be used for storing eiifes
  return eiife;
}

export function createEiife(eiife: Eiife): ts.CallExpression {
  return ts.factory.createCallExpression(
    ts.factory.createArrowFunction(
      undefined,
      undefined,
      eiife.parameters,
      undefined,
      undefined,
      ts.factory.createBlock([
        ts.factory.createExpressionStatement(
          ts.factory.createStringLiteral("eiife"),
        ),
        ...eiife.statements,
      ]),
    ),
    undefined,
    eiife.arguments,
  );
}

export function replaceEiifes(
  sourceFile: ts.SourceFile,
  context: ts.TransformationContext,
): ts.SourceFile {
  const eiifes: Eiife[] = [];

  function collectEiifes(node: ts.Node): ts.Node {
    const eiife = nodeToEiife(node);
    if (eiife === undefined) {
      return ts.visitEachChild(node, collectEiifes, context);
    }

    for (let i = 0; i < eiife.arguments.length; i++) {
      eiife.arguments[i] = ts.visitNode(
        eiife.arguments[i],
        collectEiifes,
        ts.isExpression,
      );
    }
    for (let i = 0; i < eiife.statements.length; i++) {
      eiife.statements[i] = ts.visitNode(
        eiife.statements[i],
        collectEiifes,
        ts.isStatement,
      );
    }

    const placeholder = createEiifePlaceholder(eiife);
    eiifes.push(eiife);
    return placeholder;
  }
  sourceFile = ts.visitNode(sourceFile, collectEiifes, ts.isSourceFile);

  const eiifeToFunctionName = new Map<Eiife, ts.Identifier>();
  for (const e of eiifes) {
    eiifeToFunctionName.set(e, ts.factory.createTempVariable(undefined, true));
  }

  function replaceEiifePlaceholders(node: ts.Node): ts.Node {
    const eiife = getEiife(node);
    if (eiife === undefined) {
      return ts.visitEachChild(node, replaceEiifePlaceholders, context);
    }

    const functionName = eiifeToFunctionName.get(eiife);
    assert(functionName !== undefined);
    return ts.factory.createCallExpression(
      functionName,
      undefined,
      eiife.arguments,
    );
  }

  for (const e of eiifes) {
    for (let i = 0; i < e.arguments.length; i++) {
      e.arguments[i] = ts.visitNode(
        e.arguments[i],
        replaceEiifePlaceholders,
        ts.isExpression,
      );
    }
    for (let i = 0; i < e.statements.length; i++) {
      e.statements[i] = ts.visitNode(
        e.statements[i],
        replaceEiifePlaceholders,
        ts.isStatement,
      );
    }
  }

  sourceFile = ts.visitNode(
    sourceFile,
    replaceEiifePlaceholders,
    ts.isSourceFile,
  );

  const statements = Array.from(sourceFile.statements);
  for (const [e, name] of eiifeToFunctionName.entries()) {
    statements.push(eiifeToFunctionDeclaration(e, name));
  }
  return ts.factory.updateSourceFile(sourceFile, statements);
}
