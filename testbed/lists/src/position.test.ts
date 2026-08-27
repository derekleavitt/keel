import { describe, expect, it } from 'vitest';
import {
  canInsertBetween,
  evenPositions,
  neighboursForMove,
  POSITION_STEP,
  PositionExhaustedError,
  positionBetween,
} from './position.ts';

describe('positionBetween', () => {
  it('seeds an empty list', () => {
    expect(positionBetween(null, null)).toBe(POSITION_STEP);
  });

  it('appends after the last row', () => {
    expect(positionBetween(1024, null)).toBe(2048);
  });

  it('prepends before the first row', () => {
    expect(positionBetween(null, 1024)).toBe(0);
  });

  it('takes the midpoint between neighbours', () => {
    expect(positionBetween(1024, 2048)).toBe(1536);
  });

  it('does not overflow near the top of the double range', () => {
    const result = positionBetween(Number.MAX_VALUE / 2, Number.MAX_VALUE);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('throws rather than colliding two rows when the gap is exhausted', () => {
    expect(() => positionBetween(1, 1 + Number.EPSILON)).toThrow(PositionExhaustedError);
  });
});

describe('canInsertBetween', () => {
  it('rejects adjacent doubles', () => {
    expect(canInsertBetween(1, 1 + Number.EPSILON)).toBe(false);
  });

  it('rejects a reversed or equal pair', () => {
    expect(canInsertBetween(2048, 1024)).toBe(false);
    expect(canInsertBetween(1024, 1024)).toBe(false);
  });

  it('accepts an ordinary gap', () => {
    expect(canInsertBetween(1024, 2048)).toBe(true);
  });
});

describe('neighboursForMove', () => {
  const ordered = [
    { id: 'a', position: 1024 },
    { id: 'b', position: 2048 },
    { id: 'c', position: 3072 },
  ];

  it('moving to the front has no left neighbour', () => {
    expect(neighboursForMove(ordered, 'c', null)).toEqual({ before: null, after: 1024 });
  });

  it('moving to the end has no right neighbour', () => {
    expect(neighboursForMove(ordered, 'a', 'c')).toEqual({ before: 3072, after: null });
  });

  it('lifts the moved row out first, so a one-place move is not a no-op', () => {
    // Without removing 'b', its neighbours would be 'b' itself and 'c'.
    expect(neighboursForMove(ordered, 'b', 'c')).toEqual({ before: 3072, after: null });
  });

  it('rejects an unknown anchor', () => {
    expect(() => neighboursForMove(ordered, 'a', 'zzz')).toThrow(/unknown list/);
  });
});

describe('evenPositions', () => {
  it('spaces rows a full step apart', () => {
    expect(evenPositions(3)).toEqual([1024, 2048, 3072]);
  });

  it('leaves room to insert between every pair', () => {
    const positions = evenPositions(4);
    for (let i = 0; i < positions.length - 1; i += 1) {
      expect(canInsertBetween(positions[i] as number, positions[i + 1] as number)).toBe(true);
    }
  });
});
