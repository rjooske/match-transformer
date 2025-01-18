import assert from "assert";
import {
  MatchTable,
  matchTableColumnCount,
  matchTableExpand,
  matchTableIsFail,
  matchTableRemove,
  matchTableRowCount,
  matchTableSpecializeFail,
  matchTableSpecializeSuccess,
  matchTableSuccessCaseIndex,
} from "./match-table";
import { Occurrence, Type, typeMinima } from "./type";
import { exactlyOne } from "./util";

export type DecisionTree =
  | { kind: "fail" }
  | { kind: "success"; caseIndex: number }
  | {
      kind: "check";
      type: Type;
      occurrence: Occurrence;
      success: DecisionTree;
      fail: DecisionTree;
    };

type Check = {
  type: Type;
  columnIndex: number;
};

/**
 * `m` should not contain union patterns and may return undefined if it does.
 */
function possibleChecks(m: MatchTable): Check[] | undefined {
  const checks: Check[] = [];

  for (let j = 0; j < matchTableColumnCount(m); j++) {
    const column: Type[] = [];
    for (let i = 0; i < matchTableRowCount(m); i++) {
      const patternUnion = m.patternRows[i][j];
      const patternType = exactlyOne(patternUnion);
      if (patternType === undefined) {
        return undefined;
      }
      column.push(patternType);
    }

    for (const type of typeMinima(column)) {
      checks.push({ type, columnIndex: j });
    }
  }

  return checks;
}

export function decisionTreeCompile(m: MatchTable): DecisionTree {
  if (matchTableIsFail(m)) {
    return { kind: "fail" };
  }

  const successCaseIndex = matchTableSuccessCaseIndex(m);
  if (successCaseIndex !== undefined) {
    return { kind: "success", caseIndex: successCaseIndex };
  }

  const checks = possibleChecks(m);
  assert(checks !== undefined);
  assert(checks.length > 0);
  // TODO
  const bestCheck = checks[Math.floor(checks.length * Math.random())];

  const specializedSuccessTable = matchTableSpecializeSuccess(
    m,
    bestCheck.type,
    bestCheck.columnIndex,
  );
  assert(specializedSuccessTable !== undefined);
  let cleanedUpSuccessTable = matchTableExpand(specializedSuccessTable);
  cleanedUpSuccessTable = matchTableRemove(cleanedUpSuccessTable);

  const specializedFailTable = matchTableSpecializeFail(
    m,
    bestCheck.type,
    bestCheck.columnIndex,
  );
  assert(specializedFailTable !== undefined);

  return {
    kind: "check",
    type: bestCheck.type,
    occurrence: m.occurrences[bestCheck.columnIndex],
    success: decisionTreeCompile(cleanedUpSuccessTable),
    fail: decisionTreeCompile(specializedFailTable),
  };
}

// function main() {
//   const t = decisionTreeCompile({
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
//   console.dir(t, { depth: Infinity });
// }
//
// main();
