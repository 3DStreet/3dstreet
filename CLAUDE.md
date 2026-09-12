# CLAUDE.md - 3DStreet Codebase Guide

## Project Overview

**3DStreet** is a browser-based urban planning tool built on **A-Frame** and **three.js** for creating 3D street scenes.

**Key Features:** Street templates, Streetmix/StreetPlan import, Google 3D Tiles, WebXR, Firebase cloud storage

**Links:** [App](https://3dstreet.app) | [Website](https://3dstreet.com) | [Docs](https://www.3dstreet.com/docs/) | [GitHub](https://github.com/3DStreet/3dstreet)

**License:** AGPL-3.0 (code) / CC BY-NC 4.0 (assets)

## How to use this guide

This file is the entry point for repository-wide conventions and commands.
**Before planning, changing or reviewing a topic named below, read its linked
guide and follow the relevant onward documentation links.** Apply the trigger
wherever the work lives, including shared code, server functions and tests.
The short summaries here do not replace the detailed rules and exceptions.

These are ordinary Markdown files in this repository: open them explicitly;
do not assume they have been loaded automatically. Keep detailed topic guidance
in those files and maintain its read-before pointer here.

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

**Streets and geospatial:** curved street paths, basemaps, OSM buildings and
terrain flattening span components, pure utilities and workers. **Read
[streets and geospatial guidance](docs/agent-context/streets-and-geospatial.md)
before planning, changing or reviewing those features**, including scene-load
migrations. OSM worker code must never import `three`; never raycast a street's
real meshes for terrain flattening.

**Environment:** `street-environment`, `viewer-mode`, `ocean`

**Utilities:** `create-from-json`, `gltf-part`, `screentock`, `measure-line`

**Focus hotspots & Starting View (#1315):** `focus-hotspot` makes an entity
clickable while playing (click glides the camera in and opens an info panel);
`viewer-start` is the one-per-scene Starting View whose pose is where every
scene opens and where Start/Reset glide. Both are play-mode features: read the
[play mode and viewer guidance](docs/agent-context/play-mode.md) before
touching them. Entry point: `docs/focus-hotspots.md`.

## Play Mode & Viewer

Playing is presentation-only: nothing persists and no edit permission is needed.
Hide/restore of static street clones must use the refcounted registry in
`src/aframe-components/play/clone-visibility.js`.

**Read [play mode and viewer guidance](docs/agent-context/play-mode.md) before
planning, changing or reviewing play features, simulation clocks, camera/mode
handoffs, traffic, collisions or clone visibility.** This includes editor and
WebXR integration as well as code under `src/aframe-components/play/`.

## Editor (React)

`AFRAME.INSPECTOR` wraps the A-Frame scene, with Events.js and undo/redo commands.
State lives in `src/store.js` (Zustand).

**`Inspector.execute` can refuse:** test for `TRANSFORM_REFUSED`, not a falsy
return; success returns `undefined`. `data-no-transform` is a UI gate, not a
command-layer transform-capability marker.

**Read [editor guidance](docs/agent-context/editor.md) before planning, changing
or reviewing editor commands, transforms, layers, shapes, street gizmos or AI
tool integration**, including callers outside `src/editor/`.

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

**Lifecycle emails:** one send path (`sendLifecycleEmail` in `public/functions/email/`) with per-stream Postmark routing, `emailPrefs` unsubscribe suppression, and transactional stop-rules on `emailLog`. Triggers: Auth onCreate (welcome), `stripeWebhook` (post-upgrade; failed-payment handler dormant — Stripe hosted dunning instead), hourly sweep (abandoned checkout, pricing nudge, geo-not-used), daily sweep (token exhaustion). Localized (en/es/pt-BR/fr, hand-written copy per locale in `templates.js`): recipient locale resolved from `socialProfile/{uid}` (`locale` explicit pick > `detectedLocale` captured at sign-in > en) via `email/locale.js`. Docs: [docs/email-lifecycle.md](docs/email-lifecycle.md).

## User Asset Upload

Uploads span client placement, scene serialization, Firestore and Storage.
Scene JSON carries the asset identity attributes and cloud URL; other asset
metadata belongs in Firestore. Transient `blob:` placeholders must not be serialized.

**Read [asset upload guidance](docs/agent-context/asset-uploads.md) before
planning, changing or reviewing uploads, asset persistence, quotas, deletion
or asset security rules**, including anonymous scene loading.

## Generator

Vanilla JS with React islands; generation jobs and results persist server-side.

**Read [generation guidance](docs/agent-context/generation.md) before planning,
changing or reviewing generator UI, generation jobs, provider callbacks,
reconciliation, outcome emails, tokens or token purchases.** This also applies
to shared components, editor entry points and Firebase functions.

## Shared Library (@shared/\*)

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

**Firestore emulator tests:** `npm run test:rules` — local-only (boots the firestore + auth emulators via `firebase emulators:exec`, runs vitest against `test/rules/`). Covers security rules AND the lifecycle email send service (`sendLifecycleEmail`). Not wired into CI to keep CI cheap; run manually when touching `public/firestore.rules` or `public/functions/email/`. Requires JDK 21+ on `PATH` (emulator dependency; if `java -version` shows an older default, prefix with `JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"`).

**Deploy:** `npm run deploy` or `npm run deploy:staging`

## Key Patterns

**A-Frame ↔ React:**

- React → A-Frame: `entity.setAttribute()` or `AFRAME.INSPECTOR.execute()`
- A-Frame → React: `Events.emit()` or `useStore.setState()`

**Visibility:** use `setAttribute('visible', ...)`, never raw `object3D.visible`
(mesh batching).

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

**Note:** This codebase is actively evolving. Please update this guide and the relevant linked topic guidance when making significant changes!
