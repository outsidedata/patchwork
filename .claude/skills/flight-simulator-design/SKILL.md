---
name: flight-simulator-design
description: Recipes for building flight and air-combat simulators — the frame clock, the flight model, the pilot AI, guidance and weapons, sensing and belief, the chase camera, and the harness that proves any of it. Use when building or debugging a flight sim, dogfight AI, missile guidance, autopilot, terrain avoidance, radar/RWR/sensor model, fire control, or a fixed-step game loop with interpolation. Trigger on "the ship jitters", "the plane flies into the ground", "the missile misses", "the AI won't engage", "the camera lags", "is this balanced", "the checks are green but it's broken", or before claiming any of that works.
---

# Flight simulator design

Every rule here was paid for. Each one carries the failure that bought it, with the number that was
measured and the repo it was measured in — `tieclone` (a Three.js X-Wing-era space combat game) or
`fsim2` (an atmospheric SEAD sim with a real aero model and a bearing-only sensing layer). Nothing
below is a principle somebody liked the sound of.

**Read the failure, not just the rule.** A rule you can restate but have not seen break is a rule
you will violate the first time it is inconvenient. If you are about to skip one, go find its
number in the list and decide whether you want that number back.

---

## 0. The three constraints everything else rests on

Break any one of these and every measurement the project makes becomes decorative — quietly, with
all checks still green.

1. **The simulation is renderless.** The physics, AI, weapons and mission code must never touch a
   canvas, a texture, the DOM or a GPU. That is what lets a headless harness step *the shipped
   code*. A second copy of the combat maths measures a game nobody plays. Rendering imports the
   sim; the sim never imports rendering.

   Corollary that is easy to get wrong: state that *looks* like animation but is really a readout
   of a decision belongs in the sim. In `tieclone` the repair droid's arm extension and weld
   flicker are seven floats living in the simulation, so the harness can assert the arms come out
   when and only when it is repairing. Put them in the renderer and that claim is about a file
   nothing measures.

2. **The AI's only output is the struct a human hand fills.** Pitch, roll, yaw, throttle, brake,
   trigger, launch — the same seven-ish numbers a keyboard produces, fed to the same integrator.
   No code path moves a ship directly. This is not tidiness: it means the AI cannot teleport,
   cannot exceed its airframe, cannot turn tighter than its sheet allows, and tuning the player's
   handling necessarily retunes every computer pilot. In `fsim2` the pilot faculties are literally
   `state → InputFrame` functions with no world access at all, which is why a terrain floor had to
   be passed in as a number rather than read: a pure faculty cannot cheat.

3. **A behaviour claim you cannot measure is a behaviour claim you do not have.** Not "add tests" —
   instrument the thing so the claim becomes arithmetic. `tieclone`'s design doc names the dogfight
   AI as the instrument that decides unit balance, so the AI had to be measurable before any
   balance question could be asked at all.

---

## 1. The frame clock

### 1.1 Fixed step, render interpolated, and the leftover is sacred

Step the world at a fixed rate, accumulate real time, run whole steps, and draw
`lerp(previous, current, leftover / step)`. Without the interpolation a 60 Hz display shows every
other 120 Hz physics frame and the whole scene strobes.

**The leftover is the interpolation phase. Never reset it.** *(witnessed: `tieclone`, this is the
one I broke myself)* The loop capped at 4 sub-steps of 1/120 s, so it could only ever cover 33.3 ms
of world time per frame — but frame time was clamped at 250 ms, thirty steps' worth. Any frame
longer than 33.3 ms therefore handed the accumulator more time than the loop could spend, and the
leftover was zeroed to stop it spiralling. Zeroing it drops the *phase* along with the backlog:
alpha fell from ~1.0 to 0 in one frame, every interpolated pose in the scene jumped a full step
backwards, and the camera — lagging smoothly on the wall clock, knowing nothing about it — did not
follow. The player's own hull lurched toward the lens and crept back out, several times a second,
for as long as the frame rate stayed under 30.

Measured, chase standoff that should be a constant 29 m:

| | before | after |
|---|---|---|
| 60 fps | 0.12 m | 0.12 m |
| 30 fps | **3.17 m** | 0.08 m |
| 40 fps with hitches | **5.07 m** | 0.45 m |
| 30 fps with hitches | **8.16 m** | 0.07 m |

The fix is one line and it is not the drop: **clamp the frame time to what the sub-steps can
actually consume**, before accumulating. Then the leftover is under one step by construction, the
phase is continuous, and there is no backlog to throw away. A frame the machine could not afford
becomes slow motion for *everything at once* rather than the world falling behind a camera still
running on the wall clock.

If you must drop a backlog anyway, drop **whole steps only** — keep the fraction.

