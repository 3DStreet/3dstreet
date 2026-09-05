/**
 * Paywall surface registry — surface-specific copy for the shared UpgradeModal.
 * Keyed by the `postCheckout` value passed to startCheckout(). When a key
 * matches, the modal renders a surface card header + custom headline /
 * description in place of the generic "Upgrade to Pro" treatment.
 *
 * All copy fields (`titleId`, `subtitleId`, `headlineId`, `descriptionId`,
 * `featureIds`, `secondaryCtaLabelId`) are sharedMessages ids — UpgradeModal
 * resolves them with the live locale at render. Hand-maintained translations
 * live in @shared/i18n/sharedMessages.
 *
 * Adding a new surface: add an entry whose key matches the postCheckout
 * string used at the trigger site (see startCheckout calls in editor).
 * Omit entries to keep generic copy.
 */

import { TOKEN_FEATURE_KEY } from './pricing';

const CubeIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const DraftingCompassIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m12.99 6.74 1.93 3.44" />
    <path d="M19.136 12a10 10 0 0 1-14.271 0" />
    <path d="m21 21-2.16-3.84" />
    <path d="m3 21 8.02-14.26" />
    <circle cx="12" cy="5" r="2" />
  </svg>
);

const FileTextIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M10 9H8" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </svg>
);

const ImageIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

const SparklesIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
    <path d="M19 14l.8 1.9L21.5 16.7l-1.7.8L19 19.4l-.8-1.9L16.5 16.7l1.7-.8L19 14z" />
    <path d="M5 16l.6 1.4L7 18l-1.4.6L5 20l-.6-1.4L3 18l1.4-.6L5 16z" />
  </svg>
);

const DatabaseIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
);

const MapPinIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

export const PAYWALL_SURFACES = {
  // GLB + AR-Ready GLB both flow through postCheckout='export'.
  // AR-Ready is on a deprecation path, so a single shared surface is fine.
  export: {
    icon: <CubeIcon />,
    titleId: 'surfaceExportTitle',
    subtitleId: 'surfaceExportSubtitle',
    headlineId: 'exportRequiresPro',
    descriptionId: 'surfaceExportDesc',
    featureIds: [
      'featGlbExport',
      'featWatermark',
      'featGeoUnlimited',
      'featCustomModels',
      TOKEN_FEATURE_KEY
    ]
  },

  // DXF plan-view export — fired from the Export modal's DXF card. Separate
  // key from 'export' so the paywall speaks CAD (not GLB) and analytics can
  // tell the two export paywalls apart.
  'export-dxf': {
    icon: <DraftingCompassIcon />,
    titleId: 'surfaceDxfTitle',
    subtitleId: 'surfaceDxfSubtitle',
    headlineId: 'exportRequiresPro',
    descriptionId: 'surfaceDxfDesc',
    featureIds: [
      'featDxfExport',
      'featGlbExport',
      'featWatermark',
      'featGeoUnlimited',
      TOKEN_FEATURE_KEY
    ]
  },

  // PDF plan-view export — fired from the Export modal's PDF format. Same
  // rationale as export-dxf: format-true copy + distinguishable analytics.
  'export-pdf': {
    icon: <FileTextIcon />,
    titleId: 'surfacePdfTitle',
    subtitleId: 'surfacePdfSubtitle',
    headlineId: 'exportRequiresPro',
    descriptionId: 'surfacePdfDesc',
    featureIds: [
      'featPdfDxfExport',
      'featGlbExport',
      'featWatermark',
      'featGeoUnlimited',
      TOKEN_FEATURE_KEY
    ]
  },

  // AI-render generation tokens — fired from the Screenshot modal when a
  // non-Pro user lacks enough genTokens for the selected model (1x) or for
  // the full 4x batch. Same surface for both modes; the headline frames the
  // gap as "more tokens" rather than "out of tokens" since users may have
  // some balance but not enough for the chosen model.
  // The plan-specific monthly token floor (Pro 100, Max 500) lives on the
  // billing toggle row in UpgradeModal — it tracks the user's plan choice.
  image: {
    icon: <SparklesIcon />,
    titleId: 'surfaceImageTitle',
    subtitleId: 'surfaceImageSubtitle',
    headlineId: 'surfaceImageHeadline',
    descriptionId: 'surfaceImageDesc',
    featureIds: [
      TOKEN_FEATURE_KEY,
      'featWatermark',
      'featGlbExport',
      'featGeoUnlimited',
      'featCustomModels'
    ]
  },

  // Geospatial lookups — fired by GeoModal.onSaveHandler when a free user
  // has burned through their initial geoToken allocation, and by the inline
  // "Upgrade to Pro for unlimited geo lookups" button in GeoSidebar
  // (rendered when geoToken === 0). Pro grants unlimited location changes;
  // the headline frames the uplift rather than "out of tokens" so both
  // trigger sites read the same way.
  geo: {
    icon: <MapPinIcon />,
    titleId: 'surfaceGeoTitle',
    subtitleId: 'surfaceGeoSubtitle',
    headlineId: 'surfaceGeoHeadline',
    descriptionId: 'surfaceGeoDesc',
    featureIds: [
      'featGeoUnlimited',
      'featWatermark',
      'featGlbExport',
      'featCustomModels',
      TOKEN_FEATURE_KEY
    ]
  },

  // Cloud storage for custom assets — fired by the assets panel's 80%/100%
  // usage prompts and by the sidebar Upgrade button on an upload blocked by
  // quota (#1644). Copy works for both "almost full" and "full" triggers;
  // FREE 100 MB → PRO 5 GB is the 50× claim.
  storage: {
    icon: <DatabaseIcon />,
    titleId: 'surfaceStorageTitle',
    subtitleId: 'surfaceStorageSubtitle',
    headlineId: 'surfaceStorageHeadline',
    descriptionId: 'surfaceStorageDesc',
    featureIds: [
      'featStorage5gb',
      'featCustomModels',
      'featWatermark',
      'featGeoUnlimited',
      TOKEN_FEATURE_KEY
    ]
  },

  // Watermark removal — fired by the inline upsell button and by the
  // first-of-session download interceptor in ScreenshotModal.
  watermark: {
    icon: <ImageIcon />,
    titleId: 'surfaceWatermarkTitle',
    subtitleId: 'surfaceWatermarkSubtitle',
    headlineId: 'surfaceWatermarkHeadline',
    descriptionId: 'surfaceWatermarkDesc',
    featureIds: [
      'featWatermark',
      'featGlbExport',
      'featGeoUnlimited',
      'featCustomModels',
      TOKEN_FEATURE_KEY
    ],
    // Soft-decline path. Picking this dismisses the paywall and runs the
    // pending action (the watermarked download) without leaving Pro friction.
    // Imperative label pairs with the primary "Go Pro" CTA — "free" is
    // implied by the watermark mention so we don't repeat it.
    secondaryCtaLabelId: 'watermarkSecondaryCta'
  }
};

export const getPaywallSurface = (key) =>
  (key && PAYWALL_SURFACES[key]) || null;
