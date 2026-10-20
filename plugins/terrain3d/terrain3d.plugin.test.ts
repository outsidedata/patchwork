// The browser half on render3d with no canvas, and a loader that hands over a field the test
// writes: rings that follow the camera with watertight seams, or stand still when static, a rebuild sliced within its budget,
// the seabed, remeshing on a new field's content or a stroke, the `ground` it hands other plugins,
// and `close`.
import { afterEach, expect, test, vi } from 'vitest'
import * as THREE from 'three'
import { render3d } from '#plugins/render3d/render3d.plugin.ts'
import { hash, land, type Field, type Node } from './terrain3d.sim.ts'
import { terrain3d } from './terrain3d.plugin.ts'

afterEach(() => { vi.restoreAllMocks() })

const NOISE = { freqs: [0.017, 0.13, 0.9], weights: [0.5, 0.34, 0.16] }
const DETAIL: Field['detail'] = [
  { kind: 'tint', noise: NOISE, base: 0.96, range: 0.4, amount: 0.8, fade: [24, 110] },
  { kind: 'patch', noise: { ...NOISE, offset: [37.1, 91.7] }, from: 0.72, to: 0.95, colour: '#453425', amount: 0.45, fade: [24, 110] },
  { kind: 'rough', noise: NOISE, range: [0.78, 1], jitter: { freq: 2.7, amount: 0.12 }, fade: [24, 110] },
  { kind: 'bump', noise: NOISE, step: 0.8, strength: 0.9, fade: [24, 110] },
]
const NODES: Node[] = [
  { id: 'shape', op: 'noise', kind: 'value', freq: 2, seed: 1741 },
  { id: 'crest', op: 'fold', input: 'shape', kind: 'ridge' },
  { id: 'hills', op: 'noise', kind: 'simplex', freq: 9, seed: 2754 },
  { id: 'sum', op: 'combine', a: 'crest', b: 'hills', mode: 'lerp', t: 0.3 },
]
const fieldOf = (more: Partial<Field> & { flood?: boolean; sea?: number } = {}): Field => ({
  program: { world: 600, hscale: 80, sea: more.sea ?? 0.3, flood: more.flood ?? false, out: 'sum', nodes: NODES },
  analysis: { slopeStep: 1.5, curveStep: 4, positionRadius: 18, occlusionRadius: 30, occlusionSteps: 5, cliffProbe: 12, cliffSlope: 0.5, cliffDrop: 7, flatAngle: 0.03, records: 50000 },
  bands: [{ colour: '#3e5722', amount: 1, rules: [] }, { colour: '#6a6a32', amount: 0.9, rules: [{ q: 'relief', lo: 0.2, hi: 0.62 }] }],
  grain: { base: 0.84, range: 0.32 },
  detail: DETAIL,
  surfaces: { road: { colour: '#6d6459', cover: 0 } },
  layers: [{ at: [0, 0], size: 32, px: 32, strokes: [] }],
  ...more,
})
// Cells of 4, 8 and 32 m: two seams, one of two fine cells to a coarse one and one of four.
const RINGS = [{ reach: 40, seg: 20 }, { reach: 100, seg: 25 }, { reach: 400, seg: 25 }]

// The maps a test's catalogue holds, each a texture once `land` hands it over.
const MAPS: Record<string, { type: string }> = { grass: { type: 'texture' }, grassNormal: { type: 'texture' }, notes: { type: 'json' } }

