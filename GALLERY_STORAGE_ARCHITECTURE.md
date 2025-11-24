# Gallery Storage Architecture - V2 with Service Worker Caching

## Overview

This document describes the **V2-only** gallery architecture using **Firestore** as the source of truth, with **Firebase Storage** for files, **Service Worker** for LRU image caching, and **IndexedDB** for metadata-only caching.

## Architecture

### Components

1. **Firestore** - Asset metadata (source of truth, cloud)
2. **Firebase Storage** - Binary file storage (cloud, CDN-backed)
3. **Service Worker** - LRU cache for image blobs (Cache API, quota-aware)
4. **IndexedDB** - Metadata-only cache (~1KB per asset vs 2MB with blobs)

### Data Flow

**Upload Flow:**
```
User generates/uploads asset
    ↓
Upload to Firebase Storage (blob)
    ↓
Save metadata to Firestore
    ↓
Cache metadata in IndexedDB (no blobs)
    ↓
Service Worker caches image on first fetch
```

**Load Flow:**
```
App loads → IndexedDB (metadata, instant)
    ↓
Display thumbnails (URLs from metadata)
    ↓
Browser fetches images → Service Worker intercepts
    ↓
Service Worker: Cache-first (instant if cached, else fetch from Storage)
    ↓
On quota exceeded → Prune LRU entries → Retry
```

**Offline Flow:**
```
User goes offline
    ↓
IndexedDB provides metadata instantly
    ↓
Service Worker serves cached images
    ↓
Uncached images show placeholder
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

### 1. `galleryServiceV2.js` (Primary Service)

**V2-only** Firestore-based service with full CRUD operations and metadata-only IndexedDB caching:

**Core Methods:**
- `addAsset()` - Upload file to Storage + save metadata to Firestore + cache metadata locally
- `getAsset()` - Retrieve single asset metadata
- `getAssets()` - Query assets with filters (by userId, type, category, etc.)
- `updateAsset()` - Update metadata (with ownership verification)
- `deleteAsset()` - Soft delete or hard delete (with ownership verification)
- `subscribeToAssets()` - Real-time updates via Firestore listener
- `uploadToStorage()` - Upload file with progress tracking
- `generateThumbnail()` - Auto-generate thumbnails for images

**Cache Methods:**
- `cacheAsset()` - Cache metadata only (no blobs, ~1KB per asset)
- `getCachedAssets()` - Get all cached metadata from IndexedDB
- `trackAccess()` - Update access timestamp for LRU
- `clearLocalCache()` - Clear IndexedDB cache

**Service Worker Integration:**
- `warmServiceWorkerCache()` - Proactively cache recent 50 thumbnails
- `getServiceWorkerCacheStatus()` - Get cache statistics
- `clearServiceWorkerCache()` - Clear Service Worker cache

**Collection**: Uses subcollection `users/{userId}/assets/{assetId}` for better security isolation.

### 2. `galleryMigration.js`

**One-way, one-time** migration utility from V1 → V2:

- `isMigrationNeeded()` - Check if user needs migration (checks localStorage flag)
- `hasMigrated()` - Check per-user migration flag
- `migrateAll()` - Migrate all V1 assets to V2 with progress tracking
- `deleteV1Database()` - Completely delete V1 IndexedDB after successful migration

**Per-user migration flag**: `localStorage.setItem('gallery_migrated_{userId}', 'true')`

**Migration is one-way**: Once migrated, V1 database is deleted. No fallback logic.

### 3. Service Worker (`public/sw.js`)

**LRU image caching** with quota-aware storage management:

**Features:**
- Cache-first strategy for Firebase Storage URLs
- LRU eviction (least recently used entries pruned first)
- Quota-aware: Automatically prunes cache when QuotaExceededError occurs
- Proactive cache warming: Caches recent 50 thumbnails on load
- Metadata tracking in separate IndexedDB (`3DStreetGalleryCacheMeta`)

**Cache Strategy:**
```javascript
// 1. Check Service Worker cache (Cache API)
// 2. If hit: Return cached response + update access metadata
// 3. If miss: Fetch from Firebase Storage
// 4. Cache response (with quota error handling)
```

**Message API:**
- `WARM_CACHE` - Proactively cache array of URLs
- `CLEAR_CACHE` - Clear all cached images
- `GET_CACHE_STATUS` - Get cache size, quota, usage stats

**Quota Handling:**
```javascript
// On QuotaExceededError:
// 1. Query IndexedDB for LRU candidates
// 2. Prune oldest entries (at least 5, ~10MB freed)
// 3. Retry cache operation
```

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

### 4. IndexedDB Schemas

**V2 Metadata Cache** (`3DStreetGalleryCache` v3):
```javascript
{
  assetId: "uuid",             // Primary key
  userId: "user123",           // For filtering
  type: "image",
  category: "ai-render",
  storageUrl: "https://...",   // Firebase Storage URL
  thumbnailUrl: "https://...", // Thumbnail URL
  generationMetadata: {...},
  createdAt: "ISO string",
  // LRU tracking:
  lastAccessedAt: 1234567890,  // Timestamp
  accessCount: 42              // Number of accesses
}
```

**Service Worker Cache Metadata** (`3DStreetGalleryCacheMeta`):
```javascript
{
  url: "https://...",          // Primary key (Firebase Storage URL)
  lastAccessedAt: 1234567890,  // For LRU
  accessCount: 42,
  cachedAt: 1234567890,        // When first cached
  size: 256000                 // Blob size in bytes
}
```

## Usage

### Adding an Asset (V2)

```javascript
import { galleryServiceV2 } from '@shared/gallery';
import { auth } from '@shared/services/firebase';

