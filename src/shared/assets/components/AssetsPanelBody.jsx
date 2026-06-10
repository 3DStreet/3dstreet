/**
 * AssetsPanelBody — shared filter/upload/usage/grid shell used by:
 *   - the editor's Assets panel (with placeable cards + place-in-scene)
 *   - the generator's Assets sidebar (no viewport, upload-only)
 *
 * Hosts provide their own outer chrome (panel container, sidebar collapse,
 * etc.) and pass an `onUpload(file)` so the editor can use its drop-and-
 * place flow while the generator uses a scene-free shared uploadAsset.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import posthog from 'posthog-js';
import {
  useAssets,
  AssetsContent,
  formatBytes,
  useStorageUsage,
  useCurrentUploadStore
} from '@shared/assets';
import { Loader } from '@shared/icons';
import {
  uploadAsset as sharedUploadAsset,
  FILE_PICKER_ACCEPT
} from '@shared/asset-upload';
import styles from './AssetsPanelBody.module.scss';

const FILTERS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'mesh', label: 'Meshes', match: (item) => item.type === 'mesh' },
  { key: 'splat', label: 'Splats', match: (item) => item.type === 'splat' },
  { key: 'image', label: 'Images', match: (item) => item.type === 'image' },
  { key: 'video', label: 'Video', match: (item) => item.type === 'video' }
];

const AssetsPanelBody = ({
  // Editor opts in to drag-from-card + place-in-scene CTA in the mesh modal.
  placeable = false,
  onPlaceAsset,
  // Image/video card actions — only meaningful in the generator.
  onUseForGenerator,
  onUseForVideo,
  // Host notification (FluxUI.showNotification in generator, no-op default).
  onNotification,
  // Sign-in CTA action.
  onSignIn,
  // Per-host upload handler. Editor passes uploadAndPlaceAsset (placeholder
  // entity + scene command), generator passes a wrapper around the shared
  // scene-free uploadAsset. Defaults to the scene-free version.
  //
  // Contract: host-provided uploaders own their own error surfacing (toasts,
  // entity status, etc.) and may return whatever shape they want — the body
  // doesn't inspect it. Only the default shared uploader returns
  // { ok, error } and is the only branch where the body forwards errors to
  // onNotification.
  onUpload,
  // Storage upsell entry point (#1644). Editor passes a startCheckout
  // wrapper; when omitted (generator today) the usage meter still warns but
  // no upgrade CTAs render — keeps this shared body free of checkout wiring.
  onUpgrade
}) => {
  const assetsState = useAssets();
  const { items, isLoggedIn, isLoadingMore, hasMore, reloadItems, loadMore } =
    assetsState;

  const sentinelRef = useRef(null);
  const [filter, setFilter] = useState('all');
  const usage = useStorageUsage(isLoggedIn);
  const isUploading = useCurrentUploadStore((s) => !!s.upload);

  // Storage upsell state (#1644). The full-storage card's soft decline
  // ("free up space instead") hides it for this mount only — it returns next
  // session while the account is still full. The low-usage hint dismisses
  // permanently via localStorage.
  const [fullCardDismissed, setFullCardDismissed] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(
    () => localStorage.getItem('assetsLowUsageHintDismissed') === '1'
  );
  const dismissHint = () => {
    localStorage.setItem('assetsLowUsageHintDismissed', '1');
    setHintDismissed(true);
  };

  // Funnel: log each time the meter crosses into a new upsell severity so
  // PostHog can compare prompt impressions against storage_upsell_clicked /
  // checkout_started. Ref-guarded to once per severity per mount. Lives
  // above the early returns to keep hook order stable.
  const shownSeverityRef = useRef(null);
  const ratioForEffect =
    usage.planLimit > 0 ? usage.bytesUsed / usage.planLimit : 0;
  const severityForEffect =
    usage.tier === 'FREE' && usage.planLimit != null
      ? ratioForEffect >= 1
        ? 'full'
        : ratioForEffect >= 0.8
          ? 'near_full'
          : null
      : null;
  useEffect(() => {
    if (!severityForEffect) return;
    if (shownSeverityRef.current === severityForEffect) return;
    shownSeverityRef.current = severityForEffect;
    posthog.capture('storage_upsell_shown', {
      severity: severityForEffect,
      bytes_used: usage.bytesUsed,
      plan_limit: usage.planLimit
    });
  }, [severityForEffect, usage.bytesUsed, usage.planLimit]);

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

  const triggerUploadPicker = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = FILE_PICKER_ACCEPT;
    input.onchange = async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const handler =
        onUpload ||
        ((f) =>
          sharedUploadAsset(f).then((res) => {
            if (!res.ok && res.error) {
              onNotification?.(res.error, 'error');
            }
          }));
      await handler(file);
    };
    input.click();
  };

  if (!isLoggedIn) {
    return (
      <div className={styles.body}>
        <div className={styles.signInPrompt}>
          <p>Sign in to view your assets.</p>
          {onSignIn && (
            <button className={styles.signInButton} onClick={() => onSignIn()}>
              Sign in
            </button>
          )}
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
  const isNearFull = planKnown && !isFull && usageRatio >= 0.8;
  // Upsells only make sense on the FREE tier with a host-provided checkout
  // entry point. tier is null until getUploadQuota responds — no flicker.
  const showStorageUpsell = usage.tier === 'FREE' && !!onUpgrade;
  const showLowUsageHint =
    usage.tier === 'FREE' &&
    planKnown &&
    !hintDismissed &&
    items.length > 0 &&
    usageRatio > 0 &&
    usageRatio < 0.5;

  const handleUpgradeClick = (severity) => {
    posthog.capture('storage_upsell_clicked', {
      severity,
      bytes_used: usage.bytesUsed,
      plan_limit: usage.planLimit
    });
    onUpgrade();
  };

  const filteredAssetsState = { ...assetsState, items: filteredItems };

  return (
    <div className={styles.body}>
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
            disabled={isUploading}
            title={
              isUploading
                ? 'An upload is already in progress'
                : 'Upload an asset'
            }
          >
            {isUploading ? 'Uploading…' : 'Upload'}
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
      <div
        className={`${styles.usageRow} ${isNearFull || isFull ? styles.usageRowWarn : ''}`}
      >
        {planKnown ? (
          <>
            Uploads: {formatBytes(usage.bytesUsed)} /{' '}
            {formatBytes(usage.planLimit)} ({usage.planName})
          </>
        ) : (
          <>Uploads: {formatBytes(usage.bytesUsed)}</>
        )}
        <div className={styles.usageBar}>
          <div
            className={`${styles.usageFill} ${isFull ? styles.full : ''} ${isNearFull ? styles.warn : ''}`}
            style={{ width: `${Math.round(usageRatio * 100)}%` }}
          />
        </div>
      </div>
      {showStorageUpsell && isNearFull && (
        <div className={styles.storageWarnRow}>
          <span>Almost out of space for custom models.</span>
          <button
            type="button"
            className={styles.upgradePill}
            onClick={() => handleUpgradeClick('near_full')}
          >
            Upgrade →
          </button>
        </div>
      )}
      {showStorageUpsell && isFull && !fullCardDismissed && (
        <div className={styles.storageFullCard}>
          <div className={styles.storageFullTitle}>
            You&apos;ve filled your free storage
          </div>
          <div className={styles.storageFullCopy}>
            Your work is safe. Pro gives you 5 GB to grow into — 50× more space
            for custom models and textures.
          </div>
          <button
            type="button"
            className={styles.goProButton}
            onClick={() => handleUpgradeClick('full')}
          >
            Go Pro — unlock 5 GB <span className={styles.pricePill}>$7/mo</span>
          </button>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => setFullCardDismissed(true)}
          >
            or free up space instead
          </button>
        </div>
      )}
      {showLowUsageHint && (
        <div className={styles.hintCard}>
          <div className={styles.hintHeader}>
            <span className={styles.hintTitle}>Make your scenes feel real</span>
            <button
              type="button"
              className={styles.hintDismiss}
              onClick={dismissHint}
              aria-label="Dismiss hint"
            >
              ✕
            </button>
          </div>
          <div className={styles.hintCopy}>
            You&apos;ve got{' '}
            <strong>
              {formatBytes(usage.planLimit - usage.bytesUsed)} to play with
            </strong>{' '}
            — that&apos;s room for HDRIs, ground textures, and a few hero
            models.
          </div>
        </div>
      )}
      <div className={styles.scrollArea}>
        <AssetsContent
          gallery={filteredAssetsState}
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
                ? 'No assets yet. Drag GLB or image files in, or click Upload.'
                : `No ${filter} assets yet.`}
            </div>
          }
          onUseForGenerator={onUseForGenerator}
          onUseForVideo={onUseForVideo}
          onNotification={onNotification}
          placeable={placeable}
          onPlaceAsset={onPlaceAsset}
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

export default AssetsPanelBody;