function page(o: { field?: Field; rings?: { reach: number; seg: number }[]; budget?: number; seabed?: boolean; shadowReach?: number; static?: boolean } = {}) {
  const files: Record<string, Field> = { place: o.field ?? fieldOf() }
  const asked: string[] = []
  // Each map asked for, and how to hand it over.
  const maps = new Map<string, (tex: THREE.Texture) => void>()
  const plugins: any = {
    wire: {
      rows: [],
      scene: {
        world: { terrain3d: { field: 'place', rings: o.rings ?? RINGS, shadowReach: o.shadowReach ?? 100, budget: o.budget ?? 1e9, seabed: o.seabed ?? false, static: o.static } },
        prefabs: { engine: { width: 320, height: 200 }, render3d: { camera: { fov: 60, near: 0.15, far: 3000, at: [0, 60, 0], look: [10, 50, 10] } } } },
    },
    render3d: render3d(),
    loader: {
      get: (name: string) => files[name],
      catalogued: (name: string) => MAPS[name],
      load: (name: string) => {
        asked.push(name)
        return MAPS[name] ? new Promise(ok => maps.set(name, ok)) : undefined
      },
    },
  }
  const land = (name: string) => maps.get(name)!(new THREE.Texture())
  const me = terrain3d()
  const frame = () => {
    plugins.render3d.tick(plugins)
    me.afterTick(plugins)
  }
  const settle = () => {
    frame()
    for (let i = 0; i < 1000 && me.building(); i++) frame()
    expect(me.building()).toBeUndefined()
  }
  const move = (x: number, z: number) => {
    plugins.render3d.tick(plugins)
    plugins.render3d.camera.position.set(x, 60, z)
  }
  return { plugins, me, frame, settle, move, files, asked, land }
}

// The GLSL of a ring's material, as render3d's dress puts it together.
const glsl = (m: THREE.Mesh) => {
  const material = m.material as THREE.MeshStandardMaterial
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: '#include <common>\n#include <begin_vertex>\n#include <project_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>',
  }
  material.onBeforeCompile(shader as any, undefined as any)
  return shader
}
// What vertex v of a mesh carries in slot s.
const carried = (m: THREE.Mesh, v: number, s: number) => (m.geometry.getAttribute(`tdA${s >> 2}`) as THREE.BufferAttribute).array[4 * v + (s & 3)]

const P = (m: THREE.Mesh) => m.geometry.getAttribute('position') as THREE.BufferAttribute
// Every vertex of a ring's mesh, by its place across the ground.
const byPlace = (m: THREE.Mesh) => {
  const at = new Map<string, number[]>(), p = P(m)
  for (let v = 0; v < p.count; v++) {
    const key = `${p.getX(v)},${p.getZ(v)}`
    at.set(key, [...(at.get(key) ?? []), p.getY(v)])
  }
  return at
}

test('every seam vertex is on the coarse ring\'s chord, and the coarse ring has it bit for bit and every seam segment as an edge, at 50 camera positions', () => {
  const { me, settle, move, files } = page()
  const ground = land(files.place)
  let seams = 0
  for (let n = 0; n < 50; n++) {
    move(Math.sin(n * 12.9898) * 300, Math.cos(n * 78.233) * 300)
    settle()
    for (let k = 1; k < me.rings.length; k++) {
      const fine = me.rings[k - 1], coarse = me.rings[k]
      const coarseAt = byPlace(coarse.mesh)
      const [cx, cz] = fine.at, h = fine.half, cell = coarse.cell, mm = coarse.cell / fine.cell
      const p = P(fine.mesh)
      // Every edge of the coarse ring's triangles, by the places of its two ends.
      const cp = P(coarse.mesh), ci = coarse.mesh.geometry.index!.array, edges = new Set<string>()
      const place = (a: THREE.BufferAttribute, v: number) => `${a.getX(v)},${a.getY(v)},${a.getZ(v)}`
      for (let t = 0; t < ci.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const A = place(cp, ci[t + a]), B = place(cp, ci[t + b])
        edges.add(A < B ? `${A}|${B}` : `${B}|${A}`)
      }
      // The fine ring's outer edge, in order round it: each step along it is an edge of a coarse
      // triangle, so no T-junction is left on the seam.
      const round: [number, number][] = []
      for (let v = 0; v < p.count; v++) {
        const x = p.getX(v), z = p.getZ(v)
        const s = z === cz - h ? x - (cx - h) : x === cx + h ? 2 * h + z - (cz - h) : z === cz + h ? 4 * h + (cx + h) - x : x === cx - h ? 6 * h + (cz + h) - z : -1
        if (s >= 0) round.push([s, v])
      }
      round.sort((a, b) => a[0] - b[0])
      expect(round).toHaveLength(Math.round(8 * h / fine.cell))
      // And the coarse ring lights each seam vertex as the fine ring does: over a fine cell.
      const cn = coarse.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute, fn = fine.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute
      const lit = new Map<string, string>()
      for (let v = 0; v < cp.count; v++) lit.set(place(cp, v), place(cn, v))
      for (let n = 0; n < round.length; n++) {
        const A = place(p, round[n][1]), B = place(p, round[(n + 1) % round.length][1])
        expect(edges.has(A < B ? `${A}|${B}` : `${B}|${A}`)).toBe(true)
        expect(lit.get(A)).toBe(place(fn, round[n][1]))
      }
      for (let v = 0; v < p.count; v++) {
        const x = p.getX(v), z = p.getZ(v)
        const onX = x === cx - h || x === cx + h, onZ = z === cz - h || z === cz + h
        if (!onX && !onZ) continue
        // The coarse vertices either side along the edge, and how many fine cells along it this is.
        const along = onX ? z : x
        const a = Math.floor(along / cell) * cell, t = (along - a) / fine.cell
        const hA = onX ? ground.height(x, a) : ground.height(a, z)
        const hB = onX ? ground.height(x, a + cell) : ground.height(a + cell, z)
        const chord = t === 0 ? hA : hA + (hB - hA) * (t / mm)
        expect(Math.abs(p.getY(v) - Math.fround(chord))).toBeLessThanOrEqual(1e-6)
        expect(coarseAt.get(`${x},${z}`)).toContain(p.getY(v))
        seams++
      }
    }
  }
  expect(seams).toBeGreaterThan(50 * 100)
})

