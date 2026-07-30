# test-folkville-engine.tcl — drives folkville.folk's REAL engine loop in plain
# tclsh by stubbing the Folk primitives (When/Wish/Claim/Hold!/Query!) and
# simulating the clock and tag sightings. Run: tclsh test-folkville-engine.tcl
#
# Scenario: a paver drives across the table, a crane dwells and builds a
# house, a bulldozer clears part of the road, the reset card regrows the
# meadow. Asserts on the world claims the engine holds.

set here [file dirname [info script]]

# --- fake HOME so core loading + snapshots stay inside a sandbox -------------
set sandbox [file join [expr {[info exists ::env(TMPDIR)] ? $::env(TMPDIR) : "/tmp"}] folkville-engine-test]
file delete -force $sandbox
file mkdir [file join $sandbox folkville]
file copy [file join $here folkville-core.tcl] [file join $sandbox folkville folkville-core.tcl]
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
set heldWorlds {}
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
    if {[lrange $stmt 0 4] eq {Claim the folkville world is}} {
        lappend ::heldWorlds [lrange $stmt 1 end]
    } elseif {[lrange $stmt 0 4] eq {Claim the folkville crane dwell}} {
        incr ::dwellClaims
    }
}

# quad helper: 80x80 px axis-aligned quad centered on a pixel point,
# optionally rotated so the card "faces" +x (up = right)
proc quadAt {x y {facing up}} {
    set h 40.0
    if {$facing eq "up"} {
        set tl [list [expr {$x-$h}] [expr {$y-$h}] 0]
        set tr [list [expr {$x+$h}] [expr {$y-$h}] 0]
        set br [list [expr {$x+$h}] [expr {$y+$h}] 0]
        set bl [list [expr {$x-$h}] [expr {$y+$h}] 0]
    } else {  ;# facing right: top edge on the +x side
        set tl [list [expr {$x+$h}] [expr {$y-$h}] 0]
        set tr [list [expr {$x+$h}] [expr {$y+$h}] 0]
        set br [list [expr {$x-$h}] [expr {$y+$h}] 0]
        set bl [list [expr {$x-$h}] [expr {$y-$h}] 0]
    }
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
    lappend scenario [list [list p crane-page kind crane q [quadAt $cxp $cyp up]]]
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

proc worldField {world name} {
    # world claim tail: the folkville world is T with houses H cols C rows R origin O cell L rev V
    set i [lsearch -exact $world $name]
    lindex $world [expr {$i + 1}]
}
proc terrainOf {world} { lindex $world 4 }

check "When handlers registered" {$::whenCount == 3}
check "world held at least 4 times" {[llength $::heldWorlds] >= 4}

set initial [lindex $heldWorlds 0]
set cols [worldField $initial cols]
set rows [worldField $initial rows]
check "grid 60x36" {$::cols == 60 && $::rows == 36}
check "initial world has no road" {[string first R [terrainOf $::initial]] < 0}

# find the last world before the reset fired (reset starts at tick 106;
# use the world claims in order: find max road coverage)
source [file join $here folkville-core.tcl]
set bestRoad 0
set afterCrane {}
foreach w $heldWorlds {
    set t [terrainOf $w]
    set road [llength [::folkville::cellsOf $t R $cols $rows]]
    if {$road >= $bestRoad} { set bestRoad $road; set afterCrane $w }
}
check "paver painted a road (>= 30 cells)" {$::bestRoad >= 30}

# road runs along row 10 — verify a merged run exists on that row
set runs [::folkville::runsOf [terrainOf $afterCrane] R $cols 36]
set row10 0
foreach run $runs { if {[lindex $run 0] == 10} { incr row10 } }
check "road lies on row 10" {$::row10 >= 1}

set housesMax 0
foreach w $heldWorlds {
    set n [llength [worldField $w houses]]
    if {$n > $housesMax} { set housesMax $n }
}
check "crane built exactly one house (spent latch)" {$::housesMax == 1}
check "dwell progress claims emitted" {$::dwellClaims >= 5}

# bulldozer cleared road cells around (20,10) in some later world
set clearedSeen 0
foreach w $heldWorlds {
    set t [terrainOf $w]
    set rowRoad 0
    foreach run [::folkville::runsOf $t R $cols $rows] {
        lassign $run rr c0 c1
        if {$rr == 10} { incr rowRoad [expr {$c1 - $c0 + 1}] }
    }
    if {[::folkville::cellAt $t 20 10 $cols] eq "G" && $rowRoad >= 5} {
        set clearedSeen 1
    }
}
check "bulldozer cleared its spot but not the far road" {$::clearedSeen == 1}

# reset: the final world matches a fresh initTerrain and has no houses
set final [lindex $heldWorlds end]
check "reset regrew the meadow" {[terrainOf $::final] eq [::folkville::initTerrain $::cols $::rows]}
check "reset removed houses" {[llength [worldField $::final houses]] == 0}

# snapshot file written in the sandbox
check "snapshot persisted" {[file exists [file join $::sandbox folkville-world.snapshot]]}

puts "----------------------------------------"
puts "PASS: $pass   FAIL: $fail"
file delete -force $sandbox
if {$fail > 0} { exit 1 }
puts "engine simulation passed"
