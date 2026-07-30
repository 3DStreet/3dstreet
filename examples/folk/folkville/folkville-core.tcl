# folkville-core.tcl — pure game logic for Folkville. No Folk dependencies:
# runs in plain tclsh (8.6+) so every rule below is unit-testable off-table.
#   tclsh test-folkville.tcl
#
# World representation (see SPEC-folkville.md §3):
#   terrain — one char per cell, row-major string. G grass, T tree, R road,
#             H house-occupied.
#   houses  — list of {col row} anchors, each the top-left of a 2x2 footprint.

namespace eval ::folkville {}

# ---------------------------------------------------------------- terrain ---

proc ::folkville::initTerrain {cols rows} {
    # Deterministic tree scatter (~7%): stable across re-runs by design —
    # Folk re-executes programs on every edit, so no RNG allowed here.
    set t ""
    for {set r 0} {$r < $rows} {incr r} {
        for {set c 0} {$c < $cols} {incr c} {
            if {((($c * 73856093) ^ ($r * 19349663)) % 15) == 0} {
                append t "T"
            } else {
                append t "G"
            }
        }
    }
    return $t
}

proc ::folkville::cellAt {terrain c r cols} {
    string index $terrain [expr {$r * $cols + $c}]
}

proc ::folkville::setCell {terrain c r cols ch} {
    set i [expr {$r * $cols + $c}]
    string replace $terrain $i $i $ch
}

# ------------------------------------------------------------------ brush ---

# Cells whose center lies within `radius` (in cell units) of point (cx, cy)
# (fractional cell coordinates). Clipped to the grid.
proc ::folkville::brushCells {cx cy radius cols rows} {
    set out {}
    set r2 [expr {$radius * $radius}]
    set cMin [expr {int(floor($cx - $radius))}]
    set cMax [expr {int(ceil($cx + $radius))}]
    set rMin [expr {int(floor($cy - $radius))}]
    set rMax [expr {int(ceil($cy + $radius))}]
    if {$cMin < 0} { set cMin 0 }
    if {$rMin < 0} { set rMin 0 }
    if {$cMax >= $cols} { set cMax [expr {$cols - 1}] }
    if {$rMax >= $rows} { set rMax [expr {$rows - 1}] }
    for {set r $rMin} {$r <= $rMax} {incr r} {
        for {set c $cMin} {$c <= $cMax} {incr c} {
            set dx [expr {$c + 0.5 - $cx}]
            set dy [expr {$r + 0.5 - $cy}]
            if {$dx*$dx + $dy*$dy <= $r2} {
                lappend out [list $c $r]
            }
        }
    }
    return $out
}

# Continuous stroke from (x0,y0) to (x1,y1) in cell coordinates: union of
# brushes stamped every half-radius along the segment. Deduplicated.
proc ::folkville::strokeCells {x0 y0 x1 y1 radius cols rows} {
    set dx [expr {$x1 - $x0}]
    set dy [expr {$y1 - $y0}]
    set dist [expr {hypot($dx, $dy)}]
    set steps [expr {int(ceil($dist / ($radius * 0.5)))}]
    if {$steps < 1} { set steps 1 }
    set seen [dict create]
    for {set i 0} {$i <= $steps} {incr i} {
        set f [expr {double($i) / $steps}]
        set px [expr {$x0 + $dx * $f}]
        set py [expr {$y0 + $dy * $f}]
        foreach cell [brushCells $px $py $radius $cols $rows] {
            dict set seen $cell 1
        }
    }
    return [dict keys $seen]
}

# ------------------------------------------------------------------ tools ---

# Bulldozer: every touched cell -> G. Touching any cell of a house demolishes
# the whole house. Returns number of cells changed.
proc ::folkville::bulldoze {terrainVar housesVar cells cols} {
    upvar 1 $terrainVar terrain $housesVar houses
    set changed 0
    foreach cell $cells {
        lassign $cell c r
        set ch [cellAt $terrain $c $r $cols]
        if {$ch eq "H"} {
            incr changed [demolishHouseAt terrain houses $c $r $cols]
        } elseif {$ch ne "G"} {
            set terrain [setCell $terrain $c $r $cols "G"]
            incr changed
        }
    }
    return $changed
}

proc ::folkville::demolishHouseAt {terrainVar housesVar c r cols} {
    upvar 1 $terrainVar terrain $housesVar houses
    set i 0
    foreach h $houses {
        lassign $h ac ar
        if {$c >= $ac && $c <= $ac + 1 && $r >= $ar && $r <= $ar + 1} {
            set houses [lreplace $houses $i $i]
            foreach {dc dr} {0 0  1 0  0 1  1 1} {
                set terrain [setCell $terrain [expr {$ac + $dc}] [expr {$ar + $dr}] $cols "G"]
            }
            return 4
        }
        incr i
    }
    return 0
}

# Paver: grass only. Trees and houses are immune — bulldoze first.
proc ::folkville::pave {terrainVar cells cols} {
    upvar 1 $terrainVar terrain
    set changed 0
    foreach cell $cells {
        lassign $cell c r
        if {[cellAt $terrain $c $r $cols] eq "G"} {
            set terrain [setCell $terrain $c $r $cols "R"]
            incr changed
        }
    }
    return $changed
}