test('each ring stands on its own grid, snapped round the camera, its hole on the finer ring', () => {
  const { me, settle, move } = page()
  move(13, -7)
  settle()
  // Cells of 4, 8 and 32 m; snaps of 8, 32 and 64 m; half widths of 40, 128 and 416 m.
  expect(me.rings.map(r => [r.cell, r.half])).toEqual([[4, 40], [8, 128], [32, 416]])
  expect(me.rings.map(r => r.at)).toEqual([[16, -8], [0, 0], [0, 0]])
  move(13 + 8, -7)
  settle()
  expect(me.rings.map(r => r.at)).toEqual([[24, -8], [32, 0], [0, 0]])
  // Every vertex a ring has sits on its own grid, and none of the coarse ring's is inside its hole.
  for (const [k, r] of me.rings.entries()) {
    const p = P(r.mesh)
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v), z = p.getZ(v)
      if (k === 0 || !(Math.abs(x - me.rings[k - 1].at[0]) < me.rings[k - 1].half && Math.abs(z - me.rings[k - 1].at[1]) < me.rings[k - 1].half)) continue
      throw new Error(`ring ${k} has a vertex at ${x}, ${z} inside its hole`)
    }
  }
})

test('static rings stand centred on the origin wherever the camera goes, built once and never rebuilt', () => {
  const { me, settle, move, frame } = page({ static: true })
  move(13, -7)
  settle()
  expect(me.rings.map(r => r.at)).toEqual([[0, 0], [0, 0], [0, 0]])
  const meshes = me.rings.map(r => r.mesh.geometry)
  for (const [x, z] of [[21, -7], [150, 90], [-300, 260]]) {
    move(x, z)
    frame()
    expect(me.building()).toBeUndefined()
  }
  expect(me.rings.map(r => r.at)).toEqual([[0, 0], [0, 0], [0, 0]])
  me.rings.forEach((r, k) => expect(r.mesh.geometry).toBe(meshes[k]))
})

test('a ring set that could leave a hole uncovered throws when the plugin starts', () => {
  const { frame } = page({ rings: [{ reach: 40, seg: 20 }, { reach: 50, seg: 10 }] })
  expect(frame).toThrow('terrain3d ring 1 reaches 50 m, which can leave ring 0\'s hole uncovered: it needs a reach of at least')
})

