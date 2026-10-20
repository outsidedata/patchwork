// The browser half of scatter3d: trees, grass and boulders drawn around the camera, each pack a field
// of square cells that follows render3d's camera as it stands. Every cell is placed by the server
// half's `place` (`scatter3d.sim.ts`, which says what a pack holds and how a cell is kept), over the
// same ground, so a seat draws the instances the server's `solids` stand on.
//
// It stands the cells on the land the scene's `world.scatter3d.mods.land` names (`addons/scenemanager`'s
// mods), asked of that mod with the page's plugins each `afterTick`: `{ height, cover, ramp, rules,
// edits }`, terrain3d's browser half's `ground` from terrain3d's (`terrain3d.scatter3d.ts`). terrain3d
// makes that ground, and every new land under it, in its own `afterTick`, so the land's plugin is
// listed before this one and its land is read the frame it changes: a scene listing them the other
// way, or naming a land of a plugin it does not list, throws (`ahead`). Until there is a land, its
// field not loaded yet or a scene that names none, nothing is drawn: it waits for one.
//
// It reads the scene's `world.scatter3d` every frame (scatter3d has no row), and builds the field
// again when those numbers change, compared by content and never by identity. The browser's own
// numbers:
//   cutout    the alpha a BLEND material is cut at: every BLEND material of a model becomes an
//             alpha-tested one at `cutout`, written to depth and sorted with the opaque; a MASK
//             material keeps its own cutoff. Both are cards.
//   budget    milliseconds a frame may spend placing and bedding cells new to reach (The field).
//   coverage  a card's alpha gains this much per mip level its texture is read at: a becomes
//             a·(1 + max(0, level)·coverage), level = ½·log2 of the larger squared screen derivative
//             of its texel position. Without it an alpha-tested leaf falls under the cutoff a few mips
//             down, far firs thin to sticks, and a card LOD swapped in far off turns from a solid crown
//             into a skeleton.
// and a pack's:
//   lods      metres: the shells the pack is drawn in (below).
//   shadow    metres: a shell that ends within it casts shadows; every shell takes them.
//   leaf      how far a card's normal is bent toward the sky: `leafNormal(leaf)`, n ←
//             normalize(mix(n, up, leaf)) after the normal maps, so a crown of cards is lit, and takes
//             snow, as one mass.
//   colour surface  a shape pack's, below.
//
// A model pack's meshes are named `<row>-<lod>[-<part>]`, the row one of the pack's `rows`: every mesh
// of that name is one part of that LOD. Three's glTF loader makes a repeated name unique with `_1`,
// `_2`, …, so `<row>-<lod>_n` reads as `<row>-<lod>`, and `<row>-<lod>-<part>_n` as a part. Its
// `sanitizeNodeName` deletes `.`, so a Blender `tall-0.001` arrives as `tall-0001` and reads as LOD 1;
// and a node of more than one primitive is a group whose meshes carry the glTF mesh's name, not the
// node's: the name read is the mesh's own. Each mesh's geometry is copied with its node transforms
// baked in, and every LOD of a row is moved by one offset, the one that puts LOD 0's lowest point on
// y = 0 and the middle of its bounding box across x and z on the axis, so the LODs of a row stand on
// one spot. A row of weight 0 needs no mesh; a row that is drawn and has no mesh for one of its LODs
// throws naming it (`unmeshed`). Every material is copied, so the loader's own model is left as it
// was, and every copy goes through render3d's `dress`: a card with its surface of coverage and
// `leafNormal`, anything else with none. The model is asked of the loader once, and the
// pack is drawn once it has landed.
//
// A shape pack is boulders: `shape { detail, lumpy [base, range], squash }`. Each row is a variant,
// three's icosahedron of radius 1 and `detail`, each vertex moved out to base + range·h of itself,
// h the unit hash of its position (rounded to 1e-4, so every face that shares a vertex moves it alike
// and the rock has no cracks) with the seed + 7 + the row's index among `rows`, and then its y times
// `squash`, lit face by face. Its middle is on y = 0, so bedded like any other model half of it is under
// the ground, on purpose. It is drawn in `colour` (sRGB), with three's own roughness unless it has a
// `surface { broad, fine, lift, range, mix [a, b], moss { from, to, amount, up [lo, hi], colour }, bump,
// rough }`: n = a·noise(p·broad) + b·noise(p·fine), three-dimensional value noise with a quintic fade
// over the fragment's world point, and
//   albedo  × mix(1, 1 + range·(n − 0.5), lift);
//   bump    the normal bent as by a height of n·bump/fine metres, so a bump looks the same at any
//           `fine`;
//   moss    mixed in by smoothstep(from, to, n at an offset)·amount·smoothstep(up[0], up[1], the
//           world normal's y), so it grows on the faces that look up;
//   rough   the roughness.
// Its one geometry is drawn in every shell.
//
// Shells. A pack has lods.length + 1 of them. Shell k reaches ⌈lods[k]/cell⌉ cells from the camera's
// cell, the last ⌈reach/cell⌉, a cell's distance being the larger of its x and z distances in cells:
// shell 0 is the square out to its reach, each later one the square ring between the one before and
// its own. LOD k is drawn in shell k. A shell casts shadows when it ends, at lods[k] or at reach,
// within `shadow`.
//
// Looks. Each row drawn and each shell is a look: an InstancedMesh per part of that LOD, all of them
// as big as the shell's count of cells, since a cell holds at most one instance, so a look never
// overflows. Its instances are kept packed: a cell that leaves swaps the look's last instance into its
// place. Each instance is tinted by its cell's grey tint.
//
// The field. Each pack holds every cell within its reach, the refused ones too, so a cell is placed
// once while it stays in reach; a held cell's key is `cellKey(i, j)`, a number. The camera's cell is
// read each `afterTick`, after whatever places the camera, so a scene lists this before render3d,
// which draws in its own `afterTick`. A cell's shell changes only when its distance from the camera's
// cell crosses a shell's radius r, and a move of δ cells moves that distance by at most δ, so when the
// camera crosses into another cell only the rings between r − δ and r + δ cells from the old cell are
// asked, for each shell: O(R) cells, not the whole square, which only a move past the reach asks.
// Every asked cell whose shell changes leaves its look, the ones out of reach are let go, and only
// then does each one new to its shell arrive in its look: every one leaves before any arrives, or a
// look would briefly hold more than its count. So a cell changes LOD only when the camera crosses a
// cell, and every cell already placed changes shell on the crossing, whole.
//
// A cell new to reach is not placed on the crossing. It waits in a queue, planned again on each
// crossing nearest the camera's cell first, with the cells that have left reach dropped; each frame
// places and beds them, a cell from each pack in turn, until `budget` milliseconds have gone, and at
// least one. Each frame, only the slots of a look written since the last and still drawn go to the GPU,
// and they wait there until the renderer has sent them.
//
// Bedding. A cell's instance is its model at `size`, yawed, then tilted, and sunk:
//   foot    the mean distance from the axis of LOD 0's vertices from y = 0 up to a tenth of its rise,
//           its highest point; edge the largest of those distances;
//   lean    min(1, foot/rise): a tussock follows the slope and a fir stands up straight;
//   tilt    the plane fitted by least squares to the ground at 8 points foot·size round the cell's
//           point, the instance turned `lean` of the way (a slerp) from upright to its normal;
//   sink    the base stands at the plane's height over the point, less the largest gap between the
//           ground and a ring of radius (foot + lean·(edge − foot))·size about the tilted axis, taken
//           at 8 points starting straight downhill. The tilt turns the ring about the level line, so
//           its highest point over the ground is downhill wherever the slope faces, and it touches:
//           ground cover out to its edge, a fir at its foot, where its low branches overhang.
//
// A stroke moves scatter. Each frame reads the ground's `edits()` against what it saw last: a new land
// places every held cell again; a layer whose version moved re-takes each held cell whose footprint
// meets its rect, the cell's square grown by edge·(base + spread) for the pack's widest row. A cell
// re-taken is placed and bedded again from the same hashes, so a tree on raised ground rises with it and
// is the same tree, one on a painted road is refused, and the cells away from the stroke keep their
// matrices.
//
// It hands out `solids(x, z, r)`, the server half's `solids` over this client's land: the held cells
// where the field has them, any other placed on the spot; `packs()`, each built pack by name, `{ at, the
// camera's cell; held, its cells by cellKey; pending, the cells waiting to be placed; looks, by
// "<row> <shell>"; models, each drawn row's LODs and its foot, edge, rise and lean }`; `cellKey`; and
// `leafNormal`. `close` takes every look off the scene and disposes
// its meshes, the copied geometries and the copied materials.
import type * as THREE from 'three'
import type { Plugins } from '#engine/browser.ts'
import { ahead, mod } from '#addons/scenemanager/scenemanager.addon.ts'
import { check, hash, place, solidsOver, unit, type Cell, type Ground, type Pack, type RockSurface, type Scatter } from './scatter3d.sim.ts'

