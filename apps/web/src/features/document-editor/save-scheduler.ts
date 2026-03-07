export type SaveSchedulerOptions<T> = {
  debounceMs: number;
  save: (payload: T) => Promise<void>;
  onError?: (error: unknown) => void;
};

export type SaveScheduler<T> = {
  schedule: (payload: T) => void;
  flush: () => Promise<void>;
  cancel: () => void;
};

export function createSaveScheduler<T>(options: SaveSchedulerOptions<T>): SaveScheduler<T> {
  const debounceMs = Math.max(0, Math.floor(options.debounceMs));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latestPayload: T | null = null;
  let hasPendingPayload = false;
  let running = false;
  let inFlight: Promise<void> = Promise.resolve();
  let lastError: unknown = null;

  const run = async (): Promise<void> => {
    if (running) {
      return inFlight;
    }

    running = true;
    inFlight = (async () => {
      try {
        while (hasPendingPayload) {
          hasPendingPayload = false;
          const payload = latestPayload as T;
          await options.save(payload);
        }
        lastError = null;
      } catch (error) {
        lastError = error;
        options.onError?.(error);
        throw error;
      } finally {
        running = false;
      }
    })();

    return inFlight;
  };

  const schedule = (payload: T): void => {
    latestPayload = payload;
    hasPendingPayload = true;

    if (running) {
      return;
    }

    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      void run().catch(() => undefined);
    }, debounceMs);
  };

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await run();
    if (lastError) {
      throw lastError;
    }
  };

  const cancel = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    hasPendingPayload = false;
    latestPayload = null;
  };

  return {
    schedule,
    flush,
    cancel,
  };
}
