# Cities: Skylines vehicle UGC format — research & 3DStreet implications

Research notes investigating how Cities: Skylines (CS1, 2015) and Cities: Skylines II (CS2, 2023) handle player-created vehicle assets shared via Steam Workshop / Paradox Mods, what conventions they enforce around tire placement / wheelbase / textures / physics, whether those assets could be imported into 3DStreet, and what other UGC vehicle ecosystems (OMSI 2, Open Rails, Transport Fever 2, BeamNG, Assetto Corsa, SimReady) do that 3DStreet could learn from.

Status: research only — no code changes proposed in this document. The recommendations in §7 are inputs to a separate design discussion, framed for the in-flight `physics-play-mode` work.

---

## 1. Executive summary

The Cities: Skylines (CS1) vehicle UGC format is unusually elegant for our use case, because **the entire wheel-rigging system is a visual convention enforced by the importer, not a physics rig**. The key ideas are:

1. **Origin is at ground-plane center.** Wheels touch `y = 0`. This is not a suggestion — it's a hard requirement of the importer.
2. **Wheels are not named, not separate GameObjects, and not skinned.** They are *connected mesh islands whose vertices come within 5 cm of `y = 0`*. The importer auto-detects them, paints a unique per-wheel index into the green channel of each wheel-vertex's color, and the *Vehicle shader* spins each wheel-vertex around the auto-computed pivot at `velocity / wheel_radius`.
3. **Wheelbase is implicit** — it falls out of the wheel-island positions; there's no `wheelbase = 2.5m` field anywhere.
4. **Lights are pixel-encoded in the illumination texture** (`_i` map: `0` = turn signal, `128` = no behavior, `255` = headlight/taillight). No mesh dummies, no 3D positions.
5. **No physics simulation per wheel.** CS vehicles are spline-followers with bounding-box collisions. Wheels are decoration on top.
6. **Textures use a strict suffix convention** — `_d` (diffuse), `_n` (normal), `_s` (specular), `_i` (illumination), `_a` (alpha), `_c` (color variation mask). 3DStreet does not need to replicate this verbatim — glTF PBR handles most of it — but the *separation of concerns* is worth preserving (especially `_c`, the random-tint mask).
7. **The container format (`.crp`) is reverse-engineered and parseable**, with the well-known free tool **ModTools** doing in-game `.obj` + PNG extraction. A 3DStreet → CS importer is technically feasible; the binding constraint is **license**, not engineering.
8. **CS2 (2023) kept the same authoring conventions** (5 cm rule, vertex color paint, illumination-texture lights) but moved away from Steam Workshop to Paradox Mods and to a per-file pipeline (`.Prefab`/`.Geometry`/`.Surface`/`.Texture`/`.cok`). CS2's asset library is much smaller and the editor is still in beta. **CS1 is the higher-leverage target**.

For 3DStreet (A-Frame / Three.js / glTF, currently building Rapier-based vehicle physics on the `physics-play-mode` branch), the actionable takeaways are:

- CS already solved the "where do the wheels touch" problem with a single, hard rule (origin at ground-center). 3DStreet should adopt the same rule — and it largely does, but the convention is implicit, not enforced or validated.
- CS's "wheels are visual only" architecture is **closer to the legacy 3DStreet vehicle pipeline** (`wheel_F_L` / `_F_R` / `_B_L` / `_B_R` bone naming + speed-proportional rotation) than to the new Rapier raycast controller. The two pipelines can and should coexist: the visual wheel-spin convention is what shared UGC needs; the Rapier rig with per-wheel suspension is an editor-side feature for play mode.
- The most directly portable idea is **rich, declared metadata** — length, width, wheelbase, capacity, ground clearance, era, wheel radius, lights — carried inside the glb via the existing `KHR_xmp_json_ld` Khronos extension. This is the gap between 3DStreet's current `catalog.json` (good fields, but external to the model file and hand-maintained) and an open UGC pipeline (where third parties contribute glbs that need to declare their own metadata).
- A **"CS .crp → 3DStreet glb" importer is feasible**, but the only legally clean version is "bring your own ModTools-dumped `.obj` + textures and we'll convert it client-side." A server-side Workshop scraper is not viable.
- Beyond CS, the strongest cross-ecosystem patterns to steal are: **BeamNG's slot/preset architecture** (one vehicle rig, many livery/era/agency presets), **OMSI's text-sidecar `model.cfg`** (named animation points), and **SimReady's semantic node tags** (`role: "wheel.front_left"`, `"headlight"`, `"door.front"`).

---

## 2. How Cities: Skylines vehicle UGC actually works

### 2.1 Pipeline overview (CS1)

```
Blender / 3ds Max / Maya
  ↓  export
FBX (mesh) + PNG textures
  ↓  drop into %LocalAppData%\Colossal Order\Cities_Skylines\Addons\Import
In-game Asset Editor → New → Vehicle → choose AI template
  ↓  apply Y-up, rotate/scale fixups, attach trailers, set AI fields
.crp file saved to Addons\Assets
  ↓  Content Manager → Share
Steam Workshop
```

The Asset Editor wraps the user's source mesh inside Unity's runtime asset graph (Mesh + Texture2D + Material + GameObject + AI component + CustomAssetMetaData) and serializes the whole thing to a single `.crp` ("Colossal Raw Asset Package") binary container. Inside the `.crp`, textures are stored as compressed DDS, meshes as Unity-serialized vertex/index buffers — *not* FBX. The original FBX is consumed at import time and not preserved.