type Three = typeof import('three')
export type Part = { name: string; geometry: THREE.BufferGeometry; material: THREE.Material }
export type Model = { lods: Part[][]; foot: number; edge: number; rise: number; lean: number }
export type Held = { i: number; j: number; cell: Cell | undefined; m: Float32Array | undefined; shell: number; look: Look | undefined; slot: number }
export type Look = { meshes: THREE.InstancedMesh[]; cap: number; count: number; held: Held[]; written: Set<number> }
export type Live = {
  name: string; pack: Pack; radii: number[]; grow: number; models: Record<string, Model>
  at: [number, number] | undefined; held: Map<number, Held>; looks: Map<string, Look>; byRow: Record<string, Look[]>
  pending: Map<number, { i: number; j: number; d: number }>; queue: { i: number; j: number; d: number }[]; next: number
  geometries: Set<THREE.BufferGeometry>; materials: Set<THREE.Material>
}

// `<row>-<lod>`, with `_n` or `-<part>` after it.
const NAME = /^(.+)-(\d+)(?:_\d+)?(?:-(.+))?$/

// The sentence a model pack is refused with when a row it draws has no mesh for one of its LODs in
// `root`, the model's scene, or undefined when every drawn row has every LOD.
export function unmeshed(name: string, pack: Pack, root: THREE.Object3D): string | undefined {
  const has = new Set<string>()
  root.traverse(o => {
    const at = (o as THREE.Mesh).isMesh ? NAME.exec(o.name) : null
    if (at) has.add(`${at[1]} ${Number(at[2])}`)
  })
  for (const [row, r] of Object.entries(pack.rows)) {
    if (!(r.weight > 0)) continue
    for (let k = 0; k <= pack.lods.length; k++) if (!has.has(`${row} ${k}`)) return `scatter3d pack ${name} row ${row} has no LOD ${k} in ${pack.asset}`
  }
  return undefined
}

