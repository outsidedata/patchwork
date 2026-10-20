// The browser half of terrain3d: the ground drawn as square rings that follow the camera, so it
// never ends, and the `ground` other plugins ask. It reads the scene's `world.terrain3d` off
// `plugins.wire.scene.world` (terrain3d has no row), asks the loader for the field it names
// (`terrain3d.sim.ts` says what the file holds) and makes its own land from this client's parse of it
// with the server half's `land`, so a seat draws the ground its rules stand on, byte for byte.
//
// Its other numbers are the render budget:
//   rings        `[{ reach, seg }]`, finest first: a ring is a square `reach` metres from its middle
//                to its edge, of `seg` cells across.
//   shadowReach  a ring whose reach is within this casts shadows; every ring takes them.
//   budget       milliseconds a frame the rebuild may take.
//   seabed       whether ground under the waterline is drawn at `raw`, so the sea has a floor.
//   static       false when left out; true, the rings stand still, centred on the world's origin, instead of following
//                the camera: built once and never recentred, for a place small enough that its
//                finest ring covers all of it. A brush stroke still rebuilds the rings it reaches.
//
// The grid. The finest ring's cell, 2·reach/seg, is the lattice unit, and every place a ring puts
// a vertex is a whole number of units across, so two rings that put one at the same place put it at
// the same float. Each coarser ring's cell is its own 2·reach/seg rounded to a whole number of the
// next finer ring's cells. A ring snaps its middle to multiples of about an eighth of its reach,
// rounded to a whole number of the next coarser ring's cells (its own, for the outermost), and its
// half width is its reach rounded up to the same, so its edge, and so the hole the next ring leaves
// for it, sits on the next ring's grid lines and no strip of sky shows. The camera may sit up to half
// a snap from each of two rings' middles, so a ring set in which a ring's half width is less than
// the finer one's, plus half of both snaps, plus a cell, could leave a hole uncovered, and throws when
// the plugin starts.
//
// Seams. A fine ring's outer edge is lifted onto the next coarser ring's chord: a vertex t fine cells
// along a coarse edge from its vertex A to B, m fine cells to a coarse one, is drawn at hA +
// (hB − hA)·(t/m) (hA itself at t = 0), so the rings meet without skirts. The coarse ring's cells
// along its hole are fanned through those same seam vertices, made with the same arithmetic from the
// same heights, so the two rings share every seam vertex bit for bit and no T-junction drops a pixel.
// Only the outermost ring hangs a skirt, max(hscale, 40) deep, down from its edge.
//
// A ring recentres (unless `static`) when the camera, read off render3d's camera as it stands each `afterTick`, crosses
// half a snap, and the ring outside it follows, because its hole moves. The rings that change are
// built into second buffers a slice a frame: each frame takes units of work (a ring's layout, a row
// of heights and colours, a row of normals, its seams and skirt, a row of triangles, and last the
// swap) until `budget` milliseconds have gone, at least one; and all of them swap in together, in
// that last unit, once every one is whole, so a seam is never half built. The rings are sized so a rebuild finishes before the camera leaves the
// fine area. A new land is made when the field's content changes, compared by value and never by
// identity, since the loader refills a rewritten file in place: when only its layers changed, as
// when a stroke is saved or undone, only the rings that the rects of the layers from the first that
// changed on, the old land's and the new one's, reach are rebuilt, and every other ring is the new
// land's as it stands, since every height and value it drew is the same; a change to the bands'
// colours, amounts and edges, the surfaces' colours, covers and edges, or the detail but for its
// record rules, changes what no vertex carries and rebuilds no ring, only the material; any other
// change rebuilds every ring, which draw with the material the old look made until they swap in. A ring is also rebuilt where a layer's version has moved and its rect reaches ground
// the ring draws, as when the brush strokes this client's `land`. The rings shown stay on the scene
// until the rebuilt ones swap in, so the ground never goes. So this is listed before render3d,
// whose `afterTick` draws.
//
// What a vertex carries. Each vertex holds, packed four to a vec4 attribute (`tdA0`, `tdA1`, …), the
// values its land record gives that the colour is made of: every band after the first its rules'
// ramps multiplied (not its `amount`), the grain, base + range·hash of the whole metre it stands in,
// every surface the paint's weight where the paint is that surface and 0 elsewhere, and every detail
// layer with a `where` rule on the record its record rules' ramps multiplied. At most 16, which the
// GPU passes on to the fragment beside what three passes; a field that needs more throws when its
// material is made. Normals are the height function's over ±one cell, and along a ring's hole over
// ±one of the finer ring's cells, as that ring takes them at the same vertices; never a zero vector
// made unit: a NaN normal silently stops shadow receiving.
//
// The colour is made per pixel, in GLSL built from the field with toFixed(6) and handed to render3d's
// `dress`, from those values as the GPU blends them between the vertices: the first band's colour,
// each later band mixed in by amount·its ramps drawn through its edge, times the grain, then each
// surface's colour by its weight drawn through its edge (an edge, `terrain3d.sim.ts`). A value with
// no edge is drawn as it blends, so a field with none draws as the vertex colours it once had. Colours
// are mixed as three has them, linear.
//
// Then the detail, each layer in its list's order within the part of the shader it changes: the
// albedo, the roughness, or the normal. A layer's weight is its `where` rules' ramps multiplied, the
// record's from the vertices and `band:<i>` (how much of band i shows once every later band is laid
// over it) and `surface:<name>` (that surface's weight drawn through its edge) per pixel, drawn
// through the layer's edge, times `amount` (1 when absent), times the fade, 1 − smoothstep(near,
// far, the distance from the camera) over `fade` [near, far] (1 when absent). n is its noise: Σ
// weights[i]·valueNoise(q·freqs[i]), q the ground point plus `offset`, turned `angle` radians and
// multiplied by `stretch` [x, z], each 0, 0 and [1, 1] when absent, so a stretched noise runs in
// strokes along its long axis. The kinds:
//   tint     the albedo × mix(1, base + range·(n − 0.5), weight).
//   patch    the albedo toward `colour` by smoothstep(from, to, n)·weight.
//   bump     the normal bent by strength·weight times the noise's slope, read `step` metres apart.
//   rough    the roughness toward mix(mid, clamp(mix(range[0], range[1], n) + jitter.amount·(2·
//            valueNoise(p·jitter.freq) − 1)), fade) by its weight without the fade, mid the middle
//            of `range`: up close the noise, far off the middle.
//   texture  the loader's `texture` entries `map` (the albedo), `normal` (a tangent-space normal map,
//            OpenGL's green) and `rough` (its red the roughness), `scale` metres a repeat, projected
//            straight down (`top`) or along all three axes (`tri`), each axis's share its normal's
//            part to the power `sharp`, the normals blended whiteout. `vary` from 0 breaks up the
//            tiling: each lookup is two lookups at offsets picked by a noise in the map's own repeats,
//            `vary` repeats apart at most, blended, sharing one gradient so neither shimmers. The map
//            times `colour` is laid over the albedo (`over`) or multiplies it (`multiply`) by the
//            weight; the normal map, its xy times `strength`, bends the normal toward it, and the
//            roughness map takes the roughness toward it, by the weight. A layer draws nothing until
//            every map it names has landed. A map that is no `texture` entry of the catalogue throws,
//            and so do more than 12 maps, which with three's own leave the GPU none to spare.
// A layer's GLSL reads only constants, but for its maps, so changing a layer's numbers makes a new
// program and changes no ring.
//
// It hands out `land`, the client's own, which the brush strokes, made again from each new content
// with the unsaved strokes the file does not hold yet (`terrain3d.sim.ts`); `rings`, where each ring stands
// (`at` its middle and `half` its half width in metres, `cell`, and its `mesh`); `building()`, how far
// the rebuild in hand has got, `{ done, total }` units, or undefined; and `ground`, once there is a
// land: `{ height, raw, depth, at, cover, ramp, rules, edits, ray }` over this client's land, `at`
// its land record and `cover` its paint's cover, `rules` the server half's check and `ray(origin,
// dir)` marched out to the camera's far plane. `close` takes the rings off the scene and disposes
// every geometry and the material.
import type * as THREE from 'three'
import type { Plugins } from '#engine/browser.ts'
import { hash, land as landFrom, recorded, rules, shape, type Detail, type Edge, type Field, type Key, type Land, type Noise, type Rule } from './terrain3d.sim.ts'