### 1.2 Hand the same dt to everything

Whatever time the world advanced this frame is the time the camera, the effects, the stick and the
timers advance. Clamping only the physics and letting the camera run on raw wall-clock time makes
them disagree about how much time passed, and the difference shows up as the subject sliding in
frame at whatever speed the vehicle happens to be doing.

One exception, and it is a real one: a frames-per-second readout must use the **raw** frame time.
Feed it the clamped value and it cannot read below the clamp — a counter that says 30 on a machine
managing twelve is worse than no counter.

### 1.3 A bad first frame is forever if anything feeds back into itself

*(witnessed: `tieclone`)* The timestamp handed to the first animation-frame callback can predate the
clock reading taken during module evaluation on a page that took a while to boot. Measured: −29.7 ms
on frame one of every load. A negative timestep made the camera's per-frame movement allowance
negative, which a zero-length move satisfies, which is a zero divided by a zero — and because every
later frame interpolates from the camera's own position, the NaN never washed out. Black screen from
frame one, all seventeen camera checks green, and the simulation underneath running perfectly.

Clamp dt at **both** ends. And treat any per-frame state that feeds back into itself as a latch that
has to be provably unreachable, not merely unlikely.

### 1.4 Time constants must be exact exponentials

Any smoothing, lag or damping constant expressed as "multiply by 0.9 each frame" measures a
different aircraft at 120 Hz than at 60 Hz. Use `1 − exp(−dt / tau)`. Then the harness and the
browser fly the same machine.

Know what an exponential lag does to a *moving* target: it settles with a permanent error of
`speed × tau`. At 320 m/s and a 0.09 s constant that is 29 m of extra trail, which is how a
configured 34 m chase camera measured 57 m and rendered the ship half the size it should have been
*(witnessed: `tieclone`)*. An earlier version of this rule said to cancel it with velocity
feedforward — lead by the same term. **That advice was wrong and is withdrawn**: the lead only
cancels exactly in the continuous limit, its discrete residual (≈ `v·dt/2`) moves with the frame
time, and it manufactured a stutter that survived months of debugging because this file kept
prescribing the patch. The real fix is to never smooth the position that contains the subject's
motion at all — see §6.1, which now carries the whole story.

### 1.5 A rate measured in one harness is not a rate

*(witnessed: `tieclone`)* The same "send half the squadron" produced a two-minute endgame in the
harness's six-ship escort and an eleven-second one in the browser's twenty, with every check green
in both. Anything expressed as a **fraction of the population** scales with the population.
Anything that should feel the same at both sizes has to be a **count**. Check every such number at
two population sizes before believing it.

---

## 2. The flight model

### 2.1 Write the axis convention down, then derive the signs and assert them

Which way the nose points, which way is up, what units. In `tieclone` ships face −Z, and the
rotation signs in the body-rate integrator are derived in a comment rather than guessed, with the
flight report asserting all three from the resulting orientation. A model authored facing the other
way flies backwards.

The corollary bites in reverse for *generated* geometry: an engine wake tube built down −Z and then
turned by the hull's own rotation comes out of the **nose**. Build it down +Z.

### 2.2 Top speed is where thrust crosses drag, not a number you type

*(witnessed: `fsim2`)* Constant thrust, real drag, and the crossing point is the top speed:
`v_eq = √(thrust / (½ρ(S·cd0 + A_struct)))`. Deriving it from the sheet rather than authoring a
taper means one closed form that the certification pass, the studio card and the cockpit all read,
so they cannot drift apart.

The trap in that formula is the wing area in the denominator. Without a second, area-independent
drag term for the structure, a wing tending to zero sends the equilibrium speed to infinity —
**measured: a 0.1 m² wing gave Mach 78**. With a structure drag shadow the limit is bounded. Each
dial then does exactly one thing: wing area buys turning, structure buys the speed floor no engine
buys past.

### 2.3 Aircraft always fly — they die to warheads and to the ground

*(`fsim2`, a deliberate design choice worth copying)* Cap speed magnitude at a small margin over the
equilibrium speed computed from the **authored sheet at sea-level density** — one number per
airframe, never the measured output fed back, or you have a control loop nobody designed. Scale
every velocity component by the same factor so the direction is untouched and the magnitude pins
exactly to the cap, which is zero chatter. No overspeed damage. A diving plane rides the wall.

Missiles run a separate integrator and are not capped.

---

## 3. The pilot — autopilot, AI, and the ground

The ground kills more of your aircraft than the enemy does, and every one of these was watched
happening.

### 3.1 Pitch grafted onto a bank is a level turn

