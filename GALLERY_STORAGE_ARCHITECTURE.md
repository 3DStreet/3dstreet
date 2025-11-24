# Gallery Storage Architecture - Firestore + Firebase Storage

## Overview

This document describes the refactored gallery storage architecture that uses **Firestore as the source of truth** for gallery assets, with **Firebase Storage** for file storage and **IndexedDB** as a local cache.

## Architecture

### Components

1. **Firestore** - Asset metadata (source of truth)
2. **Firebase Storage** - Binary file storage
3. **IndexedDB** - Local cache for offline access

### Data Flow

```
User generates/uploads asset
    ↓
Upload to Firebase Storage
    ↓
Save metadata to Firestore
    ↓
Cache locally in IndexedDB
    ↓
Real-time sync across devices
```

## Storage Structure

### Firestore Collection Structure

**Structure**: `users/{userId}/assets/{assetId}` (subcollection)
**Document ID**: `{assetId}` (UUID)

This uses a subcollection pattern for better security isolation and consistency with Firebase Storage paths. Each user's assets are stored under their user document, making security rules simpler and more explicit.

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

Storage is organized by media type only (not category). Categories like "ai-render", "screenshot", "upload" are stored in Firestore metadata, not in the storage path.

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

**Rationale**:
- Media type separation (images/videos/models) allows for future sharding to different storage systems/APIs
- Category information (ai-render, screenshot, upload, etc.) is stored in Firestore metadata where it can be easily queried and updated
- Simpler path structure reduces complexity and potential naming conflicts

## Services

### 1. `galleryServiceV2.js`

New Firestore-based service with full CRUD operations:

- `addAsset()` - Upload file to Storage + save metadata to Firestore (`galleryAssets` collection)
- `getAsset()` - Retrieve single asset (with ownership verification)
- `getAssets()` - Query assets with filters (by userId, type, category, etc.)
- `updateAsset()` - Update metadata (with ownership verification)
- `deleteAsset()` - Soft delete or hard delete (with ownership verification)
- `subscribeToAssets()` - Real-time updates via Firestore listener
- `uploadToStorage()` - Upload file with progress tracking
- `generateThumbnail()` - Auto-generate thumbnails for images

**Collection**: Uses top-level `galleryAssets` collection with `userId` as a field for relational queries.

### 2. `galleryServiceUnified.js`

Unified API that works with both:
- **V1** (legacy IndexedDB)
- **V2** (new Firestore + Storage)

Automatically detects authentication state and uses V2 when user is signed in, falls back to V1 otherwise.

### 3. `galleryMigration.js`

Migration utility to move existing IndexedDB data to Firestore:

- `isMigrationNeeded()` - Check if migration is required
- `migrateAll()` - Migrate all assets with progress tracking
- `cleanupOldData()` - Remove old IndexedDB data

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

**Note**: This subcollection pattern provides simpler security rules (direct userId path check) and better consistency with Firebase Storage paths (`users/{userId}/assets/...`).

### Firebase Storage Rules

```javascript
// Gallery asset files (recursive wildcard for all nested paths)
match /users/{userId}/assets/{allPaths=**} {
  allow read: if request.auth != null && request.auth.uid == userId;
  allow write: if request.auth != null && request.auth.uid == userId;
}
```

This single rule handles all nested asset paths (images/ai-renders/, videos/, models/splats/{taskId}/, etc.) without conflicts.

## Usage

### Adding an Asset

```javascript
import { galleryServiceUnified } from '@shared/gallery';
import { auth } from '@shared/services/firebase';

// Initialize with user ID
const user = auth.currentUser;
await galleryServiceUnified.init(user.uid);

// Add an image
const assetId = await galleryServiceUnified.addItem(
  imageBlob,
  {
    model: 'flux-pro-1.1',
    prompt: 'urban street scene',
    seed: 12345
  },
  'ai-render'
);
```

### Loading Assets

```javascript
// Load all assets (auto-detects V1/V2)
const assets = await galleryServiceUnified.loadFromDB();

// Query specific type (V2 only)
const videos = await galleryServiceUnified.getAssetsByType('video', 50);
```

### Real-time Updates

```javascript
// Subscribe to real-time updates (V2 only)
const unsubscribe = galleryServiceUnified.subscribeToAssets((assets) => {
  console.log('Assets updated:', assets);
});

// Later: unsubscribe
unsubscribe();
```

### Migration

