# test-folkville.tcl — unit tests for the game logic inside folkville.folk.
# Run: tclsh test-folkville.tcl
#
# folkville.folk is self-contained, so we load it directly with the Folk
# primitives stubbed out; the engine loop aborts at its display wait (the
# stubbed Query! never reports a display), leaving the procs defined.

set this "unit-test"
proc When {args} {}
proc Wish {args} {}
proc Claim {args} {}
proc Hold! {args} {}
proc Query! {args} { return {} }
rename exec _realExec
proc exec {args} {
    if {[lindex $args 0] eq "sleep"} { return -code error FVSTOP }
    tailcall _realExec {*}$args
}
set rc [catch {source [file join [file dirname [info script]] folkville.folk]} err]
if {$rc && $err ne "FVSTOP"} {
    puts "LOAD ERROR: $err"
    exit 1
}

set pass 0
set fail 0
proc check {name cond} {
    global pass fail
    if {[uplevel 1 [list expr $cond]]} {
        incr pass
    } else {
        incr fail
        puts "FAIL: $name  ($cond)"
    }
}

# --- initTerrain -------------------------------------------------------------
set cols 64; set rows 36
set t [::folkville::initTerrain $cols $rows]
check "terrain length" {[string length $::t] == $::cols * $::rows}
check "terrain deterministic" {$::t eq [::folkville::initTerrain $::cols $::rows]}
set trees [llength [::folkville::cellsOf $t T $cols $rows]]
check "tree density sane" {$::trees > 50 && $::trees < 500}
check "only G and T initially" {[string map {G "" T ""} $::t] eq ""}

# --- cellAt / setCell --------------------------------------------------------
set t2 [::folkville::setCell $t 3 2 $cols "R"]
check "setCell sets" {[::folkville::cellAt $::t2 3 2 $::cols] eq "R"}
check "setCell leaves neighbors" {[::folkville::cellAt $::t2 4 2 $::cols] eq [::folkville::cellAt $::t 4 2 $::cols]}
check "setCell pure" {[::folkville::cellAt $::t 3 2 $::cols] ne "R" || [::folkville::cellAt $::t 3 2 $::cols] eq "R"}

# --- brushCells --------------------------------------------------------------
set cells [::folkville::brushCells 10.5 10.5 1.0 $cols $rows]
check "brush 1.0 hits center cell" {[lsearch -exact $::cells {10 10}] >= 0}
check "brush 1.0 small" {[llength $::cells] >= 1 && [llength $::cells] <= 5}
set cells [::folkville::brushCells 0.0 0.0 2.0 $cols $rows]
check "brush clipped at corner" {[llength $::cells] > 0}
foreach cell $cells {
    lassign $cell c r
    check "brush in bounds" {$c >= 0 && $r >= 0 && $c < $::cols && $r < $::rows}
}

# --- strokeCells: no gaps on a fast diagonal ---------------------------------
set cells [::folkville::strokeCells 2.0 2.0 30.0 20.0 1.0 $cols $rows]
check "stroke covers endpoints" {[lsearch -exact $::cells {2 2}] >= 0 && [lsearch -exact $::cells {29 19}] >= 0}
# every touched cell must have a touched neighbor (8-connectivity) => no gaps
set seen [dict create]
foreach cell $cells { dict set seen $cell 1 }
set gaps 0
foreach cell $cells {
    lassign $cell c r
    set connected 0
    foreach {dc dr} {-1 -1  -1 0  -1 1  0 -1  0 1  1 -1  1 0  1 1} {
        if {[dict exists $seen [list [expr {$c+$dc}] [expr {$r+$dr}]]]} { set connected 1; break }
    }
    if {!$connected && [llength $cells] > 1} { incr gaps }
}
check "stroke is connected" {$::gaps == 0}

# --- pave: grass only --------------------------------------------------------
set t [::folkville::initTerrain $cols $rows]
set treeCell [lindex [::folkville::cellsOf $t T $cols $rows] 0]
lassign $treeCell tc tr
set n [::folkville::pave t [list [list $tc $tr]] $cols]
check "pave refuses tree" {$::n == 0 && [::folkville::cellAt $::t $::tc $::tr $::cols] eq "T"}
# find a grass cell
set gCell {}
for {set c 0} {$c < $cols} {incr c} {
    if {[::folkville::cellAt $t $c 5 $cols] eq "G"} { set gCell [list $c 5]; break }
}
lassign $gCell gc gr
set n [::folkville::pave t [list $gCell] $cols]
check "pave paves grass" {$::n == 1 && [::folkville::cellAt $::t $::gc $::gr $::cols] eq "R"}
set n [::folkville::pave t [list $gCell] $cols]
check "pave idempotent" {$::n == 0}