*(witnessed: `fsim2`, four aircraft dead exactly at terrain height on one island run)* A terrain
override that jams the pitch channel to full while leaving the aircraft's existing bank is a
**turn**, not a climb. You cannot climb while banked. Every unattended crash on that run happened
with the override active and the wings still banked into the ridge. The override must fly the same
wings-level pull the dedicated ground guard flies — the whole manoeuvre, not one channel of it.

### 3.2 Full aft stick is not a pull-out, and neither is a stall gate

*(witnessed: `fsim2`, same island)* Two simpler ground guards were measured killing aircraft:

- A flat maximum pitch command pinned the wing past the stall and the aircraft **mushed in — 1,400 m
  of descent at −100 m/s with full aft stick the whole way.**
- A bang-bang gate that backed off whenever the wing stalled chattered at 60 Hz against the
  elevator's own slew rate and averaged out to a **dead stick: a constant-speed vertical dive, seven
  seconds, no pull at all.**

What works is a proportional hold on angle of attack at maximum *attached* lift — the hardest pull
the wing can actually deliver, set to the conservative floor of the fleet's stall angles. Hold the
lift peak; do not ask for more than the wing has.

### 3.3 Roll commands must be continuous through knife-edge and inverted

*(witnessed: `fsim2`)* A guard whose roll command came from one component of the up vector, with a
separate branch for inverted flight, parked a diving aircraft in a **knife-edge spiral: the up
vector wobbling ±0.4 around zero for 250 ticks, aileron reversing every few ticks, −220 m/s all the
way to the sea.** Use a signed bank angle from a two-argument arctangent so the command never flips
sign at the 90° boundary, and damp it with the roll rate.

And pull only as the lift vector comes skyward. At 90° of bank a pull just tightens the spiral.

### 3.4 A defensive manoeuvre needs a floor, and the floor comes from the caller

*(witnessed: `fsim2`)* The defensive break dives into ground clutter to break a doppler lock. Over
low ground or water "the clutter" is the surface: the unfloored version **dove two evading aircraft
into the sea faster than any pull-out could recover**, and the reactive look-ahead floor is
geometrically blind to a dive it has not entered yet. A pure state-to-stick faculty does not know
the ground under the aircraft. The caller does. Pass it in.

### 3.5 Do not add a second lead term to something that already tracks its target

*(witnessed: `tieclone`)* Both the pursuit perch and the formation slot were already recomputed from
the target's current pose every frame. Adding `velocity × time` on top double-counts and parks the
chaser permanently downrange. **Cost: a 272 m formation error that never converged.**

### 3.6 Skill is aim error, not permission

*(`tieclone`)* A weak pilot points at the wrong lead. It is not *forbidden* to shoot. Gating the
trigger on a skill number produces computer opponents that behave like difficulty settings rather
than like pilots, and it makes the skill gradient unmeasurable — you cannot tell a bad shot from a
withheld one.

Two related shapes from the same file, both worth copying: keep the carrot (where to fly) and the
trigger (when to shoot) **decoupled**, so a head-on merge is never passive; and prefer one blended
steering formula over a pursuit state machine, so there are no mode-transition artefacts to debug.

### 3.7 Hysteresis on every latch a pilot can chatter

Extend-versus-reengage off two different energy thresholds, not one. A stalemate breaker that fires
after a held maximum-deflection turn has gone unresolved for N ticks. Anything read as a boolean
each frame and acted on will oscillate at the frame rate the first time the underlying number sits
near the line.

---

## 4. Guidance and weapons

### 4.1 Closing speed is a gain, not a direction

*(witnessed: `fsim2`)* In proportional navigation, the line-of-sight rotation crossed with the
line-of-sight unit vector **already points the turn that nulls the rotation**, whether the round is
closing or opening. Multiplying by a *signed* closing speed flips the command whenever the round is
momentarily opening — a stern-chase launch from a rail slower than the runner **boosted itself away
from a perfect guide: measured, a 404 m shot zoom-climbed 8 km.** Use the magnitude. Closing
geometries are byte-identical either way, so the bug hides everywhere except the one case that
matters.

### 4.2 The sheet and the flight driver must be one number

*(witnessed: `fsim2`)* The anti-radiation round's sheet claimed 90 km of reach; its flight numbers
got it 16 km. Every long shot would have been approved by the fire control and then quietly fallen
out of the sky. All three powered rounds had speeds wrong by 1.6–1.8×, which is also what sets how
long a target's position doubt grows before impact. Fix at the source: a round's flight numbers live
on its weapon sheet, both halves read that one place, and a check **flies each weapon to its stated
reach and fails if it does not arrive.**

### 4.3 Test reach against distance flown, not launch range

