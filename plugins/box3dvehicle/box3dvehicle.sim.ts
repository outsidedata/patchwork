// The server half of box3dvehicle: a car made of box3d rows out of one description, driven by
// throttle, brake and steer, riding on a suspension of its own.
//
// A car is box3d rows, since box3d makes one body per row and one joint per row: a chassis, a wheel
// for each corner and a wheel joint joining each to the chassis. There is one `box3dvehicle` row per
// car. It holds `vehicle`, the name of the fleet's Vehicle it is (below), and what changes:
// `throttle` (-1 to 1), `brake` (0 to 1), `steer` (-1 to 1, positive turns left), and `chassis`,
// `wheels` and `joints`, the ids of its parts. Its actor entry gives `pos` and `rot`, where the car
// is made: on the row's first step box3dvehicle spawns the parts there, each wheel where the spring
// holds it at rest, and takes `pos` and `rot` off the row, so it carries nothing that no longer
// changes. A rule that makes a car in a step makes it with `vehicle(w, name, pos, rot)`, which
// spawns the row with its parts made and its joints driven: a row
// spawned in a step is sent before any hook of it runs, so it is spawned whole. Each step it also writes what each corner's suspension
// is doing, a number per wheel, as it was at the start of the step: `compression`, metres
// the spring is pushed in from full droop; `load`, newtons the suspension pushes the chassis up with
// there, and the wheel down; `grounded`, whether the wheel touches anything.
//
// What never changes is the scene's `world.box3dvehicle`, a Fleet:
//   chassis, wheel, joint  the kinds of the parts' rows, every car's. box3d is handed their entries
//              by this plugin's mod (`box3dvehicle.box3d.ts`, named in `world.box3d.mods.kinds`),
//              each made from the Vehicle of the car that lists the part, so the scene's
//              `world.box3d` lists none of them.
//   vehicles   name to Vehicle: the cars the scene can make. `design(world, row)` is a car's.
//   mods       below.
// A Vehicle is the whole car, which the body, the wheels, the joints and the look are all made from:
//   body      the chassis: a box `length` along x, `height` along y and `width` along z, centred on
//              the chassis's origin, `mass` kg with its centre of mass at `center` in the chassis's
//              frame, `friction`, and a `cabin` on its top: a four-sided hull `length` long and
//              `width` wide at its base, `top` long and `topWidth` wide at its roof, `height` high,
//              its middle `at` along x. Its inertia is a uniform box's of the body's size and mass.
//   bodies     Body fields (`plugins/box3d`) every part takes, as `enableContactRecycling`.
//   axles      the wheels, a pair per axle, left (-z) then right (+z), axle after axle:
//     at         where the axle is along the chassis's x.
//     track      the distance between its two wheels' centres.
//     mount      the height of the springs' top mounts in the chassis's frame. Each mount is
//                straight above its wheel's inner face, `track` / 2 − `wheel.width` / 2 out.
//     wheel      `radius`, `width`, `mass` kg, `friction` and `rollingResistance`. Box3D rolls it as
//                a ball of its radius (`box3dvehicle.box3d.ts`) and grips by Coulomb friction, its
//                `friction` times the load on it, so its width places its mount, sets how it spins,
//                and is drawn, and grips no harder. A hard tyre is a low `friction` and
//                `rollingResistance`, a soft one high.
//     spring     `stiffness` N/m; `length`, how far below its mount the wheel's inner face hangs at
//                full droop; `travel`, how far it can be pushed up from there; `sag`, how far it
//                is pushed in when the car stands still on flat ground. Each spring is preloaded
//                to carry, at `sag`, its share of the chassis's weight (`loads`) in the scene's
//                gravity (`mods`, below).
//     damper     N·s/m: `bump`, pushed in, and `rebound`, pulled out.
//     bumpStop   the last `length` of the travel pushes back harder, `stiffness` N/m more at its
//                start, growing to twice that at full travel.
//     antiRoll   N/m on the difference between the axle's two compressions: the more pushed-in wheel
//                is pushed down that much more and the other that much less.
//     driven, steered  whether the throttle turns its wheels and the steering steers them: front,
//                rear or every axle driven is front, rear or four-wheel drive. A petrol engine's
//                torque is shared equally among the driven wheels, so the layout moves the push,
//                not how much there is.
//   engine     one of three. Direct drive, each driven wheel a motor of its own: `spinSpeed` rad/s, a
//              driven wheel's motor speed at throttle 1; `spinTorque` N·m, a
//              driven wheel's motor torque while the throttle is held; `brakeTorque` N·m, each
//              wheel's motor torque at brake 1, holding it at no spin; `coastTorque` N·m, each
//              wheel's motor torque holding it at no spin while neither is held, as an engine's drag
//              does, 0 and the wheels roll free. Or a petrol engine through a manual gearbox, told by
//              its `curve`, `[rpm, N·m]` at full throttle: `idle`, `launch` (the rpm the clutch slips
//              at, full throttle, pulling away), `redline` (the limiter), `revRate` (rpm/s, revving in
//              neutral), `friction` ([N·m, N·m per 1000 rpm], engine braking), `gears` (ratios, 1st
//              up), `reverse`, `final`, `efficiency` and `brakeTorque` as above (`petrol`, below). Or an
//              electric motor through one reduction: `torque` N·m up to the speed where it makes
//              `power` W, then that power, to its `redline` rpm, through `ratio`, `efficiency`, with
//              `regen` N·m braking it with the throttle shut, and `brakeTorque` (`electric`, below).
//              A petrol or electric car's row carries `gear` and writes `rpm` and `torque` each step.
//   steering   `angle` radians, a steered wheel's target at steer 1, and its joint's `hertz`,
//              `dampingRatio` and `maxTorque`.
//   look       how the browser half draws the car (`box3dvehicle.plugin.ts`).
//   mods       `{ gravity: '<a>', land: '<a>', grip: '<a>' }`, each the plugin whose mod gives box3dvehicle that
//              function (`addons/scenemanager`'s mods): `gravity(w)` hands back the gravity the car's
//              parts fall by, a vector (box3d's, `box3d.box3dvehicle.ts`, the gravity its world steps
//              with), whose length is the g every spring's preload and every readout of the ride is
//              worked out in (`pull`); `land(plugins)` is the browser half's, the ground its dust is
//              thrown from. A car is box3d bodies, which fall by box3d's gravity and nothing else, so
//              its springs carry no weight a scene does not name: a car in a scene that names no
//              `gravity` throws on its first step. `grip(w, x, z)` hands back how well the ground at
//              [x, z] grips, a multiplier: each step every wheel row's `friction` (box3d's live
//              friction) is set so its contact's friction is what it is on grip 1 times the grip
//              under it (`grips`), so a wheel grips as the ground it is on. With no `grip`, every wheel grips at its `wheel.friction` everywhere.
// The car's forward is its chassis's +x, up its +y, and left its -z. A wheel joint's frame on the
// chassis is turned a quarter about z from the chassis's, so its axis runs up the chassis's y, and
// the wheel spins about z, across the car.
//
// Each step, in `before`: the joint rows' `spinSpeed`, `maxSpinTorque` and `targetSteeringAngle` from
// the row's throttle, brake and steer; and each corner's suspension, on its joint row too, and box3d
// pushes all of it to the live joints in its `tick`. The suspension is Box3D's own spring on the
// wheel joint, solved inside the step with the contacts, so it cannot overshoot however stiff it is,
// set each step to push as this corner's does now and to grow as it would as the wheel moves in: the
// push `f` of the spring, the bump stop and the anti-roll bar at this compression `c`, and `k`, how
// many newtons more each metre in adds (the spring's stiffness while it pushes at all, the bump
// stop's rate there, the anti-roll bar's). Box3D's spring pushes by its stiffness times how far the
// wheel is from the joint frame's origin along the axis, so the frame on the chassis is put `f / k`
// below the wheel, the suspension limits follow it so they stay the ends of the travel, the hertz
// is the one that makes its stiffness `k` on the mass the two ends move with against each other
// (`reach`), which is the mass Box3D's spring works on, and the damping ratio the one that makes its
// damping the damper's `bump` or `rebound`, whichever way the wheel is moving. While nothing pushes
// (`k` 0: the spring hangs loose, and no anti-roll bar), Box3D's spring is off and the damper is a
// push of its own, the impulse that takes the wheel's speed against the chassis down by
// 1 − e^(−c·dt/m), which never turns it round. `before` runs ahead of every `tick`, so its order
// against box3d in the scene's actors does not matter.
import type { Kind, Row, W } from '#engine/engine.ts'
import { b3, type Body, type Push, type Quat, type Vec3 } from '#plugins/box3d/box3d.sim.ts'
import { mod } from '#addons/scenemanager/scenemanager.addon.ts'

