import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useGallery, GalleryContent } from '@shared/gallery';
import { Loader } from '@shared/icons';
import { auth, db, functions } from '@shared/services/firebase.js';
import {
  uploadAndPlaceAsset,
  FILE_PICKER_ACCEPT
} from '@/editor/lib/asset-upload/uploadAndPlaceAsset.js';
import { signIn } from '../../api';
import styles from './GalleryPanel.module.scss';

const FILTERS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'mesh', label: 'Meshes', match: (item) => item.type === 'mesh' },
  { key: 'image', label: 'Images', match: (item) => item.type === 'image' },
  { key: 'video', label: 'Video', match: (item) => item.type === 'video' }
];

function formatBytes(bytes) {
  if (!bytes || bytes < 1000) {
    return `${bytes || 0} B`;
  }
  if (bytes < 1_000_000) {
    return `${(bytes / 1000).toFixed(0)} KB`;
  }
  if (bytes < 1_000_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

const openInGenerator = async (item, tabName) => {
  try {
    const imageUrl = item.fullImageURL || item.storageUrl || item.objectURL;
    if (!imageUrl) throw new Error('No valid image URL available');

    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    localStorage.setItem(
      'pendingGalleryItem',
      JSON.stringify({
        imageDataUrl: dataUrl,
        id: item.id,
        metadata: item.metadata,
        timestamp: Date.now(),
        targetTab: tabName
      })
    );

    window.open(`/generator/#${tabName}`, '_blank');
  } catch (error) {
    console.error('Failed to open generator with gallery item:', error);
  }
};

const handleCopyParams = (item) => {
  if (!item.metadata) return;
  navigator.clipboard
    .writeText(JSON.stringify(item.metadata, null, 2))
    .catch((err) => console.error('Failed to copy parameters', err));
};

const triggerUploadPicker = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = FILE_PICKER_ACCEPT;
  input.multiple = true;
  input.onchange = async (event) => {
    const files = Array.from(event.target.files || []);
    for (const file of files) {
      await uploadAndPlaceAsset(file);
    }
  };
  input.click();
};

const GalleryPanel = () => {
  const gallery = useGallery();
  const { items, isLoggedIn, isLoadingMore, hasMore, reloadItems, loadMore } =
    gallery;

  const sentinelRef = useRef(null);
  const [filter, setFilter] = useState('all');
  const [usage, setUsage] = useState({
    bytesUsed: 0,
    planLimit: null,
    planName: null
  });

  // Resolve plan limit from the server (single source of truth) once on mount;
  // subscribe to users/{uid}/meta/usage for live bytesUsed updates.
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
        console.warn('[GalleryPanel] getUploadQuota unavailable', err);
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
          console.warn('[GalleryPanel] usage subscription error', err);
        }
      }
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [isLoggedIn]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasMore && !isLoadingMore) {
            loadMore();
          }
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, loadMore, items.length]);

  const filteredItems = useMemo(() => {
    const filterDef = FILTERS.find((f) => f.key === filter) || FILTERS[0];
    return items.filter(filterDef.match);
  }, [items, filter]);

  if (!isLoggedIn) {
    return (
      <div className={styles.galleryPanel}>
        <div className={styles.signInPrompt}>
          <p>Sign in to view your assets.</p>
          <button className={styles.signInButton} onClick={() => signIn()}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  const planKnown = usage.planLimit != null;
  const usageRatio =
    planKnown && usage.planLimit > 0
      ? Math.min(1, usage.bytesUsed / usage.planLimit)
      : 0;
  const isFull = planKnown && usageRatio >= 1;

  const filteredGallery = { ...gallery, items: filteredItems };

  return (
    <div className={styles.galleryPanel}>
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {filteredItems.length}
          {hasMore ? '+' : ''} {filteredItems.length === 1 ? 'item' : 'items'}
        </span>
        <div className={styles.toolbarActions}>
          <button
            type="button"
            className={styles.uploadButton}
            onClick={triggerUploadPicker}
          >
            Upload
          </button>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => reloadItems()}
            aria-label="Refresh assets"
            title="Refresh assets"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
          </button>
        </div>
      </div>
      <div className={styles.filterTabs} role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={`${styles.filterTab} ${filter === f.key ? styles.active : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className={styles.usageRow}>
        {planKnown ? (
          <>
            Cloud storage: {formatBytes(usage.bytesUsed)} /{' '}
            {formatBytes(usage.planLimit)} ({usage.planName})
          </>
        ) : (
          <>Cloud storage: {formatBytes(usage.bytesUsed)}</>
        )}
        <div className={styles.usageBar}>
          <div
            className={`${styles.usageFill} ${isFull ? styles.full : ''}`}
            style={{ width: `${Math.round(usageRatio * 100)}%` }}
          />
        </div>
      </div>
      <div className={styles.scrollArea}>
        <GalleryContent
          gallery={filteredGallery}
          variant="unbounded"
          gridClassName={styles.grid}
          sentinelRef={sentinelRef}
          loadingState={
            <div className={styles.loading}>
              <Loader className={styles.spinner} />
            </div>
          }
          emptyState={
            <div className={styles.empty}>
              {filter === 'all'
                ? 'No assets yet. Drag GLB or image files into the viewport, or click Upload.'
                : `No ${filter} assets yet.`}
            </div>
          }
          onCopyParams={handleCopyParams}
          onUseForGenerator={(item) => openInGenerator(item, 'modify')}
          onUseForVideo={(item) => openInGenerator(item, 'video')}
        />
        {isLoadingMore && (
          <div className={styles.loadingMore}>
            <Loader className={styles.spinner} />
          </div>
        )}
      </div>
    </div>
  );
};

export default GalleryPanel;
