export interface HermesFuzzSummary {
  rounds: number;
  equivalent: number;
  different: number;
  dumpFailed: number;
  compileErrors: number;
  planted: number;
  plantedMissed: number;
  plantedCompileErrors: number;
}

/** A green run must contain all requested comparisons and an effective negative. */
export function hermesFuzzSucceeded(summary: HermesFuzzSummary): boolean {
  return (
    Number.isSafeInteger(summary.rounds) &&
    summary.rounds > 0 &&
    summary.equivalent === summary.rounds &&
    summary.different === 0 &&
    summary.dumpFailed === 0 &&
    summary.compileErrors === 0 &&
    Number.isSafeInteger(summary.planted) &&
    summary.planted > 0 &&
    summary.plantedMissed === 0 &&
    summary.plantedCompileErrors === 0
  );
}
