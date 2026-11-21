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
  useTeamAssets,
  libraryTeams,
  AssetsContent,
  formatBytes,
  useStorageUsage,
  useCurrentUploadStore
} from '@shared/assets';
import { Loader } from '@shared/icons';
import { formatCurrency, getPeriodSuffix } from '@shared/utils/format';
import { PRICING } from '@shared/components/UpgradeModal/pricing';
import {
  uploadAsset as sharedUploadAsset,
  FILE_PICKER_ACCEPT
} from '@shared/asset-upload';
import { useSharedMessages } from '@shared/i18n/sharedMessages';
import { useAuthContext } from '@shared/contexts';
import { getUploadStageLabel } from '../uploadStageLabels.js';
import styles from './AssetsPanelBody.module.scss';

const FILTERS = [
  { key: 'all', labelId: 'filterAll', match: () => true },
  {
    key: 'mesh',
    labelId: 'filterMeshes',
    match: (item) => item.type === 'mesh'
  },
  {
    key: 'splat',
    labelId: 'filterSplats',
    match: (item) => item.type === 'splat'
  },
  {
    key: 'image',
    labelId: 'filterImages',
    match: (item) => item.type === 'image'
  },
  {
    key: 'video',
    labelId: 'filterVideo',
    match: (item) => item.type === 'video'
  }
];

// Empty-state message per active filter tab.
const EMPTY_MESSAGE_BY_FILTER = {
  all: 'noAssetsYetUploadHint',
  mesh: 'noMeshAssetsYet',
  splat: 'noSplatAssetsYet',
  image: 'noImageAssetsYet',
  video: 'noVideoAssetsYet'
};