// A held cell's key: exact while |j| < 2²⁶.
export const cellKey = (i: number, j: number) => i * 134217728 + j
const f6 = (v: number) => v.toFixed(6)

export const leafNormal = (leaf: number) => `normal = normalize( mix( normal, ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz, ${f6(leaf)} ) );`

// A card's surface: coverage on its alpha, and its normal bent toward the sky.
const cardOf = (leaf: number, coverage: number) => ({
  fragment: {
    alphamap_fragment: [
      '#ifdef USE_MAP',
      '  vec2 scTexel = vMapUv * vec2( textureSize( map, 0 ) );',
      '  float scLevel = 0.5 * log2( max( dot( dFdx( scTexel ), dFdx( scTexel ) ), dot( dFdy( scTexel ), dFdy( scTexel ) ) ) );',
      `  diffuseColor.a *= 1.0 + max( 0.0, scLevel ) * ${f6(coverage)};`,
      '#endif',
    ].join('\n'),
    normal_fragment_maps: leafNormal(leaf),
  },
})

// A boulder's surface.
function rockOf(s: RockSurface, three: Three) {
  const rgb = (c: string) => { const k = new three.Color(c); return `vec3( ${f6(k.r)}, ${f6(k.g)}, ${f6(k.b)} )` }
  const { moss } = s
  return {
    fragment: {
      common: [
        'float scHash( vec3 p ) { p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) ); p += dot( p, p.yxz + 33.33 ); return fract( ( p.x + p.y ) * p.z ); }',
        'float scNoise( vec3 p ) {',
        '  vec3 i = floor( p ); vec3 f = fract( p ); vec3 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );',
        '  float a = mix( mix( scHash( i ), scHash( i + vec3( 1.0, 0.0, 0.0 ) ), u.x ), mix( scHash( i + vec3( 0.0, 1.0, 0.0 ) ), scHash( i + vec3( 1.0, 1.0, 0.0 ) ), u.x ), u.y );',
        '  float b = mix( mix( scHash( i + vec3( 0.0, 0.0, 1.0 ) ), scHash( i + vec3( 1.0, 0.0, 1.0 ) ), u.x ), mix( scHash( i + vec3( 0.0, 1.0, 1.0 ) ), scHash( i + vec3( 1.0, 1.0, 1.0 ) ), u.x ), u.y );',
        '  return mix( a, b, u.z ); }',
        `float scRock( vec3 p ) { return ${f6(s.mix[0])} * scNoise( p * ${f6(s.broad)} ) + ${f6(s.mix[1])} * scNoise( p * ${f6(s.fine)} ); }`,
      ].join('\n'),
      color_fragment: [
        'float scN = scRock( vDressWorld );',
        `diffuseColor.rgb *= mix( 1.0, 1.0 + ${f6(s.range)} * ( scN - 0.5 ), ${f6(s.lift)} );`,
      ].join('\n'),
      normal_fragment_maps: [
        `vec2 scD = vec2( dFdx( scN ), dFdy( scN ) ) * ${f6(s.bump / s.fine)};`,
        'vec3 scSx = dFdx( -vViewPosition ), scSy = dFdy( -vViewPosition );',
        'vec3 scR1 = cross( scSy, normal ), scR2 = cross( normal, scSx );',
        'float scDet = dot( scSx, scR1 ) * faceDirection;',
        'normal = normalize( abs( scDet ) * normal - sign( scDet ) * ( scD.x * scR1 + scD.y * scR2 ) );',
        `float scMoss = smoothstep( ${f6(moss.from)}, ${f6(moss.to)}, scRock( vDressWorld + vec3( 37.1, 11.9, 91.7 ) ) ) * ${f6(moss.amount)}`,
        `  * smoothstep( ${f6(moss.up[0])}, ${f6(moss.up[1])}, inverseTransformDirection( normal, viewMatrix ).y );`,
        `diffuseColor.rgb = mix( diffuseColor.rgb, ${rgb(moss.colour)}, scMoss );`,
      ].join('\n'),
    },
  }
}

