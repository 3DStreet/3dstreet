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

**Collection**: `galleryAssets`
**Document ID**: `{assetId}` (UUID)

This follows the same pattern as other top-level collections in the codebase (e.g., `tokenProfile/{userId}`, `scenes/{sceneId}`).

**Document Schema**:

```javascript
{
  // Identity
  assetId: "uuid",                    // Generated UUID (same as document ID)
  userId: "user123",                  // Owner (relational key for queries)
  type: "video" | "image" | "splat" | "mesh" | "scene",
  category: "ai-render" | "screenshot" | "upload" | "splat-source" | "splat-output",

  // Storage
  storagePath: "users/{userId}/media/images/ai-render/{assetId}.jpg",
  storageUrl: "https://...",          // Download URL
  thumbnailPath: "users/{userId}/media/images/ai-render/{assetId}-thumb.jpg",
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

```
users/
└── {userId}/
    └── media/
        ├── images/
        │   ├── ai-renders/
        │   │   ├── {assetId}.jpg
        │   │   └── {assetId}-thumb.jpg
        │   ├── screenshots/
        │   │   ├── {assetId}.png
        │   │   └── {assetId}-thumb.jpg
        │   └── uploads/
        │       ├── {assetId}.jpg
        │       └── {assetId}-thumb.jpg
        ├── videos/
        │   ├── {assetId}.mp4
        │   └── {assetId}-thumb.jpg
        └── models/
            └── splats/
                └── {taskId}/
                    ├── source.mp4
                    ├── output.ply
                    └── thumb.jpg
```

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
// Gallery Assets Collection (top-level)
match /galleryAssets/{assetId} {
  // Users can only read their own assets
  allow read: if request.auth != null
    && request.auth.uid == resource.data.userId;

  // Users can create their own assets
  allow create: if request.auth != null
    && request.auth.uid == request.resource.data.userId;

  // Users can update their own assets
  allow update: if request.auth != null
    && request.auth.uid == resource.data.userId;

  // Users can delete their own assets
  allow delete: if request.auth != null
    && request.auth.uid == resource.data.userId;
}
```

**Note**: This pattern matches the existing codebase style where collections like `tokenProfile/{userId}` use the top-level approach with `userId` as a field rather than subcollections.

### Firebase Storage Rules

```javascript
// Gallery media files
match /users/{userId}/media/{mediaType}/{assetFile} {
  allow read: if request.auth != null && request.auth.uid == userId;
  allow write: if request.auth != null && request.auth.uid == userId;
}

// Nested paths (e.g., images/ai-renders/file.jpg)
match /users/{userId}/media/{mediaType}/{category}/{assetFile} {
  allow read: if request.auth != null && request.auth.uid == userId;
  allow write: if request.auth != null && request.auth.uid == userId;
}
```

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

### Why Top-Level Collection?

The `galleryAssets` collection uses a **top-level collection** pattern (not subcollections) to match the existing codebase architecture:

- **Consistent with existing patterns**: Collections like `tokenProfile/{userId}` and `scenes/{sceneId}` use top-level collections
- **Simpler queries**: Direct queries like `where('userId', '==', userId)` without nested paths
- **Better indexing**: Composite indexes work better with top-level collections
- **No phantom documents**: Avoids creating empty parent documents

**Alternative considered**: `users/{userId}/assets/{assetId}` (subcollections) was the initial approach but was refactored to match the codebase's existing patterns.

## File Locations

- `src/shared/gallery/services/galleryServiceV2.js` - New Firestore service (top-level `galleryAssets` collection)
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