Sources: [cslmodding.info — Vehicle Asset Creation](https://cslmodding.info/asset/vehicle/), [Paradox Wiki — Asset Editor](https://skylines.paradoxwikis.com/Asset_Editor), [fileformats.archiveteam.org — Cities Skylines CRP](http://fileformats.archiveteam.org/wiki/Cities_Skylines_CRP), [github.com/LiamBrandt/crp-extract](https://github.com/LiamBrandt/crp-extract).

### 2.2 Mesh authoring rules

| Rule | Detail |
|---|---|
| File format | **FBX only** in practice (OBJ technically accepted but unreliable) |
| Units | Meters; export scale 1.0 |
| Orientation | Unity Y-up (Blender users need to compensate post-import) |
| Hierarchy | **Single mesh object** — no per-part nodes |
| Origin | **Ground-plane center**: X/Z = horizontal center, Y = 0 |
| Wheels | Geometrically separate islands, vertices within 5 cm of Y = 0, **not connected to body** |
| Vertex limit | Unity 16-bit index cap (~65k) — vanilla vehicles are ~500–1000 triangles |
| LOD | Optional `_LOD.fbx`; if absent the engine auto-generates < 50 tris |
| Skinning | Optional, used only for animated doors (bones + AnimationClip) |

The single most important rule for our purposes is the **origin convention**: the mesh origin is the point on the ground halfway between the wheels. This makes vehicle placement trivial for the engine — it just renders the model at the entity's world transform with no per-vehicle Y offset table. It also makes the 5-cm wheel-detection threshold meaningful.

### 2.3 The 5 cm rule and RGB vertex paint encoding

The crown jewel of the CS pipeline:

> *Continuously connected parts of the mesh (called elements) which are closer than 5 cm to 0 (ground) will be automatically detected as wheels.*

— [cslmodding.info — Vehicle Wheels shader](https://cslmodding.info/shader/vehicle-wheels/)

The importer scans the mesh for connected components ("islands") whose vertices touch the bottom 5 cm of the bounding volume, flags each one as a wheel, and writes vertex colors:

| Channel | Meaning |
|---|---|
| **Red** | 255 = "this vertex is part of a wheel" (will spin); 0 = static body |
| **Green** | Per-wheel index, stepped in increments of 8 (0, 8, 16, …, up to 32 wheels) — selects which slot in the `m_tyres` array this wheel reads from |
| **Blue** | No documented effect; conventionally 255 on body, varies on wheels |

For each detected wheel, the importer writes a `Vector4(x, y, z, diameter)` into `VehicleInfo.m_generatedInfo.m_tyres`, where (x, y, z) is the wheel pivot in vehicle-local coordinates and `diameter` is inferred from the island's bounding height. Ronyx69's well-known script for overriding these illustrates the exact data shape:

```csharp
asset.m_generatedInfo.m_tyres = new Vector4[] {
    new Vector4(-0.739f, 0.328f,  1.421f, 0.328f),  // FL: x, y, z, diameter
    new Vector4( 0.739f, 0.328f,  1.421f, 0.328f),  // FR
    new Vector4(-0.739f, 0.331f, -1.93f,  0.331f),  // RL
    new Vector4( 0.739f, 0.331f, -1.93f,  0.331f),  // RR
};
```

At runtime, the **Vehicle shader** reads each vertex's (red, green) channels and the `m_tyres` array. For any vertex with red = 255, the shader rotates that vertex around `m_tyres[green/8].xyz` (the wheel pivot) at an angular velocity proportional to `vehicleVelocity / m_tyres[green/8].w` (wheel radius). Front-slot wheels also receive a steering Y-rotation.

**What this means in practice:**

- No `Wheel_FL` / `Wheel_FR` naming convention — the game doesn't read object names.
- Multi-axle vehicles (buses, semi-trucks, locomotives with up to 32 wheels) are handled by just adding more wheel islands.
- Wheel radius isn't declared anywhere — it's measured from the geometry.
- Wheelbase isn't declared anywhere — it falls out of the (z) coordinates of the front vs. rear wheel pivots.
- Wheels welded to the body cause the whole body to spin — a common newbie error documented in `Need help making vehicle asset (solved)` on Simtropolis.
- A modder can manually paint vertex colors to override the detector — useful for helicopter skids, hover vehicles, or invisible wheel decoys.

This is **the most elegant solution to the wheel-rigging problem I've seen in any UGC vehicle ecosystem.** It trades 5 cm of mesh-authoring discipline for zero runtime metadata, zero naming-convention fragility, and zero per-vehicle config files.

Sources: [cslmodding.info — Vehicle Wheels shader](https://cslmodding.info/shader/vehicle-wheels/), [Ronyx69 tire-parameters gist](https://gist.github.com/ronyx69/b2a53cce3a02b22ab4f425b95bf0825a), [Simtropolis thread 74360](https://community.simtropolis.com/forums/topic/74360-need-help-making-vehicle-asset-solved/).

### 2.4 Textures (CS1)

All textures live next to the FBX, share the basename, and use suffixes:

| Suffix | Purpose | Channel notes |
|---|---|---|
| `_d` | Diffuse / albedo | RGB |
| `_n` | Normal map (tangent space) | RGB |
| `_s` | Specular mask | Grayscale; 0–95 % matte→shine, 80–90 % metal, ~100 % glass/transparent |
| `_i` | Illumination / emissive | Grayscale; **0 = turn signal, 128 = no behavior, 255 = headlight/taillight** |
| `_a` | Alpha mask | Grayscale |
| `_c` | **Color variation mask** | Grayscale; white pixels get multiplied by a random per-instance tint |

LOD textures are parallel with `_lod_` prefix (note the casing inconsistency: `_LOD` on the mesh, `_lod` on textures). Standard sizes are 1024² main, 128² LOD; all main textures of one asset must share resolution. PNG input is converted to DXT-compressed DDS inside the `.crp`.

The most useful idea here for 3DStreet:

- **Illumination map encoding** — the trick of using pixel values to mark "this region is a turn signal, this region is a headlight" is dense and works without any mesh metadata. glTF's `emissiveTexture` plus a custom shader could do the same.
- **`_c` color variation mask** — this is *why* CS sedans come in red, blue, green, white from the same model. 3DStreet currently ships separate `sedan-rig`, `sedan-taxi-rig`, etc. mixins; a single sedan with a paint-region mask and a color picker would be far more flexible. (This is already implicit in glTF base-color + vertex colors / a paint-mask texture, but no 3DStreet vehicle today uses the technique.)

Sources: [Steam guide 500036497 — Texturing & Asset Creation 101](https://steamcommunity.com/sharedfiles/filedetails/?id=500036497), [Steam guide 524027632 — Illumination Map Value Overview](https://steamcommunity.com/sharedfiles/filedetails/?id=524027632).

### 2.5 Lights, doors, articulation, effects

| Feature | CS mechanism |
|---|---|
| **Headlights / taillights / turn signals** | Pixel-encoded in `_i` texture; light cone effects positioned in Asset Editor |
| **Particle effects, exhaust, sirens, sounds** | Not native — handled by the **Vehicle Effects** community mod via per-asset XML (`VehicleEffectsDefinition.xml`) |
| **Doors, articulation joints, antennae** | Skeletal bones + AnimationClip in the FBX |
| **Trailers / multi-car trams** | `VehicleInfo.m_trailers` — array of asset references; per-vehicle `m_attachOffsetFront` / `m_attachOffsetBack` Z-offsets in meters declare spacing. No physical joints. |
| **Sub-mesh variants** (loaded vs empty truck, LHD bus, emergency states) | Multiple optional FBXes attached in the Asset Editor; tagged with flags from a fixed enum (`Created, Spawned, Emergency1, Emergency2, Flying, Landing, LeftHandDrive`, …) and shown/hidden based on vehicle state |

The articulated-bus / multi-car-train pattern is worth calling out: **CS represents articulation as a chain of asset references with Z-offsets, not as joints**. Each segment of an articulated bus is its own `VehicleInfo` asset with its own wheels; the lead vehicle declares "behind me at z = -7.5 m comes asset X." This is conceptually identical to how 3DStreet's `managed-street-traffic` currently handles multi-vehicle convoys (separate entities, no joints).

Sources: [cslmodding.info — Vehicle Asset Creation](https://cslmodding.info/asset/vehicle/), [Extended Asset Editor mod](https://steamcommunity.com/sharedfiles/filedetails/?id=800820816), [Vehicle Effects mod (GitHub)](https://github.com/Acc3ssViolation/VehicleEffects).

### 2.6 Physics: there isn't any

Per Colossal Order's own [Game Developer "Deep Dive" on Cities: Skylines traffic](https://www.gamedeveloper.com/design/game-design-deep-dive-traffic-systems-in-i-cities-skylines-i-), vehicles are *"simple physics objects which use a velocity and multiple target points along the spline they wish to follow."* They have kinematic velocity, basic AABB collision response for accidents, and no per-wheel forces, no suspension simulation, no friction model.

This is the **second-most important finding** for 3DStreet. CS's entire visual wheel-rigging machinery exists so that purely-kinematic vehicles look like they have physics. The wheels spin at the right rate (`velocity / radius`), turn at the right angle, sit at the right ground contact — *and never carry any load*. The game can ship 200 distinct UGC vehicle types and run thousands of them at once on a CPU budget because none of them need a real wheel-collider rig.

3DStreet's `physics-play-mode` branch is doing something different (full Rapier raycast controller with per-wheel suspension on the player vehicle, kinematic-position bodies on traffic). That's the right choice for *the driveable* — interactive driving needs real physics — but for *the catalog of UGC vehicles*, CS's visual-only model is what 3DStreet should expose to contributors. The same glb can be a kinematic traffic actor today and a Rapier-physics driveable tomorrow without any mesh changes, as long as the visual contract (origin at ground-center, wheels detectable) is consistent.

### 2.7 CS2 (2023) — what changed

- **Same authoring rules** for vehicles: 5 cm wheel detection, RGB vertex paint, `_d/_n/_s/_i/_a/_c` textures (now framed as PBR), origin at ground-plane center.
- **Different on-disk format**: split into `.Prefab` (manifest) + `.Geometry` (mesh) + `.Surface` (material) + `.Texture` (texture) + `.loc` (i18n), packaged into a `.cok` for distribution. Each asset also requires a CID (Component Identifier) file.
- **Different distribution**: **Paradox Mods**, not Steam Workshop. No anonymous download equivalent of `steamcmd`; downloads require a Paradox account.
- **In-engine asset editor** rather than a stripped-down Unity inspector.
- **Vehicle asset editor was still in beta as of late-2025 patch notes** — the asset library is much smaller than CS1's 10-year backlog.

For an importer: **CS1 remains the higher-value target** through at least 2026. Revisit CS2 once Paradox Mods stabilizes and the asset library grows.

Sources: [cs2.paradoxwikis.com — Asset Creation Guide](https://cs2.paradoxwikis.com/Asset_Creation_Guide), [cs2.paradoxwikis.com — Assets: Importing](https://cs2.paradoxwikis.com/Assets:_Importing), [cs2.paradoxwikis.com — Assets: Package, Share and Upload](https://cs2.paradoxwikis.com/Assets:_Package,_Share_and_Upload), [paradoxinteractive.com — Adding Custom Assets](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/adding-custom-assets), [colossalorder.fi dev diary](https://colossalorder.fi/?p=3214).

---

## 3. The `.crp` container and extraction tools

### 3.1 Structure

`.crp` is a single-file binary holding a sequence of "sections," each headed by a one-byte type tag and a length-prefixed Pascal-style identifier string. Known type bytes (from [LiamBrandt/crp-extract](https://github.com/LiamBrandt/crp-extract)):

| Byte | Type |
|---|---|
| `0x53` | `Assembly-CSharp` |
| `0x54` | `UnityEngine.Mesh` |
| `0x57` | `BuildingInfoGen` |
| `0x58` | `UnityEngine.Material` |
| `0x59` | `UnityEngine.Texture2D` |
| `0x5A` | `UnityEngine.GameObject` |
| `0x5B` | `CustomAssetMetaData` |
| `0x69` | `ColossalFramework.Importers.Image` (PNG/DDS) |

A vehicle `.crp` typically contains 1 main + 1 LOD `Mesh`, several `Texture2D`/`Image` per LOD per map type, a `Material`, a `GameObject` wiring it all up with a `VehicleInfo` + AI component, and a `CustomAssetMetaData` blob (name, author, thumbnail, tags, dependencies).

### 3.2 Available tools

| Tool | Approach | Best for |
|---|---|---|
| **ModTools** (BloodyPenguin/nlight, in-game C# mod) | Runtime: dumps any loaded asset to `Addons/Import/` as `.obj` + PNG split by suffix | The de facto standard — produces ready-to-blend output, requires CS install |
| **crp-extract** (Python, Liam Brandt) | Offline section walker | Textures (DDS/PNG come out raw); meshes are left as unparsed binary |
| **CrpViewer** (Auskennfuchs) | GUI viewer | Inspection |
| **Crper** (unera.se/crper/, browser) | Web-based extractor | Lighter-weight than ModTools but Chrome-only |
| **UABE** (Unity Asset Bundle Extractor) | Generic Unity asset tool | Vanilla `sharedassets*.assets` (EULA-encumbered content) |

The gap in open-source tooling is the **`0x54` mesh section deserializer** — no open tool today fully converts a `.crp` mesh into a portable format without going through ModTools' in-game runtime. This is a tractable but non-trivial reverse-engineering job (a few weeks of work).

---

## 4. Importer feasibility: can 3DStreet load CS vehicles?

The technical answer is yes; the legal answer is "carefully." Three options, in increasing risk:

### Option A — Bring-your-own-OBJ (recommended)

User runs ModTools in their own CS install, dumps the asset to `.obj + _d.png + _n.png + …`, drops the result into a 3DStreet import dropzone. 3DStreet converts client-side (OBJ → glTF via three.js `OBJLoader` + `GLTFExporter`, apply axis flip, anchor wheels to y=0, bake texture-suffix conventions into glTF PBR materials).

- **Pros:** No legal exposure (user owns the extraction). No CRP parsing. ~1 week of engineering.
- **Cons:** Requires the user to own and install CS. Real friction for 3DStreet's pure-browser audience.

### Option B — Client-side `.crp` upload (possible, with mitigations)

User uploads a `.crp` they personally subscribed to. 3DStreet parses it in-browser, extracts textures (mostly free), deserializes the mesh, emits glTF, never stores it server-side, surfaces Workshop attribution metadata, requires an "I have permission to redistribute" checkbox before the resulting glb can be saved to a public scene.

- **Pros:** No CS install required. Full automation.
- **Cons:** ~2–4 weeks of engineering (mesh deserialization is the long pole). Legal risk surface is real but bounded — same posture as a desktop file converter. Per-creator copyrights on individual meshes still apply; some Workshop creators explicitly forbid redistribution.

### Option C — Server-side Workshop browser (not viable)

Pre-ingest Workshop CRPs, convert to glTF, serve from 3DStreet's CDN as a built-in vehicle library.

- **Pros:** Best UX.
- **Cons:** Almost certainly violates the [Steam Workshop Subscriber Agreement](https://steamcommunity.com/workshop/workshoplegalagreement/) (the license is to *use in the relevant game*, not redistribute). Bypasses individual creator copyrights. Paradox's mod policy gives them a colorable claim on the entire derivative pipeline. Not worth the long-term liability.

**Recommendation: ship A first as a 1-week MVP. Add B in a later phase with the mitigations above and a clear ToS clause. Never ship C.**

The hardest part of any of these is not coordinate-system conversion (Unity Y-up left-handed forward=+Z → three.js Y-up right-handed forward=−Z is a single mirror flip + 180° yaw, well-trodden). It's mapping CS's texture suffix convention — especially `_s` specular and `_c` color mask — onto glTF PBR metallic-roughness. The `_s` channel can be approximated by setting metallic and roughness factors from its grayscale value; `_c` needs to be preserved as a side-channel texture and used by a custom 3DStreet shader for instance tinting (or baked into a per-instance base-color variant if we don't want a custom shader).

Sources: [Steam Workshop Legal Agreement](https://steamcommunity.com/workshop/workshoplegalagreement/), [Paradox mod policy](https://legal.paradoxplaza.com/mod-policy), [cslmodding.info — Dump & Extract Assets](https://cslmodding.info/dump/), [PCGamesN 2024 DMCA-storm report](https://www.pcgamesn.com/cities-skylines-2/mods-dmca) (informative on Paradox's posture: they "declined to comment" on third-party-tool takedowns, but have never themselves attacked extraction tools).

---

## 5. Comparable UGC vehicle ecosystems

Brief survey of what other communities do well or badly. Full sources at the end.

| Ecosystem | Origin convention | Wheels | Metadata sidecar | Curation |
|---|---|---|---|---|
| **Cities: Skylines** (Unity) | Ground-center, Y=0 | 5 cm rule + RGB vertex paint; auto-detect | In-package `VehicleInfo` AI block; mod XML for effects | Workshop public, community-policed |
| **OMSI 2** (bus sim) | Street-level, Z=0, Z-up | Named meshes (`Wheel_VL`), named animation axes (`Axle_Steering_0_L`) | `model.cfg` text + `.bus` config | High — famously rigorous, 1:1 scale Berlin maps |
| **Open Rails / MSTS** (trains) | Y-up, meters | Explicit `ORTSNumberAxles`, `ORTSLengthBogieCentre` | `.wag` / `.eng` text | High |
| **Transport Fever 2** | Y-up, meters | Lua: `wheels = {…}` + parallel `wheelRadii = {…}` arrays in meters | `.mdl` Lua file with capacity, era, country, top speed | Moderate (API-curated) |
| **Simutrans / OpenTTD** | 2.5D sprite | n/a | `.dat` text with `length=` in tiles | Pakset maintainers reject off-scale submissions |
| **BeamNG.drive** | Z-up, meters, kg | JBeam `pressureWheels` over node-pair axles | JBeam + `.pc` preset + `.info` (name/era/thumb) | Very high |
| **Assetto Corsa / rFactor 2** | Y-up, meters | Named hardpoints: `WBCAR_BOTTOM_FRONT`, `WBTYRE_STEER`, etc. | `car.ini`, `suspensions.ini`, `tyres.ini` | High |
| **Unreal Engine** | Z-up, cm | Standard `FL/FR/RL/RR` bones, X forward Z up | Blueprint | Moderate |
| **SimReady (USD)** | Y-up, meters | Q-coded semantic node labels | USD metadata + USDPhysics + validator | Validator-enforced |
| **glTF + KHR_xmp_json_ld** | (glTF default) | n/a | JSON-LD blob inside the glb | None platform-side; per-publisher |
| **SketchUp 3D Warehouse** | Inconsistent | Inconsistent | None | **None — cautionary tale** |

The strongest ideas, ranked by applicability to 3DStreet:

1. **CS: origin convention + 5 cm wheel rule.** Solves the placement and rigging problem in one stroke. Adopt the origin rule wholesale; the 5 cm rule is too implicit for a glTF tool — see §6 for the glTF-native equivalent.
2. **OMSI: named animation points in a sidecar.** A small text/JSON manifest that says "this node is the steering axle, this is the front-left wheel, this is the destination sign" lets a downstream tool (or 3DStreet's editor) animate, swap, or attach things without re-rigging. glTF's `extras` field is the obvious carrier.
3. **BeamNG: slot/preset pattern.** Define a base rig once, ship many `.preset.json` variants that swap livery, signage, era, transit agency. Collapses "we need 30 city bus models" to "one bus + 30 presets." 3DStreet's `vehicle-mesh-slot` pattern on the `physics-play-mode` branch is the seed of this; extending it to UGC contributors would be high-leverage.
4. **SimReady: semantic node tags + validator.** `role: "wheel.front_left"`, `"headlight"`, `"door.front"`, `"coupler"`, `"destination_sign"` — small, opt-in, and unlocks downstream automation (animated doors, dynamic livery, trailer hookup, lane-keeping center inference). Ship a validator CLI alongside the spec — this is what turns a convention into a community standard.
5. **KHR_xmp_json_ld: standardized metadata carrier.** Don't invent a new file format; embed a `3DSTREET_vehicle` JSON-LD context inside the glb. This is the standards-aligned move and means a 3DStreet-compliant vehicle is *just a glTF* — readable by Sketchfab, Blender, Unreal, USD pipelines, etc.
6. **Open Rails / Transport Fever 2: declared dimensions beat measured ones.** A `lengthMeters = 12.5` field is more reliable than a renderer trying to infer it from a bounding box. CS's choice to *measure* wheelbase from geometry is elegant but only works because CS controls the rendering pipeline; for an interop format, declare explicitly.
7. **SketchUp 3D Warehouse: anti-pattern.** No enforced units, no scale convention, no curation → users can't trust anything. Every other ecosystem above curates somehow. 3DStreet must too — even one mandatory `length_m` field plus a thumbnail-with-ruler would prevent the worst.

Sources (selected): [cslmodding.info](https://cslmodding.info/asset/vehicle/), [reboot.omsi-webdisk.de — Vehicles in OMSI](https://reboot.omsi-webdisk.de/wiki/entry/29-vehicles-in-omsi/), [open-rails.readthedocs.io — Physics Manual](https://open-rails.readthedocs.io/en/1.5.1/physics.html), [wiki.transportfever2.com — Vehicle Types](https://wiki.transportfever2.com/doku.php?id=modding:vehicletypes), [documentation.beamng.com — JBeam Syntax](https://documentation.beamng.com/modding/vehicle/intro_jbeam/jbeamsyntax/) and [Part/Slot system](https://documentation.beamng.com/modding/vehicle/intro_jbeam/partslotsystem/), [assettocorsamods.net — First Car Tutorial](https://assettocorsamods.net/threads/your-first-car-in-assetto-corsa-basic-guide.1019/), [docs.omniverse.nvidia.com — SimReady Specification](https://docs.omniverse.nvidia.com/simready/latest/overview/simready-spec.html), [github.com/KhronosGroup/glTF — KHR_xmp_json_ld](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_xmp_json_ld/README.md), [forums.sketchup.com — 3D Warehouse models and scale](https://forums.sketchup.com/t/3d-warehouse-models-and-scale/341756).

---

## 6. Where 3DStreet sits today

Surveying the current code:

- `catalog.json` has two vehicle categories: **`vehicles-rigged`** (~14 models including `sedan-rig`, `box-truck-rig`, `bus`, etc.) and **`cyclists`** (~9). All hosted as Draco-compressed glb on `assets.3dstreet.app`.
- The catalog entry has only `id`, `name`, `src`, `img`, `category`, `attribution` — no length, width, wheelbase, capacity, era, class.
- Per-vehicle dimensional metadata (length, width, wheel diameter) is **hardcoded in `aframe-streetmix-parsers.js`** as the `carParams` table, keyed by Streetmix variant name. This is *outside* the asset and not contributor-editable without a PR.
- Wheel animation uses a strict **named-bone convention**: meshes must contain `wheel_F_L`, `wheel_F_R`, `wheel_B_L`, `wheel_B_R`, plus optional `wheel_B_L_2` / `wheel_B_R_2` for dual rear wheels. The `wheel` A-Frame component rotates these by `2 * speed / wheelDiameter`. Documented in `README_vehicle-wheel-animation.md` at the repo root.
- The `physics-play-mode` branch adds a *parallel* pipeline for driveable vehicles using Rapier raycast vehicle controllers. Each preset (`tuk-tuk`, `delivery-bot`, `taxi`) bundles chassis dimensions, engine/brake/steer params, and wheel dimensions. A `vehicle-mesh-slot` child entity decouples physics rig from visual mesh, allowing either a catalog mixin or a procedural component to fill the slot. Very recent commits work out off-by-wheel-radius and chassis-Y-offset issues, plus a US-6-inch (0.15 m) curb height for sidewalk slabs.

The current state is **a coherent first cut** but is fragile in the same way CS's approach explicitly avoided being fragile: 3DStreet's vehicle metadata is split across three places (catalog.json, `carParams` in JS, hardcoded wheel-bone names in the model), and there's no way for a UGC contributor to publish a vehicle without modifying core 3DStreet code.

Comparing 3DStreet's current convention with CS's, line by line:

| Concern | Cities: Skylines | 3DStreet (current) |
|---|---|---|
| Origin | Ground-plane center, Y=0 | Implicit (varies per model); recent `physics-play-mode` commits added an explicit "mesh Y offset" to compensate |
| Wheel identification | Geometric (5 cm rule) + RGB vertex paint | Named bones (`wheel_F_L` etc.) |
| Wheel radius | Measured from geometry | Declared in `carParams` JS, separate from the model |
| Wheel rotation rate | Shader: `velocity / diameter` | A-Frame component: `2 * speed / diameter`, applied to each named bone |
| Wheelbase | Implicit from wheel positions | Not declared anywhere; not used for animation |
| Multi-axle | Just more wheel islands | `wheel_B_L_2` / `wheel_B_R_2` extension |
| Lights | `_i` texture pixel encoding | Not handled (vehicles don't have lights yet) |
| Articulation / trailers | `m_trailers` array + offset metadata | Not handled |
| Color variation | `_c` mask + per-instance tint | Separate `sedan-taxi-rig` mixins for each color |
| Physics | None (kinematic + AABB) | None for traffic; Rapier raycast for `physics-play-mode` driveable |
| Metadata location | Inside `.crp` + AI fields | Split: `catalog.json`, `carParams` JS, README |
| Curation | Steam Workshop, community-policed | Curated by 3DStreet team; no UGC pipeline exists |

3DStreet's current convention is **closer to Unreal's `FL/FR/RL/RR` rig** than to CS's vertex-color trick — which is more discoverable (a modeler can immediately see what's happening in Blender's outliner) and easier to extend (steering wheel, axle indicators, doors can be named alongside wheels).

But there are two real-world constraints that push back hard on a names-only approach:

1. **glb optimization pipelines strip node names.** Draco compression and `gltfpack` both default to dropping names; even tools that preserve them often rename for deduplication. 3DStreet has hit this in practice — purposefully named wheel nodes have been lost downstream of authoring. A names-only convention is fragile against the asset pipeline 3DStreet already uses.
2. **AI-generated meshes won't follow our naming convention.** Rodin, Tripo, Hunyuan3D, and similar text/image-to-mesh tools produce ground-centered vehicles with separated wheel geometry — but with arbitrary node names like `mesh_0`, `wheel`, or nothing at all. As more 3DStreet vehicles come from AI generation rather than hand-authored Blender exports, names-only fails open (no animation) by default.

Together these argue for **geometric detection as the primary mechanism, with named nodes as an optional fast-path hint** — the inverse of the current convention. CS's 5 cm rule survives both constraints because it depends only on vertex positions, which compression preserves and AI tools produce correctly.

---

## 7. Recommendations for 3DStreet's UGC vehicle convention

The following are research-derived suggestions; they're inputs to a design discussion, not a finalized spec. They're ordered from highest leverage / lowest cost to most ambitious.

### 7.1 Codify and validate the placement convention

Adopt CS's **origin = ground-plane center, wheels touch Y=0** as a hard rule and:

- Document it as the canonical convention in `README_vehicle-wheel-animation.md` (currently silent on origin).
- Add a one-page validator in the existing `src/tested/` style that loads a glb and checks: forward axis, ground contact, unit scale (meters), presence of expected wheel nodes.
- Surface the validator both as a CLI (for asset-pack contributors) and as a soft-warn in the 3DStreet drag-and-drop glb importer (the `dragndropglb` branch).

This is one of the lowest-cost moves and addresses the SketchUp-3D-Warehouse failure mode directly.

### 7.2 Embed dimensional metadata inside the glb

Stop maintaining vehicle dimensions in `carParams` JS. Move them into the glb itself via the standard `KHR_xmp_json_ld` extension, with a custom JSON-LD context:

```json
{
  "@context": {
    "3dstreet": "https://3dstreet.app/vendor/vehicle/1.0/"
  },
  "3dstreet:class": "sedan",
  "3dstreet:lengthMeters": 5.17,
  "3dstreet:widthMeters": 2.0,
  "3dstreet:heightMeters": 1.45,
  "3dstreet:wheelbaseMeters": 2.7,
  "3dstreet:wheelDiameterMeters": 0.76,
  "3dstreet:passengerCapacity": 5,
  "3dstreet:eraStart": 2015,
  "3dstreet:region": "US",
  "3dstreet:groundClearanceMeters": 0.15
}
```

`carParams` becomes a fallback for older models without metadata. The glb is self-describing, can be re-published outside 3DStreet, and benefits from a real Khronos standard that Sketchfab, USD, Blender, etc. understand.

### 7.3 Adopt semantic node `extras` for non-wheel parts

Extend the existing wheel-naming convention with a semantic-role `extras` tag pattern, taking the SimReady idea but using glTF-native `extras`:

```json
// per-node extras
{ "role": "wheel.front_left",  "radiusMeters": 0.38 }
{ "role": "wheel.front_right", "radiusMeters": 0.38 }
{ "role": "wheel.rear_left",   "radiusMeters": 0.38 }
{ "role": "wheel.rear_right",  "radiusMeters": 0.38 }
{ "role": "steering_wheel" }
{ "role": "headlight.left" }
{ "role": "headlight.right" }
{ "role": "destination_sign", "defaultText": "Downtown" }
{ "role": "door.front_right", "openAngleDeg": 75 }
{ "role": "coupler.rear", "offsetMeters": -2.5 }
```

This generalizes the current bone-name convention to anything the vehicle has, and unlocks downstream features (animated doors, dynamic destination signs for transit, trailer attachment, livery customization) without changing the glb format.

For wheels specifically, this also stores `radiusMeters` *on the node* rather than in external JS, eliminating the wheel-diameter duplication.

### 7.4 Use BeamNG-style presets to collapse the catalog

The catalog currently ships separate mixins for `sedan-rig`, `sedan-taxi-rig`, `self-driving-cruise-car-rig`, `self-driving-waymo-car`. Most of these are the same sedan with different liveries / signage.

Borrowing BeamNG: define **one** sedan glb with slot nodes (`role: "livery"`, `role: "rooftop_accessory"`, `role: "destination_sign"`) and ship `.preset.json` files (or extend `catalog.json` entries with a `preset` field):

```json
{
  "id": "sedan-taxi",
  "name": "Taxi Sedan",
  "baseAsset": "sedan-rig",
  "preset": {
    "livery": { "baseColor": "#f4c020", "rooftopMixin": "taxi-sign" },
    "destination_sign.text": "TAXI"
  }
}
```

This is conceptually similar to the `physics-play-mode` `vehicle-mesh-slot` pattern, but extended to *visual* slots inside the mesh, not just whole-mesh swapping.

### 7.5 Treat the visual-wheel-spin contract as separate from physics

CS's biggest insight is that *every UGC vehicle in the catalog is purely visual*. The vehicle author doesn't think about physics — they author a mesh, the engine spins the wheels visually.

For 3DStreet:

- Keep the existing named-wheel-bone convention (`wheel_F_L`, etc.) plus the proposed `extras.radiusMeters` as the **portable, shared UGC contract**. Any glb in the 3DStreet catalog, whether shipped by the team or contributed externally, follows this.
- The Rapier-based `physics-play-mode` rig is a **per-preset overlay** on top of the catalog. The preset knows the chassis dimensions, the engine params, the per-wheel anchor points — but it doesn't *change* the underlying glb. A new driveable preset is a JSON file plus a chosen catalog mixin.
- **Wheel detection is shared across all callers; the actuator splits by caller.** Three concrete cases:
  - Path mode traffic (`managed-street-traffic` without drive-controls): wheel-spin component derives angular velocity from the entity's positional delta.
  - Physics mode kinematic traffic: same wheel-spin component — the chassis pose still moves frame-to-frame via `setNextKinematicTranslation`, so the per-wheel spin rate is the same `velocity / radius` calculation.
  - Physics mode dynamic player vehicle (Rapier raycast vehicle controller): Rapier already produces per-wheel suspension translation, spin X-rotation, and steering Y-rotation. The detected wheel sub-meshes are bound directly to Rapier's per-wheel transform outputs and the wheel-spin component is *not* applied (would double-rotate).

This keeps the catalog stable as physics evolves, lets play-mode driveable vehicles inherit from regular catalog vehicles, and means a UGC contributor doesn't need to understand Rapier to ship a vehicle.

### 7.6 Ship a CS / OMSI / general-glb importer at the drag-and-drop level

The `dragndropglb` branch already exists for ad-hoc glb import. Extend it with:

- **Auto-detect wheels** via the 5-cm rule on uploaded glbs that don't have named wheel nodes. Then write the node names + `extras.radiusMeters` back into the glb. This is the CS heuristic ported into client-side JS — useful when accepting glbs from Sketchfab or Blender that lack 3DStreet conventions.
- **Convert .obj + texture-suffix bundle** (the ModTools dump format) to glb. This is the "Option A" CS importer from §4: no CRP parsing, no legal exposure, ~1 week of engineering. Surfaces a "Convert from Cities: Skylines (ModTools dump)" affordance in the importer UI.
- **Stretch goal: client-side `.crp` parsing.** ~2–4 weeks of work, with the mesh deserializer as the long pole. Add later, gated on user demand and an attribution / "I have permission" gate.

### 7.7 Publish the spec and an export template

OMSI's Blender-O3D-IO plugin and Transport Fever 2's wiki are the strongest predictors of catalog quality in their respective ecosystems. 3DStreet should publish:

- A versioned spec page (in `docs/` or on 3dstreet.com): origin convention, axis/units, expected node roles, KHR_xmp_json_ld schema.
- A Blender starter file with the convention pre-rigged (empty parented placeholders for `wheel_F_L`, etc., a ground plane at Y=0).
- The validator CLI from §7.1, as `npx @3dstreet/validate-vehicle bus.glb`.
- A small gallery of "reference compliant" vehicles in the existing assets repo.

This is what turns the spec from "internal convention" into "a community can contribute to it."

---

## 8. Open questions

These are worth a follow-up before any of §7 lands as code:

1. **Color variation: shader vs. material variants?** The CS `_c` mask is elegant but requires a custom shader. The glTF-native alternative is `KHR_materials_variants` — multiple named material sets in one glb, switchable at instance time. Variants are simpler but produce N material copies; the `_c` approach produces continuous color customization from one base. Which fits 3DStreet's editor UX better?
2. **Where does the `KHR_xmp_json_ld` block actually go in the build pipeline?** Inside the source glb (means re-baking on every metadata change) or as a `.metadata.json` sidecar (means a sync hazard between model and metadata)? Probably the former, with a small Node script in the assets-dist repo that bakes metadata into Draco-compressed glbs.
3. **Is the auto-wheel-detection-from-5-cm-rule useful enough to be worth porting?** For 3DStreet-team-authored content the named-bone convention is fine. The auto-detection becomes valuable only when accepting third-party glbs that don't follow 3DStreet conventions. If the UGC pipeline is "modeler downloads our starter template," the auto-detection is mostly unused. If it's "modeler uploads whatever they have from Sketchfab," it's load-bearing.
4. **CS2 timing.** Worth a 2027 re-check. CS2's per-file pipeline (`.Prefab` / `.Geometry` / `.Surface` / `.Texture`) and PBR-native textures might be a cleaner import target than CS1's `.crp`, *if* Paradox Mods opens up downloads to anonymous fetchers.
5. **Licensing posture for the Option A importer.** Even with the user doing their own ModTools dump, 3DStreet hosting a "Cities: Skylines compatibility" feature is a marketing signal that may attract Paradox attention. Worth a quick legal check before ship, even though every CS-adjacent tool of the last decade has been left alone.

---

## 9. Sources

### Cities: Skylines (CS1 and CS2)

- [cslmodding.info — Vehicle Asset Creation](https://cslmodding.info/asset/vehicle/) (canonical community reference)
- [cslmodding.info — Vehicle Wheels shader](https://cslmodding.info/shader/vehicle-wheels/) (the 5 cm rule, vertex color encoding)
- [cslmodding.info — Building Asset Creation](https://cslmodding.info/asset/building/) (general asset rules)
- [cslmodding.info — Rotors / Vehicle Glass shader](https://cslmodding.info/shader/rotors-vehicle/)
- [cslmodding.info — Custom Effect Loader](https://cslmodding.info/mod/custom-effect-loader/) (XML light/sound effects)
- [cslmodding.info — Dump & Extract Assets](https://cslmodding.info/dump/)
- [Paradox Wiki — Asset Editor (CS1)](https://skylines.paradoxwikis.com/Asset_Editor)
- [Paradox Wiki — Asset Properties (CS1)](https://skylines.paradoxwikis.com/Asset_Properties)
- [Paradox Wiki — CRAP_File_Format (CS1)](https://skylines.paradoxwikis.com/CRAP_File_Format)
- [fileformats.archiveteam.org — Cities Skylines CRP](http://fileformats.archiveteam.org/wiki/Cities_Skylines_CRP)
- [Ronyx69 — tire-parameters override script (gist)](https://gist.github.com/ronyx69/b2a53cce3a02b22ab4f425b95bf0825a)
- [Ronyx69 — vehicle sub-mesh flags script (gist)](https://gist.github.com/ronyx69/ab2e3fdcbab5f78c9b41a337c1d19280)
- [Steam guide 500036497 — Texturing & Asset Creation 101](https://steamcommunity.com/sharedfiles/filedetails/?id=500036497)
- [Steam guide 524027632 — Illumination Map Value Overview](https://steamcommunity.com/sharedfiles/filedetails/?id=524027632)
- [Steam Workshop — Extended Asset Editor (800820816)](https://steamcommunity.com/sharedfiles/filedetails/?id=800820816)
- [GitHub — Acc3ssViolation/VehicleEffects](https://github.com/Acc3ssViolation/VehicleEffects)
- [Steam Workshop — Advanced Vehicle Options (1548831935)](https://steamcommunity.com/sharedfiles/filedetails/?id=1548831935)
- [Simtropolis — "Need help making vehicle asset (solved)"](https://community.simtropolis.com/forums/topic/74360-need-help-making-vehicle-asset-solved/)
- [Simtropolis — Asset SubMesh discussion (758590)](https://community.simtropolis.com/forums/topic/758590-asset-editor-submesh/)
- [Paradox Forum — Vehicles polygon count](https://forum.paradoxplaza.com/forum/threads/vehicles-polygon-count.863058/)
- [Game Developer — Game Design Deep Dive: Traffic Systems in Cities: Skylines](https://www.gamedeveloper.com/design/game-design-deep-dive-traffic-systems-in-i-cities-skylines-i-)
- [CS2 Wiki — Asset Creation Guide](https://cs2.paradoxwikis.com/Asset_Creation_Guide)
- [CS2 Wiki — Assets: Importing](https://cs2.paradoxwikis.com/Assets:_Importing)
- [CS2 Wiki — Asset Pipeline: Surfaces](https://cs2.paradoxwikis.com/Asset_Pipeline:_Surfaces)
- [CS2 Wiki — Assets: Package, Share and Upload](https://cs2.paradoxwikis.com/Assets:_Package,_Share_and_Upload)
- [Paradox Interactive — Adding Custom Assets (CS2)](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/adding-custom-assets)
- [Paradox Interactive — Asset Mods Patch Notes (CS2)](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/asset-mods-patch-notes)
- [Colossal Order dev diary — Adding Custom Assets](https://colossalorder.fi/?p=3214)
- [GitHub — CitiesSkylinesModding/CS2-AssetPacksManager](https://github.com/CitiesSkylinesModding/CS2-AssetPacksManager)

### `.crp` parsing & extraction

- [GitHub — LiamBrandt/crp-extract](https://github.com/LiamBrandt/crp-extract)
- [GitHub — Auskennfuchs/CrpViewer](https://github.com/Auskennfuchs/CrpViewer)
- [GitHub — bloodypenguin/Skylines-VehicleConverter](https://github.com/bloodypenguin/Skylines-VehicleConverter)
- [Crper web tool](http://unera.se/crper/)
- [Steam guide 606579769 — ModTools how-to](https://steamcommunity.com/sharedfiles/filedetails/?id=606579769)
- [citiesskylinesmoddingguide.readthedocs.io — Reverse Engineering](https://citiesskylinesmoddingguide.readthedocs.io/en/latest/modding/Workflow/Reverse-Engineering.html)

### Legal & policy

- [Steam Workshop Legal Agreement](https://steamcommunity.com/workshop/workshoplegalagreement/)
- [Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/)
- [Paradox Mod Policy](https://legal.paradoxplaza.com/mod-policy)
- [PCGamesN — 2024 Cities: Skylines mods DMCA storm](https://www.pcgamesn.com/cities-skylines-2/mods-dmca)
- [GitHub — imwaitingnow/WorkshopDL](https://github.com/imwaitingnow/WorkshopDL) (anonymous Workshop downloader)

### Comparable UGC ecosystems

- [reboot.omsi-webdisk.de — Vehicles in OMSI](https://reboot.omsi-webdisk.de/wiki/entry/29-vehicles-in-omsi/)
- [reboot.omsi-webdisk.de — Configuration files](https://reboot.omsi-webdisk.de/wiki/entry/87-configuration-files/)
- [GitHub — space928/Blender-O3D-IO-Public](https://github.com/space928/Blender-O3D-IO-Public)
- [Open Rails — Physics Manual](https://open-rails.readthedocs.io/en/1.5.1/physics.html)
- [Open Rails — Features: Rolling Stock](https://open-rails.readthedocs.io/en/latest/features-rollingstock.html)
- [Coals to Newcastle — physics file format](https://www.coalstonewcastle.com.au/physics/format/)
- [Transport Fever 2 Wiki — Vehicle Types](https://wiki.transportfever2.com/doku.php?id=modding:vehicletypes)
- [Simutrans Germany — Paksets wiki](https://simutrans-germany.com/wiki/wiki/en_paksets)
- [BeamNG docs — JBeam Syntax](https://documentation.beamng.com/modding/vehicle/intro_jbeam/jbeamsyntax/)
- [BeamNG docs — Pressure Wheels](https://documentation.beamng.com/modding/vehicle/sections/wheels/)
- [BeamNG docs — Part/Slot system](https://documentation.beamng.com/modding/vehicle/intro_jbeam/partslotsystem/)
- [BeamNG docs — Making configs and info files](https://documentation.beamng.com/modding/vehicle/tutorials/configs/)
- [assettocorsamods.net — First Car Tutorial](https://assettocorsamods.net/threads/your-first-car-in-assetto-corsa-basic-guide.1019/)
- [tirewall.net — rFactor 2 Modding Handbook (physics)](http://www.tirewall.net/mh-rf2/archive/isi_mod_tut/car/car_physics.html)
- [studio-397.com — pTool intro](https://www.studio-397.com/modding-resources/introduction-to-physics-tool-ptool-and-flexible-chassis/)
- [Unreal Engine — Vehicle User Guide](https://docs.unrealengine.com/4.27/en-US/InteractiveExperiences/Vehicles/VehicleUserGuide)
- [Unreal Engine — Recommended asset naming conventions](https://dev.epicgames.com/documentation/en-us/unreal-engine/recommended-asset-naming-conventions-in-unreal-engine-projects)
- [Roblox vehicles community guidelines (fandom)](https://roblox-vehicles.fandom.com/wiki/Roblox_vehicles_Wiki:Community_Guidelines)

### Standards & open formats

- [Khronos — KHR_xmp_json_ld README](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_xmp_json_ld/README.md)
- [Khronos blog — Pervasive asset metadata in 3DCommerce](https://www.khronos.org/blog/pervasive-asset-metadata-in-3dcommerce)
- [GitHub — KhronosGroup/glTF-Metadata-CLI](https://github.com/KhronosGroup/glTF-Metadata-CLI)
- [NVIDIA — SimReady Specification](https://docs.omniverse.nvidia.com/simready/latest/overview/simready-spec.html)
- [NVIDIA — What is SimReady](https://developer.nvidia.com/omniverse/simready-assets)
- [SimReady Foundation — Getting Started](https://nvidia.github.io/simready-foundation/guides/getting_started.html)
- [OGC — CityGML standard](https://www.ogc.org/standards/citygml/)
- [OGC — CityGML 3.0 Users Guide](https://docs.ogc.org/guides/20-066.html)
- [OSM2World](https://osm2world.org/)
- [OpenStreetMap — 3D development wiki](https://wiki.openstreetmap.org/wiki/3D_development)
- [Mapillary — Vistas Dataset](https://blog.mapillary.com/product/2017/05/03/mapillary-vistas-dataset.html)
- [arXiv — S3D3C study of Sketchfab catalog](https://arxiv.org/html/2407.17205v1)
- [SketchUp Forum — 3D Warehouse models and scale](https://forums.sketchup.com/t/3d-warehouse-models-and-scale/341756)