export type Wheel = { radius: number; width: number; mass: number; friction: number; rollingResistance: number }
export type Axle = {
  at: number
  track: number
  mount: number
  wheel: Wheel
  spring: { stiffness: number; length: number; travel: number; sag: number }
  damper: { bump: number; rebound: number }
  bumpStop: { length: number; stiffness: number }
  antiRoll: number
  driven: boolean
  steered: boolean
}
export type Direct = { spinSpeed: number; spinTorque: number; brakeTorque: number; coastTorque: number }
export type Electric = {
  torque: number
  power: number
  redline: number
  ratio: number
  efficiency: number
  regen: number
  brakeTorque: number
}
export type Petrol = {
  curve: [rpm: number, torque: number][]
  idle: number
  launch: number
  redline: number
  revRate: number
  friction: [base: number, perThousand: number]
  gears: number[]
  reverse: number
  final: number
  efficiency: number
  brakeTorque: number
}
export type Cabin ={ at: number; length: number; width: number; top: number; topWidth: number; height: number }
export type Paint = {
  body: number; cabin: number; trim: number; glass: number; light: number; tail: number
  tyre: number; rim: number; spring: number; damper: number; arm: number
}
export type Open = {
  windshield: { height: number; lean: number; frame: number }
  cage: { height: number; tube: number }
  wall: number
  floor: number
  seat: { width: number; depth: number; base: number; back: number }
  steer: number
}
export type Look = {
  paint: Paint; finish?: Partial<Record<keyof Paint, { roughness: number; metalness: number }>>; segments: number; spokes: number; rim: number; coils: number; coilRadius: number; wire: number; arm: number
  tread?: { blocks: number; depth: number }
  fenders?: { gap: number; thickness: number; flare: number }
  bumpers?: { depth: number; height: number; overhang: number }
  grille?: { slots: number; width: number; height: number }
  lights?: { radius: number; depth: number }
  spare?: boolean
  exhaust?: { at: Vec3; dir: Vec3; effect: string; rev?: string }
  dust?: { effect: string; clear: number; speed: number }
  open?: Open
}
export type Vehicle = {
  body: { length: number; width: number; height: number; mass: number; center: Vec3; friction: number; cabin: Cabin }
  bodies: Omit<Partial<Body>, 'shapes' | 'mass'>
  axles: Axle[]
  engine: Direct | Petrol | Electric
  steering: { angle: number; hertz: number; dampingRatio: number; maxTorque: number }
  look: Look
}
export type Fleet = {
  chassis: string
  wheel: string
  joint: string
  vehicles: Record<string, Vehicle>
  mods?: { gravity?: string; land?: string; grip?: string }
}