test('a rebuild is sliced within its budget, never more units a frame than the budget\'s milliseconds allow, and swaps in whole', () => {
  let t = 0
  vi.spyOn(performance, 'now').mockImplementation(() => (t += 1))
  const { me, frame, move } = page({ budget: 5 })
  move(0, 0)
  frame()
  let last = me.building()!.done, frames = 1
  expect(me.rings).toEqual([])
  while (me.building()) {
    frame()
    frames++
    const now = me.building()
    if (!now) break
    // Each unit asks the clock once, a millisecond a time here: 5 units a frame at most.
    expect(now.done - last).toBeLessThanOrEqual(5)
    expect(now.done - last).toBeGreaterThanOrEqual(1)
    last = now.done
    expect(me.rings).toEqual([])
  }
  expect(frames).toBeGreaterThan(20)
  expect(me.rings).toHaveLength(3)
  // A move of one snap rebuilds the rings it changes into a second buffer, and the rings shown stay drawn.
  const shown = me.rings.map(r => r.mesh.geometry)
  move(8, 0)
  frame()
  expect(me.building()).toBeDefined()
  expect(me.rings.map(r => r.mesh.geometry)).toEqual(shown)
  while (me.building()) frame()
  expect(me.rings[0].mesh.geometry).not.toBe(shown[0])
})

test('with seabed the ground under the waterline is drawn at raw; without, at the water', () => {
  const field = fieldOf({ flood: true, sea: 0.75 })
  const low = (seabed: boolean) => {
    const { me, settle, move } = page({ field, seabed })
    move(0, 0)
    settle()
    return Math.min(...me.rings.map(r => { const p = P(r.mesh); let m = Infinity; for (let v = 0; v < p.count; v++) m = Math.min(m, p.getY(v)); return m }))
  }
  expect(low(true)).toBeLessThan(-5)
  // The outermost ring's skirt hangs max(hscale, 40) below its edge.
  expect(low(false)).toBeGreaterThanOrEqual(-80)
  const { me, settle, move } = page({ field, seabed: false })
  move(0, 0)
  settle()
  for (const r of me.rings.slice(0, 2)) { const p = P(r.mesh); for (let v = 0; v < p.count; v++) expect(p.getY(v)).toBeGreaterThanOrEqual(0) }
})

test('normals are finite and up, each vertex carries its bands\' ramps, its grain, its paint and its detail layers\' record rules, the skirt its edge\'s, and rings inside shadowReach cast shadows', () => {
  const blue: Field = fieldOf({
    bands: [{ colour: '#ff0000', amount: 0.5, rules: [] }, { colour: '#0000ff', amount: 0.5, rules: [{ q: 'relief', lo: -10, hi: -9 }] }],
    layers: [{ at: [0, 0], size: 32, px: 32, strokes: [{ verb: 'surface', radius: 6, hardness: 1, strength: 0, level: 0, surface: 'road', path: [[0, 0]] }] }],
    detail: [...DETAIL, { kind: 'tint', noise: NOISE, base: 1, range: 1, where: [{ q: 'height', lo: 0, hi: 100 }, { q: 'band:1', lo: 0, hi: 1 }] }],
  })
  const { me, settle, move, files } = page({ field: blue })
  move(0, 0)
  settle()
  const ground = land(files.place)
  // Band 1 in slot 0, the grain in 1, the road in 2, the last detail layer's height rule in 3.
  const fine = me.rings[0].mesh
  expect(fine.geometry.getAttribute('color')).toBeUndefined()
  expect(fine.geometry.getAttribute('tdA1')).toBeUndefined()
  const p = P(fine), n = fine.geometry.getAttribute('normal')
  for (let v = 0; v < p.count; v++) {
    expect(Number.isFinite(n.getX(v)) && Number.isFinite(n.getZ(v)) && n.getY(v) > 0).toBe(true)
    const x = p.getX(v), z = p.getZ(v)
    expect(carried(fine, v, 0)).toBe(1)
    expect(carried(fine, v, 1)).toBeCloseTo(0.84 + 0.32 * hash(Math.floor(x), Math.floor(z), 0) / 2 ** 32, 6)
    const paint = ground.paint(x, z)
    expect(carried(fine, v, 2)).toBeCloseTo(paint.surface === 'road' ? paint.weight : 0, 6)
    expect(carried(fine, v, 3)).toBeCloseTo(Math.min(1, Math.max(0, ground.height(x, z) / 100)), 4)
  }
  expect(carried(fine, p.count >> 1, 2)).toBe(1)
  // The outermost ring's skirt hangs from its edge and carries what the edge does.
  const outer = me.rings[2].mesh, op = P(outer)
  const at = new Map<string, number>()
  for (let v = 0; v < op.count; v++) if (!at.has(`${op.getX(v)},${op.getZ(v)}`)) at.set(`${op.getX(v)},${op.getZ(v)}`, v)
  let skirts = 0
  for (let v = 0; v < op.count; v++) {
    const u = at.get(`${op.getX(v)},${op.getZ(v)}`)!
    if (u === v) continue
    skirts++
    for (let s = 0; s < 4; s++) expect(carried(outer, v, s)).toBe(carried(outer, u, s))
  }
  expect(skirts).toBeGreaterThan(50)
  expect(me.rings.map(r => r.mesh.castShadow)).toEqual([true, true, false])
  expect(me.rings.every(r => r.mesh.receiveShadow)).toBe(true)
})

