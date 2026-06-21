import type { ScreeningSessionRecord } from './store.js';

export type CompareItem<T extends { name?: string; symbol?: string }> = T;

export type ScreeningCompareResult = {
  base: { id: string; query: string; createdAt: string };
  target: { id: string; query: string; createdAt: string };
  sectors: {
    added: ScreeningSessionRecord['sectors'];
    removed: ScreeningSessionRecord['sectors'];
    kept: ScreeningSessionRecord['sectors'];
  };
  candidates: {
    added: ScreeningSessionRecord['candidates'];
    removed: ScreeningSessionRecord['candidates'];
    kept: ScreeningSessionRecord['candidates'];
  };
};

function sectorKey(name: string) {
  return name.trim().toLowerCase();
}

function candidateKey(symbol: string) {
  return symbol.trim();
}

export function compareScreeningSessions(
  base: ScreeningSessionRecord,
  target: ScreeningSessionRecord,
): ScreeningCompareResult {
  const baseSectorKeys = new Set(base.sectors.map((s) => sectorKey(s.name)));
  const targetSectorKeys = new Set(
    target.sectors.map((s) => sectorKey(s.name)),
  );

  const baseCandidateKeys = new Set(
    base.candidates.map((c) => candidateKey(c.symbol)),
  );
  const targetCandidateKeys = new Set(
    target.candidates.map((c) => candidateKey(c.symbol)),
  );

  return {
    base: {
      id: base.id,
      query: base.query,
      createdAt: base.createdAt,
    },
    target: {
      id: target.id,
      query: target.query,
      createdAt: target.createdAt,
    },
    sectors: {
      added: target.sectors.filter(
        (s) => !baseSectorKeys.has(sectorKey(s.name)),
      ),
      removed: base.sectors.filter(
        (s) => !targetSectorKeys.has(sectorKey(s.name)),
      ),
      kept: base.sectors.filter((s) =>
        targetSectorKeys.has(sectorKey(s.name)),
      ),
    },
    candidates: {
      added: target.candidates.filter(
        (c) => !baseCandidateKeys.has(candidateKey(c.symbol)),
      ),
      removed: base.candidates.filter(
        (c) => !targetCandidateKeys.has(candidateKey(c.symbol)),
      ),
      kept: base.candidates.filter((c) =>
        targetCandidateKeys.has(candidateKey(c.symbol)),
      ),
    },
  };
}
