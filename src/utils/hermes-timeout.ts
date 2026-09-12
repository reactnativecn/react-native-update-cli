/** Reject invalid/overflowing timer values instead of turning them into 1ms. */
export function hermesTimeout(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 0x7fffffff
    ? parsed
    : fallback;
}
