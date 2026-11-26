/**
 * One editor at a time on team scenes (#1267 Phase 2, docs/team-scenes.md).
 *
 * The scene doc's editLock is { uid, name, expiresAt }. This tab takes it
 * when a team editor opens the scene in the editor, renews it every 30
 * seconds (it lasts 2 minutes, so a closed tab frees it within 2 minutes),
 * and releases it when leaving the scene or the editor. Firestore rules
 * refuse saves without it. While someone else holds it, this tab retries
 * every 30 seconds and takes it as soon as it's free. Owners and admins can
 * take it over.
 *
 * Getting the lock never overwrites someone else's work: each in-place save
 * of a team scene increments the doc's `revision`, and this tab knows the
 * revision it has (store.sceneRevision). When it takes the lock (first time,
 * after waiting, or taking over) and the doc's revision differs, it reloads
 * the scene from that doc first. Changes made here while someone else held
 * the lock are discarded: nothing was saved while it was theirs.
 *
 * State lives in the store (editLock: { status, holderName, holderUid,
 * reloaded }): status 'none' | 'acquiring' | 'mine' | 'other'; reloaded is
 * true when getting the lock reloaded the scene.
 */
import { doc, runTransaction, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '@shared/services/firebase';
import useStore from '@/store';
import { createElementsForScenesFromJSON } from '@/editor/lib/SceneUtils';
import { formatSharedMessage } from '@shared/i18n/sharedMessages';

const LOCK_TTL_MS = 2 * 60 * 1000;
const RENEW_MS = 30 * 1000;
const NONE = {
  status: 'none',
  holderName: null,
  holderUid: null,
  reloaded: false
};

let current = null; // { sceneId, user, timer }

const setState = (state) => useStore.getState().setEditLock(state);

const isLive = (lock) =>
  typeof lock?.expiresAt?.toMillis === 'function' &&
  lock.expiresAt.toMillis() > Date.now();

/**
 * Take (or renew) the lock in a transaction. `force` takes it over from
 * someone else (owners and admins; the rules check). Returns the new status,
 * with the doc as read by the transaction (scene) when the lock is ours.
 */
async function claim(sceneId, user, { force = false } = {}) {
  const ref = doc(db, 'scenes', sceneId);
  return runTransaction(db, async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists()) return NONE;
    const lock = snapshot.data().editLock;
    if (!force && isLive(lock) && lock.uid !== user.uid) {
      return { status: 'other', holderName: lock.name, holderUid: lock.uid };
    }
    tx.update(ref, {
      editLock: {
        uid: user.uid,
        name: user.displayName || user.email || null,
        expiresAt: Timestamp.fromMillis(Date.now() + LOCK_TTL_MS)
      }
    });
    return {
      status: 'mine',
      holderName: null,
      holderUid: user.uid,
      scene: snapshot.data()
    };
  });
}

/**
 * Replace the open scene with the doc's content, keeping the lock: the
 * store's scene fields are restored in the same synchronous step, so the
 * lock controller (EditLockBanner) never sees the scene go away.
 */
function reloadScene(sceneId, scene) {
  const store = useStore.getState();
  store.startLoadingScene(formatSharedMessage('sceneLoading'));
  createElementsForScenesFromJSON(scene.data, scene.memory);
  AFRAME.scenes[0].setAttribute('metadata', 'sceneId', sceneId);
  AFRAME.scenes[0].setAttribute('metadata', 'authorId', scene.author);
  store.setSceneTitle(scene.title);
  store.setSceneVisibility(scene.visibility);
  store.setSceneTeam({ orgId: scene.orgId, projectId: scene.projectId });
  store.setSceneRevision(scene.revision);
}

/**
 * Apply a claim's result. Getting the lock (from not having it) reloads the
 * scene when Firestore has a newer revision than this tab.
 */
function apply(sceneId, next) {
  const before = useStore.getState().editLock.status;
  const { scene, ...state } = next;
  let reloaded = false;
  if (
    state.status === 'mine' &&
    before !== 'mine' &&
    scene &&
    (scene.revision || 0) !== useStore.getState().sceneRevision
  ) {
    reloadScene(sceneId, scene);
    reloaded = true;
  }
  setState({ ...state, reloaded });
}

async function tick() {
  if (!current) return;
  const { sceneId, user } = current;
  try {
    const next = await claim(sceneId, user);
    if (current?.sceneId !== sceneId) return; // left meanwhile
    apply(sceneId, next);
  } catch (error) {
    // e.g. offline: keep the last state; the lock expires on its own if
    // this tab can't renew it.
    console.warn('editLock: could not renew the lock', error);
  }
}

/** Start editing `sceneId` as `user` (a team editor). Idempotent. */
export function startEditLock(sceneId, user) {
  if (current?.sceneId === sceneId && current.user.uid === user.uid) return;
  stopEditLock();
  current = { sceneId, user, timer: setInterval(tick, RENEW_MS) };
  setState({ status: 'acquiring', holderName: null, holderUid: null });
  tick();
}

/** Stop editing: release the lock if this tab holds it. */
export function stopEditLock() {
  if (!current) return;
  const { sceneId, timer } = current;
  clearInterval(timer);
  const held = useStore.getState().editLock.status === 'mine';
  current = null;
  setState(NONE);
  if (held) {
    updateDoc(doc(db, 'scenes', sceneId), { editLock: null }).catch((error) =>
      console.warn('editLock: could not release the lock', error)
    );
  }
}

/** Take the lock over from its holder (owners and admins). */
export async function takeOverEditLock() {
  if (!current) return;
  const { sceneId, user } = current;
  const next = await claim(sceneId, user, { force: true });
  if (current?.sceneId === sceneId) apply(sceneId, next);
}

/** Try right away instead of waiting for the next 30-second retry. */
export const retryEditLock = () => tick();

// Best-effort release when the tab goes away; the 2-minute expiry covers a
// release that doesn't reach Firestore.
window.addEventListener('pagehide', stopEditLock);