*(witnessed: `fsim2` adversarial pass)* **30 of 30 shots approved on a tail chase, 0 of 30 hit.** The
target ran; the round flew far further than the range at launch. Same pass, same shape: a seeker
cone evaluated at the sheet's maximum reach at *every* range gave **30 of 30 approved at 4 km, 0 of
30 hit.** And an unconverged time-of-flight iteration produced a **190 s error against a runner**,
which feeds both the doubt growth and the reach test.

### 4.4 A lock is not an edge

*(witnessed: `tieclone`)* Lock logic clears the tone the instant the cone or the range lapses and
re-acquires a moment later; launching clears it outright. Anything that fires on a false→true
transition therefore fires several times per engagement — the first heads-up display announced one
lock three times and strobed its own banner. Hold the state open for a configured interval and treat
only a hold that reached zero as new.

### 4.5 A launch at a fixed point has no cadence of its own

*(witnessed: `tieclone`)* A guided launch is rate-limited by having to re-acquire a tone. A launch at
a static coordinate has no tone to lose, so a launch command held true for six frames is six
missiles. Give it its own explicit gate.

### 4.6 Two sources of fire are two different answers

*(`tieclone`, a mechanism worth stealing)* A round carries which kind of thing fired it. A hull with
the right property takes zero damage from a capital ship's deck battery and full damage from a
fighter's cannon. That single asymmetry is an entire mission stage: the bomber wing flies a corridor
over live guns that cannot touch it, and the only thing that can stop it is a fighter above it.

The source must travel **with the round**. Inferring it at the point of impact from some marker on
the owner identifier works by accident until the first blast or script that damages a ship without
one.

---

## 5. Sensing, tracks and belief

Only if your sim has sensors worth the name. This section is nearly all `fsim2`, where the sensing
layer was torn out and rebuilt through six wrong answers.

### 5.1 Separate how precise the last look was from how much doubt there is now

The first arrives with the measurement and is never stored. The second shrinks when a look lands and
grows every second one does not. A track reports doubt and age as two fields. Collapsing them into a
single "confidence" number is what made a later mistake — merging contacts across sensors — look
safe when it was not.

### 5.2 One Gaussian cannot say "somewhere along this line, I don't know how far"

**The central result.** A bearing with no range in it, fed to an ordinary Cartesian
constant-velocity filter, produces a belief that drifts along the line of sight while its claimed
doubt shrinks *across* it. Measured on the geometry with no observability at all — closing straight
down the bearing, where the bearing never moves:

    geometry     coverage   error     claimed ellipse
    head-on        0.25      32.3 km      6.6 km

Coverage 0.25 means the target was outside the region the filter was willing to bet on in three runs
out of four, while it claimed a 6.6 km ellipse. The mechanism: the bearing row of the update grows as
the believed range shrinks, so flying at your own guess collapses the guess toward you, and as it
collapses a 6° bearing starts behaving like a metre-accurate fix.

What fixed it was changing the *shape* — several range hypotheses along the bearing, each a filter in
its own right, weighted by how well it has explained the bearings so far, with the ambiguity held as
disagreement between them. Head-on coverage 0.25 → 0.93, and every geometry got **more accurate at
the same time**, so the honesty was not bought by drawing a bigger ellipse.

Two properties made it the answer rather than a second mechanism bolted on: with one component it is
arithmetically the filter it replaced (checked to 0.000000 m), so the ranged case *is* the
one-component case; and it matches a twenty-thousand-particle filter in honesty and accuracy for
about a millisecond a run.

### 5.3 Coverage is the number to read

Not error, not the claimed ellipse, and not a squared-error-over-claimed-doubt ratio on its own.
Coverage — the share of runs where the truth was inside the 95% region — is the plainest possible
statement of the failure: **how often the thing was not where the filter said it might be.** Honest
is 0.95.

### 5.4 Grade on the geometry with no information in it

The single "about 2.3× too confident" figure that held the project up for a week was taken on the
geometry with the *most* information in it and hid a case that was four hundred times worse. Every
formulation honest on one geometry can lie on another. Grade on: good observability, none at all,
oblique, weaving, a brief look, a mobile target, and a ranged control that must come out unchanged.

### 5.5 The prior is an input, not a knob

On a geometry with no observability the accuracy is **entirely** the range prior. Swap the priors and
the results swap:

    head-on, 20 seeds              error    coverage
    mixture, told 70 km            3.0 km     1.00
    mixture, told 150 km          54.0 km     1.00
    particle filter, told 150 km  41.1 km     1.00
    particle filter, told 70 km    3.7 km     1.00

That is not a defect. It is what Bayes says should happen when nothing has been learned. But it means
"where does the prior come from" is a design question with a physical answer — a receiver that knows
what kind of emitter it is hearing knows roughly what power was transmitted and therefore roughly how
far away it is — not a constant to tune.