/** The Vehicle a `box3dvehicle` row is: the one of the scene's fleet its `vehicle` names. */
export function design(world: Record<string, any>, car: Row): Vehicle {
  const fleet: Fleet = world.box3dvehicle, v = fleet.vehicles[car.data.vehicle]
  if (!v) throw new Error(`box3dvehicle: car ${car.id} is a ${car.data.vehicle}, and world.box3dvehicle.vehicles has ${Object.keys(fleet.vehicles).join(', ')}`)
  return v
}

// ---------------------------------------------------------------- the car's shape

// v turned by the quaternion q.
export function turn(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, s] = q
  const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])]
  return [v[0] + s * t[0] + (y * t[2] - z * t[1]), v[1] + s * t[1] + (z * t[0] - x * t[2]), v[2] + s * t[2] + (x * t[1] - y * t[0])]
}
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

// One wheel of the car: its axle, its side (-1 left, 1 right), its spring's top mount in the
// chassis's frame, and the point of the wheel the spring holds, its inner face's middle, in the
// wheel's own frame.
export type Corner = { axle: Axle; side: number; mount: Vec3; hub: Vec3 }
export function corners(v: Vehicle): Corner[] {
  return v.axles.flatMap(axle => [-1, 1].map(side => ({
    axle, side,
    mount: [axle.at, axle.mount, side * (axle.track / 2 - axle.wheel.width / 2)] as Vec3,
    hub: [0, 0, -side * axle.wheel.width / 2] as Vec3,
  })))
}

