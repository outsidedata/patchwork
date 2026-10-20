// The browser half of box3dvehicle: every car of the scene drawn from its Vehicle in
// `world.box3dvehicle.vehicles`, the one its row's `vehicle` names and its server half builds the
// bodies and joints from, placed each frame by its rows. It needs
// render3d, and is listed after box3d and before render3d, so a frame draws the rows it was handed.
// The drawing is the look's: it follows the physics' sizes where a player sees them meet the world,
// the wheels, the springs and the body's outline, and dresses the rest.
//
// A car is, from `look` (each part in `look.paint`'s colour of its name):
//   the body     on the chassis row: the body's box in `body`, and on it the cabin's hull in `cabin`,
//                or, with `open`, an open tub: a solid hood ahead of the windshield, and behind it a
//                `floor` and walls `wall` thick, two seats (`seat`: `width` across, `depth` long, a
//                `base` to sit on and a `back` to lean on, in `trim`), a steering wheel `steer` round
//                before the left seat, a windshield `windshield.height` tall leaning back `lean`
//                radians in a `frame` of `trim` with `glass` in it, standing at the cabin's front,
//                and a roll bar `cage.height` over the tub's back, tubes `cage.tube` round, with a bar
//                along each side to the windshield's top.
//                An upper arm at each corner from the body's side to the spring's top mount, where
//                the mount is out past the side.
//   fenders      an arch over each wheel, `thickness` thick, clear of the wheel by `gap` where it
//                rests, as wide as the wheel and `flare` more, in `trim`; a wheel pushed in further
//                than `gap` goes up into it.
//   bumpers      a bar across the front and the back, `depth` deep and `height` tall at the body's
//                bottom, `overhang` past each side, in `trim`.
//   grille       `slots` upright slots in `trim` across the front, `width` across and `height` tall.
//   lights       two round headlights either side of the grille, `radius` round and `depth` proud,
//                lit in `light`, and two tail lights in `tail`.
//   spare        the last axle's wheel on the back.
//   exhaust      `{ at, dir, effect, rev? }`: particle3d's `effect` thrown from the tailpipe at `at`,
//                along `dir`, both in the chassis's frame and turned with it every frame, for as long
//                as the car is drawn; and `rev` beside it while the car's row holds a throttle, stopped
//                the frame it lets go. Each is the page's own (particle3d's `emit`), left where it is
//                thrown, so a moving car leaves a trail, and stopped with the car. A scene whose look
//                has an exhaust lists particle3d after this plugin.
//   dust         `{ effect, clear, speed }`: particle3d's `effect` thrown from under each wheel while
//                it is on the ground, its lowest point within `clear` metres of the land's height there,
//                and going faster than `speed` metres a second across it; it is thrown at the ground
//                under the wheel, back from the way the wheel goes and up by half as much, and stopped
//                the frame either is no longer so. The land is the one a mod hands it,
//                `world.box3dvehicle.mods: { land: '<a>' }` (terrain3d's, `terrain3d.box3dvehicle.ts`):
//                `land(plugins)` is an object whose `height(x, z)` is the ground there, or undefined
//                until it has one. Until then, or with no mod named, no wheel is on the ground and no
//                dust is thrown. The plugin the mod is is listed before this one, so the land it asks
//                in its `afterTick` is this frame's, and a scene with dust that lists it after, or does
//                not list it, throws (`ahead`), as does one with dust on any of its vehicles that
//                does not list particle3d.
//   the wheels   each on its wheel row: a tyre of its axle's `wheel.radius` and `width` (with `tread`,
//                `blocks` blocks round it `depth` deep, staggered across it), a rim `look.rim` of the
//                radius standing `look.arm` / 2 proud of both faces, and `look.spokes` spokes on the
//                outer face, so its turning shows.
//   the corners  between the chassis and each wheel, placed each frame from both rows: a coil spring
//                of `look.coils` turns, `look.coilRadius` round and `look.wire` thick, from the wheel's
//                inner face up to the spring's mount, stretched to the gap between them, so it
//                squashes as the wheel is pushed in; a damper, a sleeve hanging from the mount as long
//                as the spring at full bump and a rod from the wheel to the mount; and a lower arm from
//                the body's bottom edge to the wheel's inner face, where that is out past the side.
// Round parts have `look.segments` sides and arms are `look.arm` thick. A car is drawn once its row
// names its parts and they have come, and goes with its row. When `world.box3dvehicle` changes, as
// the editor does while a value of it is dragged, every car is made again from it.
// Every part is a standard material in its paint, its roughness and metalness `look.finish`'s for
// that paint and three's own for a paint it leaves out, dressed by render3d, so the sky's environment,
// its wet and its snow reach the car as they reach the ground; the lamps glow in their own colour.
// Every mesh casts and takes shadows.
//
// One of these per client: the cars drawn are this scene's.
import type { Row } from '#engine/engine.ts'
import type { Plugins } from '#engine/browser.ts'
import { ahead, mod } from '#addons/scenemanager/scenemanager.addon.ts'
import type { Effect } from '#plugins/particle3d/particle3d.plugin.ts'
import { cabinPoints, corners, design as designOf, turn, wheelAt, type Fleet, type Vehicle, type Wheel } from './box3dvehicle.sim.ts'
import type { Quat, Vec3 } from '#plugins/box3d/box3d.sim.ts'

