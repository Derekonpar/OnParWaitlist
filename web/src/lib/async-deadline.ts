/**
 * Bound a read without cancelling its underlying shared-cache work. The
 * original promise remains observed, so a late rejection cannot become an
 * unhandled rejection after the caller has already used the fallback.
 */
export async function withDeadline<T>(
  task: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