// A row's foot, edge, rise and lean, from LOD 0's vertices standing on y = 0.
function stand(parts: Part[]): Pick<Model, 'foot' | 'edge' | 'rise' | 'lean'> {
  let rise = 0
  for (const p of parts) { const a = p.geometry.getAttribute('position'); for (let v = 0; v < a.count; v++) rise = Math.max(rise, a.getY(v)) }
  let sum = 0, n = 0, edge = 0
  for (const p of parts) {
    const a = p.geometry.getAttribute('position')
    for (let v = 0; v < a.count; v++) {
      const y = a.getY(v)
      if (y < 0 || y > 0.1 * rise) continue
      const d = Math.hypot(a.getX(v), a.getZ(v))
      sum += d
      n++
      edge = Math.max(edge, d)
    }
  }
  const foot = n ? sum / n : 0
  return { foot, edge, rise, lean: rise > 0 ? Math.min(1, foot / rise) : 1 }
}

// A boulder variant: the hashed icosahedron.
function boulder(shape: NonNullable<Pack['shape']>, seed: number, three: Three) {
  const g = new three.IcosahedronGeometry(1, shape.detail)
  const p = g.getAttribute('position')
  const [base, range] = shape.lumpy
  for (let v = 0; v < p.count; v++) {
    const x = p.getX(v), y = p.getY(v), z = p.getZ(v)
    const r = base + range * unit(Math.round(x * 1e4), Math.round(y * 1e4), hash(Math.round(z * 1e4), 0, seed))
    p.setXYZ(v, x * r, y * r * shape.squash, z * r)
  }
  g.computeVertexNormals()
  return g
}

