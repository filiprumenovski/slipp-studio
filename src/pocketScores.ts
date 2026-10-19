import type { Pocket } from './types';

// Display-only normalization over the full protein analysis, never the selected subset.
// Keep the model outputs untouched for export, provenance and cross-protein interpretation.
export function relativePocketScores(pockets: readonly Pocket[]): Map<string, number | undefined> {
  const maximum = pockets.reduce((max, p) => Math.max(max, p.prediction?.probability ?? 0), 0);
  return new Map(pockets.map(p => [p.id, p.prediction
    ? maximum > 0 ? p.prediction.probability / maximum : 0
    : undefined]));
}
