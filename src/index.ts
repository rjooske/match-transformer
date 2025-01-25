import { decisionTreeToExpression, nodeToMatch } from "./ast";
import { DecisionTree, decisionTreeCompile } from "./decision-tree";
import { replaceEiifes } from "./eiife";
import { matchTableExpand, matchTableRemove } from "./match-table";
import { Accessor, Literal, Occurrence, Type } from "./type";
import { unreachable } from "./util";
import assert from "assert";
import { TransformerExtras, PluginConfig } from "ts-patch";
import ts from "typescript";

export { match } from "./match";

export default (
    program: ts.Program,
    _config: PluginConfig,
    _extras: TransformerExtras,
  ) =>
  (context: ts.TransformationContext): ts.Transformer<ts.SourceFile> =>
  (sourceFile: ts.SourceFile): ts.SourceFile => {
    const typeChecker = program.getTypeChecker();

    function visitor(node: ts.Node): ts.Node {
      const match = nodeToMatch(typeChecker, node);
      if (match !== undefined) {
        let cleanedUpTable = matchTableExpand(match.table);
        cleanedUpTable = matchTableRemove(cleanedUpTable);
        const decisionTree = decisionTreeCompile(cleanedUpTable);
        const testee = ts.factory.createTempVariable(undefined, true);
        const expression = decisionTreeToExpression(decisionTree, testee);

        // const dot = decisionTreeToDot(decisionTree);
        // console.log(dot);

        const clauses: ts.CaseOrDefaultClause[] = [];
        for (let i = 0; i < match.caseBodies.length; i++) {
          const caseBody = match.caseBodies[i];
          clauses.push(
            ts.factory.createCaseClause(ts.factory.createNumericLiteral(i), [
              ts.factory.createReturnStatement(
                ts.factory.createCallExpression(caseBody, undefined, [testee]),
              ),
            ]),
          );
        }

        if (match.defaultCaseBody !== undefined) {
          clauses.push(
            ts.factory.createCaseClause(
              ts.factory.createPrefixMinus(ts.factory.createNumericLiteral(1)),
              [
                ts.factory.createReturnStatement(
                  ts.factory.createCallExpression(
                    match.defaultCaseBody,
                    undefined,
                    [testee],
                  ),
                ),
              ],
            ),
          );
        }

        const arrow = ts.factory.createArrowFunction(
          undefined,
          undefined,
          [ts.factory.createParameterDeclaration(undefined, undefined, testee)],
          undefined,
          undefined,
          ts.factory.createBlock([
            ts.factory.createSwitchStatement(
              expression,
              ts.factory.createCaseBlock(clauses),
            ),
          ]),
        );

        return ts.factory.createCallExpression(arrow, undefined, [
          match.testee,
        ]);
      }

      return ts.visitEachChild(node, visitor, context);
    }

    sourceFile = ts.visitNode(sourceFile, visitor, ts.isSourceFile);
    sourceFile = replaceEiifes(sourceFile, context);

    console.log(ts.createPrinter().printFile(sourceFile));
    if (sourceFile.fileName.includes("debug")) {
      process.exit(0);
    }

    return sourceFile;
  };

function accessorToString(a: Accessor): string {
  switch (a.kind) {
    case "property":
      return `["${a.name}"]`;
    case "index":
      return `[${a.index}]`;
    case "array-element":
      return "[number]";
    case "record-values":
      return "[string]";
    default:
      unreachable(a);
  }
}

function occurrenceToString(o: Occurrence): string {
  return o.map(accessorToString).join("");
}

function literalToString(l: Literal): string {
  switch (l.kind) {
    case "string":
      return JSON.stringify(l.value);
    case "number":
      return l.value.toString();
    case "bigint":
      return (l.value.negative ? "-" : "") + l.value.base10Value;
    case "boolean":
      return l.value ? "true" : "false";
    case "undefined":
      return "undefined";
    case "null":
      return "null";
    default:
      unreachable(l);
  }
}

function typeToString(t: Type): string {
  switch (t.kind) {
    case "unknown":
      return "unknown";
    case "literal":
      return literalToString(t.literal);
    case "primitive":
      return t.primitive;
    case "object":
      return "object";
    case "tuple":
      return `tuple(${t.elements.length})`;
    case "array":
      return "array";
    case "record":
      return "record";
  }
}

function decisionTreeNodeToString(n: DecisionTree): string {
  switch (n.kind) {
    case "fail":
      return "fail";
    case "success":
      return `success(${n.caseIndex})`;
    case "check":
      return `${typeToString(n.type)}, ${occurrenceToString(n.occurrence)}`;
    default:
      unreachable(n);
  }
}

function decisionTreeToDot(d: DecisionTree): string {
  const nodes = new Map<DecisionTree, number>();

  const stack = [d];
  while (true) {
    const node = stack.pop();
    if (node === undefined) {
      break;
    }
    if (nodes.has(node)) {
      break;
    }
    nodes.set(node, nodes.size);
    switch (node.kind) {
      case "fail":
        break;
      case "success":
        break;
      case "check":
        stack.push(node.success);
        stack.push(node.fail);
        break;
      default:
        unreachable(node);
    }
  }

  const attributes = Array.from(nodes.entries())
    .map(
      ([n, i]) => `${i} [label=${JSON.stringify(decisionTreeNodeToString(n))}]`,
    )
    .join("\n");

  const connections = Array.from(nodes.entries())
    .flatMap(([n, i]) => {
      switch (n.kind) {
        case "fail":
          return [];
        case "success":
          return [];
        case "check": {
          const s = nodes.get(n.success);
          const f = nodes.get(n.fail);
          assert(s !== undefined && f !== undefined);
          return [`${i} -> ${s}`, `${i} -> ${f}`];
        }
        default:
          unreachable(n);
      }
    })
    .join("\n");

  return `digraph {
${connections}
${attributes}
}`;
}