// Where a wheel's middle is in the chassis's frame when its spring is pushed in `compression`.
export const wheelAt = (c: Corner, compression: number): Vec3 =>
  [c.mount[0], c.mount[1] - (c.axle.spring.length - compression), c.side * c.axle.track / 2]

// The cabin's eight corners in the chassis's frame, base then roof, as a flat [x, y, z, …].
export function cabinPoints(v: Vehicle): number[] {
  const { cabin, height } = v.body, base = height / 2, roof = base + cabin.height
  const ring = (y: number, l: number, wd: number) => [[1, 1], [1, -1], [-1, -1], [-1, 1]].flatMap(([a, b]) => [cabin.at + (a * l) / 2, y, (b * wd) / 2])
  return [...ring(base, cabin.length, cabin.width), ...ring(roof, cabin.top, cabin.topWidth)]
}

// The chassis's inertia about its centre of mass, a uniform box's of the body's size: about x
// (roll), y (yaw) and z (pitch).
export function inertia(v: Vehicle): Vec3 {
  const { length: l, height: h, width: wd, mass: m } = v.body
  return [(m * (h * h + wd * wd)) / 12, (m * (l * l + wd * wd)) / 12, (m * (l * l + h * h)) / 12]
}
// A wheel's inertia about its middle, a uniform cylinder's across z: about x, y and its spin axis z.
export function wheelInertia(wh: Wheel): Vec3 {
  const side = (wh.mass * (3 * wh.radius * wh.radius + wh.width * wh.width)) / 12
  return [side, side, (wh.mass * wh.radius * wh.radius) / 2]
}

// The mass a corner's two ends move with against each other along the chassis's up, as Box3D's
// wheel joint reckons it for its spring: the chassis's and the wheel's masses, and each one's turning
// about its centre of mass as the spring pushes it off-centre.
export function reach(v: Vehicle, c: Corner): number {
  const r = sub(c.mount, v.body.center), I = inertia(v), J = wheelInertia(c.axle.wheel)
  const chassis = 1 / v.body.mass + (r[2] * r[2]) / I[0] + (r[0] * r[0]) / I[2]
  const wheel = 1 / c.axle.wheel.mass + (c.hub[2] * c.hub[2]) / J[0]
  return 1 / (chassis + wheel)
}

// What a `gravity` mod is: the gravity the car's parts fall by in `w`.
export type Gravity = (w: W) => Vec3
// How hard the scene's gravity pulls, m/s²: the length of what its `gravity` mod hands back, or
// undefined when it names none.
export function pull(w: W): number | undefined {
  const g = mod<Gravity>(w.world, 'box3dvehicle', 'gravity')?.(w)
  return g && Math.hypot(g[0], g[1], g[2])
}

// Each wheel's share of the chassis's weight, in newtons, standing still on flat ground: the shares
// that hold the chassis up and level about its centre of mass, each as the spring's stiffness times
// a height and a tilt along x and z that are the same for every wheel, which makes one answer for any
// number of axles and is the lever rule for two.
export function loads(v: Vehicle, g: number): number[] {
  const cs = corners(v), W = v.body.mass * g, [cx, , cz] = v.body.center
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (const c of cs) {
    const f = [1, c.mount[0], c.mount[2]], k = c.axle.spring.stiffness
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += k * f[i] * f[j]
  }
  const abc = solve(M, [W, W * cx, W * cz])
  if (!abc) throw new Error('box3dvehicle: the axles do not stand the chassis up: it needs wheels at two places along it and on both sides')
  return cs.map(c => c.axle.spring.stiffness * (abc[0] + abc[1] * c.mount[0] + abc[2] * c.mount[2]))
}

// M x = b for a 3×3 M, or undefined when M has no inverse.
function solve(M: number[][], b: number[]): number[] | undefined {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  const d = det(M)
  const size = Math.max(...M.flat().map(Math.abs))
  if (!(Math.abs(d) > 1e-12 * size ** 3)) return undefined
  return [0, 1, 2].map(i => det(M.map((row, r) => row.map((x, k) => (k === i ? b[r] : x)))) / d)
}