```javascript
import { galleryMigration } from '@shared/gallery';

// Check if migration is needed
const needsMigration = await galleryMigration.isMigrationNeeded(userId);

// Migrate with progress tracking
if (needsMigration) {
  const status = await galleryMigration.migrateAll(userId, (progress) => {
    console.log(`${progress.percentage}% complete`);
  });

  console.log(`Migrated: ${status.migrated}, Failed: ${status.failed}`);
}
```

## Generator Integration

The generator tabs (create, modify, inpaint, outpaint, video) have been updated to use the unified service:

```javascript
// In generator-tab-base.js and video.js
import { galleryServiceUnified as galleryService } from '@shared/gallery';
import { auth } from '@shared/services/firebase';

// Initialize on save
const currentUser = auth.currentUser;
if (currentUser && !galleryService.userId) {
  await galleryService.init(currentUser.uid);
}

// Save as before
await galleryService.addImage(dataUrl, metadata, 'ai-render');
```

## Benefits

1. **Cross-device Sync** - Assets available on all devices
2. **Real-time Updates** - Live sync when new assets are added
3. **Scalability** - No storage limits (vs IndexedDB ~5-10MB)
4. **Better Search** - Query by type, category, tags, metadata
5. **Thumbnails** - Auto-generated for better performance
6. **Soft Delete** - Recover deleted assets
7. **Offline Support** - IndexedDB cache for offline access
8. **Migration Path** - Seamless upgrade from V1 to V2

## Migration Strategy

**Phase 1**: New system runs in parallel (✅ Complete)
- V2 services created
- Unified service provides backward compatibility
- Security rules updated

**Phase 2**: Gradual adoption (Current)
- Generator tabs use unified service
- Users can manually trigger migration
- Both systems work simultaneously

**Phase 3**: Full migration (Future)
- Automatic migration prompt for users
- Legacy V1 code removal
- Full V2 adoption

## Testing Checklist

- [ ] Upload image via AI generator → saved to Firestore + Storage
- [ ] View gallery → assets load from Firestore
- [ ] Real-time sync: upload on one device → appears on another
- [ ] Offline mode: cached assets viewable when offline
- [ ] Delete asset → soft deleted (can be recovered)
- [ ] Search/filter assets by type, category
- [ ] Thumbnails generated and displayed
- [ ] Storage paths follow new structure
- [ ] Security rules prevent cross-user access
- [ ] Migration from V1 to V2 works
- [ ] Fallback to V1 works when not authenticated

## Architecture Notes

### Why Subcollections?

The gallery uses a **subcollection pattern** (`users/{userId}/assets/{assetId}`) for these reasons:

- **Simpler security rules**: Path-based security (`request.auth.uid == userId`) is more explicit than field-based checks
- **Storage consistency**: Matches Firebase Storage structure (`users/{userId}/assets/...`)
- **Data isolation**: Assets are naturally scoped to their owner's document
- **No cross-user queries needed**: Gallery assets are always queried per-user, never globally
- **Better organization**: User data is logically grouped under user documents

**Alternative considered**: Top-level `galleryAssets` collection was initially implemented to match `scenes` collection pattern, but subcollections are more appropriate for user-private data that's never queried across users.

## File Locations

- `src/shared/gallery/services/galleryServiceV2.js` - New Firestore service (`users/{userId}/assets/{assetId}` subcollection)
- `src/shared/gallery/services/galleryServiceUnified.js` - Unified API (backward compatible)
- `src/shared/gallery/services/galleryMigration.js` - Migration utility
- `src/shared/gallery/services/galleryService.js` - Legacy IndexedDB service
- `public/firestore.rules` - Security rules (Firestore + Storage)
- `src/generator/generator-tab-base.js` - Updated generator integration
- `src/generator/video.js` - Updated video tab integration

## Questions & Answers

**Q: What happens to existing IndexedDB data?**
A: It remains intact. Users can manually migrate when ready. The unified service falls back to V1 when not authenticated.

**Q: Do we auto-delete source videos after splat generation?**
A: Not yet. This can be added as a feature flag or user preference.

**Q: What's the retention policy for deleted assets?**
A: Soft deleted by default (deleted: true flag). Can be permanently deleted with hard delete option.

**Q: How to handle large galleries?**
A: Use pagination (limit parameter) and thumbnails for performance. Real-time listener can be scoped to recent items only.

**Q: Should thumbnails be in separate collection?**
A: No, thumbnail URLs are embedded in the asset document for simplicity. Thumbnails are stored separately in Storage.

## Notes

- Always initialize the service with userId when authenticated
- V2 automatically falls back to V1 if initialization fails
- Thumbnails are auto-generated for images only (videos could be added later)
- All timestamps use Firestore serverTimestamp() for consistency
- Security rules ensure users can only access their own assets