type Settings = { field: string; rings: { reach: number; seg: number }[]; shadowReach: number; budget: number; seabed: boolean; static?: boolean }
// A ring in lattice units: its cell, its snap, its half width.
type Ring = { m: number; s: number; H: number; reach: number }
type Shown = { C: number[]; hole: number[] | undefined; land: Land; versions: number[]; mesh: THREE.Mesh }
type Build = {
  k: number; C: number[]; hole: number[] | undefined; N: number; x0: number; z0: number
  vid: Int32Array; hs: Float64Array; seam: Map<string, number>; count: number
  pos: Float32Array; nor: Float32Array; att: Float32Array[]; index: number[]
  units: (() => void)[]; next: number
}
// Where each value a vertex carries goes, four to an attribute: each band's (-1 for the first, which
// carries none), the grain's, each surface's by name, and each detail layer's (undefined for one with
// no record rule); `attributes` is how many vec4s.
type Slots = { bands: number[]; grain: number; surfaces: Record<string, number>; masks: (number | undefined)[]; attributes: number }

// The most values a vertex carries, and the most texture maps the detail binds.
const VALUES = 16
const MAPS = 12

// What a vertex carries for field `f`.
function slotsOf(f: Field): Slots {
  let n = 0
  const bands = f.bands.map((_, i) => (i === 0 ? -1 : n++))
  const grain = n++
  const surfaces = Object.fromEntries(Object.keys(f.surfaces ?? {}).map(name => [name, n++]))
  const masks = (f.detail ?? []).map(d => ((d.where ?? []).some(r => recorded(r.q)) ? n++ : undefined))
  if (n > VALUES) {
    throw new Error(`terrain3d carries at most ${VALUES} values a vertex: this field's ${f.bands.length - 1} bands after the first, its grain, its ${Object.keys(f.surfaces ?? {}).length} surfaces and its ${masks.filter(m => m !== undefined).length} detail layers with record rules are ${n}`)
  }
  return { bands, grain, surfaces, masks, attributes: Math.ceil(n / 4) }
}

// Everything of a field a vertex carries is made from: two fields that give the same make the same
// rings, whatever else of their look differs.
const carried = (f: Field) => JSON.stringify([f.bands.map(b => b.rules), f.grain, Object.keys(f.surfaces ?? {}), (f.detail ?? []).map(vertexRules).filter(r => r.length)])
// Everything of a field the material is made from.
const looked = (f: Field) => JSON.stringify([f.bands, f.grain, f.surfaces ?? {}, f.detail ?? []])
// The record rules of a detail layer, which its vertex value multiplies, and the rest, read per pixel.
const vertexRules = (d: Detail) => (d.where ?? []).filter(r => recorded(r.q))
const pixelRules = (d: Detail) => (d.where ?? []).filter(r => !recorded(r.q))
// The texture maps a detail layer names, by the uniform each is bound to.
const mapsOf = (d: Detail, k: number): [string, string][] =>
  d.kind === 'texture' ? [[`tdMap${k}`, d.map], ...(d.normal ? [[`tdNor${k}`, d.normal] as [string, string]] : []), ...(d.rough ? [[`tdRgh${k}`, d.rough] as [string, string]] : [])] : []

// The GLSL of value noise at a point, and of a noise's fbm, made once and shared by every layer.
const NOISE = [
  'float tdHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }',
  'float tdNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);',
  '  return mix(mix(tdHash(i), tdHash(i + vec2(1.0, 0.0)), u.x), mix(tdHash(i + vec2(0.0, 1.0)), tdHash(i + vec2(1.0, 1.0)), u.x), u.y); }',
  // A map looked up at uv, its tiling broken up by `vary`: two lookups at offsets a noise in the map's
  // own repeats picks, blended, both with uv's own gradient.
  'vec4 tdTile(sampler2D s, vec2 uv, float vary) {',
  '  vec2 dx = dFdx(uv), dy = dFdy(uv);',
  '  float k = tdNoise(uv * 0.25) * 8.0; float i = floor(k);',
  '  vec4 a = textureGrad(s, uv + vary * sin(vec2(3.0, 7.0) * i), dx, dy), b = textureGrad(s, uv + vary * sin(vec2(3.0, 7.0) * (i + 1.0)), dx, dy);',
  '  return mix(a, b, smoothstep(0.2, 0.8, k - i)); }',
].join('\n')