# Crane: 2x2 house with top-left anchor (c, r). All four cells must be grass
# and inside the grid. Returns 1 on success.
proc ::folkville::tryPlaceHouse {terrainVar housesVar c r cols rows} {
    upvar 1 $terrainVar terrain $housesVar houses
    if {$c < 0 || $r < 0 || $c + 1 >= $cols || $r + 1 >= $rows} { return 0 }
    foreach {dc dr} {0 0  1 0  0 1  1 1} {
        if {[cellAt $terrain [expr {$c + $dc}] [expr {$r + $dr}] $cols] ne "G"} {
            return 0
        }
    }
    foreach {dc dr} {0 0  1 0  0 1  1 1} {
        set terrain [setCell $terrain [expr {$c + $dc}] [expr {$r + $dr}] $cols "H"]
    }
    lappend houses [list $c $r]
    return 1
}

# -------------------------------------------------------------- rendering ---

# Merged horizontal runs of character `ch`: list of {row colStart colEnd}.
# Keeps the renderer's wish count low (one polygon per run, not per cell).
proc ::folkville::runsOf {terrain ch cols rows} {
    set runs {}
    for {set r 0} {$r < $rows} {incr r} {
        set c 0
        while {$c < $cols} {
            if {[cellAt $terrain $c $r $cols] eq $ch} {
                set start $c
                while {$c < $cols && [cellAt $terrain $c $r $cols] eq $ch} {
                    incr c
                }
                lappend runs [list $r $start [expr {$c - 1}]]
            } else {
                incr c
            }
        }
    }
    return $runs
}

proc ::folkville::cellsOf {terrain ch cols rows} {
    set out {}
    set i 0
    set len [string length $terrain]
    while {$i < $len} {
        set j [string first $ch $terrain $i]
        if {$j < 0} { break }
        lappend out [list [expr {$j % $cols}] [expr {$j / $cols}]]
        set i [expr {$j + 1}]
    }
    return $out
}

proc ::folkville::stats {terrain houses} {
    set trees [expr {[string length $terrain] - [string length [string map {T ""} $terrain]]}]
    set road  [expr {[string length $terrain] - [string length [string map {R ""} $terrain]]}]
    return "trees $trees   houses [llength $houses]   road $road cells"
}

# --------------------------------------------------------------- geometry ---

# Folk quads are {space {topLeft topRight bottomRight bottomLeft}} with
# {x y z} vertices (see folk quad-lib). We only need x/y.
proc ::folkville::quadCenter {q} {
    set verts [lindex $q 1]
    set sx 0.0; set sy 0.0
    foreach v $verts {
        set sx [expr {$sx + [lindex $v 0]}]
        set sy [expr {$sy + [lindex $v 1]}]
    }
    list [expr {$sx / 4.0}] [expr {$sy / 4.0}]
}

# Unit vector pointing from the quad's bottom edge toward its top edge —
# i.e. the direction the physical card is "facing".
proc ::folkville::quadUp {q} {
    set verts [lindex $q 1]
    lassign $verts tl tr br bl
    set tx [expr {([lindex $tl 0] + [lindex $tr 0]) / 2.0}]
    set ty [expr {([lindex $tl 1] + [lindex $tr 1]) / 2.0}]
    set bx [expr {([lindex $bl 0] + [lindex $br 0]) / 2.0}]
    set by [expr {([lindex $bl 1] + [lindex $br 1]) / 2.0}]
    set dx [expr {$tx - $bx}]
    set dy [expr {$ty - $by}]
    set n [expr {hypot($dx, $dy)}]
    if {$n < 1e-9} { return {0.0 -1.0} }
    list [expr {$dx / $n}] [expr {$dy / $n}]
}

# Bounding-box spread (max extent in either axis, cell units) of a dwell
# history list of {timestampMs x y}. Used for the crane's hold-still test.
proc ::folkville::histSpread {hist} {
    if {[llength $hist] == 0} { return 0.0 }
    set first [lindex $hist 0]
    set xMin [lindex $first 1]; set xMax $xMin
    set yMin [lindex $first 2]; set yMax $yMin
    foreach entry $hist {
        lassign $entry _ x y
        if {$x < $xMin} { set xMin $x }
        if {$x > $xMax} { set xMax $x }
        if {$y < $yMin} { set yMin $y }
        if {$y > $yMax} { set yMax $y }
    }
    expr {max($xMax - $xMin, $yMax - $yMin)}
}

# ------------------------------------------------------------- snapshots ---

proc ::folkville::saveSnapshot {path terrain houses rev} {
    set fd [open $path w]
    puts $fd [list $terrain $houses $rev]
    close $fd
}

# Returns {terrain houses rev}, or {} if missing/corrupt/wrong grid size.
proc ::folkville::loadSnapshot {path cols rows} {
    if {![file exists $path]} { return {} }
    if {[catch {
        set fd [open $path r]
        set data [string trim [read $fd]]
        close $fd
        lassign $data terrain houses rev
    }]} { return {} }
    if {[string length $terrain] != $cols * $rows} { return {} }
    if {![string is integer -strict $rev]} { return {} }
    return [list $terrain $houses $rev]
}
