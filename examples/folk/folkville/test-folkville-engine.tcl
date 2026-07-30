# test-folkville-engine.tcl — drives folkville.folk's REAL engine loop in plain
# tclsh by stubbing the Folk primitives (When/Wish/Claim/Hold!/Query!) and
# simulating the clock and tag sightings. Run: tclsh test-folkville-engine.tcl
#
# Scenario: a paver drives across the table, a crane dwells and builds a
# house, a bulldozer clears its spot, the reset card regrows the meadow.
# Asserts on the render-ready scene claims the engine holds.

set here [file dirname [info script]]

# --- fake HOME so the snapshot file stays inside a sandbox -------------------
set sandbox [file join [expr {[info exists ::env(TMPDIR)] ? $::env(TMPDIR) : "/tmp"}] folkville-engine-test]
file delete -force $sandbox
file mkdir $sandbox
set ::env(HOME) $sandbox

# --- dict getdef shim for Tcl 8.6 (Folk ships a newer Tcl that has it) -------
if {[catch {dict getdef {} k v}]} {
    proc ::fvDictGetdef {d args} {
        set default [lindex $args end]
        set keys [lrange $args 0 end-1]
        if {[dict exists $d {*}$keys]} { return [dict get $d {*}$keys] }
        return $default
    }
    namespace ensemble configure dict -map \
        [dict merge [namespace ensemble configure dict -map] \
             {getdef ::fvDictGetdef}]
}

# --- simulated clock ---------------------------------------------------------
set simMs 1000000
rename clock _realClock
proc clock {cmd args} {
    if {$cmd eq "milliseconds"} { return $::simMs }
    tailcall _realClock $cmd {*}$args
}

# --- Folk primitive stubs ----------------------------------------------------
set this "folkville.folk"
set whenCount 0
set heldScenes {}
set dwellClaims 0

proc When {args} { incr ::whenCount }   ;# bodies not executed (renderer is visual)
proc Wish {args} {}
proc Claim {args} {}

proc Hold! {args} {
    # strip options, find the trailing "Claim ..." statement
    set i 0
    while {$i < [llength $args]} {
        set a [lindex $args $i]
        if {$a in {-key -keep -on -destructor}} { incr i 2; continue }
        if {$a in {-noncapturing -save --}} { incr i 1; continue }
        break
    }
    set stmt [lrange $args $i end]
    if {[lrange $stmt 0 4] eq {Claim the folkville scene is}} {
        lappend ::heldScenes [lrange $stmt 1 end]
    } elseif {[lrange $stmt 0 3] eq {Claim the folkville crane}} {
        incr ::dwellClaims
    }
}

# quad helper: 80x80 px axis-aligned quad centered on a pixel point, card
# facing screen-up
proc quadAt {x y} {
    set h 40.0
    set tl [list [expr {$x-$h}] [expr {$y-$h}] 0]
    set tr [list [expr {$x+$h}] [expr {$y-$h}] 0]
    set br [list [expr {$x+$h}] [expr {$y+$h}] 0]
    set bl [list [expr {$x-$h}] [expr {$y+$h}] 0]
    list "display 1" [list $tl $tr $br $bl]
}

# --- the scripted scenario ---------------------------------------------------
# Grid with defaults: display 1280x800, MARGIN 40, CELL 20 -> 60x36 cells,
# origin (40, 40). Cell (c,r) center pixel = (40 + 20c + 10, 40 + 20r + 10).
proc cellPx {c r} { list [expr {50 + 20*$c}] [expr {50 + 20*$r}] }

set scenario {}
# ticks 0-39: paver drives along row 10 from col 5 to col 44 (1 col/tick)
for {set i 0} {$i < 40} {incr i} {
    lassign [cellPx [expr {5 + $i}] 10] x y
    lappend scenario [list [list p paver-page kind paver q [quadAt $x $y]]]
}
# ticks 40-49: nothing on the table
for {set i 0} {$i < 10} {incr i} { lappend scenario {} }
# ticks 50-95: crane dwells at cell (30,20), facing up -> house site ~(29,16)
lassign [cellPx 30 20] cxp cyp
for {set i 0} {$i < 46} {incr i} {
    lappend scenario [list [list p crane-page kind crane q [quadAt $cxp $cyp]]]
}
# ticks 96-105: bulldozer parks on the road at cell (20,10)
lassign [cellPx 20 10] bx by
for {set i 0} {$i < 10} {incr i} {
    lappend scenario [list [list p dozer-page kind bulldozer q [quadAt $bx $by]]]
}
# ticks 106-225: reset card visible (needs >3000ms = >60 ticks at 50ms);
# the extra length also pushes sim time past the 10 s snapshot interval
for {set i 0} {$i < 120} {incr i} {
    lappend scenario [list [list p reset-page kind reset q [quadAt 200 200]]]
}