// The ground's look, as a render3d surface: the colours, then the detail. `uniforms` gets each map's
// sampler and each texture layer's switch.
function look(f: Field, slots: Slots, THREE: typeof import('three'), uniforms: Record<string, THREE.IUniform>): { uniforms: Record<string, THREE.IUniform>; vertex: Record<string, string>; fragment: Record<string, string> } {
  const n6 = (v: number) => v.toFixed(6)
  const rgb = (c: string) => { const k = new THREE.Color(c); return `vec3(${n6(k.r)}, ${n6(k.g)}, ${n6(k.b)})` }
  const value = (s: number) => `vTdA${s >> 2}.${'xyzw'[s & 3]}`
  const v2 = (v: number[]) => `vec2(${n6(v[0])}, ${n6(v[1])})`
  const sharpen = (w: string, e: Edge | undefined) => {
    if (!e) return w
    const rag = e.ragged > 0 ? ` + ${n6(e.ragged)} * (tdNoise(tdP * ${n6(e.scale)}) - 0.5)` : ''
    return `smoothstep(${n6(0.5 - e.width / 2)}, ${n6(0.5 + e.width / 2)}, ${w}${rag})`
  }
  const ramp = (v: string, r: Rule) => (r.lo === r.hi ? `step(${n6(r.lo)}, ${v})` : `clamp((${v} - ${n6(r.lo)}) / ${n6(r.hi - r.lo)}, 0.0, 1.0)`)
  const surfaces = Object.keys(f.surfaces ?? {})
  const detail = f.detail ?? []
  const vertexes = Array.from({ length: slots.attributes }, (_, i) => i)

  // Each layer's noise, as a function of the ground point.
  const noises = detail.map((d, k) => {
    if (d.kind === 'texture') return ''
    const n: Noise = d.noise
    let q = 'p'
    if (n.offset) q = `(${q} + ${v2(n.offset)})`
    if (n.angle) q = `(mat2(${n6(Math.cos(n.angle))}, ${n6(Math.sin(n.angle))}, ${n6(-Math.sin(n.angle))}, ${n6(Math.cos(n.angle))}) * ${q})`
    if (n.stretch) q = `(${q} * ${v2(n.stretch)})`
    return `float tdN${k}(vec2 p) { vec2 q = ${q}; return ${n.freqs.map((fr, i) => `${n6(n.weights[i])} * tdNoise(q * ${n6(fr)})`).join(' + ')}; }`
  })
  // Each texture layer's maps and its albedo, roughness and normal from them, at world point w, the
  // geometric normal g picking the axes and the normal b bent.
  const textures = detail.map((d, k) => {
    if (d.kind !== 'texture') return ''
    for (const [name] of mapsOf(d, k)) uniforms[name] = { value: null }
    uniforms[`tdOn${k}`] = { value: 0 }
    const tile = (s: string, uv: string) => (d.vary > 0 ? `tdTile(${s}, ${uv}, ${n6(d.vary)})` : `texture(${s}, ${uv})`)
    const tri = d.project === 'tri'
    // The three planes' uvs, each turned over where the face looks down its axis, so no face is a mirror.
    const planes = [
      `vec3 p = w / ${n6(d.scale)}; vec3 s = vec3(g.x < 0.0 ? -1.0 : 1.0, g.y < 0.0 ? -1.0 : 1.0, g.z < 0.0 ? -1.0 : 1.0);`,
      'vec2 uvX = vec2(p.z * s.x, p.y), uvY = vec2(p.x * s.y, p.z), uvZ = vec2(-p.x * s.z, p.y);',
      tri ? `vec3 a = pow(abs(g), vec3(${n6(d.sharp)})); a /= a.x + a.y + a.z;` : '',
    ].join(' ')
    const albedo = tri
      ? `${tile(`tdMap${k}`, 'uvX')}.rgb * a.x + ${tile(`tdMap${k}`, 'uvY')}.rgb * a.y + ${tile(`tdMap${k}`, 'uvZ')}.rgb * a.z`
      : `${tile(`tdMap${k}`, 'uvY')}.rgb`
    const out = [
      `uniform sampler2D tdMap${k};`,
      `uniform float tdOn${k};`,
      `vec3 tdAlbedo${k}(vec3 w, vec3 g) { ${planes} return (${albedo}) * ${rgb(d.colour)}; }`,
    ]
    if (d.rough) {
      out.push(`uniform sampler2D tdRgh${k};`)
      out.push(`float tdRough${k}(vec3 w, vec3 g) { ${planes} return ${tri ? `${tile(`tdRgh${k}`, 'uvX')}.r * a.x + ${tile(`tdRgh${k}`, 'uvY')}.r * a.y + ${tile(`tdRgh${k}`, 'uvZ')}.r * a.z` : `${tile(`tdRgh${k}`, 'uvY')}.r`}; }`)
    }
    if (d.normal) {
      out.push(`uniform sampler2D tdNor${k};`)
      const unpack = (uv: string) => `${tile(`tdNor${k}`, uv)}.xyz * 2.0 - 1.0`
      const st = n6(d.strength)
      out.push([
        `vec3 tdNormal${k}(vec3 w, vec3 g, vec3 b) { ${planes}`,
        `  vec3 tY = ${unpack('uvY')}; tY.xy *= ${st}; tY.x *= s.y; tY = vec3(tY.xy + b.xz, abs(tY.z) * b.y);`,
        tri ? [
          `  vec3 tX = ${unpack('uvX')}; tX.xy *= ${st}; tX.x *= s.x; tX = vec3(tX.xy + b.zy, abs(tX.z) * b.x);`,
          `  vec3 tZ = ${unpack('uvZ')}; tZ.xy *= ${st}; tZ.x *= -s.z; tZ = vec3(tZ.xy + b.xy, abs(tZ.z) * b.z);`,
          '  return normalize(tX.zyx * a.x + tY.xzy * a.y + tZ.xyz * a.z); }',
        ].join('\n') : '  return normalize(tY.xzy); }',
      ].join('\n'))
    }
    return out.join('\n')
  })
  const maps = detail.reduce((n, d, k) => n + mapsOf(d, k).length, 0)
  if (maps > MAPS) throw new Error(`terrain3d binds at most ${MAPS} texture maps: this field's detail names ${maps}`)

  // The colours: the bands, each later one by amount·its ramps through its edge, the grain, the paint.
  const colours = [
    'vec2 tdP = vDressWorld.xz;',
    'float tdDist = distance(cameraPosition, vDressWorld);',
    'vec3 tdGeo = inverseTransformDirection(normalize(vNormal), viewMatrix);',
    `vec3 tdC = ${rgb(f.bands[0].colour)};`,
    'float tdB0 = 1.0;',
    ...f.bands.slice(1).map((b, j) => {
      const i = j + 1
      return `float tdB${i} = ${n6(b.amount)} * ${sharpen(value(slots.bands[i]), b.edge)}; tdC = mix(tdC, ${rgb(b.colour)}, tdB${i});`
    }),
    // How much of each band shows once every later band is laid over it.
    ...f.bands.map((_, i) => `float tdShow${i} = tdB${i}${f.bands.slice(i + 1).map((_, j) => ` * (1.0 - tdB${i + 1 + j})`).join('')};`),
    `tdC *= ${value(slots.grain)};`,
    ...surfaces.map((name, i) => `float tdS${i} = ${sharpen(value(slots.surfaces[name]), f.surfaces[name].edge)}; tdC = mix(tdC, ${rgb(f.surfaces[name].colour)}, tdS${i});`),
  ]
  // Each layer's weight, with and without its fade.
  const reads = (q: string) => (q.startsWith('band:') ? `tdShow${q.slice(5)}` : `tdS${surfaces.indexOf(q.slice(8))}`)
  const weights = detail.map((d, k) => {
    const terms = [
      ...(slots.masks[k] !== undefined ? [value(slots.masks[k]!)] : []),
      ...pixelRules(d).map(r => ramp(reads(r.q), r)),
    ]
    const w = sharpen(terms.length ? terms.join(' * ') : '1.0', terms.length ? d.edge : undefined)
    const fade = d.fade ? `1.0 - smoothstep(${n6(d.fade[0])}, ${n6(d.fade[1])}, tdDist)` : '1.0'
    return [
      `float tdW${k} = ${n6(d.amount ?? 1)} * ${w}${d.kind === 'texture' ? ` * tdOn${k}` : ''};`,
      `float tdF${k} = ${fade};`,
      `float tdM${k} = tdW${k} * tdF${k};`,
    ].join(' ')
  })
  const albedo = detail.map((d, k) => {
    if (d.kind === 'tint') return `tdC *= mix(1.0, ${n6(d.base)} + ${n6(d.range)} * (tdN${k}(tdP) - 0.5), tdM${k});`
    if (d.kind === 'patch') return `tdC = mix(tdC, ${rgb(d.colour)}, smoothstep(${n6(d.from)}, ${n6(d.to)}, tdN${k}(tdP)) * tdM${k});`
    if (d.kind === 'texture') return d.blend === 'over' ? `tdC = mix(tdC, tdAlbedo${k}(vDressWorld, tdGeo), tdM${k});` : `tdC *= mix(vec3(1.0), tdAlbedo${k}(vDressWorld, tdGeo), tdM${k});`
    return ''
  })
  const roughness = detail.map((d, k) => {
    if (d.kind === 'rough') {
      const [lo, hi] = d.range
      return [
        `{ float r = clamp(mix(${n6(lo)}, ${n6(hi)}, tdN${k}(tdP)) + ${n6(d.jitter.amount)} * (2.0 * tdNoise(tdP * ${n6(d.jitter.freq)}) - 1.0), 0.0, 1.0);`,
        `  roughnessFactor = mix(roughnessFactor, mix(${n6((lo + hi) / 2)}, r, tdF${k}), tdW${k}); }`,
      ].join('\n')
    }
    if (d.kind === 'texture' && d.rough) return `roughnessFactor = mix(roughnessFactor, tdRough${k}(vDressWorld, tdGeo), tdM${k});`
    return ''
  })
  const normals = detail.map((d, k) => {
    if (d.kind === 'bump') {
      const st = n6(d.step)
      return [
        `{ float n = tdN${k}(tdP); vec2 g = vec2(tdN${k}(tdP + vec2(${st}, 0.0)) - n, tdN${k}(tdP + vec2(0.0, ${st})) - n) / ${st};`,
        `  normal = normalize(normal + (viewMatrix * vec4(vec3(-g.x, 0.0, -g.y) * ${n6(d.strength)} * tdM${k}, 0.0)).xyz); }`,
      ].join('\n')
    }
    if (d.kind === 'texture' && d.normal) {
      return [
        '{ vec3 b = inverseTransformDirection(normal, viewMatrix);',
        `  normal = normalize((viewMatrix * vec4(normalize(mix(b, tdNormal${k}(vDressWorld, tdGeo, b), tdM${k})), 0.0)).xyz); }`,
      ].join('\n')
    }
    return ''
  })
  const lines = (list: string[]) => list.filter(Boolean).join('\n')
  return {
    uniforms,
    vertex: {
      common: lines(vertexes.map(i => `attribute vec4 tdA${i};\nvarying vec4 vTdA${i};`)),
      begin_vertex: lines(vertexes.map(i => `vTdA${i} = tdA${i};`)),
    },
    fragment: {
      common: lines([...vertexes.map(i => `varying vec4 vTdA${i};`), NOISE, ...noises, ...textures]),
      color_fragment: lines([...colours, ...weights, ...albedo, 'diffuseColor.rgb = tdC;']),
      roughnessmap_fragment: lines(roughness),
      normal_fragment_maps: lines(normals),
    },
  }
}
type Job = { land: Land; versions: number[]; builds: Build[]; total: number; done: number }

