/**
 * A team's asset library (#1267 Phase 4, docs/team-assets.md), live:
 * orgs/{orgId}/assets not deleted, newest first, in the gallery state shape
 * AssetsContent takes (see useAssets). Team libraries are small, so no
 * paging: the most recent TEAM_LIBRARY_LIMIT are shown.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where
} from 'firebase/firestore';
import { db } from '@shared/services/firebase.js';
import { assetToDisplayItem, downloadAssetItem } from './useAssets.js';
import { removeTeamAsset } from '../teamLibrary.js';

const TEAM_LIBRARY_LIMIT = 500;

const useTeamAssets = (orgId) => {
  const [items, setItems] = useState([]);
  const [docs, setDocs] = useState({});
  const [isLoading, setIsLoading] = useState(!!orgId);
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    setItems([]);
    setDocs({});
    if (!orgId) {
      setIsLoading(false);
      return undefined;
    }
    setIsLoading(true);
    const unsubscribeAssets = onSnapshot(
      query(
        collection(db, 'orgs', orgId, 'assets'),
        where('deleted', '==', false),
        orderBy('createdAt', 'desc'),
        limit(TEAM_LIBRARY_LIMIT)
      ),
      (snapshot) => {
        const assets = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
        setDocs(Object.fromEntries(assets.map((a) => [a.assetId, a])));
        setItems(assets.map(assetToDisplayItem));
        setIsLoading(false);
      },
      (error) => {
        console.error('Error loading the team library:', error);
        setIsLoading(false);
      }
    );
    const unsubscribeUsage = onSnapshot(
      doc(db, 'orgs', orgId, 'meta', 'usage'),
      (snapshot) => setUsage(snapshot.data()?.bytesUsed || 0),
      () => setUsage(null)
    );
    return () => {
      unsubscribeAssets();
      unsubscribeUsage();
    };
  }, [orgId]);

  const removeItem = useCallback((id) => removeTeamAsset(orgId, id), [orgId]);

  return {
    items,
    docs,
    bytesUsed: usage,
    isLoading,
    isLoadingMore: false,
    isLoggedIn: true,
    hasMore: false,
    reloadItems: () => {},
    loadMore: () => {},
    removeItem,
    downloadItem: downloadAssetItem
  };
};

export default useTeamAssets;
