/**
 * Fractional ordering.
 *
 * Positions are floats so a drag between two neighbours writes exactly one row. Doubles
 * run out of room after roughly fifty halvings of the same gap, so exhaustion is reported
 * explicitly rather than silently returning a duplicate position — two rows sharing a
 * position is a bug that only shows up as a flickering list weeks later.
 */
export const POSITION_STEP = 1024;

export class PositionExhaustedError extends Error {
  constructor() {
    super('No float remains between these neighbours; renumber the list');
    this.name = 'PositionExhaustedError';
  }
}

/** True when two doubles are adjacent, so no midpoint exists. */
export function canInsertBetween(before: number, after: number): boolean {
  if (!(after > before)) return false;
  return before + (after - before) / 2 !== before;
}

/**
 * A position between two neighbours. `null` means the end of the list in that direction.
 *
 * The midpoint is `before + (after - before) / 2`, not `(before + after) / 2` — the naive
 * form overflows to Infinity near Number.MAX_VALUE.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return POSITION_STEP;
  if (before === null) return (after as number) - POSITION_STEP;
  if (after === null) return before + POSITION_STEP;
  if (!canInsertBetween(before, after)) throw new PositionExhaustedError();
  return before + (after - before) / 2;
}

/** Evenly spaced positions, used when a gap is exhausted and the list must be renumbered. */
export function evenPositions(count: number): number[] {
  return Array.from({ length: count }, (_, index) => (index + 1) * POSITION_STEP);
}

/**
 * The neighbours a moved row lands between.
 *
 * The row is lifted out of the sequence first. Without that, moving a row one place is a
 * no-op — it computes a position between itself and its neighbour.
 */
export function neighboursForMove(
  ordered: { id: string; position: number }[],
  movingId: string,
  afterId: string | null,
): { before: number | null; after: number | null } {
  const without = ordered.filter((row) => row.id !== movingId);
  if (afterId === null) {
    return { before: null, after: without[0]?.position ?? null };
  }
  const index = without.findIndex((row) => row.id === afterId);
  if (index === -1) throw new Error(`Cannot move after unknown list ${afterId}`);
  return {
    before: without[index]?.position ?? null,
    after: without[index + 1]?.position ?? null,
  };
}