// The chord of a coarse edge from hA to hB, t fine cells along it of m: one arithmetic for both rings.
const chord = (hA: number, hB: number, t: number, m: number) => (t === 0 ? hA : t === m ? hB : hA + (hB - hA) * (t / m))

// The rings of `world.terrain3d` in lattice units, and the lattice unit; throws for a set that can leave a hole.
function layoutOf(rings: Settings['rings']): { c0: number; rings: Ring[] } {
  if (!rings?.length) throw new Error('terrain3d has no rings')
  const c0 = (2 * rings[0].reach) / rings[0].seg
  const m: number[] = []
  rings.forEach((r, k) => { m.push(k === 0 ? 1 : Math.max(1, Math.round((2 * r.reach) / r.seg / (m[k - 1] * c0))) * m[k - 1]) })
  const out = rings.map((r, k) => {
    const M = m[k + 1] ?? m[k]
    return { m: m[k], s: Math.max(1, Math.round(r.reach / 8 / (c0 * M))) * M, H: Math.ceil(r.reach / (c0 * M)) * M, reach: r.reach }
  })
  for (let k = 1; k < out.length; k++) {
    const need = out[k - 1].H + (out[k].s + out[k - 1].s) / 2 + out[k].m
    if (out[k].H < need) throw new Error(`terrain3d ring ${k} reaches ${out[k].reach} m, which can leave ring ${k - 1}'s hole uncovered: it needs a reach of at least ${need * c0} m`)
  }
  return { c0, rings: out }
}