### 5.6 Some information is irreducible and must be authored

How mobile the thing might be cannot be inferred from bearings. The identical bearings, told the
target might be doing 400 m/s, leave 46 km of doubt instead of 1.7 km — the geometry did not change,
what it might be did. And being told it *wrongly* cannot be detected from inside the layer: told
parked while actually driving at 20 m/s gave **coverage 0.00** — the truth was never once inside the
region the belief was willing to bet on.

Three fixes for that were built and measured and **all three did nothing**, and each failure taught
something worth more than the fix:

1. *Widen when a look is refused.* No effect — a mixture holds a hypothesis all along the bearing, so
   a bearing almost always fits something. Nothing is ever refused, so nothing trips.
2. *Widen when the disagreements stop being even-handed* (the textbook way to catch a wrong motion
   model). No effect — the mixture slides its weight to whichever hypothesis explains the current
   bearing, so no hypothesis ever accumulates a one-sided residual. **The flexibility that makes the
   shape honest about range is exactly what hides a wrong motion model.**
3. *Measure a range as well.* Coverage stays at 0.00 — being told the thing cannot move means old
   measurements never go stale, so the belief refuses the evidence that it moved.

The engineering conclusion is that a fixed mast and a launcher on a truck are different units and
must be authored as such. The game consequence is that shoot-and-scoot beats a passive geolocation
shot, which is true of the real thing.

### 5.7 Do not merge contacts across sensors, and do not keep a lock table

Whether my radar's contact and your receiver's contact are the same object is a **guess that can be
wrong**; merging asserts it. Hand over every station's opinion side by side and let each weapon read
the half it needs. *(Measured consequence of not doing this: a panel that graded every weapon against
one "best" contact discarded the receiver's knowledge that a site was transmitting the moment a
tighter contact won, and judged an anti-radiation shot as though the site were dark.)*

A fixed number of lock slots freezes when full: a saturated radar could never take an inbound, and a
one-slot seeker chose by array order. Ask the question per weapon per tick instead — **a lock is a
contact whose doubt fits inside what the weapon can still search when it arrives.** Nothing fills up,
so nothing jams, and forty simultaneous contacts give the same answers each would alone. Scarcity
still arrives, as doubt: a sensor spreading its looks thinner leaves longer gaps, and doubt grown
across a gap fails the fit test on its own.

### 5.8 Let the physics hand you the mechanic

*(`fsim2`)* An echo makes the trip twice and comes back a millionth of itself while an emission makes
it once, so passive hearing range grows as the *square* of seeing range — a 120 km search set would be
heard from 1440 km on power alone, which is absurd. What binds it is not a fudge: the horizon for a
30 m mast seen from 8 km is 391 km, and that is what the measurement shows. So at 60 km that mast
only reaches you above 85 m, and below that the earth is in the way and neither of you exists to the
other. **The low-flying mechanic falls out of the curvature for free rather than being an authored
rule.** Both claims were watched going red with curvature switched off.

---

## 6. The camera

### 6.1 Feed it the interpolated pose, and smooth it in the SUBJECT'S frame — never in world space

Chasing the raw fixed-step pose on a display at any other rate puts the judder straight into the
viewport. Everything in §1 applies to the camera before it applies to anything else, because the
camera is the only object whose error the player sees as motion of *everything*.

**And smooth only ship-relative quantities — the boom (eye − ship), the gaze (aim − ship), the up
vector. Never the camera's absolute position.** *(witnessed: `tieclone`, the most expensive camera
lesson in this file)* At the moment of drawing, the subject's pose is exactly known; a camera whose
translation is bolted to it 1:1 cannot trail it, at any speed, at any frame time, and the damping
spends itself where the jerk actually is — attitude twitches, mode swings, solve re-compositions,
which are all rotations of geometry *around* the hull.

Smoothing the absolute position instead sets off a chain in which every link looks correct:

1. the world-space lag trails a moving subject by `v·τ` (29 m at cruise — §1.4), so
2. a velocity lead is added to cancel it, which works on paper, but
3. the discrete residual of that cancellation, ≈ `v·dt/2`, **moves with the frame time** —
   measured at 300 m/s: the camera settled 1.2 m off at 120 Hz and 4.7 m off at 30 Hz — so
4. ordinary frame-time jitter slides the hull metres along its track *in frame*, which reads as
   the ship surging behind the camera and catching up, at ANY average frame rate, on any hardware.

