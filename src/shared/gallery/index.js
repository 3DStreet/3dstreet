/**
 * Shared Gallery Module - Barrel export
 */

// Services
export { default as galleryService } from './services/galleryService';
export { default as galleryServiceV2 } from './services/galleryServiceV2';
export { default as galleryServiceUnified } from './services/galleryServiceUnified';
export { default as galleryMigration } from './services/galleryMigration';

// Hooks
export { default as useGallery } from './hooks/useGallery';

// Components
export { default as Gallery } from './components/Gallery';
export { default as GallerySidebar } from './components/GallerySidebar';
export { default as GalleryGrid } from './components/GalleryGrid';
export { default as GalleryItem } from './components/GalleryItem';
export { default as GalleryModal } from './components/GalleryModal';
