/**
 * useStorageUsage — live cloud storage usage for the current user.
 *
 * Callable hit for the plan limit + planName (single source of truth from the
 * server, which reads custom claims via Admin SDK and is therefore always
 * fresh). Plus a Firestore snapshot of users/{uid}/meta/usage for bytesUsed.
 * Optimistic shrink on `assetDeleted` events from the assetsService so the
 * meter feels responsive; the snapshot reconciles when the onAssetWritten
 * trigger lands.
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
    planName: null,
    tier: null,
    membership: null
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
            tier: data.tier ?? prev.tier,
            membership: data.membership ?? prev.membership,
            bytesUsed: data.bytesUsed ?? prev.bytesUsed
          }));
        })
        .catch((err) => {
          console.warn('[useStorageUsage] getUploadQuota unavailable', err);
        });
    };

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

    // Refetch on post-Stripe Pro flip — EditorUpgradeModal.verifyPurchase
    // dispatches this after getIdToken(true) + isUserPro confirm the webhook.
    const onPlanChanged = () => fetchQuota();
    window.addEventListener('planChanged', onPlanChanged);

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
      window.removeEventListener('planChanged', onPlanChanged);
      assetsService.events.removeEventListener('assetDeleted', onAssetDeleted);
    };
  }, [isLoggedIn]);

  return usage;
};

export default useStorageUsage;