// Initialize
const user = auth.currentUser;
await galleryServiceV2.init();

// Add an image
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

### Loading Assets (V2)

```javascript
// Get all assets
const assets = await galleryServiceV2.getAssets(user.uid, {}, 200);

// Query specific type
const videos = await galleryServiceV2.getAssetsByType(user.uid, 'video', 50);

// Query specific category
const aiRenders = await galleryServiceV2.getAssetsByCategory(
  user.uid,
  'ai-render',
  100
);
```

### Real-time Updates

```javascript
// Subscribe to real-time updates (V2)
const unsubscribe = galleryServiceV2.subscribeToAssets(user.uid, {}, (assets) => {
  console.log('Assets updated:', assets);
});

// Later: unsubscribe
galleryServiceV2.unsubscribeFromAssets();
```

### Service Worker Cache Management

```javascript
// Warm cache with recent thumbnails (automatic on init)
await galleryServiceV2.warmServiceWorkerCache(50);

// Get cache status
const cacheStatus = await galleryServiceV2.getServiceWorkerCacheStatus();
console.log(`Cache: ${cacheStatus.totalEntries} entries, ${cacheStatus.totalSizeMB}MB`);
console.log(`Quota: ${cacheStatus.usageMB}MB / ${cacheStatus.quotaMB}MB (${cacheStatus.usagePercent}%)`);

// Clear Service Worker cache
await galleryServiceV2.clearServiceWorkerCache();
```

### Migration (One-Time, One-Way)

```javascript
import { galleryMigration } from '@shared/gallery';
import { auth } from '@shared/services/firebase';

const user = auth.currentUser;

// Check if migration is needed
const needsMigration = await galleryMigration.isMigrationNeeded(user.uid);

if (needsMigration) {
  console.log('V1 → V2 migration needed');

  // Migrate with progress tracking
  const status = await galleryMigration.migrateAll(user.uid, (progress) => {
    console.log(`${progress.current}/${progress.total} (${progress.percentage.toFixed(1)}%)`);
  });

  console.log(`Migration complete:`, status);
  console.log(`Migrated: ${status.migrated}, Failed: ${status.failed}`);

  // V1 database is automatically deleted after successful migration
}
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

  // Handle migration
  if (needsMigration) {
    return (
      <button onClick={runMigration} disabled={isMigrating}>
        {isMigrating ? `Migrating... ${migrationProgress.toFixed(1)}%` : 'Migrate V1 → V2'}
      </button>
    );
  }

  // Display gallery
  return <div>{/* render items */}</div>;
}
```

## Generator Integration

The generator tabs (create, modify, inpaint, outpaint, video) use V2 exclusively:

```javascript
// In generator-tab-base.js and video.js
import { galleryServiceV2 as galleryService } from '@shared/gallery';
import { auth } from '@shared/services/firebase';

// Save image to gallery
const currentUser = auth.currentUser;
if (currentUser) {
  await galleryService.addAsset(
    dataUrl,
    metadata,
    'image',
    'ai-render',
    currentUser.uid
  );
}
```

## Benefits