// What a `land` mod is: the ground dust is thrown from, or undefined until there is one.
type Land = (plugins: Plugins) => { height(x: number, z: number): number } | undefined
type Drawn = { chassis: any; wheels: any[]; corners: { coil: any; sleeve: any; rod: any; arm?: any }[]; owned: { dispose(): void }[]; smoke?: Effect; rev?: Effect; dust: (Effect | undefined)[] }

export function box3dvehicle() {
  const cars = new Map<number, Drawn>()
  let design = ''

  function make(render3d: Plugins['render3d'], v: Vehicle): Drawn {
    const { THREE, scene } = render3d as { THREE: any; scene: any }
    const owned: { dispose(): void }[] = []
    const mats = new Map<string, any>()
    const lit = new Set(['light', 'tail'])
    const mat = (name: keyof Vehicle['look']['paint']) => {
      if (!mats.has(name)) {
        const color = v.look.paint[name]
        const m = render3d.dress(new THREE.MeshStandardMaterial({ color, ...v.look.finish?.[name], ...(lit.has(name) ? { emissive: color } : {}) }))
        owned.push(m)
        mats.set(name, m)
      }
      return mats.get(name)
    }
    const geo = <G extends { dispose(): void }>(g: G) => { owned.push(g); return g }
    const look = v.look, { segments, spokes, rim, coils, coilRadius, wire, arm } = look
    const { length: L, height: H, width: W } = v.body
    const Y = new THREE.Vector3(0, 1, 0)

    // A box `size` big with its middle at `at`, in `paint`, put in `into`.
    const box = (into: any, size: number[], at: number[], paint: keyof Vehicle['look']['paint']) => {
      const m = new THREE.Mesh(geo(new THREE.BoxGeometry(size[0], size[1], size[2])), mat(paint))
      m.position.set(at[0], at[1], at[2])
      into.add(m)
      return m
    }
    // A round tube `radius` thick from `a` to `b`, put in `into`.
    const tube = (into: any, a: number[], b: number[], radius: number, paint: keyof Vehicle['look']['paint']) => {
      const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      const m = new THREE.Mesh(geo(new THREE.CylinderGeometry(radius, radius, d.length(), segments).translate(0, d.length() / 2, 0)), mat(paint))
      m.position.set(a[0], a[1], a[2])
      m.quaternion.setFromUnitVectors(Y, d.normalize())
      into.add(m)
      return m
    }
    // A wheel's tyre, tread, rim and spokes across z, the spokes on the `side` face.
    const wheel = (wh: Wheel, side: number) => {
      const { radius, width: w } = wh
      const g = new THREE.Group()
      const tread = look.tread
      const inner = tread ? radius - tread.depth : radius
      g.add(new THREE.Mesh(geo(new THREE.CylinderGeometry(inner, inner, w, segments).rotateX(Math.PI / 2)), mat('tyre')))
      if (tread) {
        const block = geo(new THREE.BoxGeometry(tread.depth, (Math.PI * radius) / tread.blocks, w / 2))
        for (let k = 0; k < tread.blocks; k++) {
          const a = (2 * Math.PI * k) / tread.blocks, m = new THREE.Mesh(block, mat('tyre'))
          m.position.set(Math.cos(a) * (radius - tread.depth / 2), Math.sin(a) * (radius - tread.depth / 2), (k % 2 ? 1 : -1) * (w / 4))
          m.rotation.z = a
          g.add(m)
        }
      }
      g.add(new THREE.Mesh(geo(new THREE.CylinderGeometry(radius * rim, radius * rim, w + arm, segments).rotateX(Math.PI / 2)), mat('rim')))
      for (let s = 0; s < spokes; s++) {
        const spoke = new THREE.Mesh(geo(new THREE.BoxGeometry(arm, radius * rim * 2, arm)), mat('arm'))
        spoke.position.z = (side * (w + arm)) / 2
        spoke.rotation.z = (s * Math.PI) / spokes
        g.add(spoke)
      }
      return g
    }

    const chassis = new THREE.Group()
    const cabin = v.body.cabin, front = cabin.at + cabin.length / 2, back = cabin.at - cabin.length / 2
    const open = look.open
    if (open) {
      // The hood ahead of the windshield, the tub behind it.
      box(chassis, [L / 2 - front, H, W], [(L / 2 + front) / 2, 0, 0], 'body')
      const tubL = front + L / 2, tubX = (front - L / 2) / 2
      box(chassis, [tubL, open.floor, W], [tubX, -H / 2 + open.floor / 2, 0], 'body')
      for (const side of [-1, 1]) box(chassis, [tubL, H, open.wall], [tubX, 0, side * (W / 2 - open.wall / 2)], 'body')
      box(chassis, [open.wall, H, W], [-L / 2 + open.wall / 2, 0, 0], 'body')
      // Two seats in the cabin, their backs at its back, and the wheel before the left one.
      const { seat } = open, floor = -H / 2 + open.floor, seatX = back + open.wall + seat.depth / 2
      for (const side of [-1, 1]) {
        box(chassis, [seat.depth, seat.base, seat.width], [seatX, floor + seat.base / 2, side * (W / 4)], 'trim')
        box(chassis, [seat.base / 2, seat.back, seat.width], [seatX - seat.depth / 2, floor + seat.base + seat.back / 2, side * (W / 4)], 'trim')
      }
      const ring = new THREE.Mesh(geo(new THREE.TorusGeometry(open.steer, arm / 2, 6, segments)), mat('trim'))
      ring.position.set((seatX + seat.depth / 2 + front) / 2, H / 2 + open.steer / 2, -W / 4)
      ring.rotation.y = Math.PI / 2
      ring.rotation.x = -Math.PI / 6
      chassis.add(ring)
      // The windshield, leaning back from the hood's rear edge.
      const { windshield: ws } = open
      const shield = new THREE.Group()
      shield.position.set(front, H / 2, 0)
      shield.rotation.z = ws.lean
      box(shield, [ws.frame / 2, ws.height, W - 2 * ws.frame], [0, ws.height / 2, 0], 'glass')
      for (const side of [-1, 1]) box(shield, [ws.frame, ws.height, ws.frame], [0, ws.height / 2, side * (W / 2 - ws.frame / 2)], 'trim')
      box(shield, [ws.frame, ws.frame, W], [0, ws.height, 0], 'trim')
      box(shield, [ws.frame, ws.frame, W], [0, ws.frame / 2, 0], 'trim')
      chassis.add(shield)
      // The roll bar over the tub's back, and a bar each side to the windshield's top.
      const { cage } = open, cz = W / 2 - cage.tube, top = H / 2 + cage.height, bar = back + cage.tube
      const shieldTop = [front - Math.sin(ws.lean) * ws.height, H / 2 + Math.cos(ws.lean) * ws.height]
      for (const side of [-1, 1]) {
        tube(chassis, [bar, H / 2, side * cz], [bar, top, side * cz], cage.tube, 'trim')
        tube(chassis, [bar, top, side * cz], [shieldTop[0], shieldTop[1], side * cz], cage.tube, 'trim')
      }
      tube(chassis, [bar, top, -cz], [bar, top, cz], cage.tube, 'trim')
    } else {
      box(chassis, [L, H, W], [0, 0, 0], 'body')
      // The cabin: a box whose eight corners are moved onto the cabin's hull, base and roof.
      const pts = cabinPoints(v), cab = geo(new THREE.BoxGeometry(1, 1, 1)), p = cab.attributes.position
      for (let i = 0; i < p.count; i++) {
        const ring = p.getY(i) > 0 ? 4 : 0, x = p.getX(i) > 0, z = p.getZ(i) > 0
        const k = ring + (x ? (z ? 0 : 1) : (z ? 3 : 2))
        p.setXYZ(i, pts[3 * k], pts[3 * k + 1], pts[3 * k + 2])
      }
      cab.computeVertexNormals()
      chassis.add(new THREE.Mesh(cab, mat('cabin')))
    }
    if (look.bumpers) {
      const b = look.bumpers
      for (const end of [-1, 1]) box(chassis, [b.depth, b.height, W + 2 * b.overhang], [end * (L / 2 + b.depth / 2), -H / 2 + b.height / 2, 0], 'trim')
    }
    if (look.grille) {
      const g = look.grille, step = g.width / g.slots
      for (let k = 0; k < g.slots; k++) box(chassis, [arm, g.height, step / 2], [L / 2 + arm / 2, 0, -g.width / 2 + step * (k + 0.5)], 'trim')
    }
    if (look.lights) {
      const { radius, depth } = look.lights, z = (look.grille?.width ?? 0) / 2 + radius * 1.5
      for (const side of [-1, 1]) {
        const lamp = new THREE.Mesh(geo(new THREE.CylinderGeometry(radius, radius, depth, segments).rotateZ(Math.PI / 2)), mat('light'))
        lamp.position.set(L / 2 + depth / 2, 0, side * z)
        chassis.add(lamp)
        box(chassis, [depth, radius * 2, radius], [-L / 2 - depth / 2, H / 4, side * (W / 2 - radius)], 'tail')
      }
    }
    if (look.spare) {
      const wh = v.axles[v.axles.length - 1].wheel, spare = wheel(wh, 1)
      spare.rotation.y = -Math.PI / 2
      spare.position.set(-L / 2 - wh.width / 2 - (look.bumpers?.depth ?? 0) / 2, H / 2, 0)
      chassis.add(spare)
    }

    const cs = corners(v)
    for (const c of cs) {
      const out = Math.abs(c.mount[2]) - W / 2
      if (out > 0) {
        const upper = new THREE.Mesh(geo(new THREE.BoxGeometry(arm, 1, arm).translate(0, 0.5, 0)), mat('arm'))
        upper.position.set(c.mount[0], c.mount[1], c.side * W / 2)
        upper.quaternion.setFromUnitVectors(Y, new THREE.Vector3(0, 0, c.side))
        upper.scale.y = out
        chassis.add(upper)
      }
      if (look.fenders) {
        // An arch over the wheel where it rests, `gap` clear of it.
        const f = look.fenders, { radius, width: w } = c.axle.wheel
        const r1 = radius + f.gap, r2 = r1 + f.thickness
        const shape = new THREE.Shape()
        shape.moveTo(r2, 0)
        shape.absarc(0, 0, r2, 0, Math.PI, false)
        shape.lineTo(-r1, 0)
        shape.absarc(0, 0, r1, Math.PI, 0, true)
        shape.closePath()
        const depth = w + f.flare
        const arch = new THREE.Mesh(geo(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: segments }).translate(0, 0, -depth / 2)), mat('trim'))
        const rest = wheelAt(c, c.axle.spring.sag)
        arch.position.set(rest[0], rest[1], rest[2] + (c.side * f.flare) / 2)
        chassis.add(arch)
      }
    }
    scene.add(chassis)

    const wheels = cs.map(c => { const g = wheel(c.axle.wheel, c.side); scene.add(g); return g })

    // A helix of `coils` turns from y 0 to y 1, to be stretched between the wheel and the mount.
    const helix = new THREE.Curve()
    helix.getPoint = (t: number, into = new THREE.Vector3()) => into.set(coilRadius * Math.cos(t * coils * 2 * Math.PI), t, coilRadius * Math.sin(t * coils * 2 * Math.PI))
    const coil = geo(new THREE.TubeGeometry(helix, coils * segments, wire, Math.max(3, segments / 4), false))
    const stick = (thick: number) => geo(new THREE.BoxGeometry(thick, 1, thick).translate(0, 0.5, 0))
    const drawnCorners = cs.map(c => {
      const spring = new THREE.Mesh(coil, mat('spring'))
      const sleeve = new THREE.Mesh(geo(new THREE.CylinderGeometry(coilRadius / 2, coilRadius / 2, 1, segments).translate(0, -0.5, 0)), mat('damper'))
      sleeve.scale.y = c.axle.spring.length - c.axle.spring.travel
      const rod = new THREE.Mesh(stick(wire * 2), mat('damper'))
      const inside = Math.abs(c.mount[2]) - c.axle.wheel.width / 2 <= W / 2
      const lower = inside ? undefined : new THREE.Mesh(stick(arm), mat('arm'))
      for (const m of [spring, sleeve, rod, lower]) if (m) scene.add(m)
      return { coil: spring, sleeve, rod, arm: lower }
    })
    for (const part of [chassis, ...wheels, ...drawnCorners.flatMap(c => [c.coil, c.sleeve, c.rod, c.arm])]) {
      part?.traverse((m: any) => { m.castShadow = m.receiveShadow = true })
    }
    return { chassis, wheels, corners: drawnCorners, owned, dust: [] }
  }

  function drop(scene: any, id: number) {
    const d = cars.get(id)!
    for (const m of [d.chassis, ...d.wheels, ...d.corners.flatMap(c => [c.coil, c.sleeve, c.rod, c.arm])]) if (m) scene.remove(m)
    for (const o of d.owned) o.dispose()
    for (const fx of [d.smoke, d.rev, ...d.dust]) if (fx) fx.life = fx.age
    cars.delete(id)
  }

  // `obj` from `from` to `to`: at `from`, its y turned onto the way to `to` and stretched to reach it.
  function span(THREE: any, obj: any, from: Vec3, to: Vec3) {
    const dir = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2])
    const len = dir.length()
    obj.position.set(from[0], from[1], from[2])
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.divideScalar(len || 1))
    obj.scale.y = len
  }

  return {
    afterTick(plugins: Plugins) {
      const { THREE, scene } = plugins.render3d
      const world = plugins.wire.scene.world
      const fleet: Fleet | undefined = world?.box3dvehicle
      if (!fleet) return
      const now = JSON.stringify(fleet)
      if (now !== design) { for (const id of [...cars.keys()]) drop(scene, id); design = now }
      const rows = new Map<number, Row>(plugins.wire.rows.map(r => [r.id, r]))
      const seen = new Set<number>()
      const dusty = Object.values(fleet.vehicles).some(v => v.look.dust)
      if (dusty) {
        ahead(plugins.wire.scene, 'box3dvehicle', 'land')
        if (!plugins.particle3d) throw new Error('world.box3dvehicle has a vehicle whose look has dust, and this scene does not list particle3d')
      }
      const ground = dusty ? mod<Land>(world!, 'box3dvehicle', 'land')?.(plugins) : undefined
      for (const car of plugins.wire.rows) {
        if (car.kind !== 'box3dvehicle' || car.data.chassis === undefined) continue
        const chassis = rows.get(car.data.chassis), wheels = (car.data.wheels as number[]).map(id => rows.get(id))
        if (!chassis || wheels.some(w => !w)) continue
        seen.add(car.id)
        const v = designOf(world!, car), cs = corners(v), dust = v.look.dust
        if (!cars.has(car.id)) cars.set(car.id, make(plugins.render3d, v))
        const d = cars.get(car.id)!
        const at: Vec3 = chassis.data.pos, rot: Quat = chassis.data.rot
        d.chassis.position.fromArray(at)
        d.chassis.quaternion.fromArray(rot)
        cs.forEach((c, i) => {
          const wd = wheels[i]!.data
          d.wheels[i].position.fromArray(wd.pos)
          d.wheels[i].quaternion.fromArray(wd.rot)
          const place = (local: Vec3): Vec3 => { const t = turn(rot, local); return [at[0] + t[0], at[1] + t[1], at[2] + t[2]] }
          const mount = place(c.mount)
          const h = turn(wd.rot, c.hub), hub: Vec3 = [wd.pos[0] + h[0], wd.pos[1] + h[1], wd.pos[2] + h[2]]
          const k = d.corners[i]
          span(THREE, k.coil, hub, mount)
          span(THREE, k.rod, hub, mount)
          k.sleeve.position.fromArray(mount)
          k.sleeve.quaternion.copy(k.rod.quaternion)
          if (k.arm) span(THREE, k.arm, place([c.mount[0], -v.body.height / 2, (c.side * v.body.width) / 2]), hub)
          if (dust) {
            const [x, y, z] = wd.pos as Vec3, [vx, , vz] = wd.vel as Vec3
            const floor = ground ? ground.height(x, z) : undefined, speed = Math.hypot(vx, vz)
            const on = floor !== undefined && y - c.axle.wheel.radius - floor <= dust.clear && speed > dust.speed
            const fx = d.dust[i]
            if (on) {
              const at = [x, floor, z], dir = [-vx / speed, 0.5, -vz / speed]
              if (fx) { fx.at = at; fx.dir = dir } else d.dust[i] = plugins.particle3d.emit(dust.effect, at, { dir, life: Infinity })
            } else if (fx) { fx.life = fx.age; d.dust[i] = undefined }
          }
        })
        const ex = v.look.exhaust
        if (ex) {
          const particles = plugins.particle3d
          if (!particles) throw new Error(`world.box3dvehicle.vehicles.${car.data.vehicle}.look has an exhaust, and this scene does not list particle3d`)
          const t = turn(rot, ex.at), exhaust = [at[0] + t[0], at[1] + t[1], at[2] + t[2]], dir = turn(rot, ex.dir)
          d.smoke ??= particles.emit(ex.effect, exhaust, { dir, life: Infinity })
          if (ex.rev && car.data.throttle && !d.rev) d.rev = particles.emit(ex.rev, exhaust, { dir, life: Infinity })
          if (d.rev && !car.data.throttle) { d.rev.life = d.rev.age; d.rev = undefined }
          for (const fx of [d.smoke, d.rev]) if (fx) { fx.at = exhaust; fx.dir = dir }
        }
      }
      for (const id of [...cars.keys()]) if (!seen.has(id)) drop(scene, id)
    },
    close(plugins: Plugins) {
      for (const id of [...cars.keys()]) drop(plugins.render3d.scene, id)
      design = ''
    },
  }
}
