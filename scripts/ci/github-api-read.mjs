const waitSync = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

function retryable(error) {
  const detail = `${error.stderr ?? ''}\n${error.message ?? ''}`;
  return /HTTP (?:429|5\d\d)|timed out|ECONNRESET/i.test(detail)
    || /secondary rate limit|abuse detection|temporarily rate limited/i.test(detail);
}

/** Retry only recognizable transient failures from idempotent GitHub reads. */
export function withGitHubReadRetry(read, { wait = waitSync } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return read();
    } catch (error) {
      if (attempt === 2 || !retryable(error)) throw error;
      // A secondary limit asks clients to pause. Bounded backoff avoids
      // repeating the burst; auth and permission errors still fail at once.
      wait(attempt === 0 ? 10_000 : 30_000);
    }
  }
}
