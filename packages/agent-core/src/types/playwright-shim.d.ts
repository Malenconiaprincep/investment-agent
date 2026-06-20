declare module 'playwright' {
  export const chromium: {
    launch(options: { headless?: boolean }): Promise<{
      newContext(options?: Record<string, unknown>): Promise<{
        request: {
          get(
            url: string,
            options?: Record<string, unknown>,
          ): Promise<{
            ok(): boolean;
            status(): number;
            json(): Promise<unknown>;
          }>;
        };
      }>;
      close(): Promise<void>;
    }>;
  };
}
