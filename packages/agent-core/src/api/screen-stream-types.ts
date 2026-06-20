export type ScreenStreamEvent =
  | { type: 'step'; step: string; label: string }
  | { type: 'token'; text: string }
  | {
      type: 'hotNews';
      query: string;
      mode: 'auto' | 'manual';
      hotThemes: string[];
      hotNews: Array<{ title: string; datetime: string; url: string | null }>;
    }
  | {
      type: 'sectors';
      sectors: Array<{ name: string; reason: string; dataSource: string }>;
    }
  | {
      type: 'candidates';
      candidates: Array<{
        symbol: string;
        name: string;
        thesis: string;
        dataSource: string;
      }>;
    }
  | {
      type: 'done';
      query: string;
      sectors: Array<{ name: string; reason: string; dataSource: string }>;
      candidates: Array<{
        symbol: string;
        name: string;
        thesis: string;
        dataSource: string;
      }>;
      rotationSummary: string;
      hotNews: Array<{ title: string; datetime: string; url: string | null }>;
      hotThemes: string[];
      mode: 'auto' | 'manual';
      passed: boolean;
      missingSections: string[];
      missingKeywords: string[];
      screenedAt: string;
      elapsedMs: number;
      sessionId: string;
    }
  | { type: 'error'; message: string };