const AssetsPanelBody = ({
  // Editor opts in to drag-from-card + place-in-scene CTA in the mesh modal.
  placeable = false,
  onPlaceAsset,
  // Image/video card actions — only meaningful in the generator.
  onUseForGenerator,
  onUseForVideo,
  // Editor-only: open a snapshot's scene and focus its captured pose (#1605).
  onFocusScene,
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
  onUpgrade,
  // The team library to show first (#1267 Phase 4), e.g. the open team
  // scene's team; null = the user's own assets.
  defaultLibrary = null,
  // Editor: the open scene's team (null = personal scene). A team scene uses
  // only its team's assets, so other libraries aren't placeable there.
  sceneOrgId = null
}) => {
  const personalState = useAssets();
  const t = useSharedMessages();
  const { currentUser } = useAuthContext();

  // Which library: the user's own assets (null) or a team's (orgId).
  const teams = libraryTeams(currentUser?.orgs);
  const [chosenLibrary, setChosenLibrary] = useState(undefined);
  const wanted = chosenLibrary === undefined ? defaultLibrary : chosenLibrary;
  const library = teams.some((org) => org.orgId === wanted) ? wanted : null;
  const teamState = useTeamAssets(library);
  const isTeamLibrary = !!library;
  const libraryTeam = teams.find((org) => org.orgId === library) || null;
  // Uploading into a team library takes a seat in it (viewers only look).
  const canUploadHere =
    !isTeamLibrary || ['owner', 'admin', 'member'].includes(libraryTeam?.role);
  // In a team scene, only that team's library can be placed.
  const placeableHere = placeable && (!sceneOrgId || library === sceneOrgId);
  const sceneTeam = teams.find((org) => org.orgId === sceneOrgId) || null;
  const assetsState = isTeamLibrary
    ? { ...teamState, isLoggedIn: personalState.isLoggedIn }
    : personalState;
  const { items, isLoggedIn, isLoadingMore, hasMore, reloadItems, loadMore } =
    assetsState;

  const sentinelRef = useRef(null);
  const [filter, setFilter] = useState('all');
  const usage = useStorageUsage(isLoggedIn);
  // Status only, never the whole upload object: that object is replaced on
  // every progress tick and this component fans out to every gallery card.
  const uploadStatus = useCurrentUploadStore((s) => s.upload?.status ?? null);
  const isUploading = uploadStatus !== null;

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

  // Storage usage thresholds (#1644), computed once and shared by the
  // impression effect below and the render. tier is null until getUploadQuota
  // responds (no flicker); upsells only apply to the FREE tier with a
  // host-provided checkout entry (the generator passes none).
  const planKnown = usage.planLimit != null;
  const usageRatio =
    planKnown && usage.planLimit > 0
      ? Math.min(1, usage.bytesUsed / usage.planLimit)
      : 0;
  const isFull = planKnown && usageRatio >= 1;
  const isNearFull = planKnown && !isFull && usageRatio >= 0.8;
  const showStorageUpsell = usage.tier === 'FREE' && !!onUpgrade;
  // Severity of the upgrade card that actually renders — null when no card can
  // show, so we never log an impression for a prompt the user can't see.
  const upsellSeverity =
    showStorageUpsell && isFull
      ? 'full'
      : showStorageUpsell && isNearFull
        ? 'near_full'
        : null;

  // Funnel: log each time the meter crosses into a new upsell severity so
  // PostHog can compare prompt impressions against storage_upsell_clicked /
  // checkout_started. Ref-guarded to once per severity per mount. Lives
  // above the early returns to keep hook order stable.
  const shownSeverityRef = useRef(null);
  useEffect(() => {
    if (!upsellSeverity) return;
    if (shownSeverityRef.current === upsellSeverity) return;
    shownSeverityRef.current = upsellSeverity;
    posthog.capture('storage_upsell_shown', {
      severity: upsellSeverity,
      bytes_used: usage.bytesUsed,
      plan_limit: usage.planLimit
    });
  }, [upsellSeverity, usage.bytesUsed, usage.planLimit]);

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
      // Into the library on screen: the user's own or a team's.
      const target = { orgId: library };
      const handler =
        onUpload ||
        ((f) =>
          sharedUploadAsset(f, target).then((res) => {
            if (!res.ok && res.error) {
              onNotification?.(res.error, 'error');
            }
          }));
      await handler(file, target);
    };
    input.click();
  };

  if (!isLoggedIn) {
    return (
      <div className={styles.body}>
        <div className={styles.signInPrompt}>
          <p>{t('signInToViewAssets')}</p>
          {onSignIn && (
            <button className={styles.signInButton} onClick={() => onSignIn()}>
              {t('signIn')}
            </button>
          )}
        </div>
      </div>
    );
  }

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

  const librarySwitch = teams.length > 0 && (
    <select
      className={styles.librarySelect}
      value={library || ''}
      onChange={(e) => {
        setChosenLibrary(e.target.value || null);
        posthog.capture('assets_library_switched', {
          library: e.target.value ? 'team' : 'personal'
        });
      }}
      aria-label={t('assetLibrary')}
    >
      <option value="">{t('assetLibraryMine')}</option>
      {teams.map((org) => (
        <option key={org.orgId} value={org.orgId}>
          {t('assetLibraryTeam', { team: org.name })}
        </option>
      ))}
    </select>
  );

  return (
    <div className={styles.body}>
      {librarySwitch}
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {filteredItems.length}
          {hasMore ? '+' : ''}{' '}
          {filteredItems.length === 1 ? t('itemSingular') : t('itemPlural')}
        </span>
        {canUploadHere && (
          <div className={styles.toolbarActions}>
            <button
              type="button"
              className={styles.uploadButton}
              onClick={triggerUploadPicker}
              disabled={isUploading}
              title={isUploading ? t('uploadInProgress') : t('uploadAnAsset')}
            >
              {isUploading
                ? // Stage only, no percentage: a button label should not tick.
                  getUploadStageLabel(t, uploadStatus) || t('uploading')
                : t('upload')}
            </button>
            {/* A team library updates live. */}
            {!isTeamLibrary && (
              <button
                type="button"
                className={styles.refreshButton}
                onClick={() => reloadItems()}
                aria-label={t('refreshAssets')}
                title={t('refreshAssets')}
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
            )}
          </div>
        )}
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
            {t(f.labelId)}
          </button>
        ))}
      </div>
      {isTeamLibrary ? (
        <div className={styles.usageRow}>
          {t('teamLibraryUsage', {
            used: formatBytes(teamState.bytesUsed || 0)
          })}
        </div>
      ) : (
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
      )}
      {!isTeamLibrary &&
        showStorageUpsell &&
        (isNearFull || isFull) &&
        !fullCardDismissed && (
          <div className={styles.storageFullCard}>
            <div className={styles.storageFullTitle}>
              {isFull
                ? "You've filled your free storage"
                : "You've almost filled your free storage"}
            </div>
            <div className={styles.storageFullCopy}>
              {isFull ? 'Your work is safe. ' : ''}Pro gives you 5 GB to grow
              into, 50× more space for custom models and textures.
            </div>
            <button
              type="button"
              className={styles.goProButton}
              onClick={() => handleUpgradeClick(isFull ? 'full' : 'near_full')}
            >
              Go Pro: unlock 5 GB{' '}
              <span className={styles.pricePill}>
                {formatCurrency(PRICING.pro.yearly.pricePerMonth)}
                {getPeriodSuffix('month')}
              </span>
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
      {!isTeamLibrary && showLowUsageHint && (
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
            </strong>
            , room for 3D models, splats, images, videos and more.
          </div>
        </div>
      )}
      {placeable && sceneOrgId && library !== sceneOrgId && (
        <div className={styles.usageRow}>
          {t('teamSceneUsesTeamLibrary', { team: sceneTeam?.name || '' })}
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
              {isTeamLibrary
                ? t('teamLibraryEmpty')
                : t(EMPTY_MESSAGE_BY_FILTER[filter] || 'noAssetsYet')}
            </div>
          }
          onUseForGenerator={onUseForGenerator}
          onUseForVideo={onUseForVideo}
          onFocusScene={onFocusScene}
          onNotification={onNotification}
          placeable={placeableHere}
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