// What an axle is on this car, standing still: each wheel's `load` (N) and the mass it carries
// (kg), how often the chassis bounces on the springs there (`hz`), how near the dampers come to
// stopping that bounce without passing the rest point, pushed in and pulled out (`bump`, `rebound`:
// 1 stops it exactly), and the gap under the body (`clearance`, m).
export type Ride = { load: number; carried: number; hz: number; bump: number; rebound: number; clearance: number }
export function ride(v: Vehicle, g: number): Ride[] {
  const all = loads(v, g)
  return v.axles.map((a, i) => {
    const load = all[2 * i], carried = load / g, k = a.spring.stiffness
    const critical = 2 * Math.sqrt(k * carried)
    return {
      load, carried,
      hz: Math.sqrt(k / carried) / (2 * Math.PI),
      bump: a.damper.bump / critical,
      rebound: a.damper.rebound / critical,
      clearance: a.wheel.radius + a.spring.length - a.spring.sag - a.mount - v.body.height / 2,
    }
  })
}

// A quarter turn about z: a wheel joint frame's x, its axis, laid along the chassis's y.
export const QUARTER: Quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2]

// A corner's joint frame on the chassis, its origin on the axis where the wheel's inner face is when
// the spring is pushed in `c`.
export const frameA = (k: Corner, c: number) =>
  ({ pos: [k.mount[0], k.mount[1] + c - k.axle.spring.length, k.mount[2]] as Vec3, rot: QUARTER })

// ---------------------------------------------------------------- the rule

const still = (pos: Vec3, rot: Quat) => ({ pos, rot, vel: [0, 0, 0], spin: [0, 0, 0], awake: true })

// How high a car's chassis origin stands over flat ground at rest: a wheel's radius, the spring's
// length less its sag, less the mount's height, the highest of its axles'.
export const standing = (v: Vehicle) =>
  Math.max(...v.axles.map(a => a.wheel.radius + a.spring.length - a.spring.sag - a.mount))

function build(me: Row, v: Vehicle, w: W) {
  const fleet: Fleet = w.world.box3dvehicle
  const pos: Vec3 = me.data.pos, rot: Quat = me.data.rot
  const chassis = w.spawn(fleet.chassis, still([...pos] as Vec3, [...rot] as Quat))
  const wheels: number[] = [], joints: number[] = []
  for (const c of corners(v)) {
    const wheel = w.spawn(fleet.wheel, still(add(pos, turn(rot, wheelAt(c, c.axle.spring.sag))), [...rot] as Quat))
    const joint = w.spawn(fleet.joint, { a: chassis.id, b: wheel.id })
    wheels.push(wheel.id)
    joints.push(joint.id)
  }
  me.data.chassis = chassis.id
  me.data.wheels = wheels
  me.data.joints = joints
  delete me.data.pos
  delete me.data.rot
}

function drive(me: Row, v: Vehicle, w: W, dt: number) {
  const e = v.engine, steer: number = me.data.steer ?? 0
  const cs = corners(v)
  cs.forEach((c, i) => { if (c.axle.steered) w.get(me.data.joints[i]).data.targetSteeringAngle = steer * v.steering.angle })
  if ('curve' in e) petrol(me, e, cs, w, dt)
  else if ('power' in e) electric(me, e, cs, w)
  else direct(me, e, cs, w)
}

// The driven wheels' mean forward spin against the chassis, rad/s, and their corners' places.
function drivenSpin(me: Row, cs: Corner[], w: W): { spin: number; driven: number[] } {
  const chassis = w.get(me.data.chassis).data
  const driven = cs.flatMap((c, i) => (c.axle.driven ? [i] : []))
  const spin = driven.reduce((s, i) => {
    const wd = w.get(me.data.wheels[i]).data
    return s - dot(sub(wd.spin, chassis.spin), turn(wd.rot, [0, 0, 1]))
  }, 0) / driven.length
  return { spin, driven }
}