test('the colours and the detail are the field\'s numbers, written into render3d\'s dress: bands through their edges, the grain, the paint, then each layer in order', () => {
  const field = fieldOf({
    bands: [{ colour: '#3e5722', amount: 1, rules: [] }, { colour: '#6a6a32', amount: 0.9, rules: [{ q: 'relief', lo: 0.2, hi: 0.62 }], edge: { width: 0.1, ragged: 0.3, scale: 0.25 } }],
    surfaces: { road: { colour: '#6d6459', cover: 0, edge: { width: 0.05, ragged: 0, scale: 1 } } },
    detail: [...DETAIL, { kind: 'patch', noise: { ...NOISE, angle: 0.5, stretch: [1, 6] }, from: 0.4, to: 0.6, colour: '#ffffff', where: [{ q: 'surface:road', lo: 1, hi: 0 }, { q: 'slope', lo: 0.1, hi: 0.3 }], edge: { width: 0.2, ragged: 0, scale: 1 } }],
  })
  const { me, settle, move } = page({ field })
  move(0, 0)
  settle()
  const material = me.rings[0].mesh.material as THREE.MeshStandardMaterial
  expect(material.vertexColors).toBe(false)
  expect(material.customProgramCacheKey()).toContain('0.017000')
  const { vertexShader, fragmentShader } = glsl(me.rings[0].mesh)
  // Band 1, the grain and the road are slots 0 to 2, and the last layer's slope rule 3: one vec4.
  expect(vertexShader).toContain('attribute vec4 tdA0;')
  expect(vertexShader).toContain('vTdA0 = tdA0;')
  expect(vertexShader).not.toContain('tdA1')
  const frag = fragmentShader
  expect(frag).toContain('float tdB1 = 0.900000 * smoothstep(0.450000, 0.550000, vTdA0.x + 0.300000 * (tdNoise(tdP * 0.250000) - 0.5));')
  expect(frag).toContain('tdC *= vTdA0.y;')
  expect(frag).toContain('float tdS0 = smoothstep(0.475000, 0.525000, vTdA0.z);')
  expect(frag).toContain('float tdShow0 = tdB0 * (1.0 - tdB1);')
  // The last layer: its record rule's vertex value, the road read per pixel, through its edge.
  expect(frag).toContain('float tdW4 = 1.000000 * smoothstep(0.400000, 0.600000, vTdA0.w * clamp((tdS0 - 1.000000) / -1.000000, 0.0, 1.0));')
  expect(frag).toContain('mat2(0.877583, 0.479426, -0.479426, 0.877583)')
  expect(frag).toContain('* vec2(1.000000, 6.000000)')
  // Each layer where it belongs, in order.
  const color = frag.slice(frag.indexOf('#include <color_fragment>'), frag.indexOf('#include <roughnessmap_fragment>'))
  expect(color.indexOf('tdC *= mix(1.0, 0.960000 + 0.400000 * (tdN0(tdP) - 0.5), tdM0);')).toBeGreaterThan(color.indexOf('tdC = mix(tdC, vec3(0.'))
  expect(color.indexOf('smoothstep(0.720000, 0.950000, tdN1(tdP)) * tdM1')).toBeGreaterThan(color.indexOf('tdM0);'))
  expect(color.indexOf('smoothstep(0.400000, 0.600000, tdN4(tdP)) * tdM4')).toBeGreaterThan(color.indexOf('tdM1);'))
  expect(color).toContain('diffuseColor.rgb = tdC;')
  expect(frag.slice(frag.indexOf('#include <roughnessmap_fragment>'))).toContain('roughnessFactor = mix(roughnessFactor, mix(0.890000, r, tdF2), tdW2);')
  expect(frag.slice(frag.indexOf('#include <normal_fragment_maps>'))).toContain('* 0.900000 * tdM3, 0.0)).xyz);')
})

