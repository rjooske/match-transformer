import { match } from "../src/match";

function f(x: unknown): number {
  return match(x)
    .returns<number>()
    .case<{ foo?: number; bar?: boolean }>(() => 0)
    .default(() => -1);
}
