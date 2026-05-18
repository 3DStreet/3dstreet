/**
 * useStorageUsage — live cloud storage usage for the current user.
 *
 * One callable hit on mount for the plan limit + planName (single source of
 * truth from the server), plus a Firestore snapshot of users/{uid}/meta/usage
 * for bytesUsed. Optimistic shrink on `assetDeleted` events from the
 * assetsService so the meter feels responsive; the snapshot reconciles when
 * the onAssetWritten trigger lands.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '@shared/services/firebase.js';
import assetsService from '../services/assetsService.js';

const useStorageUsage = (isLoggedIn) => {
  const [usage, setUsage] = useState({
    bytesUsed: 0,
    planLimit: null,
    planName: null
  });

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return undefined;
    let cancelled = false;

    httpsCallable(
      functions,
      'getUploadQuota'
    )({ proposedBytes: 0 })
      .then(({ data }) => {
        if (cancelled || !data) return;
        setUsage((prev) => ({
          ...prev,
          planLimit: data.planLimit,
          planName: data.planName,
          bytesUsed: data.bytesUsed ?? prev.bytesUsed
        }));
      })
      .catch((err) => {
        console.warn('[useStorageUsage] getUploadQuota unavailable', err);
      });

    const ref = doc(db, 'users', user.uid, 'meta', 'usage');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const bytesUsed = snap.exists()
          ? Number(snap.data().bytesUsed) || 0
          : 0;
        setUsage((prev) => ({ ...prev, bytesUsed }));
      },
      (err) => {
        if (err.code !== 'permission-denied') {
          console.warn('[useStorageUsage] usage subscription error', err);
        }
      }
    );

    const onAssetDeleted = (e) => {
      const { userId: eventUserId, size } = e.detail || {};
      if (eventUserId !== user.uid || !size) return;
      setUsage((prev) => ({
        ...prev,
        bytesUsed: Math.max(0, prev.bytesUsed - size)
      }));
    };
    assetsService.events.addEventListener('assetDeleted', onAssetDeleted);

    return () => {
      cancelled = true;
      unsub();
      assetsService.events.removeEventListener('assetDeleted', onAssetDeleted);
    };
  }, [isLoggedIn]);

  return usage;
};

export default useStorageUsage;
