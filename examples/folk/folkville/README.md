# Folkville — implementation

The code for [SPEC-folkville.md](../SPEC-folkville.md): a tabletop SimCity
where LEGO vehicles carrying printed Folk cards bulldoze, pave, and build on
a projected meadow.

## Files

| File | What it is |
| --- | --- |
| `folkville-core.tcl` | All game rules as pure Tcl (terrain string, brushes, strokes, houses, snapshots). No Folk dependencies. |
| `folkville.folk` | The one Folk program: renderer + tool auras + crane dwell ring (`When` handlers), then the 20 Hz engine loop (single writer of the world claim). |
| `folkville-bulldozer.folk` `-paver.folk` `-crane.folk` `-reset.folk` | Tool cards. Each is a complete Folk program — print one per card, stick it flat on the vehicle's roof. |
| `test-folkville.tcl` | 42 unit tests for the core. `tclsh test-folkville.tcl` |
| `test-folkville-engine.tcl` | Drives the **real** `folkville.folk` engine loop in tclsh with stubbed Folk primitives and a simulated clock: a scripted paver paints a road, a crane dwells and builds one house, a bulldozer clears its spot, the reset card regrows the meadow. 12 assertions. |

Both test suites pass (Tcl 8.6). The Folk-facing surface (`When`/`Wish`
patterns, `Query!` joins, drawing wishes) is written against current
FolkComputer/folk `main` builtins but has not yet run on a real table.

## Install on the Folk machine

1. `mkdir -p ~/folkville && cp folkville-core.tcl ~/folkville/`
   (also honored: `~/folk-live/` or `~/`)
2. Add `folkville.folk` as a program (virtual via the editor, or print it —
   the page can live at the table's edge; its position doesn't matter).
3. Print the four tool cards. Mount the first three flat on LEGO vehicles;
   keep the reset card in your pocket.
4. Drive.

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
