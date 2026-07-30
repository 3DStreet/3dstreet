# SPEC B — "Folkville": a tabletop SimCity for Folk Computer

**Status:** design spec, ready to build · **Depends on 3DStreet:** none (pure Folk)
**Companion spec:** [SPEC-street-editor.md](SPEC-street-editor.md) (completely separate program)

## 1. Vision

The projector turns the table into a meadow: grass everywhere, trees scattered
around. There is no screen, no keyboard, no mouse. The only controllers are
three LEGO vehicles parked on the table, each carrying a small printed card on
its roof:

| Vehicle | Card | What it does |
| --- | --- | --- |
| 🚜 Bulldozer | `folkville: bulldozer` | Everything under its blade returns to bare grass — trees fall, houses crumble, road is ripped up |
| 🚧 Paver | `folkville: paver` | Lays gray road wherever it drives (grass only — it refuses to pave through trees, so you must bulldoze first) |
| 🏗️ Crane | `folkville: crane` | Park it on open grass for 2 seconds and a house is erected next to it |

A fourth card, kept off-table, is `folkville: reset` — place it face-up for
3 seconds and the meadow regrows.

The world is deliberately a *bitmap*, not a street model: roads are painted
cells on a canvas, exactly as the user framed it ("a gray texture … added by
the car as a bitmap / canvas style modification").

### Why this is a good Folk demo

- The vehicles ARE the UI — Folk's whole thesis, physically legible in 5 seconds.
- The tool cards are themselves tiny Folk programs (§4.1), so "the bulldozer
  is a program you can pick up" is literally true. Swap cards between cars and
  the cars swap jobs — a magic trick that explains Folk better than any slide.
- Zero network, zero browser, no 3DStreet coupling: it survives flaky open-house
  Wi-Fi and runs on a stock Folk table.

## 2. Grounding in Folk APIs (verified against FolkComputer/folk `main`)

The design uses only primitives confirmed in the folk2 source:

| Primitive | Source | Use here |
| --- | --- | --- |
| `When display /disp/ has width /w/ height /h/ { … }` | `builtin-programs/display-saver.folk` | full-viewport world |
| `Wish to draw a polygon onto $disp with points $pts color $c layer $l` | `builtin-programs/draw/shapes.folk` | grass base, road cells, house fallback |
| `Wish to draw a line onto $disp with points $pts width $w color $c` | `display-saver.folk` | play-area border, crane progress ring |
| `Wish to draw text onto $disp with x $x y $y text $t color $c scale $s` | `display-saver.folk` | HUD, labels under vehicles |
| `Wish to draw an image onto /p/ with image $im position {x y} width $w anchor center` | `builtin-programs/draw/image.folk` | tree/house art (fallback: polygons) |
| `tag /t/ has quad /q/` claims; `::quad::centroid` → `{x y z}` | `builtin-programs/tags-to-quads.folk`, `quad-lib.folk` | vehicle positions in display space |
| `When the clock time is /t/` (special-cased for atomicity in `prelude.tcl`) | `prelude.tcl` | dwell timers, animations |
| `Hold! -key K [-keep ms] Claim …` (durable statement outside reactive scope) | `prelude.tcl`, precedent `fswatch.folk` | the world state |
| `Query!` (synchronous DB sample, `&` joins) | `prelude.tcl`, used in `draw/image.folk` | engine loop reads tag poses |
| Long-running `while true` loop in a `.folk` program doing `Hold!` per iteration | `builtin-programs/fswatch.folk` | the 20 Hz game engine |
| `Claim`/`When` with `$this` scoping | everywhere | tool cards |

**To verify on hardware** (each has a designed fallback, §8): the exact space
tag quads arrive in (display vs camera — `tags-to-quads.folk` registers
changers both ways); whether `draw an image onto $disp` works directly or
needs a canvas target (fallback: polygons); `Hold!` claim survival across
program re-saves (fallback: disk snapshot, §5.4).

## 3. World model

### 3.1 Grid

- Cell size `CELL = 20` px → at 1280×720 that's **64×36 = 2,304 cells**.
  (One tunable; 16 px works if the projector is sharp.)
- Optional inset margin (e.g. 40 px) so the world sits inside a drawn border
  and tool cards resting outside the border do nothing.

### 3.2 Terrain

One character per cell, row-major string (a 2,304-char Tcl string — cheap to
copy, index, and diff):

| Char | Meaning |
| --- | --- |
| `G` | grass |
| `T` | tree (grass with a tree sprite) |
| `R` | road |
| `H` | house-occupied (any of a house's 2×2 cells) |

Houses additionally live in a list of `{col row rev}` anchors (top-left of the
2×2 footprint) so sprites render once per house, not per cell.

### 3.3 Initial world

All `G`, then deterministic tree scatter — no RNG needed (Folk programs may
re-run at any time, so regeneration must be stable):

```tcl
# ~7% tree cover, stable pseudo-noise
if {((($col * 73856093) ^ ($row * 19349663)) % 15) == 0} { set c T }
```

### 3.4 Scene claim

The engine (§4.2) is the single writer. It publishes **render-ready data**
(merged road runs, tree cells, house anchors, HUD stats), not the raw
terrain string:

```tcl
Hold! -key {folkville scene} \
    Claim the folkville scene is rev $rev with roads $roadRuns trees $treeCells \
        houses $houses grid [list $cols $rows] origin [list $ox $oy] \
        cell $CELL stats $stats
```

Two consequences: `rev` increments only on actual edits, so the renderer's
`When` refires only when something changed — idle tables cost nothing. And
because the claim carries plain lists rather than state that needs game code
to interpret, consumers need no shared library — everything ships as `.folk`
programs, with no out-of-band Tcl files.

## 4. Program architecture

Three kinds of `.folk` programs, one printed page each:

```
┌─────────────────┐     Claim … is a folkville tool …      ┌──────────────────┐
│ tool cards (×4) │ ─────────────────────────────────────▶ │ folkville.folk    │
│ (on vehicles)   │        tag quads (from Folk core)      │  engine: while-   │
└─────────────────┘ ─────────────────────────────────────▶ │  loop @ 20 Hz     │
                                                           │  Hold! scene      │
┌─────────────────┐   the folkville scene is rev /…/       │                   │
│ renderer When   │ ◀───────────────────────────────────── │  (same page,      │
│ (same page)     │ ──▶ Wish to draw … onto $disp          │   loop runs last) │
└─────────────────┘                                        └──────────────────┘
```

### 4.1 Tool cards — the whole program fits on the card

```tcl
# print one card per tool; stick it flat on the vehicle roof
Claim $this is a folkville tool with kind bulldozer
Wish $this is labelled "🚜 BULLDOZER"
```

(and `paver`, `crane`, `reset`). Because the card is a Folk program, its tag
id is irrelevant — the engine discovers tools by *claim*, not by hardcoded
tag number. Print spares; swap freely between vehicles.

### 4.2 Engine — `folkville.folk`

Single page containing, in order: renderer `When` (§4.3), helper `proc`s,
then the engine loop (must be last — the loop never returns, `fswatch.folk`
precedent). Loop body each tick (~50 ms):

1. `Query! /someone/ claims /p/ is a folkville tool with kind /kind/`
   then for each result `Query! $p has quad /q/` → tool positions
   (`::quad::centroid`, converted to display space if needed, then to
   `{col row}`).
2. Apply mechanics (§5) to local `terrain`/`houses` variables.
3. If anything changed: `incr rev` and re-`Hold!` the scene claim
   (recomputing road runs / tree cells / stats — cheap at this grid size).
4. `exec sleep 0.05`.

The engine never draws; the renderer never mutates. All game rules live in
step 2 as plain Tcl on plain strings — trivially unit-testable off-table with
`tclsh`.

### 4.3 Renderer — pure function of the scene claim

```tcl
When the folkville scene is rev /rev/ with roads /roads/ trees /trees/ houses /houses/ grid /grid/ origin /origin/ cell /cellPx/ stats /stats/ &
     display /disp/ has width /dw/ height /dh/ {
    # 1. grass: one full-viewport polygon (or grass.png stretched)
    # 2. roads: one rect per merged run in /roads/ — already merged by the engine
    # 3. trees:  image tree.png per cell in /trees/ (fallback: dark-green circle)
    # 4. houses: image house.png per anchor (fallback: brown rect + roof tri)
    # 5. border + HUD text from /stats/
}
```

Run-merging keeps wish count sane: worst-case checkerboard roads ≈ 1,100
polygons, but a realistic road network is 50–300 runs. Trees ~150, houses
~20. Total ≤ 500 draw wishes, re-emitted only on `rev` change. Vehicle
auras (§5.5) live in a separate `When … tag quad …` block so they track at
full frame rate without touching the scene claim.

## 5. Mechanics

### 5.1 Brush strokes, not point stamps

Tags sample at camera rate; a fast-moving car would leave dotted road.
The engine keeps each tool's previous centroid **and timestamp**; on each
sighting it walks the segment from previous → current position in steps of
half a brush radius, applying the brush at every step. If the gap between
sightings exceeds **500 ms** (card occluded by a hand, vehicle lifted), it's
a teleport: no stroke, just re-anchor. Centroids get light EMA smoothing
(α ≈ 0.4) before cell quantization to kill projector/camera jitter.

### 5.2 Bulldozer — brush radius 1.5 cells

Every cell touched → `G`. If a touched cell is `H`, the whole house dies:
all 4 cells → `G`, anchor removed. (Optional juice: `Hold! -keep 1500ms` a
rubble claim; renderer draws debris that fades.)

### 5.3 Paver — brush radius 1.0 cell

`G → R` only. `T`, `H` immune — the paver visibly *refuses*, which teaches
the tool loop (bulldoze, then pave) without a single word of instruction.

### 5.4 Crane — dwell-to-build

- Track a rolling 2 s window of crane positions; if the bounding box stays
  within one cell AND the 2×2 area whose nearest corner is one cell ahead of
  the crane is all `G` → place house (`H`×4 + anchor), advance `rev`.
- While dwelling, renderer draws a progress ring closing around the site.
- After building, the crane is **spent** until moved ≥ 3 cells away
  (prevents machine-gunning houses).

### 5.5 Always-on feedback (frame rate, not world rate)

Under every discovered tool: a colored aura circle + text label at its
centroid (yellow dozer / gray paver / orange crane), so visitors instantly
see the table is tracking their vehicle even before they change anything.

### 5.6 Reset card

Face-up and stationary for 3 s → world := initial scatter. The dwell delay
plus keeping the card in a pocket makes accidents near-impossible.

### 5.7 Persistence across reloads

Editing any program re-runs it; a Folk reboot drops held claims. Every 10 s
(and on reset) the engine writes `~/folkville-world.snapshot`
(`terrain`, `houses`, `rev`); on start it restores from that file if present.
Also try `Hold! -save` (exists in `prelude.tcl`) once on hardware.

## 6. Art

`~/folk-images/folkville/`: `tree.png`, `house.png` (a few variants keyed by
`anchor hash % N` for a lived-in look), optional `grass.png` tile. All
optional — the renderer falls back to flat polygons and the game reads fine.
Loaded once via the `the image loader is /loadImage/` claim
(`draw/image.folk` pattern), *not* per frame.

## 7. Build plan (each milestone is independently demoable)

| # | Milestone | Exit criterion | Est. |
| --- | --- | --- | --- |
| M0 | Meadow | Grass + stable tree scatter + border fill the viewport | 1–2 h |
| M1 | Paver paints | Driving the paver leaves continuous road; occlusion doesn't streak | 2–3 h |
| M2 | Bulldozer | Trees/road cleared under blade; paver-vs-tree refusal works | 1 h |
| M3 | Crane | Dwell ring, 2×2 house, spent-until-moved | 2 h |
| M4 | Juice | Sprites, auras + labels, HUD, reset card, disk persistence, sound (`audio.folk`) | 2–4 h |

M1 is the open-house minimum: grass + trees + one car that paints road is
already a crowd magnet.

## 8. Risks & fallbacks

| Risk | Mitigation |
| --- | --- |
| Tag quads arrive in camera space, not display space | `tags-to-quads.folk` registers changers both directions; apply `the changer from space $camera to space "display $display"` to centroids |
| `draw an image onto $disp` needs a canvas the display lacks | Renderer's polygon fallbacks are first-class; ship M0–M3 on polygons, add PNGs in M4 |
| `Query!` join syntax differs on installed Folk version | Engine isolates all DB reads in two `Query!` lines; adjust against that table's `builtin-programs` (same place `fswatch.folk`/`image.folk` live) |
| Wish flood on big road networks | Run-merging (§4.3); if still slow, chunk the world into 8×8 super-tiles and only re-emit dirty chunks (rev per chunk) |
| Card glare / tag misses on moving vehicles | Matte paper, tags ≥ 40 mm, mounted flat; §5.1 tolerates dropouts by design |
| Two visitors grab two tools at once | Already works — the engine iterates *all* discovered tools per tick; nothing is single-tool |

## 9. Stretch (post-open-house)

- Tire-track decals behind vehicles (`Hold! -keep 3000ms` claims).
- Population counter that grows while houses stand near road (houses need a
  road connection within 3 cells or they stay dark — one Tcl BFS).
- Day/night cycle from `the clock time` (dim grass, lit house windows).
- A tiny fire truck. Houses catch fire. You know you want it.
