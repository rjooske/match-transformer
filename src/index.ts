import assert from "assert";
import ts from "typescript";
import { TransformerExtras, PluginConfig } from "ts-patch";
import { decisionTreeToExpression, nodeToMatch } from "./ast";
import { decisionTreeCompile } from "./decision-tree";
import { matchTableExpand, matchTableRemove } from "./match-table";

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

        console.log();
        console.dir(match.table, { depth: Infinity });
        console.dir(decisionTree, { depth: Infinity });

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

    // return ts.visitNode(sourceFile, visitor, ts.isSourceFile);
    sourceFile = ts.visitNode(sourceFile, visitor, ts.isSourceFile);
    console.log(ts.createPrinter().printFile(sourceFile));
    // if (sourceFile.fileName.endsWith("test.ts")) {
    //   process.exit(0);
    // }

    return sourceFile;
  };