That stutter survived repeated debugging passes precisely because each pass found the clock and
the interpolation provably exact and stopped there — the error lived in the camera's settling
point, downstream of everything the frame-clock instrumentation measures. It was finally killed
not by a better lead but by deleting the lead and the world-space smoothing together and keeping
the damping ship-relative, which needs no prediction and has no dt-dependent term anywhere.

Two consequences worth keeping:

- The slew cap stays, in world space, as the LAST step: with rigid translation a subject teleport
  or swap transmits instantly, and the cap is what turns that cut into a sweep. After clamping,
  write the clamped position back into the stored relative offset, or the next frame undoes the
  clamp in one jump. And seed the camera's world position on the first frame, or the cap sweeps
  the opening seconds in from wherever the camera object was constructed.
- A golden trace of frozen camera positions became deletable the same day. It existed to guard a
  fragile mechanism whose wrong constants showed up as geometry drift; the ship-frame design has
  no such constants, so every claim worth holding could be stated as a property (both bodies in
  frame, no NaN at the merge, no step over the cap, converged offset identical at 30/60/120 Hz).
  If a camera needs a table of magic numbers to stay correct, that is the design asking to be
  simplified, not a test asking to be written.

### 6.2 Damp every channel, including the one that looks like it does not need it

*(witnessed: `tieclone`)* The camera's up vector was for a long time the one term with no damping —
recomputed from the hull's current attitude and assigned raw every frame. Roll is how a pilot points
at things, the roll rate was 5 rad/s with a 0.05 s response, and **55% of that was landing directly in
the viewport: measured at 366°/s of camera roll**, which is the jerk you feel whenever a computer
pilot is lining up a shot. Damping it is what turns "following a ship" into "a camera operator
following a ship".

### 6.3 Cap the on-screen step, and guard the cap against a zero

The ideal camera position is allowed to be discontinuous — a mode change and a merge both move it a
long way in one frame. What is on screen is not. Cap the step at the subject's own speed plus an
allowance, so a jump becomes a fast move rather than a cut.

Then note that `step > cap` is satisfied by a step of exactly **zero** when the cap is non-positive,
and the scale factor is a zero over a zero. That is the NaN in §1.3. Guard `cap > 0` explicitly.

### 6.4 A two-body framing must bound both the standoff and the aim point

*(witnessed: `tieclone`)* A camera that frames you against another aircraft, with the standoff
tracking the separation exactly, contains both bodies at every range and is useless to look at,
because the composition is self-similar: **measured at 3.2 km separation, the camera sat 2387 m back
and the player's own fighter was six pixels tall.** Bound the separation the framing scales with.

Bound the **aim point** with it, or you get the other failure: capping only the standoff leaves the
camera aimed at the midpoint of a 3 km gap from 300 m away, which puts the subject 1.4 km *behind*
the lens. Both terms scale together or neither does.

### 6.5 Ask what a camera mode is actually reading

*(witnessed: `tieclone`)* The "look back at whoever is chasing me" view was fed the astromech's threat
assessment, whose decision order falls through to *my own target* when nobody is hunting me — which is
in front. Measured with the camera 0.93 units behind the nose when it should have been looking down
it: the rear view had silently become a second forward view. Gate on the specific question you mean,
not on the nearest available number.

---

## 7. The harness — how you know any of this is true

This section is the one that makes the rest possible, and it is the one that gets skipped.

### 7.1 Plant the defect first. A check that has never been seen to fail is not evidence

