/**
 * Shared Gallery Module - Barrel export
 * Uses Firestore + Firebase Storage
 */

// Constants
export {
  ASSET_TYPES,
  ASSET_CATEGORIES,
  ASSET_TYPE_FOLDERS,
  STORAGE_PATHS,
  getTypeFolderName,
  validateUserIdForPath
} from './constants';

// Services
export { default as galleryServiceV2 } from './services/galleryServiceV2';

// Hooks
export { default as useGallery } from './hooks/useGallery';

// Components
export { default as Gallery } from './components/Gallery';
export { default as GallerySidebar } from './components/GallerySidebar';
export { default as GalleryGrid } from './components/GalleryGrid';
export { default as GalleryItem } from './components/GalleryItem';
export { default as GalleryModal } from './components/GalleryModal';
export { default as GalleryContent } from './components/GalleryContent';
export { default as MeshDetailsModal } from './components/MeshDetailsModal';

// Formatters
export { formatBytes, formatDate } from './utils';
