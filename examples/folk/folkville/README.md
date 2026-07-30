# Folkville — implementation

The code for [SPEC-folkville.md](../SPEC-folkville.md): a tabletop SimCity
where LEGO vehicles carrying printed Folk cards bulldoze, pave, and build on
a projected meadow.

Everything ships as `.folk` programs — there is no out-of-band Tcl library
to install. `folkville.folk` is self-contained: its engine owns all game
logic and publishes a **render-ready scene claim** (merged road runs, tree
cells, house anchors, stats — data, not code), so the renderer and any other
consumer is a plain loop over lists.

## Files

| File | What it is |
| --- | --- |
| `folkville.folk` | The whole game: game-logic procs, renderer `When` (fires only on scene-rev change), live tool auras, crane dwell ring, then the 20 Hz engine loop — single writer of the scene claim, `fswatch.folk`-style. |
| `folkville-bulldozer.folk` `-paver.folk` `-crane.folk` `-reset.folk` | Tool cards. Each is a complete Folk program — print one per card, stick it flat on the vehicle's roof. Tools are discovered by claim, not tag id, so cards are swappable and spares are free. |
| `test-folkville.tcl` | 42 unit tests for the game logic. Loads `folkville.folk` directly with Folk primitives stubbed. `tclsh test-folkville.tcl` |
| `test-folkville-engine.tcl` | Drives the **real** engine loop in tclsh with stubbed Folk primitives and a simulated clock: a scripted paver paints a road, a crane dwells and builds one house, a bulldozer clears its spot, the reset card regrows the meadow. 14 assertions. |

Both suites pass (Tcl 8.6). The Folk-facing surface (`When`/`Wish` patterns,
`Query!` joins, drawing wishes) is written against current FolkComputer/folk
`main` builtins but has not yet run on a real table.

## Install on the Folk machine

1. Add `folkville.folk` as a program (virtual via the editor, or print it —
   the page can live at the table's edge; its position doesn't matter).
2. Print the four tool cards. Mount the first three flat on LEGO vehicles;
   keep the reset card in your pocket.
3. Drive.

World state survives restarts via `~/folkville-world.snapshot` (written every
10 s). Delete the file (or use the reset card) for a fresh meadow.

## Tuning

All knobs are at the top of `folkville.folk`: `CELL` (px per cell), `MARGIN`,
brush radii, dwell time, reset hold time, tick rate.

## Hardware verification checklist (first session at a real table)

In order of likelihood to need touching:

1. **The tool query join** (one line, marked `HARDWARE NOTE` in
   `folkville.folk`): `Query! /p/ is a folkville tool with kind /kind/ & /p/ has quad /q/`.
   If tool auras appear but nothing edits terrain, the engine's join isn't
   matching — compare against `builtin-programs/tags-to-quads.folk` on the
   table for how page entities relate to quads.
2. **Quad coordinate space**: auras drawn far from the physical cards means
   quads arrive in camera space; apply the table's registered space changer
   to the centroid.
3. **Filled rectangles**: if grass/roads don't render, set `usePolygons 0`
   inside the renderer `When` — it falls back to fat-line rects that use only
   primitives verified in folk's own `display-saver.folk`.
4. **`Hold!` across re-saves**: if the world blanks when you edit the
   program, the snapshot restore will bring it back on the next engine start
   (10 s granularity).
