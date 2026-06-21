export type CommitteeTradePlanPayload = {
  symbol: string;
  name: string;
  action: 'buy' | 'hold' | 'wait' | 'sell';
  actionReason: string;
  latestClose: number;
  entryPrice: number | null;
  stopLossPrice: number;
  targetHint: string;
  signals: Array<{
    kind: 'buy' | 'sell';
    tradeDate: string;
    price: number;
    reason: string;
    strength?: 'red' | 'blue';
  }>;
  diamondStrength: 'red' | 'blue' | null;
  checklistScore: number;
  checklistMax: number;
};

export type CommitteeStreamEvent =
  | { type: 'step'; step: string; label: string }
  | { type: 'token'; text: string }
  | {
      type: 'specialist';
      role: string;
      status: 'start' | 'done' | 'error';
      message?: string;
    }
  | { type: 'tradePlans'; tradePlans: CommitteeTradePlanPayload[] }
  | {
      type: 'done';
      memo: string;
      tradePlans: CommitteeTradePlanPayload[];
      candidates: Array<{ symbol: string; name: string }>;
      passed: boolean;
      missingSections: string[];
      missingKeywords: string[];
      completedAt: string;
      elapsedMs: number;
      sessionId: string;
      screeningSessionId?: string;
    }
  | { type: 'error'; message: string };
