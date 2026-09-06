type FetchDeadlineOptions = {
  signal?: AbortSignal;
  timeoutMs: number;
  retries?: number;
};

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function fetchWithDeadline(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchDeadlineOptions
): Promise<Response> {
  const attempts = Math.max(1, (options.retries || 0) + 1);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    const timer = globalThis.setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), options.timeoutMs);

    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (attempt + 1 < attempts && TRANSIENT_STATUSES.has(response.status)) {
        await waitForRetry(attempt, options.signal);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted || attempt + 1 >= attempts || !isTransientFetchError(error)) throw error;
      await waitForRetry(attempt, options.signal);
    } finally {
      globalThis.clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }

  throw lastError;
}

function isTransientFetchError(error: unknown) {
  return error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError");
}

function waitForRetry(attempt: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = globalThis.setTimeout(finish, 120 + attempt * 140 + Math.random() * 90);
    const abort = () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason || new DOMException("Request cancelled", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