test('a texture layer binds its maps once every one has landed, and a map that is no texture of the catalogue throws', async () => {
  const field = fieldOf({
    detail: [{ kind: 'texture', map: 'grass', normal: 'grassNormal', scale: 4, project: 'tri', sharp: 4, vary: 0.6, colour: '#ffffff', strength: 1, blend: 'over', where: [{ q: 'band:0', lo: 0.5, hi: 1 }] }],
  })
  const { me, settle, move, land: hand, asked } = page({ field })
  move(0, 0)
  settle()
  expect(asked).toEqual(['grass', 'grassNormal'])
  const { uniforms, fragmentShader } = glsl(me.rings[0].mesh)
  expect(fragmentShader).toContain('uniform sampler2D tdMap0;')
  expect(fragmentShader).toContain('uniform sampler2D tdNor0;')
  expect(fragmentShader).toContain('tdTile(tdMap0, uvX, 0.600000)')
  expect(fragmentShader).toContain('* tdOn0;')
  expect([uniforms.tdMap0.value, uniforms.tdNor0.value, uniforms.tdOn0.value]).toEqual([null, null, 0])
  hand('grass')
  await new Promise(r => setTimeout(r, 0))
  expect(uniforms.tdOn0.value).toBe(0)
  hand('grassNormal')
  await new Promise(r => setTimeout(r, 0))
  expect(uniforms.tdMap0.value).toBeInstanceOf(THREE.Texture)
  expect(uniforms.tdNor0.value).toBeInstanceOf(THREE.Texture)
  expect(uniforms.tdOn0.value).toBe(1)
  const bad = page({ field: fieldOf({ detail: [{ ...field.detail[0], normal: 'notes' } as Field['detail'][number]] }) })
  bad.move(0, 0)
  expect(bad.frame).toThrow('terrain3d detail 0 names notes, which is no texture entry of the loader\'s catalogue')
})

test('a field whose vertices would carry more than 16 values throws, naming them', () => {
  const bands = Array.from({ length: 12 }, (_, i) => ({ colour: '#808080', amount: 1, rules: i ? [{ q: 'slope', lo: 0, hi: 1 }] : [] }))
  const detail: Field['detail'] = Array.from({ length: 5 }, () => ({ kind: 'tint', noise: NOISE, base: 1, range: 0.2, where: [{ q: 'slope', lo: 0, hi: 1 }] }))
  const { frame, move } = page({ field: fieldOf({ bands, detail }) })
  move(0, 0)
  expect(frame).toThrow('terrain3d carries at most 16 values a vertex: this field\'s 11 bands after the first, its grain, its 1 surfaces and its 5 detail layers with record rules are 18')
})

test('a change to what no vertex carries makes a new material and rebuilds no ring; one to what a vertex carries rebuilds every ring, which keep the old material until they swap', () => {
  const { me, frame, settle, move, files } = page({ budget: 0 })
  move(0, 0)
  settle()
  const geometries = me.rings.map(r => r.mesh.geometry)
  const first = me.rings[0].mesh.material as THREE.Material
  const freed = vi.fn()
  first.addEventListener('dispose', freed)
  files.place = { ...files.place, bands: files.place.bands.map(b => ({ ...b, colour: '#aa3322', edge: { width: 0.2, ragged: 0, scale: 1 } })), detail: DETAIL.slice(0, 2) }
  frame()
  expect(me.building()).toBeUndefined()
  expect(me.rings.map(r => r.mesh.geometry)).toEqual(geometries)
  const second = me.rings[0].mesh.material as THREE.Material
  expect(second).not.toBe(first)
  expect(me.rings.every(r => r.mesh.material === second)).toBe(true)
  expect(freed).toHaveBeenCalledTimes(1)
  // The band's rule changed: every ring is built again, and draws with the old material until the swap.
  const kept = vi.fn()
  second.addEventListener('dispose', kept)
  files.place = { ...files.place, bands: [files.place.bands[0], { ...files.place.bands[1], rules: [{ q: 'slope', lo: 0, hi: 0.5 }] }] }
  frame()
  expect(me.building()).toBeDefined()
  expect(me.rings.every(r => r.mesh.material === second)).toBe(true)
  expect(kept).not.toHaveBeenCalled()
  settle()
  expect(me.rings.map((r, k) => r.mesh.geometry === geometries[k])).toEqual([false, false, false])
  expect(me.rings.every(r => r.mesh.material !== second)).toBe(true)
  expect(kept).toHaveBeenCalledTimes(1)
})

