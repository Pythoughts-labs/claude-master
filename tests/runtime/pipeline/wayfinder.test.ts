import { describe, expect, it } from 'vitest';

import type { VerificationReport } from '../../../src/pipeline/report-types.js';
import { routeSlice } from '../../../src/pipeline/wayfinder.js';

function verification(pass: boolean): VerificationReport {
  return {
    pass,
    testsDeleted: 0,
    testsSkipped: 0,
    workspaceClean: true,
    scopeViolations: [],
  } as unknown as VerificationReport;
}

describe('routeSlice', () => {
  it('advances when all gates are green', () => {
    expect(
      routeSlice({
        verification: verification(true),
        perSliceReview: null,
        roundsUsed: 0,
        maxRounds: 2,
        hardBlocker: false,
      }),
    ).toEqual({ route: 'advance', reasons: [] });
  });

  it('repairs a red gate while rounds remain', () => {
    expect(
      routeSlice({
        verification: verification(false),
        perSliceReview: null,
        roundsUsed: 0,
        maxRounds: 2,
        hardBlocker: false,
      }),
    ).toEqual({ route: 'repair', reasons: ['slice verification failed'] });
  });

  it('halts a red gate when rounds are exhausted', () => {
    expect(
      routeSlice({
        verification: verification(false),
        perSliceReview: null,
        roundsUsed: 2,
        maxRounds: 2,
        hardBlocker: false,
      }),
    ).toEqual({ route: 'halt', reasons: ['slice verification failed'] });
  });

  it('halts on a hard blocker even when gates are green', () => {
    expect(
      routeSlice({
        verification: verification(true),
        perSliceReview: null,
        roundsUsed: 0,
        maxRounds: 2,
        hardBlocker: true,
      }),
    ).toEqual({ route: 'halt', reasons: ['unrecoverable blocker'] });
  });

  it('halts on missing verification when rounds are exhausted', () => {
    expect(
      routeSlice({
        verification: null,
        perSliceReview: null,
        roundsUsed: 2,
        maxRounds: 2,
        hardBlocker: false,
      }),
    ).toEqual({
      route: 'halt',
      reasons: ['verification report missing (fail closed)'],
    });
  });

  it('halts on missing verification while rounds remain', () => {
    expect(
      routeSlice({
        verification: null,
        perSliceReview: null,
        roundsUsed: 0,
        maxRounds: 2,
        hardBlocker: false,
      }),
    ).toEqual({
      route: 'halt',
      reasons: ['verification report missing (fail closed)'],
    });
  });
});
