# CLAUDE.md - 3DStreet Codebase Guide

## Project Overview

**3DStreet** is a browser-based urban planning tool built on **A-Frame** and **three.js** for creating 3D street scenes.

**Key Features:** Street templates, Streetmix/StreetPlan import, Google 3D Tiles, WebXR, Firebase cloud storage

**Links:** [App](https://3dstreet.app) | [Website](https://3dstreet.com) | [Docs](https://www.3dstreet.com/docs/) | [GitHub](https://github.com/3DStreet/3dstreet)

**License:** AGPL-3.0 (code) / CC BY-NC 4.0 (assets)

## Architecture

Multi-application monorepo with shared components:

1. **A-Frame Core** (`/src`) - 3D rendering engine, geometry, WebXR (vanilla JS + A-Frame)
2. **React Editor** (`/src/editor`) - UI for scene editing, uses `AFRAME.INSPECTOR` to communicate with A-Frame
3. **Generator** (`/src/generator`) - AI image/video generation tool (fal.ai + Replicate), vanilla JS with React islands
4. **Shared Library** (`/src/shared`) - Auth, navigation, Firebase services (imported via `@shared/*`)
5. **Firebase** (`/public`) - Hosting, cloud functions, Firestore

## Key Directories

```
src/
├── index.js                    # A-Frame entry point
├── store.js                    # Zustand global state
├── assets.js, catalog.json     # Asset loading system
├── aframe-components/          # 30+ custom A-Frame components
├── editor/                     # React Editor
│   ├── components/             # UI components
│   └── lib/                    # Events, History, Commands
├── generator/                  # AI generator app
│   ├── mount-*.js              # React island mounting
│   └── components/             # React islands
├── shared/                     # Shared library (@shared/*)
│   ├── auth/                   # Auth components
│   ├── navigation/             # AppSwitcher
│   ├── services/firebase.js    # Firebase SDK
│   └── utils/                  # Shared utilities
└── tested/                     # Unit-tested modules

public/
├── functions/                  # Firebase Cloud Functions
└── firebase.json               # Firebase config
```

## Key A-Frame Components

**Core Street:**
- `managed-street` - **Preferred**: Manages `street-segment` children, loads from `streetmix-url`, `streetplan-url`, or `json-blob`
- `street` + `streetmix-loader` - **Legacy**: Being phased out
- `street-segment` - Individual lane/segment (drive-lane, bike-lane, sidewalk, etc.)
- `intersection` - 4-way intersections (no managed equivalent yet)

**Procedural:** `street-generated-*` (striping, stencil, pedestrians, rail, clones)

**Geospatial:** `street-geo`, `google-maps-aerial`, `geojson`

**Environment:** `street-environment`, `viewer-mode`, `ocean`

**Utilities:** `create-from-json`, `gltf-part`, `screentock`, `measure-line`

## Editor (React)

**Architecture:** `AFRAME.INSPECTOR` global wraps A-Frame scene, uses Events.js + command pattern

**Key Components:** MainWrapper (auth/modals) → SceneGraph (left) + PropertiesPanel (right) + Viewport (3D canvas)

**State:** `src/store.js` (Zustand) - scene metadata, modal state, save state, preferences

**Commands:** `src/editor/lib/commands/` - undo/redo pattern (AddEntity, SetComponent, EntityReparent, etc.)

**Layer Reordering:** Drag-and-drop reordering of layers within the same parent in the SceneGraph. Uses `EntityReparentCommand` which serializes via `STREET.utils.getElementData()` and recreates via `STREET.utils.createEntityFromObj()` — the same proven save/load code path.

## Asset System

**How it works:** `<street-assets>` custom element injects A-Frame mixins from `catalog.json` + legacy hardcoded mixins in `assets.js`

**catalog.json structure:** `{ id, name, src, img, category, attribution, ... }` - loaded on-demand

**UI usage:** Add Layer Panel (cards) + Model Dropdown (properties panel) query mixins via `getGroupedMixinOptions()`

**Global access:** `STREET.catalog` array

**Asset utilities:** https://github.com/3dstreet/3dstreet-assets-dist

## Firebase

**Firestore:** `scenes` collection (data, title, authorId, timestamps), `/users/{uid}/tokenProfile` (genToken, credToken)

**Auth:** Google, Email/Password, user claims for plan levels

**Functions:** getScene, createStripeSession, stripeWebhook, geoid, generateReplicateImage, generateFalImage, onAssetWritten, getUploadQuota, onSplatAssetCreated

## User Asset Upload

Drag-and-drop GLB/image upload with client-side optimization, cloud persistence, quota enforcement, and per-entity status UI.

**Persistence — two identity attributes written to saved JSON:**
- `data-asset-id` — Firestore doc id under the owner's subcollection
- `data-asset-owner-uid` — needed to reconstruct the owner-only Firestore path (`users/{ownerUid}/assets/{assetId}`) without auth context (e.g. for anonymous viewers)

The cloud URL lives in `gltf-model` / `src`. Firebase Storage download tokens allow anonymous viewers to load the file without Firestore access.

**`data-temporary-file` sentinel:** placeholder entities carrying a transient `blob:` URL are marked with this attribute; the scene serializer (`json-utils_1.1.js`) skips them. Removed by `uploadAndPlaceAsset.js` on success.

**All other metadata** (`size`, `originalFilename`, etc.) lives in Firestore and is fetched on demand — never saved in the scene JSON.

**Cloud Functions:**
- `onAssetWritten` — Firestore trigger, maintains `users/{uid}/meta/usage.bytesUsed` via transaction. Only `size` (original) counts toward quota; `optimizedSourceSize` is excluded (platform cost).
- `getUploadQuota` — callable, reads plan via `getAuth().getUser(uid)` (Admin SDK, always fresh custom claims). Returns `{ bytesUsed, planLimit, planName, allowed }`.

**Plan limits (decimal):** FREE 100 MB · PRO 5 GB · MAX 25 GB (reserved; no users today). Per-file caps: GLB 50 MB · image 10 MB.

**Security rules:**
- `size`, `storagePath`, `optimizedSourcePath`, `userId` immutable after create — prevents quota spoofing
- Client hard-delete (`deleteDoc`) disallowed; UI soft-deletes (`deleted: true`); GC Cloud Function purges via Admin SDK
- `users/{uid}/meta/usage` owner-readable, write-only via Cloud Functions

## Generator

**Structure:** Vanilla JS app (modify/create/video/gallery tabs) + React islands (auth, navigation, purchase modal)

**Island Architecture:** React components mounted via `mount-*.js` files into specific DOM elements

**Workflow:** User prompt → token check → Firebase Cloud Function (fal.ai or Replicate) submits an async job → jobId → client polls; result saved to gallery server-side

**Token system:** TokenSync syncs Firestore → Zustand, PurchaseModal for Stripe checkout

**Async job queue:** All user-initiated AI generations use `users/{uid}/generationJobs/{jobId}` (provider-agnostic, survives a closed browser). Providers today: `replicate` (image→splat via SHARP, image→video via Veo/Kling/LTX, image→image via nano-banana/seedream/kontext — converge on one idempotent processor via webhook + poll + reconciler; results saved to the gallery server-side), `fal` (image→3D mesh via Hunyuan3D/TRELLIS and image→image via flux-2 edit — same convergent shape via `fal_webhook` → `falJobWebhook` + the shared `fetchFalPrediction` adapter), and `cloudrun` (`.ply`→RAD/LOD conversion via the `rad-converter` Cloud Run service; worker-writeback, `tokenCost: 0`, triggered by `onSplatAssetCreated`). A scheduled reconciler backstops all of them. Completion emails send from the webhook in real time (after a ~10s open-tab ack grace so a watching tab suppresses them); opt-in defaults on for slow kinds (splat/video/mesh), off for images. Design: `docs/generation-job-queue.md`; RAD pipeline: `docs/rad-cloud-run-pipeline.md`.

## Shared Library (@shared/*)

**Purpose:** Reusable components/services across editor + generator, imported via webpack alias

**Categories:**
- `auth/` - ProfileButton, SignInModal, TokenDisplay, TokenDetailsCard
- `navigation/` - AppSwitcher (app switcher dropdown)
- `contexts/` - AuthProvider (wraps Firebase auth, provides user/tokenProfile)
- `services/firebase.js` - Centralized Firebase SDK (app, auth, db, functions, vertexAI)
- `utils/` - tokens.js, username.js
- `icons/` - Shared icon components
- `api/` - User API calls

**Usage:** Import barrel exports, has Storybook stories for development

## Development

**Setup:** `npm install`, create `config/.env.development`

**Dev server:** `npm start` → http://localhost:3333 (editor) + /generator/

**Build:** `npm run dist` (production) or `npm run dist:staging`

**Test:** `npm test` (Mocha + Vitest), `npm run lint`, `npm run prettier`

**Firestore rules tests:** `npm run test:rules` — local-only (boots the firestore emulator via `firebase emulators:exec`, runs vitest against `test/rules/`). Not wired into CI to keep CI cheap; run manually when touching `public/firestore.rules`. Requires JDK 21+ on `PATH` (Firestore emulator dependency).

**Deploy:** `npm run deploy` or `npm run deploy:staging`

## Key Patterns

**A-Frame ↔ React:**
- React → A-Frame: `entity.setAttribute()` or `AFRAME.INSPECTOR.execute()`
- A-Frame → React: `Events.emit()` or `useStore.setState()`

**URL Hash Schemes:** Streetmix URL, StreetPlan URL, Cloud UUID (`#scenes/...`), Managed Street JSON

**File Naming:** A-Frame: `kebab-case.js`, React: `PascalCase.js/jsx`, Styles: `.module.scss`

**Island Architecture:** React components mounted in vanilla JS via `createRoot()` + mount functions

**Shared imports:** `import { ... } from '@shared/auth/components'` (uses barrel exports)

## External Integrations

**Streetmix/StreetPlan:** 2D street import via API (components: `streetmix-loader`, `street-mapping-streetplan`)

**Google 3D Tiles:** Real-world context (`google-maps-aerial` component, `3d-tiles-renderer` library)

**fal.ai / Replicate:** Image and video generation via Firebase proxy (Flux 2, nano-banana, seedream, kontext, etc.)

**Firebase:** Auth, Firestore, Cloud Functions, Hosting

**Stripe:** Payment processing (createStripeSession, stripeWebhook)

**Analytics/Monitoring:** PostHog (analytics), Sentry (error tracking)

## Tech Stack

A-Frame 1.8.0 (loaded via CDN in index.html; ships super-three 0.184), Three.js r184 (npm `three` must match the A-Frame build's super-three version, upgrade together; webpack externalizes bare `three` imports to the A-Frame global, while `three/examples` addons are bundled from npm), React 18.2.0, Zustand 5.0.1, Firebase 11.10.0, Webpack 5.91.0, TailwindCSS 3.4.14

## Resources

[User Docs](https://www.3dstreet.com/docs/) | [GitHub](https://github.com/3DStreet/3dstreet) | [Discord](https://discord.com/invite/zNFMhTwKSd) | [A-Frame Docs](https://aframe.io/docs/)

---

**Note:** This codebase is actively evolving. Please update this document when making significant changes!