1. **Cross-device Sync** - Assets available on all devices via Firestore
2. **Real-time Updates** - Live sync when new assets are added
3. **Scalability** - No storage limits (Firebase vs IndexedDB ~5-10MB)
4. **Better Search** - Query by type, category, tags, metadata
5. **Thumbnails** - Auto-generated, CDN-backed for fast loading
6. **Soft Delete** - Recover deleted assets
7. **Mobile-Friendly** - Metadata-only IndexedDB (~1KB vs 2MB per asset)
8. **Offline Support** - Service Worker Cache API with LRU eviction
9. **Quota-Aware** - Automatic cache pruning on iOS Safari (50MB limit)
10. **Clean Architecture** - V2-only, no dual-system complexity

## Migration Strategy

**Phase 1**: V2-only refactor (✅ Complete)
- Removed `galleryServiceUnified.js`
- V2 is now the only active service
- Metadata-only IndexedDB caching
- Service Worker with LRU image caching
- One-way V1 → V2 migration with per-user flags

**Phase 2**: User migration (In Progress)
- Users prompted to migrate on first login
- One-time migration per user
- V1 database deleted after successful migration
- No fallback logic (V2 or nothing)

**Phase 3**: Legacy cleanup (Future)
- Remove `galleryService.js` (V1) entirely
- Remove migration code once all users migrated

## Testing Scenarios

### 1. Fresh User (No V1 Data)
- ✅ Login → No migration needed
- ✅ Gallery loads from Firestore (empty)
- ✅ Add image → Saved to Firestore + Storage
- ✅ IndexedDB stores metadata only (~1KB)
- ✅ Service Worker caches thumbnail on first load

### 2. Existing V1 User
- ✅ Login → Migration prompt shown
- ✅ Click migrate → Progress bar displays
- ✅ V1 assets uploaded to Storage
- ✅ Firestore docs created
- ✅ V1 IndexedDB deleted
- ✅ Migration flag set in localStorage
- ✅ Second login → No migration prompt

### 3. Offline Mode
- ✅ Load gallery → IndexedDB provides metadata instantly
- ✅ Display thumbnails → Service Worker serves cached images
- ✅ Uncached images → Show placeholder
- ✅ Go online → Fetch uncached images
- ✅ Service Worker caches new images

### 4. Quota Exceeded (Mobile)
- ✅ Add 100+ images → Service Worker quota exceeded
- ✅ Automatic pruning → Oldest 5+ entries removed
- ✅ Retry cache → Succeeds
- ✅ App continues working normally
- ✅ Most recent 50 thumbnails always cached

### 5. Multi-Device Sync
- ✅ Add image on laptop → Saved to Firestore
- ✅ Open phone → Real-time listener triggers
- ✅ Gallery updates with new image
- ✅ Thumbnail fetched from Storage
- ✅ Service Worker caches thumbnail

### 6. Multi-User (Same Browser)
- ✅ Alice logs in → Sees only Alice's images
- ✅ Bob logs in → Sees only Bob's images
- ✅ IndexedDB has both users' metadata
- ✅ Service Worker cache shared (OK, images are public)
- ✅ Firestore security rules prevent cross-user access

## Testing Checklist

**Core Functionality:**
- [ ] Login required for gallery access
- [ ] Upload image → Firestore + Storage + IndexedDB metadata
- [ ] View gallery → Loads from Firestore
- [ ] Thumbnails auto-generated and cached
- [ ] Delete asset → Soft delete (deleted: true)
- [ ] Search/filter by type, category
- [ ] Storage paths: `users/{uid}/assets/{type}s/{assetId}.ext`

**Service Worker:**
- [ ] Service Worker registered on load
- [ ] Cache-first strategy for Firebase Storage URLs
- [ ] Proactive cache warming (50 thumbnails)
- [ ] LRU eviction on quota exceeded
- [ ] Cache status API works
- [ ] Clear cache works

**IndexedDB:**
- [ ] Stores metadata only (no blobs)
- [ ] ~1KB per asset (vs 2MB before)
- [ ] LRU tracking (lastAccessedAt, accessCount)
- [ ] Schema upgrade v2 → v3 removes old blobs

**Migration:**
- [ ] V1 → V2 migration works with progress
- [ ] V1 database deleted after success
- [ ] Per-user migration flag in localStorage
- [ ] No migration prompt after first migration
- [ ] Multi-user migration (different flags per user)

**Offline:**
- [ ] IndexedDB provides instant metadata
- [ ] Service Worker serves cached images
- [ ] Uncached images show placeholder
- [ ] Works on iOS Safari (50MB quota)

**Security:**
- [ ] Users see only their own images
- [ ] Firestore rules prevent cross-user read/write
- [ ] Storage rules prevent cross-user access

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