// An electric motor through one fixed reduction, `ratio`. The row's `gear` is -1 reverse, 0 neutral
// and 1 drive. The motor turns with the driven wheels' mean forward spin times the ratio, `rpm`; up
// to the speed where `torque` (N·m) makes `power` (W) it pulls with `torque` times the throttle, and
// above it with `power` over its speed, falling as it spins up, and nothing at `redline` (its rpm
// limit). With the throttle shut it brakes the wheels by `regen` (N·m at the motor), as a motor run
// as a generator does. Throttle below 0 is the brake pedal. That torque through the ratio and
// `efficiency` is shared equally among the driven wheels' motors, each aimed at the wheel speed of
// the redline, or at rest while regenerating.
function electric(me: Row, e: Electric, cs: Corner[], w: W) {
  const pedal: number = me.data.throttle ?? 0, throttle = Math.max(0, pedal)
  const brake = Math.max(me.data.brake ?? 0, -pedal)
  const gear: number = Math.sign(me.data.gear ?? 0)
  const ratio = gear * e.ratio
  const { spin, driven } = drivenSpin(me, cs, w)
  const rpm = Math.min(Math.abs(spin * ratio) * RPM, e.redline)
  const omega = rpm / RPM
  const torque = throttle > 0
    ? (rpm < e.redline ? Math.min(e.torque, omega > 0 ? e.power / omega : e.torque) * throttle : 0)
    : -e.regen
  me.data.rpm = rpm
  me.data.torque = torque
  const share = (Math.abs(torque * ratio) * e.efficiency) / driven.length
  const aim = torque > 0 ? (-Math.sign(ratio) * (e.redline / RPM)) / Math.abs(ratio) : 0
  cs.forEach((c, i) => {
    const j = w.get(me.data.joints[i]).data
    if (brake > 0) { j.spinSpeed = 0; j.maxSpinTorque = brake * e.brakeTorque }
    else if (c.axle.driven && ratio !== 0) { j.spinSpeed = aim; j.maxSpinTorque = share }
    else { j.spinSpeed = 0; j.maxSpinTorque = 0 }
  })
}

function direct(me: Row, e: Direct, cs: Corner[], w: W) {
  const throttle: number = me.data.throttle ?? 0, brake: number = me.data.brake ?? 0
  cs.forEach((c, i) => {
    const j = w.get(me.data.joints[i]).data
    if (brake > 0) { j.spinSpeed = 0; j.maxSpinTorque = brake * e.brakeTorque }
    else if (c.axle.driven && throttle !== 0) { j.spinSpeed = -throttle * e.spinSpeed; j.maxSpinTorque = e.spinTorque }
    else { j.spinSpeed = 0; j.maxSpinTorque = e.coastTorque }
  })
}

// The engine's torque at full throttle at `rpm`, N·m: the curve's points joined by straight lines,
// its ends held past them.
export function torqueAt(curve: Petrol['curve'], rpm: number): number {
  if (rpm <= curve[0][0]) return curve[0][1]
  for (let i = 1; i < curve.length; i++) {
    const [r0, t0] = curve[i - 1], [r1, t1] = curve[i]
    if (rpm <= r1) return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0)
  }
  return curve[curve.length - 1][1]
}

const RPM = 60 / (2 * Math.PI)