test('it remeshes when the field\'s content changes, never for a copy of the same, and where a stroke changed the ground', () => {
  const { me, frame, settle, move, files } = page({ budget: 0 })
  move(0, 0)
  settle()
  const first = me.land
  files.place = structuredClone(files.place)
  frame()
  expect(me.building()).toBeUndefined()
  expect(me.land).toBe(first)
  files.place = { ...files.place, grain: { base: 0.5, range: 0.1 } }
  frame()
  expect(me.land).not.toBe(first)
  expect(me.building()).toBeDefined()
  settle()
  // A stroke on the layer at the origin reaches the two inner rings and not the outermost one, whose
  // hole it falls in.
  const shown = me.rings.map(r => r.mesh.geometry)
  const raise = { verb: 'raise' as const, radius: 6, hardness: 0.5, strength: 5, level: 0, surface: 'road', path: [[0, 0]] }
  me.land!.stroke(0, raise)
  settle()
  expect(me.rings.map((r, k) => r.mesh.geometry === shown[k])).toEqual([false, false, true])
  expect(me.ground!.height(0, 0)).toBeCloseTo(me.land!.height(0, 0), 12)
  // A new content that does not hold the stroke yet keeps it unsaved; one that holds it saves it.
  const raised = me.land!.height(0, 0)
  files.place = { ...files.place, grain: { base: 0.6, range: 0.1 } }
  settle()
  expect(me.land!.unsaved(0)).toBe(raise)
  expect(me.land!.height(0, 0)).toBe(raised)
  files.place = { ...files.place, layers: [{ ...files.place.layers[0], strokes: [raise] }] }
  settle()
  expect(me.land!.unsaved(0)).toBeUndefined()
  expect(me.land!.height(0, 0)).toBe(raised)
})

test('a new content that changes only layers rebuilds only the rings their squares reach, and every ring stays shown until the rebuilt ones swap in', () => {
  const { me, frame, settle, move, files } = page({ budget: 0 })
  move(0, 0)
  settle()
  const raise = { verb: 'raise' as const, radius: 6, hardness: 0.5, strength: 5, level: 0, surface: 'road', path: [[0, 0]] }
  // The layer at the origin gains a stroke, as a saved stroke's file does: its square, grown by the
  // record's reach, is in the two inner rings and in the outermost ring's hole.
  let shown = me.rings.map(r => r.mesh.geometry)
  files.place = { ...files.place, layers: [{ ...files.place.layers[0], strokes: [raise] }] }
  frame()
  expect(me.building()).toBeDefined()
  expect(me.rings.map((r, k) => r.mesh.geometry === shown[k])).toEqual([true, true, true])
  settle()
  expect(me.rings.map((r, k) => r.mesh.geometry === shown[k])).toEqual([false, false, true])
  expect(me.land!.height(0, 0)).toBeCloseTo(land(files.place).height(0, 0), 12)
  // The heights and colours of the outermost ring are the ones the new land gives.
  const outer = byPlace(me.rings[2].mesh), again = page({ field: files.place, budget: 0 })
  again.move(0, 0)
  again.settle()
  expect(byPlace(again.me.rings[2].mesh)).toEqual(outer)
  // The loader refills a rewritten file in place, so the parsed field the land was made from holds
  // the new content too: the stroke taken out again, as an undo does, is still the inner rings'.
  shown = me.rings.map(r => r.mesh.geometry)
  const place = files.place
  const next = { ...place, layers: [{ ...place.layers[0], strokes: [] }] }
  for (const key of Object.keys(place)) delete (place as Record<string, unknown>)[key]
  Object.assign(place, next)
  settle()
  expect(me.rings.map((r, k) => r.mesh.geometry === shown[k])).toEqual([false, false, true])
  expect(me.land!.height(0, 0)).toBe(land(place).height(0, 0))
  files.place = { ...place, layers: [{ ...place.layers[0], strokes: [raise] }] }
  settle()
  // A layer added far out reaches only the outermost ring.
  shown = me.rings.map(r => r.mesh.geometry)
  files.place = { ...files.place, layers: [...files.place.layers, { at: [300, 0], size: 32, px: 16, strokes: [raise] }] }
  settle()
  expect(me.rings.map((r, k) => r.mesh.geometry === shown[k])).toEqual([true, true, false])
  // Any other change is every ring's.
  shown = me.rings.map(r => r.mesh.geometry)
  files.place = { ...files.place, bands: [{ colour: '#223344', amount: 1, rules: [] }] }
  frame()
  expect(me.rings.length).toBe(3)
  settle()
  expect(me.rings.map((r, k) => r.mesh.geometry === shown[k])).toEqual([false, false, false])
})

