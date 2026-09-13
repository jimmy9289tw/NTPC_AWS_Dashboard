export type WagePair = {
  mean: number | null | undefined;
  median: number | null | undefined;
};

export function meanMedianGap({ mean, median }: WagePair): number | null {
  if (mean == null || median == null) return null;
  return mean - median;
}

export function meanMedianGapSharePct({ mean, median }: WagePair): number | null {
  const gap = meanMedianGap({ mean, median });
  if (gap == null || mean == null || mean === 0) return null;
  return gap / mean * 100;
}

export function growthRatePct(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / previous * 100;
}

export function compoundAnnualGrowthRatePct(
  latest: number | null | undefined,
  earliest: number | null | undefined,
  elapsedYears: number,
): number | null {
  if (latest == null || earliest == null || latest <= 0 || earliest <= 0 || elapsedYears <= 0) return null;
  return (Math.pow(latest / earliest, 1 / elapsedYears) - 1) * 100;
}

export function estimateRangesOverlap(
  firstLow: number | null | undefined,
  firstHigh: number | null | undefined,
  secondLow: number | null | undefined,
  secondHigh: number | null | undefined,
): boolean | null {
  if (firstLow == null || firstHigh == null || secondLow == null || secondHigh == null) return null;
  return Math.max(firstLow, secondLow) <= Math.min(firstHigh, secondHigh);
}
