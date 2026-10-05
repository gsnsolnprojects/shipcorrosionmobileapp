/**
 * Plain fetch() has no timeout — when a server is unreachable (not just
 * erroring, actually unreachable, e.g. a stale/wrong LAN IP), Android can
 * take 60s+ to give up on the connection attempt. That leaves a screen's
 * data-loading spinner (or a "best-effort" call that's supposed to fail
 * silently) stuck for ages. This fails fast instead.
 *
 * Aborting surfaces as a TypeError, matching what a genuine network failure
 * throws — every offline/queue check in this app (`err instanceof TypeError`)
 * already treats that as "looks offline," so a timeout is handled identically.
 */
export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new TypeError("Network request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