export function scatter3d() {
  let seen: { s: Scatter; ground: Ground | undefined } | undefined
  let built: string | undefined
  let checked = false
  let lives: Record<string, Live> = {}
  let land: object | undefined
  let versions: number[] = []
  let three: Three | undefined
  let scene: THREE.Scene | undefined
  const asked = new Set<string>()

  const drop = () => {
    for (const l of Object.values(lives)) {
      for (const look of l.looks.values()) for (const m of look.meshes) { scene?.remove(m); m.dispose() }
      for (const g of l.geometries) g.dispose()
      for (const m of l.materials) m.dispose()
    }
    lives = {}
  }

  const me = {
    leafNormal,
    packs: () => lives,

    solids(x: number, z: number, r: number) {
      const ground = seen?.ground
      if (!seen || !ground) return []
      return solidsOver(seen.s.packs, (name, pack, i, j) => {
        const h = lives[name]?.held.get(cellKey(i, j))
        return h ? h.cell : place(pack, i, j, ground)
      }, x, z, r)
    },

    afterTick(plugins: Plugins) {
      const { scene: on } = plugins.wire
      const s = on.world?.scatter3d as Scatter | undefined
      if (!s) return
      if (!plugins.render3d) throw new Error('scatter3d draws through render3d, which this scene does not list')
      ahead(on, 'scatter3d', 'land')
      const ground = mod<(plugins: Plugins) => Ground | undefined>(on.world!, 'scatter3d', 'land')?.(plugins)
      seen = { s, ground }
      three = plugins.render3d.THREE
      scene = plugins.render3d.scene
      const text = JSON.stringify(s)
      if (text !== built) {
        drop()
        built = text
        checked = false
      }
      if (!ground) return
      if (!checked) {
        check(s, ground)
        checked = true
      }
      for (const [name, pack] of Object.entries(s.packs)) {
        if (lives[name]) continue
        const l = make(name, pack, s, plugins)
        if (l) lives[name] = l
      }
      const e = ground.edits()
      if (e.land !== land) {
        for (const l of Object.values(lives)) for (const h of l.held.values()) retake(l, h, ground)
        land = e.land
        versions = e.layers.map(v => v.version)
      } else {
        e.layers.forEach((layer, k) => {
          if (layer.version === versions[k]) return
          versions[k] = layer.version
          const [x0, z0, x1, z1] = layer.rect
          for (const l of Object.values(lives)) {
            const c = l.pack.cell, g = l.grow
            for (const h of l.held.values()) if (h.i * c - g <= x1 && (h.i + 1) * c + g >= x0 && h.j * c - g <= z1 && (h.j + 1) * c + g >= z0) retake(l, h, ground)
          }
        })
      }
      const camera = plugins.render3d.camera as THREE.PerspectiveCamera | undefined
      const all = Object.values(lives)
      if (camera) for (const l of all) follow(l, camera.position.x, camera.position.z)
      // The cells new to reach, a cell from each pack in turn, nearest first, until `budget`
      // milliseconds have gone, and at least one.
      const start = performance.now()
      let took = true, one = false
      while (took && (!one || performance.now() - start < s.budget)) {
        took = false
        for (const l of all) if (settle(l, ground)) took = one = true
      }
      for (const l of all) upload(l)
    },

    close() {
      drop()
      seen = undefined
      built = undefined
      land = undefined
      versions = []
      asked.clear()
    },
  }

  // A pack's models, its looks on the scene and its empty field; undefined while its model is coming.
  function make(name: string, pack: Pack, s: Scatter, plugins: Plugins): Live | undefined {
    const t = three!
    const drawn = Object.keys(pack.rows).filter(row => pack.rows[row].weight > 0)
    const radii = [...pack.lods.map(l => Math.ceil(l / pack.cell)), Math.ceil(pack.reach / pack.cell)]
    const ends = [...pack.lods, pack.reach]
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
    const dress = <M extends THREE.Material>(m: M, surface?: object): M => plugins.render3d.dress(m, surface ? { surface } : {})
    const models: Record<string, Model> = {}
    if (pack.asset !== undefined) {
      const loader = plugins.loader
      if (!loader.ready(pack.asset)) {
        if (!asked.has(pack.asset)) {
          asked.add(pack.asset)
          // The loader writes a failure to the console once itself.
          loader.load(pack.asset).catch(() => {})
        }
        return undefined
      }
      const root = loader.model(pack.asset).scene as THREE.Object3D
      const why = unmeshed(name, pack, root)
      if (why) throw new Error(why)
      root.updateMatrixWorld(true)
      const copies = new Map<THREE.Material, THREE.Material>()
      const found: Record<string, Part[][]> = {}
      root.traverse(o => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const at = NAME.exec(mesh.name)
        if (!at || !drawn.includes(at[1])) return
        const k = Number(at[2])
        if (k > pack.lods.length) return
        const theirs = mesh.material as THREE.Material
        let material = copies.get(theirs)
        if (!material) {
          material = theirs.clone()
          const card = material.transparent || material.alphaTest > 0
          if (material.transparent) {
            material.transparent = false
            material.alphaTest = s.cutout
            material.depthWrite = true
          }
          dress(material, card ? cardOf(pack.leaf, s.coverage) : undefined)
          copies.set(theirs, material)
          materials.add(material)
        }
        const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
        geometries.add(geometry)
        ;((found[at[1]] ??= [])[k] ??= []).push({ name: mesh.name, geometry, material })
      })
      for (const row of drawn) {
        const lods = found[row]
        const box = new t.Box3()
        for (const p of lods[0]) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!) }
        const dx = -(box.min.x + box.max.x) / 2, dy = -box.min.y, dz = -(box.min.z + box.max.z) / 2
        for (const parts of lods) for (const p of parts) p.geometry.translate(dx, dy, dz)
        models[row] = { lods, ...stand(lods[0]) }
      }
    } else {
      const material = dress(new t.MeshStandardMaterial({ color: new t.Color(pack.colour), ...(pack.surface && { roughness: pack.surface.rough }) }), pack.surface && rockOf(pack.surface, t))
      material.name = name
      materials.add(material)
      const rows = Object.keys(pack.rows)
      for (const row of drawn) {
        const geometry = boulder(pack.shape!, pack.seed + 7 + rows.indexOf(row), t)
        geometries.add(geometry)
        const part = { name: row, geometry, material }
        models[row] = { lods: radii.map(() => [part]), ...stand([part]) }
      }
    }
    const looks = new Map<string, Look>(), byRow: Record<string, Look[]> = {}
    for (const row of drawn) {
      radii.forEach((R, k) => {
        const cap = (2 * R + 1) ** 2 - (k ? (2 * radii[k - 1] + 1) ** 2 : 0)
        const meshes = models[row].lods[k].map(p => {
          const m = new t.InstancedMesh(p.geometry, p.material, cap)
          m.name = p.name
          m.count = 0
          m.instanceColor = new t.InstancedBufferAttribute(new Float32Array(cap * 3), 3)
          m.castShadow = ends[k] <= pack.shadow
          m.receiveShadow = true
          // The instances move as the camera does; a bounding sphere kept from any one moment culls
          // the rest.
          m.frustumCulled = false
          scene!.add(m)
          return m
        })
        const look = { meshes, cap, count: 0, held: [], written: new Set<number>() }
        looks.set(`${row} ${k}`, look)
        ;(byRow[row] ??= [])[k] = look
      })
    }
    const grow = Math.max(0, ...drawn.map(row => models[row].edge)) * (pack.size[0] + pack.size[1])
    return { name, pack, radii, grow, models, at: undefined, held: new Map(), looks, byRow, pending: new Map(), queue: [], next: 0, geometries, materials }
  }

  // The shell a cell d cells from the camera's is in, or −1 out of reach.
  const shellOf = (l: Live, d: number) => l.radii.findIndex(R => d <= R)

  // Marks slot s of a look for upload.
  const touch = (look: Look, s: number) => { look.written.add(s) }

  function arrive(l: Live, h: Held) {
    const look = l.byRow[h.cell!.row][h.shell]
    if (look.count === look.cap) throw new Error(`scatter3d pack ${l.name}: the look of ${h.cell!.row} in shell ${h.shell} is full at ${look.cap}`)
    const slot = look.count++
    for (const m of look.meshes) {
      m.instanceMatrix.array.set(h.m!, slot * 16)
      m.instanceColor!.array.fill(h.cell!.tint, slot * 3, slot * 3 + 3)
      m.count = look.count
    }
    touch(look, slot)
    look.held[slot] = h
    h.look = look
    h.slot = slot
  }

  function leave(h: Held) {
    const look = h.look!
    const last = --look.count
    if (h.slot !== last) {
      const moved = look.held[last]
      for (const m of look.meshes) {
        m.instanceMatrix.array.copyWithin(h.slot * 16, last * 16, last * 16 + 16)
        m.instanceColor!.array.copyWithin(h.slot * 3, last * 3, last * 3 + 3)
      }
      look.held[h.slot] = moved
      moved.slot = h.slot
      touch(look, h.slot)
    }
    look.held.length = last
    for (const m of look.meshes) m.count = look.count
    h.look = undefined
    h.slot = -1
  }

  // Every look's slots written since the last frame and still drawn go to the GPU, and no others: a
  // range a slot, which three sorts and joins where they touch, never a span from the first to the
  // last, which would send every slot between. The ranges are added to any the renderer has not sent
  // yet, which it clears once it has, and a version moves only with a range, since a new version with
  // none sends the whole buffer.
  function upload(l: Live) {
    for (const look of l.looks.values()) {
      const slots = [...look.written].filter(s => s < look.count)
      look.written.clear()
      if (!slots.length) continue
      for (const m of look.meshes) {
        for (const [a, n] of [[m.instanceMatrix, 16], [m.instanceColor!, 3]] as const) {
          for (const s of slots) a.addUpdateRange(s * n, n)
          a.needsUpdate = true
        }
      }
    }
  }

  // A cell placed and bedded from its hashes.
  function take(l: Live, i: number, j: number, ground: Ground) {
    const cell = place(l.pack, i, j, ground)
    return { cell, m: cell && bed(cell, l.models[cell.row], ground) }
  }

  // A held cell placed and bedded again where it is, in its shell.
  function retake(l: Live, h: Held, ground: Ground) {
    if (h.look) leave(h)
    Object.assign(h, take(l, h.i, h.j, ground))
    if (h.cell) arrive(l, h)
  }

  // The field onto the camera's cell. A cell's shell changes only when its distance from the camera's
  // cell crosses a shell's radius R, and a move of δ cells changes that distance by at most δ, so
  // only the cells between R − δ and R + δ from the old cell are asked, ring by ring: O(R) of them
  // on a crossing. A move past the field's reach asks the whole square.
  function follow(l: Live, x: number, z: number) {
    const ci = Math.floor(x / l.pack.cell), cj = Math.floor(z / l.pack.cell)
    const was = l.at
    if (was && was[0] === ci && was[1] === cj) return
    l.at = [ci, cj]
    const R = l.radii[l.radii.length - 1]
    const arriving: Held[] = []
    // Every cell leaves before any arrives.
    const ask = (i: number, j: number) => {
      const k = shellOf(l, Math.max(Math.abs(i - ci), Math.abs(j - cj)))
      const key = cellKey(i, j)
      const h = l.held.get(key)
      if (!h) {
        if (k >= 0 && !l.pending.has(key)) l.pending.set(key, { i, j, d: 0 })
        return
      }
      if (k === h.shell) return
      if (h.look) leave(h)
      if (k < 0) { l.held.delete(key); return }
      h.shell = k
      if (h.cell) arriving.push(h)
    }
    const d = was ? Math.max(Math.abs(ci - was[0]), Math.abs(cj - was[1])) : Infinity
    if (d > R) {
      for (const h of l.held.values()) if (h.look) leave(h)
      l.held.clear()
      l.pending.clear()
      for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) ask(i, j)
    } else {
      const [oi, oj] = was!
      const rings = new Uint8Array(R + d + 1)
      for (const r of l.radii) for (let n = Math.max(0, r - d + 1); n <= r + d; n++) rings[n] = 1
      rings.forEach((on, n) => {
        if (!on) return
        if (n === 0) return ask(oi, oj)
        for (let i = oi - n; i <= oi + n; i++) { ask(i, oj - n); ask(i, oj + n) }
        for (let j = oj - n + 1; j < oj + n; j++) { ask(oi - n, j); ask(oi + n, j) }
      })
    }
    for (const h of arriving) arrive(l, h)
    // What is still to be placed, planned again from here: nearest first, and none out of reach.
    for (const [key, c] of l.pending) {
      c.d = Math.max(Math.abs(c.i - ci), Math.abs(c.j - cj))
      if (c.d > R) l.pending.delete(key)
    }
    l.queue = [...l.pending.values()].sort((a, b) => a.d - b.d)
    l.next = 0
  }

  // The nearest cell still to be placed, placed and bedded in its shell; false when there is none.
  function settle(l: Live, ground: Ground) {
    while (l.next < l.queue.length) {
      const { i, j } = l.queue[l.next++]
      const key = cellKey(i, j)
      if (!l.pending.delete(key)) continue
      const h: Held = { i, j, ...take(l, i, j, ground), shell: shellOf(l, Math.max(Math.abs(i - l.at![0]), Math.abs(j - l.at![1]))), look: undefined, slot: -1 }
      l.held.set(key, h)
      if (h.cell) arrive(l, h)
      return true
    }
    return false
  }

  // The instance's matrix: yawed, tilted `lean` of the way to the ground's plane, and sunk.
  function bed(c: Cell, model: Model, ground: Ground): Float32Array {
    const t = three!
    const { foot, edge, lean } = model
    const f = foot * c.size
    let a = 0, bx = 0, bz = 0
    if (f > 0) {
      let sx = 0, sz = 0
      for (let k = 0; k < 8; k++) {
        const dx = f * Math.cos((k * Math.PI) / 4), dz = f * Math.sin((k * Math.PI) / 4)
        const h = ground.height(c.x + dx, c.z + dz)
        a += h
        sx += h * dx
        sz += h * dz
      }
      // Eight points evenly round a circle: Σdx² = Σdz² = 4f² and Σdx·dz = 0.
      a /= 8
      bx = sx / (4 * f * f)
      bz = sz / (4 * f * f)
    } else a = ground.height(c.x, c.z)
    const up = new t.Vector3(0, 1, 0)
    const tilt = new t.Quaternion().slerpQuaternions(new t.Quaternion(), new t.Quaternion().setFromUnitVectors(up, new t.Vector3(-bx, 1, -bz).normalize()), lean)
    const rho = (foot + lean * (edge - foot)) * c.size
    const down = Math.atan2(-bz, -bx)
    const p = new t.Vector3()
    let gap = -Infinity
    for (let k = 0; k < 8; k++) {
      const th = down + (k * Math.PI) / 4
      p.set(rho * Math.cos(th), 0, rho * Math.sin(th)).applyQuaternion(tilt)
      gap = Math.max(gap, a + p.y - ground.height(c.x + p.x, c.z + p.z))
    }
    const q = tilt.multiply(new t.Quaternion().setFromAxisAngle(up, c.yaw))
    return Float32Array.from(new t.Matrix4().compose(new t.Vector3(c.x, a - gap, c.z), q, new t.Vector3(c.size, c.size, c.size)).elements)
  }

  return me
}