set tick -1
proc Query! {args} {
    if {[lrange $args 0 0] eq "display"} {
        return [list [dict create disp fakedisp dw 1280 dh 800]]
    }
    # tool query — serve the current scenario step
    set step [expr {$::tick < 0 ? {} : [lindex $::scenario $::tick]}]
    set out {}
    foreach t $step { lappend out $t }
    return $out
}

rename exec _realExec
proc exec {args} {
    if {[lindex $args 0] eq "sleep"} {
        incr ::simMs 50
        incr ::tick
        if {$::tick >= [llength $::scenario]} {
            return -code error FVDONE
        }
        return
    }
    tailcall _realExec {*}$args
}

# --- run the actual program --------------------------------------------------
set rc [catch {source [file join $here folkville.folk]} err]
if {$rc && $err ne "FVDONE"} {
    puts "ENGINE ERROR: $err"
    puts $::errorInfo
    exit 1
}

# --- assertions --------------------------------------------------------------
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

# scene claim tail: the folkville scene is rev V with roads RR trees TT
#                   houses HH grid {C R} origin {X Y} cell L stats S
proc sceneField {scene name} {
    set i [lsearch -exact $scene $name]
    lindex $scene [expr {$i + 1}]
}
proc roadCellCount {scene} {
    set n 0
    foreach run [sceneField $scene roads] {
        lassign $run r c0 c1
        incr n [expr {$c1 - $c0 + 1}]
    }
    return $n
}
proc row10Coverage {scene} {
    # {cells covering col 20?} and total road cells on row 10
    set total 0
    set covers20 0
    foreach run [sceneField $scene roads] {
        lassign $run r c0 c1
        if {$r != 10} { continue }
        incr total [expr {$c1 - $c0 + 1}]
        if {20 >= $c0 && 20 <= $c1} { set covers20 1 }
    }
    list $covers20 $total
}

check "When handlers registered" {$::whenCount == 3}
check "scene held at least 4 times" {[llength $::heldScenes] >= 4}

set initial [lindex $heldScenes 0]
check "grid 60x36" {[sceneField $::initial grid] eq {60 36}}
check "initial scene has no road" {[sceneField $::initial roads] eq {}}
set initialTrees [llength [sceneField $initial trees]]
check "initial tree scatter present" {$::initialTrees > 50 && $::initialTrees < 500}

set bestRoad 0
foreach s $heldScenes {
    set n [roadCellCount $s]
    if {$n > $bestRoad} { set bestRoad $n }
}
check "paver painted a road (>= 30 cells)" {$::bestRoad >= 30}

set row10Seen 0
set clearedSeen 0
foreach s $heldScenes {
    lassign [row10Coverage $s] covers20 total
    if {$total >= 5} { set row10Seen 1 }
    if {!$covers20 && $total >= 5} { set clearedSeen 1 }
}
check "road lies on row 10" {$::row10Seen == 1}
check "bulldozer cleared its spot but not the far road" {$::clearedSeen == 1}

set housesMax 0
foreach s $heldScenes {
    set n [llength [sceneField $s houses]]
    if {$n > $housesMax} { set housesMax $n }
}
check "crane built exactly one house (spent latch)" {$::housesMax == 1}
check "dwell progress claims emitted" {$::dwellClaims >= 5}

# reset: final scene is a fresh meadow (procs are defined by folkville.folk)
set final [lindex $heldScenes end]
set freshTrees [llength [::folkville::cellsOf [::folkville::initTerrain 60 36] T 60 36]]
check "reset regrew the meadow" {[llength [sceneField $::final trees]] == $::freshTrees}
check "reset cleared roads" {[sceneField $::final roads] eq {}}
check "reset removed houses" {[sceneField $::final houses] eq {}}

# snapshot file written in the sandbox
check "snapshot persisted" {[file exists [file join $::sandbox folkville-world.snapshot]]}

puts "----------------------------------------"
puts "PASS: $pass   FAIL: $fail"
file delete -force $sandbox
if {$fail > 0} { exit 1 }
puts "engine simulation passed"
