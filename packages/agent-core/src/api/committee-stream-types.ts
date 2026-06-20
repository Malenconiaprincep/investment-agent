export type CommitteeStreamEvent =
  | { type: 'step'; step: string; label: string }
  | { type: 'token'; text: string }
  | {
      type: 'specialist';
      role: string;
      status: 'start' | 'done' | 'error';
      message?: string;
    }
  | {
      type: 'done';
      memo: string;
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
