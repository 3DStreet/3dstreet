# CLAUDE.md - 3DStreet Codebase Guide

## Project Overview

**3DStreet** is an open-source geospatial design application for creating urban planning scenes with detailed street configurations. It's a browser-based tool built on **three.js** and **A-Frame** that empowers users to rapidly prototype custom urban design scenarios using procedural street design tools combined with a rich library of accurately scaled 3D models.

**Key Features:**
- Built-in street generation templates
- Import from 2D Streetmix.net and StreetPlan.net cross-sections
- Real-world context through Google 3D Tiles, OpenStreetMap
- WebXR support for on-site Augmented Reality
- Cloud storage via Firebase
- Active global user base

**Application:** https://3dstreet.app
**Website:** https://3dstreet.com
**License:** AGPL-3.0 (code) / CC BY-NC 4.0 (assets)

---

## Architecture Overview

3DStreet has a **dual-architecture** design:

### 1. A-Frame Vanilla JS Application (`/src`)
- **Purpose:** Core 3D rendering engine and scene management
- **Technology:** A-Frame (built on three.js), vanilla JavaScript
- **Role:** Handles all geometry construction, 3D model loading, WebXR, camera controls, and scene rendering
- **Entry Point:** `src/index.js`

### 2. React Editor Application (`/src/editor`)
- **Purpose:** User interface and editing tools
- **Technology:** React 18, Zustand (state management), TailwindCSS, Sass
- **Role:** Provides UI for scene manipulation, property editing, file I/O, authentication, and cloud storage
- **Entry Point:** `src/editor/index.js`
- **Relationship:** Wraps around A-Frame scene, communicates via AFRAME.INSPECTOR global object and event system

### 3. Firebase Hosting & Functions (`/public`)
- **Purpose:** Deployment, cloud storage, serverless functions
- **Hosting:** Serves static files and SPA routing
- **Functions:** Scene storage/retrieval, Stripe payments, geoid calculations, WebXR variants, Replicate AI
- **Configuration:** `public/firebase.json`

---

## Directory Structure

```
3dstreet/
├── src/                          # Main source code
│   ├── index.js                  # A-Frame app entry point
│   ├── store.js                  # Zustand global state store
│   ├── assets.js                 # Dynamic asset loader for A-Frame
│   ├── aframe-streetmix-parsers.js  # Streetmix JSON parser
│   ├── street-utils.js           # Street utility functions
│   ├── segments-variants.js      # Segment type definitions
│   ├── catalog.json              # Asset catalog
│   │
│   ├── aframe-components/        # Custom A-Frame components
│   │   ├── street-segment.js     # Individual street segment component
│   │   ├── managed-street.js     # Managed street component
│   │   ├── intersection.js       # Intersection handling
│   │   ├── street-environment.js # Environment/skybox
│   │   ├── viewer-mode.js        # Camera/viewer controls
│   │   ├── street-generated-*.js # Procedural generation components
│   │   ├── google-maps-aerial.js # Google 3D Tiles integration
│   │   ├── geojson.js            # GeoJSON import
│   │   └── ... (30+ components)
│   │
│   ├── editor/                   # React Editor UI
│   │   ├── index.js              # Editor entry point (Inspector)
│   │   ├── instrument.js         # Sentry error tracking
│   │   │
│   │   ├── components/           # React components
│   │   │   ├── MainWrapper.js    # Top-level wrapper
│   │   │   ├── Main.js           # Main editor layout
│   │   │   ├── scenegraph/       # Scene hierarchy UI
│   │   │   ├── viewport/         # 3D viewport controls
│   │   │   ├── modals/           # Modal dialogs
│   │   │   ├── widgets/          # Property editors
│   │   │   └── elements/         # Reusable UI elements
│   │   │
│   │   ├── lib/                  # Editor libraries
│   │   │   ├── Events.js         # Event bus
│   │   │   ├── History.js        # Undo/redo system
│   │   │   ├── viewport.js       # Viewport management
│   │   │   ├── cameras.js        # Camera utilities
│   │   │   ├── shortcuts.js      # Keyboard shortcuts
│   │   │   ├── assetsLoader.js   # Asset loading
│   │   │   ├── location-sync.js  # Location state synchronization
│   │   │   └── commands/         # Command pattern for undo/redo
│   │   │
│   │   ├── services/             # External services
│   │   │   └── firebase.js       # Firebase configuration
│   │   │
│   │   ├── contexts/             # React contexts
│   │   ├── hooks/                # React hooks
│   │   ├── utils/                # Editor utilities
│   │   ├── api/                  # API integrations
│   │   ├── icons/                # Icon components
│   │   └── style/                # SCSS styles
│   │
│   ├── tested/                   # Unit-tested utility modules
│   │   ├── streetmix-utils.js
│   │   └── create-from-json-utils-tested.js
│   │
│   ├── styles/                   # Global styles
│   │   └── tailwind.css
│   │
│   ├── lib/                      # Third-party and first-party libraries
│   └── streetplan/               # Streetplan integration
│
├── public/                       # Firebase hosting root
│   ├── index.html                # Deployment copy (generated)
│   ├── firebase.json             # Firebase configuration
│   ├── firestore.rules           # Database security rules
│   ├── assets/                   # 3D models, textures, audio (copied from root)
│   ├── ui_assets/                # UI images, icons (copied from root)
│   ├── dist/                     # Built JS bundles (copied)
│   └── functions/                # Firebase Cloud Functions
│       ├── index.js              # Functions entry point
│       ├── geoid.js              # Geoid calculations
│       ├── token-management.js   # Auth tokens
│       ├── webxr-variant.js      # WebXR handling
│       ├── replicate.js          # Replicate AI integration
│       └── ...
│
├── test/                         # Unit tests (Mocha)
│   ├── streetmix-utils.test.js
│   ├── create-from-json-utils.test.js
│   └── ...
│
├── index.html                    # Development HTML (source)
├── package.json                  # Dependencies and scripts
├── webpack.config.js             # Development webpack config
├── webpack.prod.config.js        # Production webpack config
├── tailwind.config.js            # Tailwind CSS config
├── .firebaserc                   # Firebase project config
├── README.md                     # User-facing docs
├── EDITOR-README.md              # Editor-specific docs
├── CONTRIBUTING.md               # Contribution guidelines
└── CLAUDE.md                     # This file!
```

