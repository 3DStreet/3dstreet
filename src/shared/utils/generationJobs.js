/**
 * Shared client-side helpers for async generation jobs
 * (users/{uid}/generationJobs — see docs/generation-job-queue.md).
 *
 * pollGenerationJob replaces the per-surface hand-rolled poll loops (editor
 * ScreenshotModal + the four generator tabs). One implementation matters
 * beyond tidiness: the server's webhook ack-grace is tuned to this poll
 * cadence, and a poll that outlives its UI acks the job and suppresses the
 * opted-in completion email — so every surface needs the same cancellable
 * loop, cancelled when its UI goes away.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '../services/firebase.js';

export const JOB_POLL_INTERVAL_MS = 3000;

/**
 * Poll getGenerationJobStatus until the job is terminal.
 *
 * Returns { promise, cancel }. The promise resolves with the terminal payload
 * ({ image_url | video_url | mesh_url | splat_url, assetId, … }) on success,
 * resolves with null if cancel() was called (the job is unaffected
 * server-side — cancelling also stops acking it, so an opted-in email can
 * still send), and rejects on failure/timeout:
 *   - failed/canceled: error.jobStatus is set, error.jobError carries the
 *     server's error string (null if none), error.message is human-readable
 *   - deadline passed while still running: error.timedOut is true;
 *     error.lostTrack is true when the last poll itself errored
 * Transient poll errors are retried until the deadline.
 *
 * @param {string} jobId
 * @param {Object} [options]
 * @param {string} [options.resultField] result key that must be present for a
 *   success to count as terminal (e.g. 'image_url'); omit to accept any
 *   succeeded status
 * @param {number} [options.intervalMs]
 * @param {number} [options.maxMs]
 */
export function pollGenerationJob(
  jobId,
  {
    resultField,
    intervalMs = JOB_POLL_INTERVAL_MS,
    maxMs = 15 * 60 * 1000
  } = {}
) {
  const getGenerationJobStatus = httpsCallable(
    functions,
    'getGenerationJobStatus'
  );
  let cancelled = false;
  let timer = null;
  const cancel = () => {
    cancelled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const promise = (async () => {
    const deadline = Date.now() + maxMs;
    let lastPollErrored = false;
    for (;;) {
      if (cancelled) return null;
      let data = null;
      try {
        ({ data } = await getGenerationJobStatus({ jobId }));
        lastPollErrored = false;
      } catch (pollError) {
        // Transient poll error — retry until the deadline rather than failing
        // hard; the job is unaffected server-side.
        console.warn('Generation job poll failed (will retry):', pollError);
        lastPollErrored = true;
      }
      if (cancelled) return null;
      if (data?.status === 'succeeded' && (!resultField || data[resultField])) {
        return data;
      }
      if (data?.status === 'failed' || data?.status === 'canceled') {
        const error = new Error(data.error || 'Generation failed.');
        error.jobStatus = data.status;
        error.jobError = data.error || null;
        throw error;
      }
      if (Date.now() > deadline) {
        const error = new Error('Generation is taking longer than expected.');
        error.timedOut = true;
        error.lostTrack = lastPollErrored;
        throw error;
      }
      await new Promise((resolve) => {
        timer = setTimeout(resolve, intervalMs);
      });
    }
  })();
  return { promise, cancel };
}

/**
 * Force the completion email ON for a still-running job — used when a client
 * poll gives up at its deadline: a render that outlives the poll window is
 * unusual enough that the user shouldn't have to babysit the tab for it.
 * Returns true if the preference landed on the job doc (false if the job was
 * already terminal or the callable failed).
 */
export async function forceJobNotifyEmail(jobId) {
  if (!jobId) return false;
  try {
    const setGenerationJobNotify = httpsCallable(
      functions,
      'setGenerationJobNotify'
    );
    const { data } = await setGenerationJobNotify({ jobId, email: true });
    return data?.applied === true;
  } catch (error) {
    console.error('Failed to force the completion email:', error);
    return false;
  }
}