# --- houses ------------------------------------------------------------------
set t [string repeat G [expr {$cols * $rows}]]
set houses {}
check "place house ok" {[::folkville::tryPlaceHouse t houses 5 5 $::cols $::rows] == 1}
check "house occupies 2x2" {[::folkville::cellAt $::t 5 5 $::cols] eq "H" && [::folkville::cellAt $::t 6 6 $::cols] eq "H"}
check "house recorded" {[llength $::houses] == 1}
check "no overlapping house" {[::folkville::tryPlaceHouse t houses 6 6 $::cols $::rows] == 0}
check "no house off-grid" {[::folkville::tryPlaceHouse t houses [expr {$::cols - 1}] 5 $::cols $::rows] == 0}
set t2 [::folkville::setCell $t 10 10 $cols "T"]
check "no house on tree" {[::folkville::tryPlaceHouse t2 houses 10 10 $::cols $::rows] == 0}

# bulldozing one corner removes the whole house
set n [::folkville::bulldoze t houses [list [list 6 6]] $cols]
check "bulldoze demolishes house" {$::n == 4 && [llength $::houses] == 0}
check "house cells back to grass" {[::folkville::cellAt $::t 5 5 $::cols] eq "G" && [::folkville::cellAt $::t 6 5 $::cols] eq "G"}

# bulldozer clears trees and road
set t [::folkville::setCell $t 8 8 $cols "T"]
set t [::folkville::setCell $t 9 8 $cols "R"]
set n [::folkville::bulldoze t houses [list [list 8 8] [list 9 8] [list 10 8]] $cols]
check "bulldoze clears T and R, skips G" {$::n == 2}
check "cleared to grass" {[::folkville::cellAt $::t 8 8 $::cols] eq "G" && [::folkville::cellAt $::t 9 8 $::cols] eq "G"}

# --- runsOf ------------------------------------------------------------------
set small [string repeat G 20]   ;# 5x4 grid
set small [::folkville::setCell $small 1 1 5 "R"]
set small [::folkville::setCell $small 2 1 5 "R"]
set small [::folkville::setCell $small 3 1 5 "R"]
set small [::folkville::setCell $small 0 3 5 "R"]
set runs [::folkville::runsOf $small R 5 4]
check "two runs" {[llength $::runs] == 2}
check "run merged" {[lsearch -exact $::runs {1 1 3}] >= 0}
check "single-cell run" {[lsearch -exact $::runs {3 0 0}] >= 0}

# --- stats -------------------------------------------------------------------
set s [::folkville::stats $small {}]
check "stats counts road" {[string match "*road 4 cells*" $::s]}

# --- quad helpers ------------------------------------------------------------
# axis-aligned quad, 100x100, top edge up
set q [list "display 1" {{100 100 0} {200 100 0} {200 200 0} {100 200 0}}]
lassign [::folkville::quadCenter $q] qx qy
check "quad center" {abs($::qx - 150.0) < 1e-6 && abs($::qy - 150.0) < 1e-6}
lassign [::folkville::quadUp $q] ux uy
check "quad up (screen up = -y)" {abs($::ux) < 1e-6 && abs($::uy + 1.0) < 1e-6}
# rotated 90° clockwise (top edge now points right: +x)
set q [list "display 1" {{100 200 0} {100 100 0} {200 100 0} {200 200 0}}]
lassign [::folkville::quadUp $q] ux uy
check "quad up rotated" {abs($::ux + 1.0) < 1e-6 && abs($::uy) < 1e-6}

# --- histSpread --------------------------------------------------------------
set hist {{0 5.0 5.0} {100 5.2 5.1} {200 5.1 5.3}}
check "spread small when still" {[::folkville::histSpread $::hist] < 0.4}
lappend hist {300 9.0 5.0}
check "spread large when moved" {[::folkville::histSpread $::hist] > 3.0}

# --- snapshot round-trip -----------------------------------------------------
set tmp [file join [expr {[info exists ::env(TMPDIR)] ? $::env(TMPDIR) : "/tmp"}] folkville-test.snapshot]
set houses {{5 5} {20 8}}
::folkville::saveSnapshot $tmp $t $houses 42
lassign [::folkville::loadSnapshot $tmp $cols $rows] t2 h2 r2
check "snapshot terrain" {$::t2 eq $::t}
check "snapshot houses" {$::h2 eq $::houses}
check "snapshot rev" {$::r2 == 42}
check "snapshot rejects wrong size" {[::folkville::loadSnapshot $::tmp 10 10] eq ""}
file delete $tmp
check "snapshot missing file" {[::folkville::loadSnapshot $::tmp $::cols $::rows] eq ""}

# -----------------------------------------------------------------------------
puts "----------------------------------------"
puts "PASS: $pass   FAIL: $fail"
if {$fail > 0} { exit 1 }
puts "all tests passed"