---

## Key Components and Systems

### A-Frame Components (src/aframe-components/)

#### Core Street Components
- **`street`** (`src/index.js`): Legacy component that processes street JSON and creates geometry
  - Schema: JSON, type, left/right buildings, showGround, showStriping, showVehicles, length
  - Used by: `streetmix-loader` component (older loading method)
  - Note: Being phased out in favor of `managed-street`

- **`streetmix-loader`** (`src/index.js`): Legacy loader that converts Streetmix.net URLs to A-Frame entities
  - Fetches from Streetmix API, converts units, applies to `street` component
  - Note: `managed-street` can now load Streetmix URLs directly

- **`managed-street`** (`managed-street.js`): **Replacement for `street` component** (preferred approach)
  - Directly creates and manages `street-segment` child entities
  - Supports loading from: `streetmix-url`, `streetplan-url`, or `json-blob` in Managed Street JSON format (https://www.3dstreet.com/docs/managed-street/managed-street-json-format/)
  - Features: Dynamic segment management, event system for changes, better organization
  - Can load Streetmix/StreetPlan data without need for separate loader components
  - Defines street length and automatically adds helper components:
    - `street-align`: Positions segments relative to entity origin (width: center/left/right, length: middle/start/end)
    - `street-ground`: Ground plane beneath the street
    - `street-label`: Optional text labels

- **`street-segment`** (`street-segment.js`): Individual segment (lane) within a street
  - Types: drive-lane, bike-lane, sidewalk, parking-lane, transit, divider, etc.
  - Handles variantString parsing and model placement, segment width

- **`intersection`** (`intersection.js`): Creates road intersections
  - Creates a 4-way intersection with right angles
  - Generates crossing markings and signals
  - Legacy component similar to `street` but its analogous `managed-intersection` equivalent does not yet exist

#### Procedural Generation Components
- **`street-generated-striping`**: Road markings, lane lines
- **`street-generated-stencil`**: Road stencils (arrows, bike symbols, lettering, etc.)
- **`street-generated-pedestrians`**: Procedural pedestrian placement
- **`street-generated-rail`**: Rail/tram tracks
- **`street-generated-clones`**: Repeated objects (trees, buildings, cars, etc.)

#### Geospatial Components
- **`street-geo`**: Places streets at real-world lat/lon coordinates
- **`google-maps-aerial`**: Loads Google 3D Tiles for context
- **`geojson`**: Imports GeoJSON features

#### Environment & Rendering
- **`street-environment`**: Skybox, lighting, fog (presets: day, night, sunny, etc.)
- **`street-ground`**: Ground plane with textures
- **`ocean`**: Water effects for waterfront scenes
- **`viewer-mode`**: Camera presets (orbit, fps, birds-eye, camera-path)

#### Utility Components
- **`create-from-json`**: Creates A-Frame entities from JSON array
- **`gltf-part`**: Manipulates parts of GLTF models
- **`screentock`**: Screenshot capture
- **`focus-animation`**: Camera focus transitions
- **`measure-line`**: Measurement tools
- **`street-label`**: Text labels in 3D space
- **`css2d-renderer`**: 2D HTML overlays in 3D space
- **`scene-timer`**: Scene timing/animation control

### React Editor Architecture (src/editor/)

#### Inspector System
The editor is built as an "Inspector" that wraps around the A-Frame scene:
- **Global Object:** `AFRAME.INSPECTOR` (defined in `src/editor/index.js`)
- **Main Class:** `Inspector` prototype with methods: `init`, `open`, `close`, `select`, `execute`, etc.
- **Communication:** Events (via `Events.js`) and direct A-Frame manipulation

#### Key React Components

**MainWrapper** (`components/MainWrapper.js`)
- Top-level component with AuthProvider, GeoProvider contexts
- Handles authentication state
- Shows appropriate modals (intro, signin, payment, etc.)

**SceneGraph** (`components/scenegraph/SceneGraph.js`)
- Left sidebar showing entity hierarchy
- Layer visibility toggles

**Toolbar** (`components/scenegraph/Toolbar.js`)
- Top toolbar with actions: Save, New Scene, Add Layer, Undo/Redo, etc.
- Recording controls (video capture)
- Viewer mode toggle

**PropertiesPanel** (in widgets/)
- Right sidebar showing properties of selected entity
- Component editors for A-Frame components
- Uses command pattern for undo/redo

**Viewport** (`components/viewport/`)
- 3D canvas interactions
- Transform gizmos (move, rotate, scale)
- Grid, helpers, selection outlines

#### State Management (src/store.js)

**Zustand Store** - Global application state:
```javascript
useStore.getState() // Access state
useStore.setState() // Update state
```

Key state properties:
- `sceneId`, `sceneTitle`, `authorId`, `locationString` - Scene metadata
- `projectInfo` - Project description, area, conditions, etc.
- `modal` - Currently visible modal
- `isInspectorEnabled` - Editor vs viewer mode
- `isGridVisible` - Grid visibility
- `isSavingScene`, `doSaveAs` - Save state
- `isRecording` - Video recording state
- `unitsPreference` - Metric vs imperial

Events emitted:
- `historychanged` - Triggers autosave
- `gridvisibilitychanged` - Grid toggle
- `entityselect` - Entity selection
- `objectselect` - Three.js object selection

The state of state:
- The use of Zustand Store in favor of legacy state management methods is not complete. Some state data is still referenced in local React components or A-Frame component attributes that would be more appropriately stored in and referenced from this Zustand Store.

#### Command System (src/editor/lib/commands/)

Implements command pattern for undo/redo:
- Each action is a Command class with `execute()` and `undo()` methods
- Commands: AddEntity, RemoveEntity, SetComponent, SetPosition, etc.
- History: `AFRAME.INSPECTOR.history.undo()` / `redo()`

Usage:
```javascript
AFRAME.INSPECTOR.execute('SetPosition', {
  entity: entityEl,
  position: { x: 0, y: 0, z: 0 }
});
```

### Asset Loading System (src/assets.js + catalog.json)

The asset system dynamically loads 3D models, textures, and other media into A-Frame's asset loader, making them available throughout the application.

#### How It Works

**1. Custom Element: `<street-assets>`**
- Sets base path for assets, default: `https://assets.3dstreet.app/`
- Defined in `src/assets.js` as a custom HTML element
- Automatically injected into `<a-assets>` block when scene loads
- Watches for `<a-scene>` creation using MutationObserver
- Usage: `<street-assets url="https://assets.3dstreet.app/" categories="vehicles buildings"></street-assets>`

**2. Mixin Generation (Two Sources)**

Assets are defined as A-Frame mixins from two sources:

**A. From `catalog.json`:**
- JSON array of asset metadata
- Dynamically converted to mixins during asset loading
- Mixins use "lazy loading" so assets only loaded when needed for specific scene model
- Provides richer metadata (thumbnails, names, descriptions, categories, attribution)
- Preferred loading method for all new assets
- Utilities in separate repo to generate some catalog.json data from gltf/glb files https://github.com/3dstreet/3dstreet-assets-dist?tab=readme-ov-file#cli-gtlfglb-processing-tools

**B. Hardcoded Models in `assets.js`:**

Legacy method to define each asset as HTML in JavaScript code. To be phased out in favor of using catalog.json. 

#### catalog.json Structure

Location: `src/catalog.json`

Each entry:
```json
{
  "id": "sedan-rig",           // Mixin ID (must be unique)
  "name": "Sedan",             // Display name in UI
  "src": "sets/vehicles-rig/gltf-exports/draco/toyota-prius-rig.glb", // Model path (relative to asset base)
  "img": "sets/vehicles-rig/gltf-exports/draco/toyota-prius-rig.jpg", // Thumbnail (relative to asset base)
  "category": "vehicles-rigged", // Category for grouping
  "description": "...",        // Optional description
  "attribution": "StreetPlan.net. Used with permission.", // Optional attribution
  "attributionUrl": "https://...", // Optional attribution link
  "baseRotation": 180,         // Optional default rotation for buildings
  "display": "none"            // Optional - hide from UI if "none"
}
```

**Legacy - Catalog entries for assets defined in assets.js:**
```json
{
  "id": "bus",
  "name": "Bus New Flyer XD40",
  "img": "thumbnails/bus.jpg"
}
```

**3. Category System**
- Every mixin has a `category` attribute
- Used for grouping in UI (Add Layer panel, model dropdowns)

#### How Assets Are Used in the UI

**1. Add Layer Panel** (`src/editor/components/elements/AddLayerPanel/`)
- Shows cards with thumbnails for available assets
- Organized by tabs (categories)
- User can click or drag-and-drop to add to scene
- Process:
  1. `getGroupedMixinOptions(true)` queries all `<a-mixin>` elements in DOM
  2. Matches mixin IDs with catalog.json entries to get metadata (name, img, description)
  3. Groups by category
  4. Renders cards with thumbnails from `catalog.json.img`
  5. On click/drop: creates `<a-entity mixin="mixin-id">` in scene

**2. Model Dropdown** (`src/editor/components/widgets/Mixins.js`)
- Right-hand properties panel when entity is selected
- Labeled "Model" in the properties
- Searchable dropdown showing all available mixins
- Grouped by category (collapsible sections)
- Process:
  1. `getGroupedMixinOptions(false)` queries mixins (without metadata for performance)
  2. Renders `react-select` dropdown
  3. On change: updates entity's `mixin` attribute

**3. Model Info Panel** (`src/editor/components/elements/MixinMetadata.js`)
- Shows metadata from catalog.json when entity has a single mixin
- Displays: name, ID, category, attribution (with link)
- Only shown if mixin is found in catalog.json
- Auto-updates when mixin changes

#### Global Access

Assets are exposed globally:
```javascript
// From assets.js:
STREET.catalog = catalog; // Array from catalog.json

// Accessing mixins in code:
const mixinEl = document.querySelector('#sedan-rig');
const mixinData = STREET.catalog.find(item => item.id === 'sedan-rig');
```

**Best Practices for New Models:**
- Use descriptive, unique IDs (avoid conflicts)
- Optimize models: Use Draco compression, keep poly count reasonable
- Provide good thumbnail images (square aspect ratio recommended)
- Use appropriate category for discoverability
- Add attribution for third-party assets
- Test in both Add Layer panel and Model dropdown

### Firebase Integration

#### Firestore Database
- **Collection:** `scenes`
- **Document structure:**
  ```json
  {
    "data": "...", // 3DStreet Scene JSON - array of entity objects with components and children
    "title": "...",
    "authorId": "...",
    "createdAt": timestamp,
    "updatedAt": timestamp
  }
  ```

#### Cloud Functions (`public/functions/`)
- **`getScene`**: Retrieves scene JSON by UUID
- **`createStripeSession`**: Initiates checkout
- **`stripeWebhook`**: Handles payment webhooks
- **`serveWebXRVariant`**: Generates WebXR-optimized HTML
- **`geoid`**: Calculates geoid height for elevation

#### Authentication
- Firebase Auth (Google, Email/Password)
- User claims for plan levels (PRO, etc.)
- Claims structure:
  ```json
  {
    "plan": "PRO"
  }
  ```

---

## Development Workflow

### Setup
```bash
git clone https://github.com/3DStreet/3dstreet.git
cd 3dstreet
npm install
```

### Environment Variables
Create `config/.env.development` (see `config/README.md`):
```
FIREBASE_API_KEY=...
FIREBASE_PROJECT_ID=...
# etc.
```

### Development Server
```bash
npm start                    # Starts webpack-dev-server on :3333
# Opens http://localhost:3333
```

### Building
```bash
npm run dist                 # Production build (uses .env.production)
npm run dist:staging         # Staging build (uses .env.development)
```

### Testing
```bash
npm run test                 # Run Mocha unit tests
npm run test:watch           # Watch mode
npm run lint                 # ESLint check
npm run lint:fix             # Auto-fix linting errors
```

### Formatting
```bash
npm run prettier             # Format all JS/JSX/SCSS files
```

### Firebase Deployment
```bash
npm run prefirebase          # Copy assets to public/
cd public
firebase use [PROJECT_ID]    # Select Firebase project
firebase deploy              # Deploy to Firebase
```

Or use shortcuts:
```bash
npm run deploy               # Deploy to production
npm run deploy:staging       # Deploy to staging
npm run emulator             # Run local Firebase emulator
```

---

## Important Patterns and Conventions

### A-Frame Component Lifecycle
```javascript
AFRAME.registerComponent('my-component', {
  schema: { ... },           // Component properties
  init: function() { ... },  // Called once when component is attached
  update: function(oldData) { ... }, // Called when properties change
  tick: function(time, deltaTime) { ... }, // Called every frame
  remove: function() { ... } // Called when component is detached
});
```

### Communicating Between A-Frame and React

**React → A-Frame:**
```javascript
// Set component property
entity.setAttribute('street', 'showVehicles', false);

// Execute Inspector command
AFRAME.INSPECTOR.execute('AddEntity', { entity: parentEl });
```

**A-Frame → React:**
```javascript
// Emit event
Events.emit('entityselect', entity);

// Update Zustand store
useStore.getState().setSceneTitle('New Title');
```

### Scene URL Hash Schemes

3DStreet supports multiple URL import formats:

| Hash Format | Example | Description |
|-------------|---------|-------------|
| Streetmix URL | `#https://streetmix.net/kfarr/3/demo` | Import from Streetmix.net |
| StreetPlan URL | `#https://streetplan.net/3dstreet/89241` | Import from StreetPlan |
| Cloud UUID | `#scenes/abc-123...` | Load scene from Firebase |
| Managed Street JSON | `#managed-street-json:{...}` | Inline JSON data |

Handled by: `src/aframe-components/street-mapping-streetplan.js`, `src/index.js`

### File Naming Conventions
- A-Frame components: `kebab-case.js` (e.g., `street-segment.js`)
- React components: `PascalCase.js` or `.jsx` (e.g., `MainWrapper.js`)
- Utilities: `kebab-case.js` (e.g., `street-utils.js`)
- Styles: `kebab-case.scss` or `.module.scss` for CSS modules

### Code Organization
- **A-Frame component code:** Lives directly in component `.js` file, registered with `AFRAME.registerComponent`
- **Tested utility functions:** In `src/tested/` with corresponding tests in `test/`
- **React component styles:** Either `.module.scss` (CSS modules) or global `.scss` imported in component

---

---

## Testing

3DStreet has limited test coverage. Tests use Mocha and are located in `test/`.

**Tested modules** (in `src/tested/`):
- `streetmix-utils.js` - Streetmix URL conversions, width calculations
- `create-from-json-utils-tested.js` - JSON entity creation utilities
- `aframe-streetmix-parsers.js` - Segment parsing (partial coverage)

**Running tests:**
```bash
npm run test           # Run all tests
npm run test:watch     # Watch mode
```

**Adding tests:**
1. If writing a new utility function, create it in `src/tested/`
2. Create corresponding test file in `test/`
3. Use Mocha syntax:
   ```javascript
   const assert = require('assert');
   describe('MyFunction', () => {
     it('should do something', () => {
       assert.equal(myFunction(input), expected);
     });
   });
   ```

**Approval tests:**
Located in `test/approvalTest/` - these test outputs against approved baseline files.

---

## External Integrations

### Streetmix.net
- **Purpose:** Import 2D street cross-sections
- **API:** `https://streetmix.net/api/v1/streets/[UUID]`
- **Component:** `streetmix-loader` in `src/index.js`
- **Utilities:** `src/tested/streetmix-utils.js`
- **Segment types:** See [Streetmix info.json](https://github.com/streetmix/streetmix/blob/master/assets/scripts/segments/info.json)

### StreetPlan
- **Purpose:** Alternative street import format
- **Component:** `street-mapping-streetplan` in `src/aframe-components/street-mapping-streetplan.js`
- **URL format:** `#https://streetplan.net/3dstreet/[ID]`

### Google 3D Tiles
- **Purpose:** Real-world building context
- **Component:** `google-maps-aerial` in `src/aframe-components/google-maps-aerial.js`
- **Library:** `3d-tiles-renderer` (via npm)

### Mapbox (deprecated?)
- **Component:** `aframe-mapbox-component` in `src/lib/`
- **Note:** May be replaced by Google 3D Tiles

### PostHog
- **Purpose:** Analytics
- **Setup:** `src/editor/index.js` and `src/editor/instrument.js`
- **Usage:** `posthog.capture('event_name', { properties })`

### Sentry
- **Purpose:** Error tracking
- **Setup:** `src/editor/instrument.js`
- **Package:** `@sentry/react`

### Stripe
- **Purpose:** Payment processing
- **Functions:** `public/functions/index.js` (createStripeSession, stripeWebhook)
- **Package:** `stripe` (npm)

### Replicate
- **Purpose:** AI model inference (for image generation)
- **Function:** `public/functions/replicate.js`

---

## Architecture Diagrams (Conceptual)

### Data Flow: User Edit → Scene Update
```
User interacts with React UI
  ↓
Action triggers Command (e.g., SetPosition)
  ↓
Command pushed to History (undo stack)
  ↓
Command executes: modifies A-Frame entity
  ↓
A-Frame component lifecycle (update, tick)
  ↓
Three.js renders updated geometry
  ↓
Event emitted: 'historychanged'
  ↓
Autosave triggered (if enabled)
  ↓
Scene saved to Firebase Firestore
```

### A-Frame Scene Component Hierarchy (Simplified)
```
<a-scene>
  ├── <a-assets> (dynamically injected by assets.js)
  │
  ├── #reference-layers (geospatial data)
  │
  ├── #environment (skybox, lighting)
  │   └── street-environment component
  │
  ├── #cameraRig (viewer)
  │   ├── #camera (A-Frame camera)
  │   ├── #leftHand (VR controller)
  │   ├── #rightHand (VR controller)
  │   └── #screenshot (screentock component)
  │
  └── #street-container (user layers)
      └── #default-street
          ├── street component
          ├── streetmix-loader component
          │
          └── (generated children)
              ├── .street-parent (contains segments)
              │   └── [street-segment] entities
              │       └── (3D models, geometry)
              │
              └── .buildings-parent (contains buildings)
                  └── [building] entities
                      └── (3D models)
```

---

## Resources and Links

### Official Documentation
- **User Docs:** https://www.3dstreet.com/docs/
- **GitHub Repo:** https://github.com/3DStreet/3dstreet
- **Discord:** https://discord.com/invite/zNFMhTwKSd

### Related Projects
- **A-Frame:** https://aframe.io/docs/
- **Three.js:** https://threejs.org/docs/
- **Streetmix:** https://streetmix.net/
- **Streetplan:** https://streetplan.net/
- **A-Frame Inspector:** https://github.com/aframevr/aframe-inspector (original fork source)
- **C-Frame Editor:** https://github.com/c-frame/aframe-editor/ (related project)

### Technologies Used
- **A-Frame:** 1.7.1 - WebVR/WebXR framework
- **Three.js:** 0.172.0 - 3D library
- **React:** 18.2.0 - UI library
- **Zustand:** 5.0.1 - State management
- **Firebase:** 11.3.1 - Backend services
- **Webpack:** 5.91.0 - Module bundler
- **TailwindCSS:** 3.4.14 - Utility CSS
- **PostHog:** Analytics
- **Sentry:** Error tracking

---

## Version History

Note -- 3DStreet does not use active versioning after combining the editor and core repos in 2024. Previously the core (A-Frame) repo had versioned NPM releases, but we no longer support developers using the 3DStreet A-Frame components directly in third-party applications.

- See [CHANGELOG.md](https://github.com/3DStreet/3dstreet/releases) for version history

---

## Please Update this Document

This codebase is actively developed and evolving. If you notice this guide is outdated or missing important information, please update it!