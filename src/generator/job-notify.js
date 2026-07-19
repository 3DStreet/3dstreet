/**
 * Mid-render email opt-in, shared by every generator tab.
 *
 * The "email me when done" checkbox lives in the rendering UI (it only
 * matters while a job is in flight), so toggling it has to write through to
 * the already-submitted job doc — which is client-write-denied in Firestore
 * rules — via the setGenerationJobNotify callable.
 *
 * On failure the checkbox is reverted so the UI never claims a preference the
 * job doc doesn't hold. `applied: false` (the job went terminal mid-toggle)
 * is left alone: the render is done, the row is about to disappear anyway.
 */
import FluxUI from './main.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@shared/services/firebase.js';

export async function syncJobNotifyEmail(jobId, checkboxEl) {
  if (!jobId || !checkboxEl) return;
  const email = !!checkboxEl.checked;
  try {
    const setGenerationJobNotify = httpsCallable(
      functions,
      'setGenerationJobNotify'
    );
    await setGenerationJobNotify({ jobId, email });
  } catch (error) {
    console.error('Failed to update email notification preference:', error);
    checkboxEl.checked = !email;
    FluxUI.showNotification(
      'Could not update the email preference — please try again.',
      'warning'
    );
  }
}
