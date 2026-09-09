/**
 * Overpass API fetch with endpoint rotation, timeout, and backoff
 * (#1962 step F; the #1861 fix lives on top of this).
 *
 * Worker-compatible (no DOM, no THREE) and query-agnostic by design: the
 * buildings layer sends building queries today, and #1930's street
 * centerline import reuses this module with its own queries.
 *
 * Every endpoint × attempt combination is tried before giving up: the
 * public Overpass instances 504/timeout independently, so rotating
 * endpoints inside the retry loop turns most single-instance outages into
 * a slow success instead of a failed tile.
 */

export const DEFAULT_OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_ATTEMPTS_PER_ENDPOINT = 2;
const BACKOFF_BASE_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class OverpassError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'OverpassError';
    this.status = status;
  }
}

/**
 * POST an Overpass QL query, returning the parsed JSON response.
 *
 * @param {string} query Overpass QL (should carry its own [timeout:..]).
 * @param {Object} [options]
 * @param {string[]} [options.endpoints]
 * @param {number} [options.timeoutMs] per-request abort timeout.
 * @param {number} [options.attemptsPerEndpoint]
 * @param {Function} [options.fetchImpl] injectable for tests.
 * @param {AbortSignal} [options.signal] external cancellation.
 * @throws {OverpassError} after every endpoint/attempt failed (carries the
 *   last failure's HTTP status when there was one).
 */
export async function fetchOverpass(query, options = {}) {
  const {
    endpoints = DEFAULT_OVERPASS_ENDPOINTS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    attemptsPerEndpoint = DEFAULT_ATTEMPTS_PER_ENDPOINT,
    fetchImpl = fetch,
    signal
  } = options;

  let lastError = null;
  for (let attempt = 0; attempt < attemptsPerEndpoint; attempt++) {
    for (let i = 0; i < endpoints.length; i++) {
      if (signal?.aborted) {
        throw new OverpassError('aborted');
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onExternalAbort = () => controller.abort();
      signal?.addEventListener('abort', onExternalAbort, { once: true });
      try {
        const response = await fetchImpl(endpoints[i], {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          signal: controller.signal
        });
        if (!response.ok) {
          lastError = new OverpassError(
            `Overpass ${endpoints[i]} responded ${response.status}`,
            { status: response.status }
          );
        } else {
          return await response.json();
        }
      } catch (err) {
        if (signal?.aborted) {
          throw new OverpassError('aborted');
        }
        lastError = new OverpassError(
          `Overpass ${endpoints[i]} failed: ${err.message || err.name}`
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onExternalAbort);
      }
      // Brief pause before hitting the next endpoint/attempt — hammering a
      // struggling instance makes 504s worse. No pause after the final
      // failure; the caller gets the error immediately.
      const isLastTry =
        attempt === attemptsPerEndpoint - 1 && i === endpoints.length - 1;
      if (!isLastTry) {
        await sleep(BACKOFF_BASE_MS * (attempt + 1));
      }
    }
  }
  throw lastError || new OverpassError('Overpass fetch failed');
}
