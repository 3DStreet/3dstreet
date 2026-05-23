/**
 * useStorageUsage — live cloud storage usage for the current user.
 *
 * Callable hit for the plan limit + planName (single source of truth from the
 * server) — re-fired on every ID-token change so a post-Stripe-checkout
 * refresh (EditorUpgradeModal calls getIdToken(true)) bumps the panel from
 * FREE to PRO without a page reload. Plus a Firestore snapshot of
 * users/{uid}/meta/usage for bytesUsed. Optimistic shrink on `assetDeleted`
 * events from the assetsService so the meter feels responsive; the snapshot
 * reconciles when the onAssetWritten trigger lands.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { onIdTokenChanged } from 'firebase/auth';
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

    const fetchQuota = () => {
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
    };

    // Refire on every ID-token change. Fires on sign-in, sign-out, and forced
    // refresh (EditorUpgradeModal.verifyPurchase → getIdToken(true) after
    // Stripe checkout). The initial call here also covers mount.
    const unsubToken = onIdTokenChanged(auth, (u) => {
      if (u) fetchQuota();
    });
    fetchQuota();

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
      unsubToken();
      assetsService.events.removeEventListener('assetDeleted', onAssetDeleted);
    };
  }, [isLoggedIn]);

  return usage;
};

export default useStorageUsage;
