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
3. **Generator** (`/src/generator`) - BFL Flux AI tool for image/video generation, vanilla JS with React islands
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

**Commands:** `src/editor/lib/commands/` - undo/redo pattern (AddEntity, SetComponent, etc.)

## Asset System

**How it works:** `<street-assets>` custom element injects A-Frame mixins from `catalog.json` + legacy hardcoded mixins in `assets.js`

**catalog.json structure:** `{ id, name, src, img, category, attribution, ... }` - loaded on-demand

**UI usage:** Add Layer Panel (cards) + Model Dropdown (properties panel) query mixins via `getGroupedMixinOptions()`

**Global access:** `STREET.catalog` array

**Asset utilities:** https://github.com/3dstreet/3dstreet-assets-dist

## Firebase

**Firestore:** `scenes` collection (data, title, authorId, timestamps), `/users/{uid}/tokenProfile` (genToken, credToken)

**Auth:** Google, Email/Password, user claims for plan levels

**Functions:** getScene, createStripeSession, stripeWebhook, serveWebXRVariant, geoid, bfl-proxy

## Generator

**Structure:** Vanilla JS app (generator/inpaint/outpaint/gallery tabs) + React islands (auth, navigation, purchase modal)

**Note:** UI still displays "AI Image Generator" but video generation coming soon

**Island Architecture:** React components mounted via `mount-*.js` files into specific DOM elements

**Workflow:** User prompt → token check → Firebase Cloud Function → BFL API → poll → display + save to localStorage

**Token system:** TokenSync syncs Firestore → Zustand, PurchaseModal for Stripe checkout

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

**Test:** `npm test` (Mocha), `npm run lint`, `npm run prettier`

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

**BFL Flux AI:** Image generation via Firebase proxy (models: Flux Pro 1.1, Dev, Schnell) - https://docs.bfl.ai

**Firebase:** Auth, Firestore, Cloud Functions, Hosting

**Stripe:** Payment processing (createStripeSession, stripeWebhook)

**Analytics/Monitoring:** PostHog (analytics), Sentry (error tracking)

## Tech Stack

A-Frame master build (commit 6a054e8, loaded via CDN in index.html — required for Three.js r181 compatibility with the Spark splat library), Three.js r181, React 18.2.0, Zustand 5.0.1, Firebase 11.3.1, Webpack 5.91.0, TailwindCSS 3.4.14

## Resources

[User Docs](https://www.3dstreet.com/docs/) | [GitHub](https://github.com/3DStreet/3dstreet) | [Discord](https://discord.com/invite/zNFMhTwKSd) | [A-Frame Docs](https://aframe.io/docs/)

---

**Note:** This codebase is actively evolving. Please update this document when making significant changes!