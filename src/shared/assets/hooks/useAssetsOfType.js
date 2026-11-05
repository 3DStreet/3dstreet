/**
 * useAssetsOfType - every asset of one type in the signed-in user's library
 * (#2142), for AssetPickerModal.
 *
 * Unlike useAssets, which pages through all types for the gallery, this asks
 * Firestore for the one type (composite index on type, deleted, createdAt) and
 * loads all of it before reporting ready, so the grid appears once and can be
 * sorted by any field in memory. Items arrive newest first.
 */

import { useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { AuthContext } from '@shared/contexts';
import { auth } from '@shared/services/firebase.js';
import assetsService from '../services/assetsService.js';
import { assetToDisplayItem } from './useAssets.js';

const PAGE_SIZE = 200;

const useAssetsOfType = (type) => {
  // The generator mounts outside AuthProvider, so fall back to the SDK's user
  // (see useAssets).
  const contextUser = useContext(AuthContext)?.currentUser;
  const [firebaseUser, setFirebaseUser] = useState(
    () => auth.currentUser || window.authState?.currentUser || null
  );
  useEffect(() => onAuthStateChanged(auth, setFirebaseUser), []);
  const userId = (contextUser || firebaseUser)?.uid || null;

  const [state, setState] = useState({
    items: [],
    isLoading: true,
    loadFailed: false
  });

  useEffect(() => {
    if (!userId) {
      setState({ items: [], isLoading: false, loadFailed: false });
      return undefined;
    }
    let cancelled = false;
    setState({ items: [], isLoading: true, loadFailed: false });
    (async () => {
      try {
        const assets = [];
        let cursor = null;
        let hasMore = true;
        while (hasMore) {
          const page = await assetsService.getAssetsPage(userId, {
            filters: { type },
            pageSize: PAGE_SIZE,
            cursor
          });
          if (cancelled) return;
          assets.push(...page.assets);
          cursor = page.lastDoc;
          hasMore = page.hasMore;
        }
        setState({
          items: assets.map(assetToDisplayItem),
          isLoading: false,
          loadFailed: false
        });
      } catch (error) {
        console.error('Failed to load assets for picker:', error);
        if (!cancelled) {
          setState({ items: [], isLoading: false, loadFailed: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, type]);

  return { ...state, isLoggedIn: !!userId };
};

export default useAssetsOfType;
