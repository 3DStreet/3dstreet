/**
 * Paywall surface registry — surface-specific copy for the shared UpgradeModal.
 * Keyed by the `postCheckout` value passed to startCheckout(). When a key
 * matches, the modal renders a surface card header + custom headline /
 * description in place of the generic "Upgrade to Pro" treatment.
 *
 * Adding a new surface: add an entry whose key matches the postCheckout
 * string used at the trigger site (see startCheckout calls in editor).
 * Omit entries to keep generic copy.
 */

import { TOKEN_FEATURE_LINE } from './pricing';

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
    title: 'GLB glTF',
    subtitle: '.glb · 3D model export',
    headline: 'Export requires Pro',
    description:
      'GLB glTF export lets you use your 3D scene in any compatible tool, game engine, or AR platform.',
    features: [
      'GLB glTF & AR Ready GLB export',
      'Download JPEG snapshots without watermark',
      'Unlimited geospatial maps & location changes',
      'Import custom 3D models & SVG / glTF files',
      TOKEN_FEATURE_LINE
    ]
  },

  // AI-render generation tokens — fired from the Screenshot modal when a
  // non-Pro user lacks enough genTokens for the selected model (1x) or for
  // the full 4x batch. Same surface for both modes; the headline frames the
  // gap as "more tokens" rather than "out of tokens" since users may have
  // some balance but not enough for the chosen model.
  // The plan-specific up-front grant (100 monthly / 840 yearly) lives on the
  // billing toggle row in UpgradeModal — it tracks the user's plan choice.
  image: {
    icon: <SparklesIcon />,
    title: 'AI Render',
    subtitle: 'Generation tokens · AI image rendering',
    headline: 'More AI generation tokens',
    description:
      'AI renders use generation tokens. Pro upgrade delivers tokens up front so you can keep generating immediately across every available AI model.',
    features: [
      TOKEN_FEATURE_LINE,
      'Download JPEG snapshots without watermark',
      'GLB glTF & AR Ready GLB export',
      'Unlimited geospatial maps & location changes',
      'Import custom 3D models & SVG / glTF files'
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
    title: 'Geospatial',
    subtitle: 'Real-world location · 3D map context',
    headline: 'Unlimited geospatial lookups',
    description:
      'Place your scene on a real-world map with 3D context of the surrounding environment. Pro unlocks unlimited location changes.',
    features: [
      'Unlimited geospatial maps & location changes',
      'Download JPEG snapshots without watermark',
      'GLB glTF & AR Ready GLB export',
      'Import custom 3D models & SVG / glTF files',
      TOKEN_FEATURE_LINE
    ]
  },

  // Cloud storage for custom assets — fired by the assets panel's 80%/100%
  // usage prompts and by the sidebar Upgrade button on an upload blocked by
  // quota (#1644). Copy works for both "almost full" and "full" triggers;
  // FREE 100 MB → PRO 5 GB is the 50× claim.
  storage: {
    icon: <DatabaseIcon />,
    title: 'Cloud Storage',
    subtitle: 'Custom models & textures',
    headline: '50× more space for custom models',
    description:
      'Your work is safe. The Free plan includes 100 MB of asset storage — Pro gives you 5 GB to grow into for custom models, textures, and splats.',
    features: [
      '5 GB custom model & asset storage',
      'Import custom 3D models & SVG / glTF files',
      'Download JPEG snapshots without watermark',
      'Unlimited geospatial maps & location changes',
      TOKEN_FEATURE_LINE
    ]
  },

  // Watermark removal — fired by the inline upsell button and by the
  // first-of-session download interceptor in ScreenshotModal.
  watermark: {
    icon: <ImageIcon />,
    title: 'Snapshot',
    subtitle: '.jpg / .png · 2D image export',
    headline: 'Remove the watermark',
    description:
      'Share polished snapshots in client presentations, planning reports, and social posts.',
    features: [
      'Download JPEG snapshots without watermark',
      'GLB glTF & AR Ready GLB export',
      'Unlimited geospatial maps & location changes',
      'Import custom 3D models & SVG / glTF files',
      TOKEN_FEATURE_LINE
    ],
    // Soft-decline path. Picking this dismisses the paywall and runs the
    // pending action (the watermarked download) without leaving Pro friction.
    // Imperative label pairs with the primary "Go Pro" CTA — "free" is
    // implied by the watermark mention so we don't repeat it.
    secondaryCtaLabel: 'Download now with watermark'
  }
};

export const getPaywallSurface = (key) =>
  (key && PAYWALL_SURFACES[key]) || null;
