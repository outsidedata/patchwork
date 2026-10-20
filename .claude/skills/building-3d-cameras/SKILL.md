---
name: building-3d-cameras
description: Use when writing, changing, or judging ANY 3D camera — a chase camera, an orbit, a cockpit, a follow, a cinematic, a camera hook in a skin. Also the moment anyone says the camera stutters, judders, shakes, lags, snaps, swims, feels floaty, feels heavy, or "the camera is wrong". Also before claiming a camera is smooth, and before believing a camera measurement taken with renderN. The rules are short and every one of them was paid for.
---

# Building 3D cameras

A camera is the only thing in the frame the player cannot look away from. Every other bug is a
thing you see; a camera bug is a thing you feel, and it reads as "the whole game is broken".

**The law: a follow camera is a rigid offset on an already-interpolated pose. Nothing else.**

```ts
// the whole of it
const p = v.blend<number[]>(a, 'pos')        // already smooth. That is what blend is FOR.
const bearing = v.blend<number>(a, 'yaw')
v.camera.up.set(0, 1, 0)
v.camera.position.set(p[0] - Math.sin(bearing) * back, p[1] + high, p[2] - Math.cos(bearing) * back)
v.camera.lookAt(p[0], p[1] + aim, p[2])
```

If your camera hook is longer than that, every extra line is a suspect. Read the table below and
delete the ones you have. `@patchwork/chasecamera3d` is this, packaged, for a body that rolls; use it
rather than writing a fourth copy.

## The five stutters. Delete them on sight.

| in the code | what it is | why it stutters |
|---|---|---|
| `camera.position.lerp(want, 1 - Math.exp(-dt * ease))` | **an ease over a blended pose** | `v.blend` already interpolated between deliveries. A second smoother on an already-smooth signal adds lag AND a wobble — and the wobble looks exactly like the thing it appears to be fixing, so it invites a third. `@patchwork/chasecamera3d`'s own note: *"there is no ease and no velocity term. The pose handed in is already smooth; an ease on top only adds lag and a wobble."* |
| `Math.max(heightAt(camX, camZ) + clear, p[1] + high)` | **a branch on terrain** | two crimes in one line. The ground equation has high-frequency octaves in it, so sampling it under a *sliding camera* wobbles the height; and then the `max` FLIPS between its two branches every time the ground crosses the threshold. **A camera may never be positioned by a conditional on terrain.** If a ridge clips the camera, that is a level problem or a `back`/`high` problem. |
| `Math.sin(w.stepN * 2.7)` | **jitter off a step counter** | `stepN` is an integer advancing 60×/s; a sinusoid of it is a square wave at render rate. Any shake must be continuous in TIME — drive it off a blended field (`v.blend(b, 'age')`), never off a counter, a frame index or `Math.random()`. |
| `if (dist > snap) k = 1` | **a snap threshold** | a branch that changes the interpolation rule mid-motion, which fires exactly when the camera is already moving fastest. The only legitimate cut is an explicit scene cut, and that is a mode change, not a distance test. |
| `a.data.pos` inside a camera hook | **the raw pose** | truth stair-steps once a step while the body is DRAWN sliding. It reads as a frame-rate problem and is not one. Always `v.blend`. |

## The tier rule

**If the body bobs, fix the body. Never the camera.**

A tank stood on a single `heightAt(x, z)` sample follows every 20 cm ripple in the grass. The
camera is rigid and correct and still shivers, because the thing it is bolted to is shivering.
Smoothing the camera to hide that buys a shiver *and* lag.

The fix is in the sim: stand the body on its own **footprint** — the mean of the corners of a
square the size of the vehicle, the same span its tilt is already read over.

```ts
export const restsAt = (land: Land, x: number, z: number, span: number): number => {
  const h = span / 2
  return (heightAt(land, x - h, z - h) + heightAt(land, x + h, z - h)
        + heightAt(land, x - h, z + h) + heightAt(land, x + h, z + h)) / 4
}
```

One span for the height and for the normal, so they are two answers about one footprint rather
than two footprints that disagree. A 7.7 m vehicle does not ride 20 cm noise, and now it doesn't.

The same rule generalises: a camera bug is very often a *pose* bug one tier down. Before adding
anything to the hook, print the pose it is following and see whether that is smooth.

## Measuring it — and the instrument that lies

**`__lab.renderN()` CANNOT SEE CAMERA STUTTER.** It steps the sim and renders in lockstep, one
step per frame, so the blend alpha is identical on every frame. A camera measured that way reads
perfectly smooth while the real page judders. Measured numbers on one unchanged build: **8.5%
under `renderN`, 33% under the real clock.**

Measure under the **real rAF clock**, and dedupe. A sampler on its own `requestAnimationFrame`
runs at a different phase from the engine's and will record the same camera position twice; the
false zeros then swamp the statistic and tell you the camera stopped dead 40% of the time.

```js
__lab.setAuto(true); __lab.hold('w', true)
window.__s = []; let n = 0, last = ''
const tick = () => { if (n++ > 300) { __lab.hold('w', false); return }
  const p = __lab.eye().pos, k = p.join(',')
  if (k !== last) { last = k; window.__s.push([performance.now(), ...p]) }   // DISTINCT only
  requestAnimationFrame(tick) }
requestAnimationFrame(tick)
```