test('the ground it hands out reads its own land, and its ray hits the ground', () => {
  const { me, settle, move, asked, files } = page()
  expect(me.ground).toBeUndefined()
  move(0, 0)
  settle()
  expect(asked).toEqual([])
  const g = me.ground!
  const l = land(files.place)
  expect(g.height(12, -30)).toBe(l.height(12, -30))
  expect(g.raw(12, -30)).toBe(l.raw(12, -30))
  expect(g.depth(12, -30)).toBe(0)
  expect(g.at(12, -30).slope).toBe(l.analyse(12, -30).slope)
  expect(g.cover(0, 0)).toBe(1)
  expect(g.ramp({ q: 'relief', lo: 0, hi: 1 }, 5, 5)).toBe(l.ramp({ q: 'relief', lo: 0, hi: 1 }, 5, 5))
  expect(() => g.rules([{ q: 'nope', lo: 0, hi: 1 }], 'a pack')).toThrow('a pack rule 0 reads nope')
  expect(g.edits().land).toBe(me.land)
  const hit = g.ray([0, 200, 0], [0.3, -1, 0.2])!
  expect(Math.abs(hit[1] - g.height(hit[0], hit[2]))).toBeLessThan(0.01)
})

test('a field that has not landed is asked for, and nothing is built until it lands', () => {
  const { me, frame, files, asked } = page({ budget: 0 })
  const field = files.place
  delete (files as any).place
  frame()
  frame()
  expect(asked).toEqual(['place'])
  expect(me.building()).toBeUndefined()
  files.place = field
  frame()
  expect(me.building()).toBeDefined()
})

test('close disposes every geometry and the material, and takes the rings off the scene', () => {
  const { me, plugins, settle, move, frame } = page({ budget: 0 })
  const geometries = new Set<THREE.BufferGeometry>()
  const freed = new Set<THREE.BufferGeometry>()
  const watch = () => { for (const r of me.rings) if (!geometries.has(r.mesh.geometry)) { geometries.add(r.mesh.geometry); r.mesh.geometry.addEventListener('dispose', e => { freed.add(e.target) }) } }
  for (const [x, z] of [[0, 0], [9, 0], [50, 40], [200, -80]]) {
    move(x, z)
    settle()
    watch()
  }
  move(400, 0)
  frame()
  expect(me.building()).toBeDefined()
  const material = me.rings[0].mesh.material as THREE.Material
  const dropped = vi.fn()
  material.addEventListener('dispose', dropped)
  me.close()
  expect(geometries.size).toBeGreaterThan(6)
  expect([...geometries].filter(g => !freed.has(g))).toEqual([])
  expect(dropped).toHaveBeenCalledTimes(1)
  expect((plugins.render3d.scene as THREE.Scene).children).toEqual([])
  expect(me.building()).toBeUndefined()
})