// The land as a page has it, `ground`, for a plugin a `land` mod hands it to.
export type Ground = NonNullable<ReturnType<typeof terrain3d>['ground']>

export function terrain3d() {
  let settings = ''
  let layout: { c0: number; rings: Ring[] } | undefined
  let field: Field | undefined
  let seen: { parts: unknown[]; text: string } | undefined
  let asked: string | undefined
  // The material of the field's look as it now is, what its vertices carry, and the keys it was made
  // for; a material replaced while a ring still draws with it waits in `retired` until none does.
  let material: THREE.MeshStandardMaterial | undefined
  let slots: Slots | undefined
  let looks = '', carries = ''
  const retired = new Set<THREE.Material>()
  let shown: (Shown | undefined)[] = []
  let job: Job | undefined
  let scene: THREE.Scene | undefined

  // Disposes every retired material no ring draws with.
  const retire = () => {
    for (const m of retired) {
      if (shown.some(b => b?.mesh.material === m)) continue
      m.dispose()
      retired.delete(m)
    }
  }

  // Whether `f` holds other content than the field last seen: its top-level values are swapped
  // whenever the loader refills it, and a swap for the same content changes nothing.
  const changed = (f: Field) => {
    const parts = Object.values(f)
    if (f === field && seen && seen.parts.length === parts.length && seen.parts.every((p, i) => p === parts[i])) return false
    const text = JSON.stringify(f)
    const same = seen?.text === text
    field = f
    seen = { parts, text }
    return !same
  }

  const drop = (b: Shown | undefined) => {
    if (!b) return
    scene?.remove(b.mesh)
    b.mesh.geometry.dispose()
  }

  const me = {
    land: undefined as Land | undefined,
    ground: undefined as undefined | {
      height(x: number, z: number): number; raw(x: number, z: number): number; depth(x: number, z: number): number
      at(x: number, z: number): ReturnType<Land['analyse']>; cover(x: number, z: number): number
      ramp(rule: Rule, x: number, z: number): number; rules: typeof rules; edits(): ReturnType<Land['edits']>
      ray(origin: number[], dir: number[]): number[] | undefined
    },
    rings: [] as { at: number[]; half: number; cell: number; mesh: THREE.Mesh }[],
    building: () => (job ? { done: job.done, total: job.total } : undefined),

    afterTick(plugins: Plugins) {
      const s = plugins.wire.scene.world!.terrain3d as Settings
      const key = JSON.stringify([s.rings, s.shadowReach, s.seabed])
      if (key !== settings) {
        layout = layoutOf(s.rings)
        settings = key
        job = undefined
        for (const b of shown) drop(b)
        shown = []
        me.rings = []
      }
      const f = plugins.loader.get(s.field) as Field | undefined
      if (!f) {
        if (asked !== s.field) { asked = s.field; plugins.loader.load(s.field) }
        return
      }
      const { THREE: three, scene: on, camera } = plugins.render3d as { THREE: typeof import('three'); scene: THREE.Scene; camera?: THREE.PerspectiveCamera }
      scene = on
      const prior = seen?.text
      if (changed(f)) remake(f, prior === undefined ? undefined : JSON.parse(prior), three, plugins)
      if (!camera) return
      job ??= s.static ? plan(0, 0, s.seabed) : plan(camera.position.x, camera.position.z, s.seabed)
      if (!job) return
      if (job.land !== me.land) { job = undefined; return }
      const j = job, start = performance.now()
      do { work(j, three, s) } while (j.done < j.total && performance.now() - start < s.budget)
    },

    close() {
      job = undefined
      for (const b of shown) drop(b)
      shown = []
      me.rings = []
      material?.dispose()
      material = undefined
      for (const m of retired) m.dispose()
      retired.clear()
      looks = carries = ''
    },
  }

  // A new land from the field's new content, and the rings to be built again: those its changed
  // layers reach when nothing but layers, or what of the look no vertex carries, changed; every ring
  // otherwise. A ring that stays is the new land's as it stands. A new look makes a new material,
  // which the rings draw with at once when they carry what it reads, and from the swap otherwise.
  function remake(f: Field, prior: Field | undefined, three: typeof import('three'), plugins: Plugins) {
    const was = me.land
    const l = landFrom(f, was)
    me.land = l
    job = undefined
    const dirty = was && prior && differs(prior, was, l)
    if (dirty) {
      const versions = l.edits().layers.map(e => e.version)
      shown.forEach((b, k) => {
        if (b && b.land === was && !dirty.some(r => reaches(r, k, b.C, b.hole))) shown[k] = { ...b, land: l, versions }
      })
    }
    if (!material || looked(f) !== looks) {
      const s = slotsOf(f)
      const uniforms: Record<string, THREE.IUniform> = {}
      const made = plugins.render3d.dress(new three.MeshStandardMaterial(), { surface: look(f, s, three, uniforms) }) as THREE.MeshStandardMaterial
      bind(f, uniforms, plugins)
      if (material) retired.add(material)
      material = made
      slots = s
      looks = looked(f)
      if (carried(f) === carries) for (const b of shown) if (b) b.mesh.material = made
      carries = carried(f)
      retire()
    }
    me.ground = {
      height: (x, z) => me.land!.height(x, z),
      raw: (x, z) => me.land!.raw(x, z),
      depth: (x, z) => me.land!.depth(x, z),
      at: (x, z) => me.land!.analyse(x, z),
      cover: (x, z) => me.land!.paint(x, z).cover,
      ramp: (rule, x, z) => me.land!.ramp(rule, x, z),
      rules,
      edits: () => me.land!.edits(),
      ray: (origin, dir) => me.land!.ray(origin, dir, (plugins.render3d.camera as THREE.PerspectiveCamera).far),
    }
  }

  // Each detail layer's maps, asked of the loader, bound to its samplers once every one has landed,
  // and its switch then turned on.
  function bind(f: Field, uniforms: Record<string, THREE.IUniform>, plugins: Plugins) {
    ;(f.detail ?? []).forEach((d, k) => {
      const maps = mapsOf(d, k)
      if (!maps.length) return
      for (const [, name] of maps) {
        if (plugins.loader.catalogued(name)?.type !== 'texture') throw new Error(`terrain3d detail ${k} names ${name}, which is no texture entry of the loader's catalogue`)
      }
      // The loader writes a failure to the console once itself, and the layer stays off.
      Promise.all(maps.map(([, name]) => plugins.loader.load(name))).then(got => {
        maps.forEach(([uniform], i) => { uniforms[uniform].value = got[i] })
        uniforms[`tdOn${k}`].value = 1
      }, () => {})
    })
  }

  // Where the ground of land `b` can differ from land `a`'s, made from the field `prior` held, as
  // rects, when the two fields differ in their layers, and in what of their look no vertex carries,
  // alone: the rect of each layer of either from the first that differs on, since a layer's strokes
  // read the ground the layers before it leave. Undefined when anything else differs. `prior` is the
  // content as it was: the loader refills the parsed field in place, so `a.field` already holds the
  // new one.
  function differs(prior: Field, a: Land, b: Land): number[][] | undefined {
    const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
    const fa = prior as Record<string, unknown>, fb = b.field as Record<string, unknown>
    const drawn = ['layers', 'bands', 'grain', 'surfaces', 'detail']
    for (const key of new Set([...Object.keys(fa), ...Object.keys(fb)])) if (!drawn.includes(key) && !same(fa[key], fb[key])) return undefined
    if (carried(prior) !== carried(b.field)) return undefined
    const la = prior.layers ?? [], lb = b.field.layers ?? []
    let first = 0
    while (first < Math.max(la.length, lb.length) && same(la[first], lb[first]) && same(a.unsaved(first), b.unsaved(first))) first++
    const rects: number[][] = []
    for (let k = first; k < la.length; k++) rects.push(a.rect(k))
    for (let k = first; k < lb.length; k++) rects.push(b.rect(k))
    return rects
  }

  // The rings the camera at (x, z) wants rebuilt, as a job, or undefined when every ring stands right.
  function plan(x: number, z: number, seabed: boolean): Job | undefined {
    const { c0, rings } = layout!
    const l = me.land!
    const centres = rings.map(r => [Math.round(x / c0 / r.s) * r.s + 0, Math.round(z / c0 / r.s) * r.s + 0])
    const edits = l.edits()
    const versions = edits.layers.map(e => e.version)
    const builds: Build[] = []
    rings.forEach((_, k) => {
      const was = shown[k], C = centres[k], hole = k > 0 ? centres[k - 1] : undefined
      const moved = !was || was.land !== l || was.C[0] !== C[0] || was.C[1] !== C[1] || (hole && (was.hole![0] !== hole[0] || was.hole![1] !== hole[1]))
      const stroked = was && edits.layers.some((e, i) => e.version !== was.versions[i] && reaches(e.rect, k, C, hole))
      if (moved || stroked) builds.push(build(k, C, hole, seabed))
    })
    if (!builds.length) return undefined
    // Every build's units, and the swap.
    const total = builds.reduce((n, b) => n + b.units.length, 0) + 1
    return { land: l, versions, builds, total, done: 0 }
  }

  // Whether a rect reaches the ground ring k draws: its square, less the open hole within a cell of it.
  function reaches(rect: number[], k: number, C: number[], hole: number[] | undefined) {
    const { c0, rings } = layout!
    const r = rings[k], h = r.H * c0, cell = r.m * c0
    const [x0, z0, x1, z1] = [rect[0] - cell, rect[1] - cell, rect[2] + cell, rect[3] + cell]
    if (x1 < (C[0] * c0) - h || x0 > C[0] * c0 + h || z1 < C[1] * c0 - h || z0 > C[1] * c0 + h) return false
    if (!hole) return true
    const hh = rings[k - 1].H * c0, hx = hole[0] * c0, hz = hole[1] * c0
    return !(x0 > hx - hh && x1 < hx + hh && z0 > hz - hh && z1 < hz + hh)
  }

  // One unit of the job: the next unit of a build, or, once every build is whole, the swap.
  function work(j: Job, three: typeof import('three'), s: Settings) {
    j.done++
    for (const b of j.builds) {
      if (b.next < b.units.length) {
        b.units[b.next++]()
        return
      }
    }
    swap(j, three, s)
  }

  function swap(j: Job, three: typeof import('three'), s: Settings) {
    const { c0, rings } = layout!
    for (const b of j.builds) {
      const g = new three.BufferGeometry()
      g.setAttribute('position', new three.BufferAttribute(b.pos, 3))
      g.setAttribute('normal', new three.BufferAttribute(b.nor, 3))
      b.att.forEach((a, i) => g.setAttribute(`tdA${i}`, new three.BufferAttribute(a, 4)))
      g.setIndex(new three.BufferAttribute(Uint32Array.from(b.index), 1))
      g.computeBoundingSphere()
      const was = shown[b.k]
      let mesh: THREE.Mesh
      if (was) {
        mesh = was.mesh
        mesh.geometry.dispose()
        mesh.geometry = g
        mesh.material = material!
      } else {
        mesh = new three.Mesh(g, material)
        mesh.receiveShadow = true
        scene!.add(mesh)
      }
      mesh.castShadow = rings[b.k].reach <= s.shadowReach
      shown[b.k] = { C: b.C, hole: b.hole, land: j.land, versions: j.versions, mesh }
    }
    job = undefined
    me.rings = shown.map((b, k) => ({ at: [b!.C[0] * c0, b!.C[1] * c0], half: rings[k].H * c0, cell: rings[k].m * c0, mesh: b!.mesh }))
    retire()
  }

  // A ring's rebuild as units of work.
  function build(k: number, C: number[], hole: number[] | undefined, seabed: boolean): Build {
    const { c0, rings } = layout!
    const l = me.land!
    const r = rings[k], m = r.m, N = (2 * r.H) / m
    const x0 = C[0] - r.H, z0 = C[1] - r.H
    const last = k === rings.length - 1
    const mc = last ? 0 : rings[k + 1].m
    const inner = hole ? rings[k - 1] : undefined
    const hx0 = hole ? (hole[0] - inner!.H - x0) / m : 0, hx1 = hole ? hx0 + (2 * inner!.H) / m : 0
    const hz0 = hole ? (hole[1] - inner!.H - z0) / m : 0, hz1 = hole ? hz0 + (2 * inner!.H) / m : 0
    const mf = inner?.m ?? 1, mm = m / mf
    const drawnAt = seabed ? l.raw : l.height
    const drawn = (Lx: number, Lz: number) => drawnAt(Lx * c0, Lz * c0)
    const skirt = Math.max(l.field.program.hscale, 40)
    const b: Build = {
      k, C, hole, N, x0, z0, vid: new Int32Array((N + 1) * (N + 1)).fill(-1), hs: new Float64Array((N + 1) * (N + 1)).fill(NaN),
      seam: new Map(), count: 0, pos: new Float32Array(0), nor: new Float32Array(0), att: [], index: [], units: [], next: 0,
    }
    const sl = slots!
    const detail = l.field.detail ?? []
    const surfaces = Object.keys(l.field.surfaces ?? {})
    const at = (i: number, j: number) => j * (N + 1) + i
    const inHole = (i: number, j: number) => !!hole && i > hx0 && i < hx1 && j > hz0 && j < hz1
    const edge = (i: number, j: number) => i === 0 || j === 0 || i === N || j === N
    // The unlifted height at grid point (i, j), inside the grid or out of it.
    const hAt = (i: number, j: number) => {
      if (i >= 0 && j >= 0 && i <= N && j <= N) {
        const p = at(i, j)
        if (Number.isNaN(b.hs[p])) b.hs[p] = drawn(x0 + i * m, z0 + j * m)
        return b.hs[p]
      }
      return drawn(x0 + i * m, z0 + j * m)
    }
    // What vertex v at (x, z) carries (`Slots`).
    const carry = (v: number, x: number, z: number) => {
      const rec = l.record(x, z)
      const put = (s: number, value: number) => { b.att[s >> 2][4 * v + (s & 3)] = value }
      const ramps = (list: Rule[]) => list.reduce((p, rule) => p * shape(rec[rule.q as Key], rule.lo, rule.hi), 1)
      l.field.bands.forEach((band, n) => { if (n > 0) put(sl.bands[n], ramps(band.rules)) })
      put(sl.grain, l.field.grain.base + l.field.grain.range * (hash(Math.floor(x), Math.floor(z), 0) / 4294967296))
      const paint = l.paint(x, z)
      for (const name of surfaces) put(sl.surfaces[name], paint.surface === name ? paint.weight : 0)
      detail.forEach((d, k) => { if (sl.masks[k] !== undefined) put(sl.masks[k]!, ramps(vertexRules(d))) })
    }
    // Vertex u's values given to vertex v, which stands where it does.
    const same = (v: number, u: number) => { for (const a of b.att) for (let e = 0; e < 4; e++) a[4 * v + e] = a[4 * u + e] }
    const normal = (v: number, l0: number, r0: number, d0: number, u0: number, step: number) => {
      const nx = l0 - r0, ny = 2 * step, nz = d0 - u0, len = Math.hypot(nx, ny, nz)
      if (len > 0) { b.nor[3 * v] = nx / len; b.nor[3 * v + 1] = ny / len; b.nor[3 * v + 2] = nz / len } else b.nor[3 * v + 1] = 1
    }
    // A seam vertex's key, by its lattice place.
    const place = (Lx: number, Lz: number) => `${Lx},${Lz}`
    // Each coarse edge of the hole: its two grid ends, from low to high, and the grid step along it.
    const holeEdges = () => {
      const out: [number, number, number, number][] = []
      for (let i = hx0; i < hx1; i++) { out.push([i, hz0, i + 1, hz0]); out.push([i, hz1, i + 1, hz1]) }
      for (let j = hz0; j < hz1; j++) { out.push([hx0, j, hx0, j + 1]); out.push([hx1, j, hx1, j + 1]) }
      return out
    }
    const tri = (a: number, c: number, d: number) => {
      const p = b.pos
      const cross = (p[3 * c + 2] - p[3 * a + 2]) * (p[3 * d] - p[3 * a]) - (p[3 * c] - p[3 * a]) * (p[3 * d + 2] - p[3 * a + 2])
      if (cross > 0) b.index.push(a, c, d)
      else b.index.push(a, d, c)
    }
    const boundary: number[] = [] // the grid indices round the outer edge, in order, for the skirt

    // The layout: which grid points are drawn, and where each vertex goes.
    b.units.push(() => {
      let n = 0
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) if (!inHole(i, j)) b.vid[at(i, j)] = n++
      const seams = hole && mm > 1 ? 4 * (hx1 - hx0) * (mm - 1) : 0
      for (let i = 0; i < N; i++) boundary.push(at(i, 0))
      for (let j = 0; j < N; j++) boundary.push(at(N, j))
      for (let i = N; i > 0; i--) boundary.push(at(i, N))
      for (let j = N; j > 0; j--) boundary.push(at(0, j))
      b.count = n + seams + (last ? boundary.length : 0)
      b.pos = new Float32Array(3 * b.count)
      b.nor = new Float32Array(3 * b.count)
      b.att = Array.from({ length: sl.attributes }, () => new Float32Array(4 * b.count))
    })
    // Heights and what each vertex carries, a row at a time; an outer edge lifted onto the coarser
    // ring's chord.
    for (let j = 0; j <= N; j++) {
      b.units.push(() => {
        for (let i = 0; i <= N; i++) {
          const v = b.vid[at(i, j)]
          if (v < 0) continue
          const Lx = x0 + i * m, Lz = z0 + j * m
          let y = hAt(i, j)
          if (!last && edge(i, j)) {
            const alongZ = i === 0 || i === N
            const L = alongZ ? Lz : Lx
            const A = Math.floor(L / mc) * mc
            const hA = alongZ ? drawn(Lx, A) : drawn(A, Lz), hB = alongZ ? drawn(Lx, A + mc) : drawn(A + mc, Lz)
            y = chord(hA, hB, (L - A) / m, mc / m)
          }
          b.pos[3 * v] = Lx * c0
          b.pos[3 * v + 1] = y
          b.pos[3 * v + 2] = Lz * c0
          carry(v, Lx * c0, Lz * c0)
        }
      })
    }
    // Normals, a row at a time, from the unlifted heights a cell either side; on the hole's edge a
    // fine cell either side, as the finer ring takes them there.
    const rim = (i: number, j: number) =>
      !!hole && (((i === hx0 || i === hx1) && j >= hz0 && j <= hz1) || ((j === hz0 || j === hz1) && i >= hx0 && i <= hx1))
    for (let j = 0; j <= N; j++) {
      b.units.push(() => {
        for (let i = 0; i <= N; i++) {
          const v = b.vid[at(i, j)]
          if (v < 0) continue
          if (rim(i, j)) {
            const Lx = x0 + i * m, Lz = z0 + j * m
            normal(v, drawn(Lx - mf, Lz), drawn(Lx + mf, Lz), drawn(Lx, Lz - mf), drawn(Lx, Lz + mf), mf * c0)
          } else normal(v, hAt(i - 1, j), hAt(i + 1, j), hAt(i, j - 1), hAt(i, j + 1), m * c0)
        }
      })
    }
    // The seam vertices along the hole, on the chord between the grid points they lie between, and
    // the outermost ring's skirt.
    b.units.push(() => {
      let v = b.count - (last ? boundary.length : 0) - (hole && mm > 1 ? 4 * (hx1 - hx0) * (mm - 1) : 0)
      if (hole && mm > 1) {
        for (const [i0, j0, i1, j1] of holeEdges()) {
          const hA = hAt(i0, j0), hB = hAt(i1, j1)
          for (let t = 1; t < mm; t++) {
            const Lx = x0 + i0 * m + (i1 - i0) * t * mf, Lz = z0 + j0 * m + (j1 - j0) * t * mf
            b.pos[3 * v] = Lx * c0
            b.pos[3 * v + 1] = chord(hA, hB, t, mm)
            b.pos[3 * v + 2] = Lz * c0
            const s = mf * c0
            normal(v, drawn(Lx - mf, Lz), drawn(Lx + mf, Lz), drawn(Lx, Lz - mf), drawn(Lx, Lz + mf), s)
            carry(v, Lx * c0, Lz * c0)
            b.seam.set(place(Lx, Lz), v++)
          }
        }
      }
      if (!last) return
      const cx = C[0] * c0, cz = C[1] * c0
      const first = v
      for (const p of boundary) {
        const u = b.vid[p]
        b.pos[3 * v] = b.pos[3 * u]
        b.pos[3 * v + 1] = b.pos[3 * u + 1] - skirt
        b.pos[3 * v + 2] = b.pos[3 * u + 2]
        const ox = b.pos[3 * u] - cx, oz = b.pos[3 * u + 2] - cz, len = Math.hypot(ox, oz)
        b.nor[3 * v] = len > 0 ? ox / len : 0
        b.nor[3 * v + 2] = len > 0 ? oz / len : 0
        b.nor[3 * v + 1] = len > 0 ? 0 : 1
        same(v, u)
        v++
      }
      // Each skirt quad, turned to face out from the ring's middle.
      const face = (a: number, c: number, d: number) => {
        const p = b.pos
        const ux = p[3 * c] - p[3 * a], uy = p[3 * c + 1] - p[3 * a + 1], uz = p[3 * c + 2] - p[3 * a + 2]
        const wx = p[3 * d] - p[3 * a], wy = p[3 * d + 1] - p[3 * a + 1], wz = p[3 * d + 2] - p[3 * a + 2]
        const nx = uy * wz - uz * wy, nz = ux * wy - uy * wx
        if (nx * (p[3 * a] - cx) + nz * (p[3 * a + 2] - cz) > 0) b.index.push(a, c, d)
        else b.index.push(a, d, c)
      }
      for (let n = 0; n < boundary.length; n++) {
        const P = b.vid[boundary[n]], Q = b.vid[boundary[(n + 1) % boundary.length]]
        const P1 = first + n, Q1 = first + ((n + 1) % boundary.length)
        face(P, Q, P1)
        face(Q, Q1, P1)
      }
    })
    // Triangles, a row of cells at a time: two to a cell, or a fan through the seam where a cell
    // borders the hole.
    for (let j = 0; j < N; j++) {
      b.units.push(() => {
        const vid = (i: number, jj: number) => b.vid[at(i, jj)]
        const fan = (C0: number[], A: number[], B: number[], D0: number[]) => {
          const c = vid(C0[0], C0[1]), d = vid(D0[0], D0[1]), a = vid(A[0], A[1]), bb = vid(B[0], B[1])
          const di = B[0] - A[0], dj = B[1] - A[1]
          let prev = a
          for (let t = 1; t <= mm; t++) {
            const cur = t === mm ? bb : b.seam.get(place(x0 + A[0] * m + di * t * mf, z0 + A[1] * m + dj * t * mf))!
            tri(c, prev, cur)
            prev = cur
          }
          tri(c, bb, d)
        }
        for (let i = 0; i < N; i++) {
          if (hole && i >= hx0 && i < hx1 && j >= hz0 && j < hz1) continue
          if (hole && j >= hz0 && j < hz1 && i === hx0 - 1) { fan([i, j], [hx0, j], [hx0, j + 1], [i, j + 1]); continue }
          if (hole && j >= hz0 && j < hz1 && i === hx1) { fan([i + 1, j], [hx1, j], [hx1, j + 1], [i + 1, j + 1]); continue }
          if (hole && i >= hx0 && i < hx1 && j === hz0 - 1) { fan([i, j], [i, hz0], [i + 1, hz0], [i + 1, j]); continue }
          if (hole && i >= hx0 && i < hx1 && j === hz1) { fan([i, j + 1], [i, hz1], [i + 1, hz1], [i + 1, j + 1]); continue }
          const a = vid(i, j), c = vid(i + 1, j), d = vid(i + 1, j + 1), e = vid(i, j + 1)
          tri(a, c, d)
          tri(a, d, e)
        }
      })
    }
    return b
  }

  return me
}
