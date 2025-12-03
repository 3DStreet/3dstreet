# Gallery Storage Architecture - V2 (Firestore + Firebase Storage)

## Overview

This document describes the **V2** gallery architecture using **Firestore** as the source of truth and **Firebase Storage** for files. Image caching is handled by the browser's built-in HTTP cache (1-year cache headers are set on upload).

## Architecture

### Components

1. **Firestore** - Asset metadata (source of truth, cloud)
2. **Firebase Storage** - Binary file storage (cloud, CDN-backed)
3. **Browser HTTP Cache** - Automatic caching via Cache-Control headers

### Data Flow

**Upload Flow:**
```
User generates/uploads asset
    ↓
Upload to Firebase Storage (blob with cache-control: public, max-age=31536000)
    ↓
Generate thumbnail (for images)
    ↓
Save metadata to Firestore
    ↓
Emit 'assetAdded' event
```

**Load Flow:**
```
Component requests image
    ↓
Use Firebase Storage URL directly
    ↓
Browser HTTP cache handles caching (1-year max-age)
    ↓
CDN serves cached content on subsequent requests
```

## Storage Structure

### Firestore Collection Structure

**Structure**: `users/{userId}/assets/{assetId}` (subcollection)
**Document ID**: `{assetId}` (UUID)

This uses a subcollection pattern for better security isolation and consistency with Firebase Storage paths.

**Document Schema**:

```javascript
{
  // Identity
  assetId: "uuid",                    // Generated UUID (same as document ID)
  userId: "user123",                  // Owner (relational key for queries)
  type: "video" | "image" | "splat" | "mesh" | "scene",
  category: "ai-render" | "screenshot" | "upload" | "splat-source" | "splat-output",

  // Storage
  storagePath: "users/{userId}/assets/images/{assetId}.jpg",
  storageUrl: "https://...",          // Download URL
  thumbnailPath: "users/{userId}/assets/images/{assetId}-thumb.jpg",
  thumbnailUrl: "https://...",

  // File Metadata
  filename: "my-image.jpg",
  originalFilename: "IMG_20250121.jpg",
  size: 2500000,                      // bytes
  mimeType: "image/jpeg",

  // Media Dimensions
  width: 1920,                        // pixels
  height: 1080,                       // pixels
  duration: 45.2,                     // seconds (for video)

  // Generation Metadata (flexible object)
  generationMetadata: {
    model: "flux-pro-1.1",
    prompt: "...",
    seed: 12345,
    steps: 40,
    guidance: 2.5,
    // ... other model-specific params
  },

  // Timestamps
  createdAt: Timestamp,
  updatedAt: Timestamp,
  uploadedAt: Timestamp,

  // Organization
  tags: ["urban", "street"],
  collections: ["project-a"],

  // Soft Delete
  deleted: false,
  deletedAt: null
}
```

### Firebase Storage Structure

Storage is organized by media type only (not category).

```
users/
└── {userId}/
    └── assets/
        ├── images/
        │   ├── {assetId}.jpg
        │   ├── {assetId}-thumb.jpg
        │   ├── {assetId2}.png
        │   └── {assetId2}-thumb.jpg
        ├── videos/
        │   ├── {assetId}.mp4
        │   └── {assetId}-thumb.jpg
        └── models/
            ├── {assetId}.ply
            ├── {assetId}.glb
            └── {assetId}-thumb.jpg
```

## Services

### `galleryServiceV2.js` (Primary Service)

Firestore-based service with full CRUD operations:

**Core Methods:**
- `addAsset()` - Upload file to Storage + save metadata to Firestore
- `getAsset()` - Retrieve single asset metadata
- `getAssets()` - Query assets with filters (by userId, type, category, etc.)
- `updateAsset()` - Update metadata (with ownership verification)
- `deleteAsset()` - Soft delete or hard delete (with ownership verification)
- `subscribeToAssets()` - Real-time updates via Firestore listener
- `uploadToStorage()` - Upload file with progress tracking
- `generateThumbnail()` - Auto-generate thumbnails for images

**Helper Methods:**
- `getAssetsByType()` - Filter by type
- `getAssetsByCategory()` - Filter by category
- `searchAssets()` - Simple text search
- `dataUriToBlob()` - Convert data URI to blob

### `galleryMigration.js`

**One-way, one-time** migration utility from V1 (IndexedDB) → V2 (Firestore):

- `isMigrationNeeded()` - Check if user needs migration
- `hasMigrated()` - Check per-user migration flag
- `migrateAll()` - Migrate all V1 assets to V2 with progress tracking
- `deleteV1Database()` - Completely delete V1 IndexedDB after successful migration

