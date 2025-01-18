import {
  Occurrence,
  Type,
  typeGetArguments,
  typeEqualConstructor,
  typeIsSubtype,
  typeMakeArgumentsUnknown,
  Union,
  unionIsSubtype,
  unionReplaceAt,
  unionIntersection,
  typeAccessUnion,
} from "./type";
import { cartesianProduct, every, exactlyOne, zip } from "./util";
import assert from "assert";

export type MatchTable = {
  input: Union;
  occurrences: Occurrence[];
  caseIndices: number[];
  patternRows: Union[][];
};

export function matchTableColumnCount(m: MatchTable): number {
  return m.occurrences.length;
}

export function matchTableRowCount(m: MatchTable): number {
  return m.patternRows.length;
}

export function matchTableIsFail(m: MatchTable): boolean {
  return matchTableRowCount(m) === 0;
}

export function matchTableSuccessCaseIndex(m: MatchTable): number | undefined {
  const row = exactlyOne(m.patternRows);
  if (row !== undefined && row.length === 0) {
    return m.caseIndices[0];
  }
}

/**
 * Returns undefined when `columnIndex` is out of bounds.
 * `m` should not contain a union pattern and may return undefined when it does.
 */
export function matchTableSpecializeSuccess(
  m: MatchTable,
  type: Type,
  columnIndex: number,
): MatchTable | undefined {
  const typeWithUnknownArguments = typeMakeArgumentsUnknown(type);
  const typeArguments = typeGetArguments(type);
  const occurrence = m.occurrences[columnIndex];

  const modifiedInputType = unionReplaceAt(m.input, occurrence, [
    typeWithUnknownArguments,
  ]);
  const result: MatchTable = {
    input: unionIntersection(m.input, modifiedInputType),
    occurrences: [],
    caseIndices: [],
    patternRows: [],
  };

  for (let i = 0; i < columnIndex; i++) {
    result.occurrences.push(m.occurrences[i]);
  }
  for (const [, accessor] of typeArguments) {
    result.occurrences.push([...occurrence, accessor]);
  }
  for (let i = columnIndex + 1; i < m.occurrences.length; i++) {
    result.occurrences.push(m.occurrences[i]);
  }

  for (let i = 0; i < m.patternRows.length; i++) {
    const row = m.patternRows[i];
    const caseIndex = m.caseIndices[i];

    const patternUnion = row.at(columnIndex);
    if (patternUnion === undefined) {
      return undefined;
    }
    const patternType = exactlyOne(patternUnion);
    if (patternType === undefined) {
      return undefined;
    }

    if (
      !typeIsSubtype(
        typeWithUnknownArguments,
        typeMakeArgumentsUnknown(patternType),
      )
    ) {
      continue;
    }

    const newRow: Union[] = [];
    for (let i = 0; i < columnIndex; i++) {
      newRow.push(row[i]);
    }
    for (const [, accessor] of typeArguments) {
      const union = typeAccessUnion(patternType, accessor);
      assert(union !== undefined);
      newRow.push(union);
    }
    for (let i = columnIndex + 1; i < row.length; i++) {
      newRow.push(row[i]);
    }

    result.caseIndices.push(caseIndex);
    result.patternRows.push(newRow);
  }

  return result;
}

/**
 * Returns undefined when `columnIndex` is out of bounds.
 * `m` should not contain a union pattern and may return undefined when it does.
 */
export function matchTableSpecializeFail(
  m: MatchTable,
  type: Type,
  columnIndex: number,
): MatchTable | undefined {
  const result: MatchTable = {
    input: m.input,
    occurrences: Array.from(m.occurrences),
    caseIndices: [],
    patternRows: [],
  };

  for (let i = 0; i < m.patternRows.length; i++) {
    const row = m.patternRows[i];
    const caseIndex = m.caseIndices[i];

    const patternUnion = row.at(columnIndex);
    if (patternUnion === undefined) {
      return undefined;
    }
    const patternType = exactlyOne(patternUnion);
    if (patternType === undefined) {
      return undefined;
    }

    if (!typeEqualConstructor(type, patternType)) {
      result.caseIndices.push(caseIndex);
      result.patternRows.push(row);
    }
  }

  return result;
}

export function matchTableExpand(m: MatchTable): MatchTable {
  const result: MatchTable = {
    input: m.input,
    occurrences: Array.from(m.occurrences),
    caseIndices: [],
    patternRows: [],
  };

  for (let i = 0; i < m.patternRows.length; i++) {
    const row = m.patternRows[i];
    const caseIndex = m.caseIndices[i];
    for (const types of cartesianProduct(row)) {
      result.caseIndices.push(caseIndex);
      result.patternRows.push(types.map((t) => [t]));
    }
  }

  return result;
}

export function matchTableRemove(m: MatchTable): MatchTable {
  const result: MatchTable = {
    input: m.input,
    occurrences: Array.from(m.occurrences),
    caseIndices: [],
    patternRows: [],
  };

  for (let i = 0; i < m.patternRows.length; i++) {
    const row = m.patternRows[i];
    const caseIndex = m.caseIndices[i];

    let rowShouldStay = true;
    for (let j = 0; j < i; j++) {
      const earlierRow = m.patternRows[j];
      if (every(zip(row, earlierRow), ([r1, r2]) => unionIsSubtype(r1, r2))) {
        rowShouldStay = false;
        break;
      }
    }

    if (rowShouldStay) {
      result.caseIndices.push(caseIndex);
      result.patternRows.push(row);
    }
  }

  return result;
}