*(`fsim2`'s standing rule, and the reason its numbers can be trusted)* Every claim in that sensing
layer was watched going red with a defect planted on purpose, one at a time — one hypothesis instead
of ten, three instead of ten, the disagreement term dropped, simultaneous alternatives allowed to
join, weights never updated, anything joined to anything. **The three-hypothesis plant is caught by
exactly one check**, the head-on honesty check, and is otherwise indistinguishable from a good
filter. Without that check the plant passes and the layer looks fine.

If you add a claim, plant its defect before you trust its green.

Two holes found in the *checking* rather than the code, both worth stealing:

- A plant run reported "0 failures" for a configuration that **crashed** the checker — failures were
  being counted by scanning for failure lines, and a crashed run has none. Judge plants on exit code
  as well.
- There was no honesty check at all on the geometry where the original defect was worst.

### 7.2 False greens are the failure mode

A ratio between two zeros passes. When a report goes green after a change, confirm the underlying
numbers are non-degenerate. Write the guard into the report itself: `tieclone`'s frame-clock check
asserts that the drive sequence *contains* frames longer than the loop can cover before asserting
anything about them, so a gentler sequence can never produce a meaningless pass.

And where you can, end a report with the **negative control**: the old code, reconstructed inline,
asserted to fail the same drive. A fix whose check also passes against the bug is not a check.

### 7.3 A stand-in in a check is a claim you have not tested

*(witnessed: `tieclone`)* Every mission check leaned on a helper that damaged the objective directly,
standing in for a player pressing the attack. All the reports were green while, in the browser, the
final stage was a dead end: nothing in the AI could shoot a thing that was not a ship, and the
objective sat at full health forever. The stand-in was honestly labelled and still hid an
uncompletable stage. **Where there is no player, at least one check has to finish the job with no
stand-in at all.**

### 7.4 Certify the data sheet before anything is placed

*(`fsim2`)* Two kinds of check, and you need both. **Closed-form** trim and envelope algebra straight
from the sheet, which is blind to sign errors. **Dynamic** checks that fly the *real* integrator — a
flipped damping derivative or a dead motor passes every static check and then diverges the moment it
is integrated.

Make the studio's verdict and the continuous-integration verdict **the same function**, never a
reimplementation, or the button and the gate will eventually disagree about the same sheet.

### 7.5 Author the catalogue as a sweep, not as opinions

*(`fsim2`'s congruence sweep — the sharpest idea in either repo)* Rather than asserting that the
sensor catalogue is coherent, drive the real world step with a receiver and one emitter and *measure*
three properties across the whole set:

1. every lock-capable emitter drives a standard receiver over the warning threshold — **no unit in the
   set may kill you silently**;
2. every searching emitter stays clearly below it — **no false warnings from being swept**;
3. the slowest lock beam's sustained level sits above the fastest sweep's with a real margin — **the
   two regimes are separable by rate alone at the receiver**.

The threshold is imported from the reaction code rather than retyped, so the instrument's verdict
cannot drift from the runtime read. This turns "is the content set coherent" from taste into a
verdict, and it generalises to any catalogue with a threshold in it.

### 7.6 Keep a ledger, and check the numbers in the prose

*(`fsim2`)* Every number quoted in the status document is a line the ledger command prints, and the
last thing that command does is check that each quoted line is still something it says. A figure in
the doc therefore cannot rot quietly.

That rule exists because two hand-typed figures were wrong — typed from memory of a command run
earlier, reading as measured for as long as they sat there. **A number no check can reach does not
belong in a doc, because a wrong one is more expensive than an absent one.**

### 7.7 Write down what failed, at the line it would change

Dead ends are the expensive part of the record. `fsim2`'s association step carries, in comments at the
exact line they would modify, two attempts that made things measurably worse: joining duplicates took
the honesty figure from 10.5 to **26.7**, and refusing to found a rival at all took it to **432.6**
while collapsing a jammer's ghosts from fourteen to four. A third formulation, a proper unscented
filter, got coverage from 0.25 to about 0.72 and no further — **the informative negative**, because it
proves the problem was never mainly the linearisation.

Also record the arguments you talked yourself *out* of. Holding hypotheses over mobility the way the
shipped code holds them over range is provably useless for the passive case — a more mobile hypothesis
always explains a set of bearings at least as well as a less mobile one, so the weights cannot
discriminate and the answer would be permanently pessimistic — and plausible for the active case,
where a range series does reveal motion. Someone will propose it. The note is what stops it costing a
week twice.

### 7.8 Correct the journal when a later measurement contradicts it

The same `fsim2` journal contains "my suspicion about pruning was wrong — long and sparse runs are
fine", followed later by the correction: **that is false, and the missing ingredient was the miss
distance.**

    miss distance   coverage    error    claimed
      3000 m          0.98      0.8 km    0.39 km
      1500 m          0.87      1.6 km    0.44 km
       800 m          0.70      6.7 km    1.20 km
       400 m          0.62     11.7 km    3.57 km

The original geometry flew a baseline leg and then straight at the site, and stopped before getting
near it. A negative result is only as good as the geometry it was taken on.

### 7.9 Look at it. Pictures find what checks do not

*(witnessed: `fsim2`, three defects in one afternoon, none catchable by any check that existed)*

- A site placed at a flat 30 m was **inside a mountain** and could see nothing. The model was right
  and the scenario was wrong: a site sits on the ground, and there the ground is 5.4 km up.
- One side's picture of the other was drawn **twice as far out as the aircraft**, because a belief was
  already in world terms and the observer's own position was added to it again.
- The panel graded every weapon against a single best contact, discarding half of what was known.

Build the page that draws both sides' pictures of each other. Then open it.

### 7.10 Instrument the story, not just the aggregate

`tieclone` keeps a report that is not pass/fail at all: it prints a per-two-second time series of one
duel — range, aspect, nose-off-lead, throttle, shots, hull — plus aggregates. Reach for it the moment
a check fails and the honest answer is "I don't know why yet". Aggregates hide the story; the series
does not.

---

## 8. Data, not code

Airframes and weapon classes live in sheets, not in source. A new aircraft is a row. Load the sheets
once and keep them **mutable**, so a live tuning panel binds straight to them and editing a pitch rate
retunes every aircraft of that class on the next frame.

Resolve tuning in layers — code literals, then a git-tracked defaults file, then a session layer — and
build the panel by *walking* the tuning tree, so newly authored data gets controls for free.

Two cautions:

- A global "feel" multiplier applied inside the integrator on top of every sheet row retunes the whole
  fleet at once, which is usually what you want; but a harness that derives its expectations from the
  sheets is invalidated by such a value saved as a *default* until it is re-run.
- Damage that is a pure function of current health — which systems are dead re-read every frame rather
  than tracked in a state machine — gets you repair in exactly the reverse order for free.

---

## 9. The two things that are not engineering questions

### 9.1 Ask whether the game is supposed to be fair before you "fix" an asymmetry

*(`tieclone`, explicitly)* That project's lopsidedness is the product. A ship that loses nine duels in
ten is not a defect there. A mechanism fix will move the damage-per-second, and a duel-length check
will go red downstream of it, and it will *feel* like the fix is incomplete. It is not — the mechanism
was the job.

Reports that measure whether the game **works** — it boots, a stage is enterable and completable, a
round leaves a barrel at the rate its row says — must stay green. That is a different question from
whether the game is fair, and on some projects it is the only one that matters. Find out which project
you are on before you touch a sheet, and never let a fairness number pull you off a mechanism.

### 9.2 The mission is the game, and it must not move ships

Give the mission machinery exactly three kinds of output and check that none of them is a command:

- a **preference** handed to target selection — weight a contact by how far it is from the objective.
  That is convergence as taste, not as orders.
- **where a bomber flies** versus **what it shoots**, deliberately two different points. An attack
  profile that flies at what it is shooting at is a kamikaze run.
- a **count** of aircraft assigned to a task, never a fraction (§1.5).

Both sides should read the same state machine from their own end, through **one** function that
produces both readings. Two copies eventually disagree about what stage it is.

Measure geometry off the loaded model rather than hardcoding it, so re-exporting a bigger ship moves
the corridor with it. And note which measurement you actually want: `tieclone`'s deck height is the
maximum height of the gun mounts, **not** the bounding box, because the box contains a command tower
and a 700 m barrel — a corridor flown at that height is a corridor in open space with the ship a
kilometre below it.

---

## Quick index of the failures, for when you recognise the symptom

| symptom | section | what it was |
|---|---|---|
| subject lurches toward the camera and creeps back | 1.1 | interpolation phase zeroed when the sub-steps ran out |
| black screen from frame one, all checks green | 1.3 | negative first frame, zero over zero, NaN latched |
| chase distance measures larger than configured | 1.4, 6.1 | world-space lag on a moving target — smooth ship-relative instead |
| ship surges behind the camera and catches up, any fps | 6.1 | absolute-position smoothing patched with a velocity lead |
| behaves differently in the harness and the browser | 1.5 | a fraction of the population where a count belonged |
| top speed goes to infinity as the wing shrinks | 2.2 | no area-independent drag term |
| aircraft flies into the ridge with the override on | 3.1 | pitch grafted onto a bank is a turn |
| aircraft descends at full aft stick and does not recover | 3.2 | past the stall — hold the lift peak instead |
| aileron reverses every few ticks in a dive | 3.3 | roll command discontinuous through knife-edge |
| evading aircraft fly into the sea | 3.4 | the clutter dive had no floor |
| chaser parks permanently downrange | 3.5 | a second lead term on something already tracking |
| stern shot flies away from a perfect guide | 4.1 | signed closing speed used as a direction |
| approved shots that never hit | 4.3 | reach tested at launch range; seeker cone at max reach |
| one lock announced three times | 4.4 | fired on an edge that re-triggers |
| six missiles from one launch command | 4.5 | a static launch has no tone to lose |
| filter confidently wrong on a closing geometry | 5.2 | one Gaussian cannot express an unknown range |
| told-parked target escapes the belief entirely | 5.6 | mobility is irreducible and cannot be inferred |
| saturated sensor picture freezes when full | 5.7 | a fixed lock table |
| camera roll jerks whenever a pilot lines up | 6.2 | the one undamped channel |
| own aircraft six pixels tall | 6.4 | unbounded two-body framing |
| rear view is secretly a forward view | 6.5 | read a threat number that falls through to your target |
| stage is uncompletable but every check is green | 7.3 | a stand-in did the job no player could do |
| a number in the doc is wrong | 7.6 | it was typed from memory and nothing re-derives it |