## Security Rules

### Firestore Rules

```javascript
// Gallery Assets Subcollection (under users)
match /users/{userId}/assets/{assetId} {
  // Users can only access their own gallery assets
  allow read: if request.auth != null && request.auth.uid == userId;

  // Users can create assets with proper userId field
  allow create: if request.auth != null
    && request.auth.uid == userId
    && request.resource.data.userId == userId;

  // Users can update their own assets
  allow update: if request.auth != null && request.auth.uid == userId;

  // Users can delete their own assets
  allow delete: if request.auth != null && request.auth.uid == userId;
}
```

### Firebase Storage Rules

```javascript
// Gallery asset files (recursive wildcard for all nested paths)
match /users/{userId}/assets/{allPaths=**} {
  allow read: if request.auth != null && request.auth.uid == userId;
  allow write: if request.auth != null && request.auth.uid == userId;
}
```

## Usage

### Adding an Asset

```javascript
import { galleryServiceV2 } from '@shared/gallery';
import { auth } from '@shared/services/firebase';

const user = auth.currentUser;
await galleryServiceV2.init();

const assetId = await galleryServiceV2.addAsset(
  imageBlob,
  {
    model: 'flux-pro-1.1',
    prompt: 'urban street scene',
    seed: 12345
  },
  'image',      // type
  'ai-render',  // category
  user.uid
);
```

### Loading Assets

```javascript
// Get all assets
const assets = await galleryServiceV2.getAssets(userId, {}, 200);

// Query specific type
const videos = await galleryServiceV2.getAssetsByType(userId, 'video', 50);

// Query specific category
const aiRenders = await galleryServiceV2.getAssetsByCategory(userId, 'ai-render', 100);
```

### Real-time Updates

```javascript
const unsubscribe = galleryServiceV2.subscribeToAssets(userId, {}, (assets) => {
  console.log('Assets updated:', assets);
});

// Later: unsubscribe
galleryServiceV2.unsubscribeFromAssets();
```

### Using React Hook

```javascript
import { useGallery } from '@shared/gallery';

function GalleryComponent() {
  const {
    items,
    isLoading,
    needsMigration,
    isMigrating,
    migrationProgress,
    addItem,
    removeItem,
    runMigration
  } = useGallery();

  if (needsMigration) {
    return (
      <button onClick={runMigration} disabled={isMigrating}>
        {isMigrating ? `Migrating... ${migrationProgress.toFixed(1)}%` : 'Migrate Gallery'}
      </button>
    );
  }

  return <div>{/* render items */}</div>;
}
```

## Benefits

1. **Cross-device Sync** - Assets available on all devices via Firestore
2. **Real-time Updates** - Live sync when new assets are added
3. **Scalability** - No storage limits (Firebase vs IndexedDB limit)
4. **Better Search** - Query by type, category, tags, metadata
5. **Thumbnails** - Auto-generated, CDN-backed for fast loading
6. **Soft Delete** - Recover deleted assets
7. **Browser Caching** - Automatic via HTTP Cache-Control headers (1 year)
8. **Simple Architecture** - No local IndexedDB blob management

## Future: Local Caching (Not Implemented)

For offline support or faster loads, local caching could be added later:

- **Service Worker** - Cache-first strategy for Firebase Storage URLs
- **IndexedDB Blob Store** - Application-level blob caching with LRU eviction
- **Cache Warming** - Proactive caching of recent thumbnails

This was intentionally deferred to simplify the initial implementation.

## File Locations

- `src/shared/gallery/services/galleryServiceV2.js` - Main Firestore service
- `src/shared/gallery/services/galleryMigration.js` - V1→V2 migration utility
- `src/shared/gallery/hooks/useGallery.js` - React hook
- `src/shared/gallery/components/GalleryItem.jsx` - Thumbnail card
- `src/shared/gallery/components/GalleryModal.jsx` - Detail view modal
- `public/firestore.rules` - Security rules

## Testing Checklist

**Core Functionality:**
- [ ] Login required for gallery access
- [ ] Upload image → Firestore + Storage
- [ ] View gallery → Loads from Firestore
- [ ] Thumbnails auto-generated
- [ ] Delete asset → Soft delete
- [ ] Search/filter by type, category

**Migration:**
- [ ] V1 → V2 migration works with progress
- [ ] Per-user migration flag in localStorage
- [ ] No migration prompt after first migration

**Security:**
- [ ] Users see only their own images
- [ ] Firestore rules prevent cross-user access
- [ ] Storage rules prevent cross-user access