// A petrol engine through a manual gearbox. The row's `gear` is -1 reverse, 0 neutral, 1… the
// gears; `rpm` the engine's speed. Throttle below 0 is the brake pedal. In gear the engine turns
// with the driven wheels' mean forward spin times the gear's ratio times the final drive, and below
// that the clutch slips to hold it at `launch` rpm at full throttle, `idle` at none. In neutral it
// revs toward `idle` up to `redline` with the throttle, at most `revRate` rpm a second. Its torque is
// the curve's times the throttle, none at the redline (the limiter), and with the throttle shut it
// drags by `friction` (base + perThousand per 1000 rpm), the engine braking. That torque through the
// gear, the final drive and `efficiency` is shared equally among the driven wheels' motors, each
// aimed at the wheel speed of the redline in this gear, or at rest while braking by the engine, so
// a car left in gear stands where it stopped.
function petrol(me: Row, e: Petrol, cs: Corner[], w: W, dt: number) {
  const pedal: number = me.data.throttle ?? 0, throttle = Math.max(0, pedal)
  const brake = Math.max(me.data.brake ?? 0, -pedal)
  const gear: number = me.data.gear ?? 0
  const ratio = gear === 0 ? 0 : (gear < 0 ? -e.reverse : e.gears[gear - 1]) * e.final
  const { spin, driven } = drivenSpin(me, cs, w)
  let rpm: number = me.data.rpm ?? e.idle
  if (ratio === 0) {
    const to = e.idle + throttle * (e.redline - e.idle), step = e.revRate * dt
    rpm += Math.max(-step, Math.min(step, to - rpm))
  } else {
    rpm = Math.max(spin * ratio * RPM, e.idle + throttle * (e.launch - e.idle))
  }
  rpm = Math.min(rpm, e.redline)
  const drag = e.friction[0] + (e.friction[1] * rpm) / 1000
  const torque = throttle > 0 ? (rpm < e.redline ? torqueAt(e.curve, rpm) * throttle : 0) : -drag
  me.data.rpm = rpm
  me.data.torque = torque
  const share = (Math.abs(torque * ratio) * e.efficiency) / driven.length
  const aim = torque > 0 ? (-Math.sign(ratio) * (e.redline / RPM)) / Math.abs(ratio) : 0
  cs.forEach((c, i) => {
    const j = w.get(me.data.joints[i]).data
    if (brake > 0) { j.spinSpeed = 0; j.maxSpinTorque = brake * e.brakeTorque }
    else if (c.axle.driven && ratio !== 0) { j.spinSpeed = aim; j.maxSpinTorque = share }
    else { j.spinSpeed = 0; j.maxSpinTorque = 0 }
  })
}

/** Moves a car's gear `by` up or down, held between reverse and its top gear: a petrol car's
 * gearbox, an electric car's reverse, neutral and drive. A direct-drive car has no gear. */
export function shift(me: Row, v: Vehicle, by: number) {
  const e = v.engine
  const top = 'curve' in e ? e.gears.length : 'power' in e ? 1 : undefined
  if (top === undefined) return
  me.data.gear = Math.max(-1, Math.min(top, (me.data.gear ?? 0) + by))
}

// Whether a part moves slower than Box3D's sleep threshold for it: its speed, and its spin times
// `far`, how far its shape reaches from its centre of mass, as Box3D reckons a body's: a wheel's
// radius, the chassis's farthest corner when left out.
function sleepy(v: Vehicle, part: Row, far = chassisExtent(v)): boolean {
  const d = part.data, threshold: number = v.bodies.sleepThreshold ?? b3.b3DefaultBodyDef().sleepThreshold
  return Math.hypot(d.vel[0], d.vel[1], d.vel[2]) < threshold && far * Math.hypot(d.spin[0], d.spin[1], d.spin[2]) < threshold
}

// How far the chassis's shape reaches from its centre of mass: its farthest corner.
function chassisExtent(v: Vehicle): number {
  const { length: l, height: h, width: wd, center } = v.body
  const box = [-1, 1].flatMap(a => [-1, 1].flatMap(b => [-1, 1].map(c => [(a * l) / 2, (b * h) / 2, (c * wd) / 2])))
  const cabin = cabinPoints(v), points = [...box, ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => cabin.slice(3 * i, 3 * i + 3))]
  return Math.max(...points.map(p => Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2])))
}

const push = (row: Row, p: Push) => { (row.data.pushes ??= []).push(p) }

