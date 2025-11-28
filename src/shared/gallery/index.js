/**
 * Shared Gallery Module - Barrel export
 * V2 (Firestore + Firebase Storage) is the primary service
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
export { default as galleryService } from './services/galleryService'; // V1 - kept for migration only
export { default as galleryServiceV2 } from './services/galleryServiceV2'; // V2 - primary service
export { default as galleryMigration } from './services/galleryMigration';

// Hooks
export { default as useGallery } from './hooks/useGallery';

// Components
export { default as Gallery } from './components/Gallery';
export { default as GallerySidebar } from './components/GallerySidebar';
export { default as GalleryGrid } from './components/GalleryGrid';
export { default as GalleryItem } from './components/GalleryItem';
export { default as GalleryModal } from './components/GalleryModal';