The number that matters is the variance of the camera's **SPEED**, not of its position: distance
between distinct samples over the real milliseconds between them. A rigid rig on a body at
constant speed holds a constant camera speed whatever the frame times do.

| wobble — mean \|v − v̄\| / v̄ | verdict |
|---|---|
| under ~10% | the ground, the acceleration curve, or frame pacing. Fine. |
| 20 %+ | there is a smoother, a branch or a counter in the hook. It is in the table above. |

**Report fps and the dt spread beside it.** A reading taken at 34 fps with dt from 10 to 72 ms is
confounded and says so; take it again on an idle machine before blaming the rig — and never
quote the wobble without the pacing next to it.

Every camera hook owes an `eye()` probe — `{ pos, dir }` read off `v.camera` — or none of this
can be measured at all. Add it with the hook, not after someone complains.

## Orientation, and the three.js facts that bite

- **`lerp` position, `slerp` orientation.** A component-wise lerp of two unit quaternions is
  SHORT of unit, and rotating a standoff by a short quaternion scales it by |q|². Normalise once,
  inside the rig.
- **`getWorldDirection()` returns local −Z**, not +Z. Held against a sim's forward vector it gives
  you an exact negation and ten minutes of believing something is flipped when it isn't.
- **A `RingGeometry` lies in the XY plane, so its own normal is +Z, not +Y.** Laying one flat on
  the ground is `setFromUnitVectors(new Vector3(0,0,1), n)`. Using `UP` stands it on edge, where
  it draws as *nothing at all* and looks like it was never added to the scene.
- **Set `camera.up` before `lookAt`, every frame.** Something else will have moved it.
- **`updateProjectionMatrix()` after every change to fov, near, far or aspect.**
- **World up, not the body's**, for a ground vehicle: a camera that rolls with every rut is a
  camera nobody can aim from. Roll with the body only where the body genuinely has no ground —
  an aircraft, a spacecraft — which is what `@patchwork/chasecamera3d` is for.
- **`near`/`far` are the game's**, set in `dress()`. render3d's 0.1–300 default silently clips a
  40 km world away with no error and no clue.
- **Derive the standoff from the subject's size.** One tuned distance does not survive the second
  vehicle.

## A camera that follows a turret is not a camera that follows a hull

For any vehicle with an independently-aimed weapon, the camera rides **what the pointer lays**,
not what the driver steers. Behind the hull, the gun ends up aimed off the side of the screen and
the one instrument the game has is pointing at something nobody can see.

That also buys a free browser regression row which needs no pointer lock — **hold the turn key:
the hull must turn and the camera must not move at all:**

```
ok  the hull turns under the gun        hull turned 31.5°
ok  and the camera stays with the gun   camera moved 0.00° · turret moved 0.0000°
```

## Verifying the rig against the model — the probe that isn't a lie

A probe that reads back the number you just wrote proves nothing. When a turret turns the wrong
way, **every number about it is right**; the only thing that can contradict you is the node.

```ts
barrel: () => {
  const gun = partsOf(a).gun
  gun.updateWorldMatrix(true, false)
  return { at: gun.getWorldPosition(new THREE.Vector3()).toArray(),
           dir: gun.getWorldDirection(new THREE.Vector3()).toArray() }   // remember: −Z
}
```

Hold that against the sim's own forward vector **with the child actually rotated**. A reading
taken while the child's local rotation is 0 agrees with everything and catches nothing: turn the
parent first, then read both.

**glTF's `export_yup` flips the handedness of a child node's Y.** A model authored z-up in
Blender and parented hull → turret → gun comes out with the turret turning the *other way* for a
positive `rotation.y`. The rig is not wrong and the sim is not wrong; the basis change is real.
Negate it in the skin and say in a comment that it is the export, so the next person does not
"fix" it back.

## Pointer lock cannot be taken over CDP

`requestPointerLock()` needs transient user activation. `Runtime.evaluate` — all a headless
driver's `eval` sends — does not grant it, and `Input.dispatchMouseEvent` has not been enough
either. So a mouse-driven camera or turret **cannot be held in an automated browser.**

Do not let that become a silent gap. The row prints **NOT MEASURED** with the reason, and the
mouse → camera path is measured offline instead, through the same input hook with `aim.locked`
set by hand on a sim seat. A turret shipped backwards behind exactly this hole: the sim row
pinned the arithmetic its author believed, and the one bench that could have contradicted it
printed nothing at all.

## Red flags — stop, you are about to ship a stutter

- "I'll add a little smoothing to the camera." The pose is already smooth. Find what isn't.
- "It's smooth in `renderN`." `renderN` cannot see this class of bug at all.
- "I'll clamp the camera above the terrain." That is a branch on noise. Move `back` / `high`.
- "The camera shakes on rough ground." Fix the body's footprint, one tier down.
- "I'll lerp the quaternion, it's close enough." It is short of unit and it scales your standoff.
- "The numbers all check out, so the turret must be right." Read the node, not the number.
- "The camera is fine, it's just the frame rate." Measure the speed variance and print the pacing
  beside it. One of those two sentences is then true and you will know which.