function suspend(me: Row, v: Vehicle, w: W, dt: number) {
  const body = w.get(me.data.chassis), c = body.data
  const up = turn(c.rot, [0, 1, 0]), com = add(c.pos, turn(c.rot, v.body.center))
  const g = pull(w)
  if (g === undefined) throw new Error('box3dvehicle: world.box3dvehicle.mods names no gravity, and a car\'s springs carry its weight in it: name the plugin its parts are bodies of, as { gravity: \'box3d\' }')
  const cs = corners(v), shares = loads(v, g)
  const at = cs.map((k, i) => {
    const wheel = w.get(me.data.wheels[i])
    const mount = add(c.pos, turn(c.rot, k.mount)), hub = add(wheel.data.pos, turn(wheel.data.rot, k.hub))
    const vMount = add(c.vel, cross(c.spin, sub(mount, com)))
    const vHub = add(wheel.data.vel, cross(wheel.data.spin, sub(hub, wheel.data.pos)))
    return {
      wheel, hub, mount,
      grounded: (wheel.data.touching?.length ?? 0) > 0,
      compression: dot(sub(hub, mount), up) + k.axle.spring.length,
      speed: dot(sub(vHub, vMount), up),
    }
  })
  // A car whose every part is slower than Box3D's sleep threshold keeps its joints as they are:
  // Box3D starts a body's time to sleep over whenever a joint on it is set, and a car at rest moves
  // by less than that each step, so it would never sleep. Its springs push as they were last set,
  // which is how they push at rest.
  const still = sleepy(v, body) && at.every((x, i) => sleepy(v, x.wheel, cs[i].axle.wheel.radius))
  const load = at.map((x, i) => {
    const k = cs[i], { spring, bumpStop, antiRoll, damper } = k.axle
    const cNow = x.compression, other = at[i ^ 1].compression
    const pushed = shares[i] + spring.stiffness * (cNow - spring.sag)
    const into = cNow - (spring.travel - bumpStop.length)
    const f = Math.max(0, pushed) + (into > 0 ? bumpStop.stiffness * into * (1 + into / bumpStop.length) : 0) + antiRoll * (cNow - other)
    const stiff = (pushed > 0 ? spring.stiffness : 0) + (into > 0 ? bumpStop.stiffness * (1 + (2 * into) / bumpStop.length) : 0) + antiRoll
    const rate = x.speed > 0 ? damper.bump : damper.rebound, m = reach(v, k)
    const j = w.get(me.data.joints[i]).data
    if (still && j.enableSuspensionSpring !== undefined) return f + rate * x.speed
    if (stiff > 0) {
      const free = cNow - f / stiff
      j.enableSuspensionSpring = true
      j.localFrameA = frameA(k, free)
      j.lowerSuspensionLimit = -free
      j.upperSuspensionLimit = spring.travel - free
      j.suspensionHertz = Math.sqrt(stiff / m) / (2 * Math.PI)
      j.suspensionDampingRatio = rate / (2 * Math.sqrt(stiff * m))
    } else {
      j.enableSuspensionSpring = false
      j.localFrameA = frameA(k, 0)
      j.lowerSuspensionLimit = 0
      j.upperSuspensionLimit = spring.travel
      const impulse = m * x.speed * (1 - Math.exp((-rate * dt) / m))
      push(body, { impulse: scale(up, impulse), point: x.mount })
      push(x.wheel, { impulse: scale(up, -impulse), point: x.hub })
    }
    return f + rate * x.speed
  })
  me.data.compression = at.map(x => x.compression)
  me.data.load = load
  me.data.grounded = at.map(x => x.grounded)
}

// What a `grip` mod is: how well the ground at [x, z] grips, a multiplier of a wheel's friction.
export type Grip = (w: W, x: number, z: number) => number

// Each wheel's friction, its `wheel.friction` times the square of the grip of the ground under it:
// Box3D mixes two shapes' friction as √(a·b), so the contact's is what it is on ungripping ground
// times the grip.
function grips(me: Row, v: Vehicle, w: W) {
  const grip = mod<Grip>(w.world, 'box3dvehicle', 'grip')
  if (!grip) return
  corners(v).forEach((c, i) => {
    const wheel = w.get(me.data.wheels[i]).data, g = grip(w, wheel.pos[0], wheel.pos[2])
    wheel.friction = c.axle.wheel.friction * g * g
  })
}

/** A car of the fleet's `name` at `pos` turned `rot`, spawned with its parts made and its joints
 * driven. */
export function vehicle(w: W, name: string, pos: Vec3, rot: Quat): Row {
  const me = w.spawn('box3dvehicle', { vehicle: name, pos, rot })
  const v = design(w.world, me)
  build(me, v, w)
  drive(me, v, w, 0)
  return me
}

/** Ends a car and every part of it: its joints, its wheels, its chassis and its row. */
export function scrap(w: W, car: Row) {
  for (const id of [...(car.data.joints ?? []), ...(car.data.wheels ?? []), car.data.chassis]) if (id !== undefined) w.end(w.get(id))
  w.end(car)
}

export const box3dvehicle: Kind = {
  before(me, dt, w) {
    const v = design(w.world, me)
    if (me.data.chassis === undefined) build(me, v, w)
    drive(me, v, w, dt)
    suspend(me, v, w, dt)
    grips(me, v, w)
  },
}
