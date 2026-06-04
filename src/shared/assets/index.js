/**
 * Shared Assets Module - Barrel export
 * Uses Firestore + Firebase Storage
 */

// Constants
export {
  ASSET_TYPES,
  ASSET_CATEGORIES,
  ASSET_TYPE_FOLDERS,
  SPLAT_EXTENSIONS,
  STORAGE_PATHS,
  getTypeFolderName,
  validateUserIdForPath
} from './constants';

// Services
export { default as assetsService } from './services/assetsService';

// Hooks
export { default as useAssets, assetToDisplayItem } from './hooks/useAssets';
export { default as useStorageUsage } from './hooks/useStorageUsage';

// State
export { default as useCurrentUploadStore } from './state/currentUploadStore';

// Components
export { default as Assets } from './components/Assets';
export { default as AssetsSidebar } from './components/AssetsSidebar';
export { default as AssetsGrid } from './components/AssetsGrid';
export { default as AssetsItem } from './components/AssetsItem';
export { default as AssetsModal } from './components/AssetsModal';
export { default as AssetsContent } from './components/AssetsContent';
export { default as AssetsPanelBody } from './components/AssetsPanelBody';
export { default as MeshDetailsModal } from './components/MeshDetailsModal';
export { default as AssetDetailModal } from './components/AssetDetailModal';

// Formatters
export { formatBytes, formatDate, getServedUrl, is3dViewerType } from './utils';
