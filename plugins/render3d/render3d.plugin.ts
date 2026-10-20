// render3d: the three.js scene, the camera it is seen through, and the look it is drawn with. It has
// no row and no server half: its prefab is read off the scene on the first tick, as `ui` reads its
// own, so the numbers reach every page once, in the scene file the page already has.
//
// The prefab:
//   camera      { fov, near, far, at, look }: a PerspectiveCamera of the canvas's shape at `at`,
//               looking at `look`. Whatever places the camera afterwards writes it here.
//   pixelRatio  a cap on the screen's devicePixelRatio. The canvas keeps the engine prefab's
//               `width` and `height` as its size on the page, and draws that many pixels times the
//               ratio; with none it draws one pixel per pixel.
//   tone        `aces`, `neutral` or `none`, and `exposure` the light it is fed with.
//   shadows     `soft`, `hard` or `none`.
//   background  a colour the scene is cleared to. Through the composer it is tone mapped with the
//               rest of the frame; drawn straight, three clears to it as given.
//   ao          { radius, thickness, falloff, scale, intensity, samples }: three's GTAOPass, run
//               through an EffectComposer.
//   bloom       { strength, radius, threshold }: three's UnrealBloomPass, run through the
//               EffectComposer after the AO, on the frame's light before it is tone mapped, so a
//               surface or a particle brighter than `threshold` spills `strength` of its light
//               round it, `radius` from 0 to 1 how far. With no `ao`, no `bloom` and no effect
//               (Effects, below) there is no composer, and the scene is drawn straight to the canvas.
// A field left out leaves three's own setting: no tone mapping, an exposure of 1, no shadows, a pixel
// ratio of 1, three's clear colour. A scene with no render3d prefab has no camera and draws nothing.
//
// Through the composer the frame is drawn into half-float targets, so light past 1 survives until
// the last pass, three's OutputPass, tone maps it and puts it in sRGB; a material's `toneMapped`
// changes nothing there.
//
// The AO reads the depth the scene pass drew. The composer's two targets each carry a float depth
// texture, and each frame the GTAO pass is handed the one the scene pass is about to draw into, with
// no normals, which it rebuilds from the depth. So the scene is drawn once a frame, every surface
// occludes where its own material put it, and no pass draws the scene again with an override
// material or holds a target of normals or depth to draw it into. With `ao` the renderer draws
// reversed depth (`reversedDepthBuffer`), so a normal rebuilt from depth far off is not noise; that
// is fixed when the renderer is made, so the renderer is made once a page has mounted a canvas and
// the prefab has been read, whichever comes second. A plugin that draws passes of its own through
// this renderer does so with a camera three can project again, an orthographic one, because a
// reversed-depth renderer calls `updateProjectionMatrix` on it.
//
// `project(p)` is the canvas point of a world point through the camera as it stands, in the canvas's
// pixels from its top left: `{ x, y, behind }`, where `behind` is true where the camera draws
// nothing, behind it, nearer than `near` or past `far`. It is measured along the camera's own axis,
// so it holds under either depth projection.
//
// Materials. `splice(key, splice)` registers a shader splice for every dressed material, once per
// key. `dress(material, { surface })` hands a material every splice and its own `surface` through
// one `onBeforeCompile`. A splice and a surface have one shape, `{ uniforms?, vertex?: { chunk:
// glsl }, fragment?: { chunk: glsl } }`: each glsl goes right after `#include <chunk>` in that
// shader (`common` for declarations), and a chunk the shader does not include throws when the
// program is compiled. The surface goes in first, then the splices in the order they were
// registered, so a splice lands on the surface's own look. The `uniforms` objects are handed to every
// program as they are, so the plugin that owns a splice writes `value` once a frame and every
// dressed material follows. Every dressed program has `vDressWorld`, the fragment's world position
// with an instanced or batched mesh's own matrix counted; the fragment's world normal is
// `inverseTransformDirection(normal, viewMatrix)`. A program's cache key is the splice keys and the
// surface's own text, so two materials with different surfaces never share a program. A splice
// registered after a material was dressed marks that material for recompiling; a disposed material
// is let go of.
//
// Effects. `pass(key, pass)` draws every frame through a three postprocessing `Pass` of another
// plugin's, once per key: after the AO, in the order they were handed over, and before the overlay,
// the bloom and the tone mapping, so an effect works on the frame's light as the scene left it.
// Before each frame its `depth` is set to the depth texture the scene was drawn with, the one the AO
// reads; under `ao` that depth is reversed, which three tells every shader material by defining
// USE_REVERSED_DEPTH_BUFFER. It is sized to the drawing buffer when the composer is made. With an
// effect there is always a composer, drawn into targets that carry that depth, and handing one over
// once the renderer is made makes the composer again. A pass handed over is render3d's from then on:
// it is disposed when render3d closes.
//
// The overlay. `overlay` is `{ scene, camera }`, a second scene drawn over the first each frame
// with the depth cleared between them, so whatever is in it is drawn over the world and meets
// nothing of it: a cockpit, a held tool, anything that stands a hand's width from the eye. Its camera
// takes the main camera's place, turn, field of view, aspect and zoom as the frame is drawn, and
// keeps its own `near` and `far`, which whoever puts something in the overlay sets for what it put
// there, so the world keeps a near plane far enough out for its depth to hold across the land while
// the overlay's is a hundredth of that, clipping nothing close and fighting nothing far. An overlay
// with nothing in it is not drawn. Through the composer it is drawn after the AO, which does not
// reach it, and before the bloom and the tone mapping, which do, so it is lit, bloomed and graded as
// the world is; drawn straight, it is drawn right after the world. Its lights light it alone, and the
// world's light it alone, so what it holds is lit by lights it holds.
//
// The camera has one driver at a time. Whoever places it claims it: `claim(owner)` is true when
// `owner` now holds it and false while another does, `release(owner)` lets go of the owner's own
// claim only, and `claimed()` is the owner or undefined.
//
// It hands out THREE, the scene, the overlay, the canvas, the camera, the renderer, GLTFLoader and SkeletonUtils,
// and `composer`, the EffectComposer the frame is drawn through, or undefined while there is none: it
// is made again whenever an effect joins, so it is read where it is used, never kept.
// The canvas is hidden until the first `afterTick`, which runs only once the client has been sent a
// packet, so a canvas with nothing drawn on it is never shown. One of these per client, made when
// the seat arrives on its scene and closed when it leaves: `close` disposes the composer, the
// renderer and its WebGL context, then takes the canvas off the page.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { Pass } from 'three/addons/postprocessing/Pass.js'
import type { Plugins } from '#engine/browser.ts'

type V3 = [number, number, number]
export type Prefab = {
  camera: { fov: number; near: number; far: number; at: V3; look: V3 }
  pixelRatio?: number
  tone?: 'aces' | 'neutral' | 'none'
  exposure?: number
  shadows?: 'soft' | 'hard' | 'none'
  background?: THREE.ColorRepresentation
  ao?: { radius: number; thickness: number; falloff: number; scale: number; intensity: number; samples: number }
  bloom?: { strength: number; radius: number; threshold: number }
}
type Stage = 'vertex' | 'fragment'
export type Splice = { uniforms?: Record<string, THREE.IUniform>; vertex?: Record<string, string>; fragment?: Record<string, string> }
// A pass another plugin draws the frame through, handed the depth the scene was drawn with.
export type Effect = Pass & { depth?: THREE.DepthTexture | null }

const TONES = { aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping, none: THREE.NoToneMapping }
const SHADOWS = { soft: THREE.PCFShadowMap, hard: THREE.BasicShadowMap }
// The values `tone` and `shadows` take.
export const tones = Object.keys(TONES) as NonNullable<Prefab['tone']>[]
export const shadowings = [...Object.keys(SHADOWS), 'none'] as NonNullable<Prefab['shadows']>[]

// What every dressed program is given before its surface: the world position of the fragment.
const WORLD: Splice = {
  vertex: {
    common: 'varying vec3 vDressWorld;',
    project_vertex: [
      'vec4 dressWorld = vec4( transformed, 1.0 );',
      '#ifdef USE_BATCHING',
      '  dressWorld = batchingMatrix * dressWorld;',
      '#endif',
      '#ifdef USE_INSTANCING',
      '  dressWorld = instanceMatrix * dressWorld;',
      '#endif',
      'vDressWorld = ( modelMatrix * dressWorld ).xyz;',
    ].join('\n'),
  },
  fragment: { common: 'varying vec3 vDressWorld;' },
}

// The part of a surface that makes a program, as text: its glsl and its uniform names. Two surfaces
// share a program only when this text is the same.
const text = (s: Splice | undefined) => (s ? JSON.stringify([s.vertex ?? {}, s.fragment ?? {}, Object.keys(s.uniforms ?? {})]) : '')

// Three's GTAOPass reading the depth it is handed, with no normals, and holding only what it draws
// with. Three's own, made with no depth, builds a target of normals with a depth texture of its own
// to draw the scene into a second time, and keeps it, sized and unused, once it is handed a depth;
// made with a depth, it reads that target's depth texture anyway and throws. So this one takes its
// depth only through `setGBuffer`, builds no such target, sizes the two targets it draws into, and
// disposes everything it holds, its AO and blend materials too, which three's own leaves.
class DepthAO extends GTAOPass {
  setGBuffer(depth?: THREE.DepthTexture) {
    (this as unknown as { _renderGBuffer: boolean })._renderGBuffer = false
    if (depth) this.depthTexture = depth
    for (const m of [this.gtaoMaterial, this.pdMaterial]) {
      m.defines.NORMAL_VECTOR_TYPE = 0
      m.defines.DEPTH_SWIZZLING = 'x'
      m.uniforms.tNormal.value = null
      m.uniforms.tDepth.value = depth ?? null
    }
    this.depthRenderMaterial.uniforms.tDepth.value = depth ?? null
  }
  setSize(width: number, height: number) {
    this.width = width
    this.height = height
    this.gtaoRenderTarget.setSize(width, height)
    this.pdRenderTarget.setSize(width, height)
    this.gtaoMaterial.uniforms.resolution.value.set(width, height)
    this.gtaoMaterial.uniforms.cameraProjectionMatrix.value.copy(this.camera.projectionMatrix)
    this.gtaoMaterial.uniforms.cameraProjectionMatrixInverse.value.copy(this.camera.projectionMatrixInverse)
    this.pdMaterial.uniforms.resolution.value.set(width, height)
    this.pdMaterial.uniforms.cameraProjectionMatrixInverse.value.copy(this.camera.projectionMatrixInverse)
  }
  dispose() {
    this.gtaoNoiseTexture.dispose()
    this.pdNoiseTexture.dispose()
    this.gtaoRenderTarget.dispose()
    this.pdRenderTarget.dispose()
    for (const m of [this.gtaoMaterial, this.normalMaterial, this.pdMaterial, this.depthRenderMaterial, this.copyMaterial, this.blendMaterial]) m.dispose()
    ;(this as unknown as { _fsQuad: { dispose(): void } })._fsQuad.dispose()
  }
}

// The overlay's camera put where the main camera stands, with its own near and far.
const follow = (overlay: THREE.PerspectiveCamera, camera: THREE.PerspectiveCamera) => {
  camera.updateMatrixWorld()
  camera.matrixWorld.decompose(overlay.position, overlay.quaternion, overlay.scale)
  overlay.fov = camera.fov
  overlay.aspect = camera.aspect
  overlay.zoom = camera.zoom
  overlay.updateMatrixWorld()
  overlay.updateProjectionMatrix()
}

// The overlay drawn over what the passes before it drew, into the same target, the depth cleared
// first. Three's RenderPass clears the depth of whatever target was bound before it binds its own,
// so it cannot do this.
class OverlayPass extends Pass {
  constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    super()
    this.needsSwap = false
  }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    if (!this.scene.children.length) return
    const was = renderer.autoClear
    renderer.autoClear = false
    renderer.setRenderTarget(this.renderToScreen ? null : read)
    renderer.clearDepth()
    renderer.render(this.scene, this.camera)
    renderer.autoClear = was
  }
}

// Each part's glsl right after the chunk it names, the parts in the order given.
const insert = (src: string, stage: Stage, parts: [string, Splice][]) => {
  const at = new Map<string, string[]>()
  for (const [key, part] of parts) {
    for (const [chunk, glsl] of Object.entries(part[stage] ?? {})) {
      if (!src.includes(`#include <${chunk}>`)) throw new Error(`render3d: ${key} goes after #include <${chunk}>, which this ${stage} shader does not include`)
      at.set(chunk, [...(at.get(chunk) ?? []), glsl])
    }
  }
  for (const [chunk, glsl] of at) src = src.replace(`#include <${chunk}>`, () => [`#include <${chunk}>`, ...glsl].join('\n'))
  return src
}

export function render3d() {
  const scene = new THREE.Scene()
  const overlay = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera() }
  const splices = new Map<string, Splice>()
  const effects = new Map<string, Effect>()
  const dressed = new Set<THREE.Material>()
  let prefab: Prefab | undefined
  let size: [number, number] = [0, 0]
  let mounted: HTMLCanvasElement | undefined
  let renderer: THREE.WebGLRenderer | undefined
  let post: { composer: EffectComposer; gtao?: DepthAO; own: Pass[] } | undefined
  let holder: unknown

  // The renderer, once there is both a canvas and a prefab: reversed depth is fixed when it is made.
  const make = () => {
    if (renderer || !mounted || !prefab) return
    const p = prefab
    const [width, height] = size
    const r = new THREE.WebGLRenderer({ canvas: mounted, reversedDepthBuffer: !!p.ao })
    if (p.pixelRatio !== undefined) r.setPixelRatio(Math.min(devicePixelRatio, p.pixelRatio))
    r.setSize(width, height)
    if (p.tone !== undefined) r.toneMapping = TONES[p.tone]
    if (p.exposure !== undefined) r.toneMappingExposure = p.exposure
    if (p.shadows !== undefined && p.shadows !== 'none') {
      r.shadowMap.enabled = true
      r.shadowMap.type = SHADOWS[p.shadows]
    }
    renderer = r
    me.renderer = r
    compose()
  }

  // The composer, made again whenever an effect joins: the scene, the AO, every effect in the order
  // they joined, the overlay, the bloom and the tone mapping. Its own passes are let go of when it is
  // made again; an effect's pass stays, for the next one.
  const compose = () => {
    const p = prefab!, r = renderer!
    const [width, height] = size
    if (post) {
      for (const pass of post.own) pass.dispose()
      post.composer.dispose()
      post = undefined
    }
    if (!p.ao && !p.bloom && !effects.size) return
    // With AO or an effect the scene is drawn into a target carrying the depth they read; without,
    // the composer's own half-float targets.
    const composer = p.ao || effects.size
      ? new EffectComposer(r, new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(width, height, THREE.FloatType) }))
      : new EffectComposer(r)
    composer.setSize(width, height)
    const own: Pass[] = [new RenderPass(scene, me.camera!)]
    composer.addPass(own[0])
    let gtao: DepthAO | undefined
    if (p.ao) {
      gtao = new DepthAO(scene, me.camera!, width * r.getPixelRatio(), height * r.getPixelRatio())
      const { radius, thickness, falloff, scale, intensity, samples } = p.ao
      gtao.updateGtaoMaterial({ radius, thickness, distanceFallOff: falloff, scale, samples })
      gtao.blendIntensity = intensity
      composer.addPass(gtao)
      own.push(gtao)
    }
    for (const effect of effects.values()) {
      effect.setSize(width * r.getPixelRatio(), height * r.getPixelRatio())
      composer.addPass(effect)
    }
    const after: Pass[] = [new OverlayPass(overlay.scene, overlay.camera)]
    if (p.bloom) {
      const { strength, radius, threshold } = p.bloom
      after.push(new UnrealBloomPass(new THREE.Vector2(width * r.getPixelRatio(), height * r.getPixelRatio()), strength, radius, threshold))
    }
    after.push(new OutputPass())
    for (const pass of after) composer.addPass(pass)
    post = { composer, gtao, own: [...own, ...after] }
  }

  const me = {
    THREE,
    GLTFLoader,
    SkeletonUtils,
    scene,
    overlay,
    canvas: undefined as HTMLCanvasElement | undefined,
    camera: undefined as THREE.PerspectiveCamera | undefined,
    renderer: undefined as THREE.WebGLRenderer | undefined,
    get composer(): EffectComposer | undefined { return post?.composer },
    mount(canvas: HTMLCanvasElement) {
      canvas.style.display = 'none'
      me.canvas = canvas
      mounted = canvas
      make()
    },
    tick(plugins: Plugins) {
      if (prefab) return
      const p = plugins.wire.scene.prefabs.render3d as Prefab | undefined
      if (!p) return
      if (!p.camera) throw new Error('the render3d prefab has no camera')
      if (p.tone !== undefined && !Object.hasOwn(TONES, p.tone)) throw new Error(`render3d tone ${p.tone} is none of ${tones.join(', ')}`)
      if (p.shadows !== undefined && p.shadows !== 'none' && !Object.hasOwn(SHADOWS, p.shadows)) throw new Error(`render3d shadows ${p.shadows} is none of ${shadowings.join(', ')}`)
      const { width, height } = plugins.wire.scene.prefabs.engine
      size = [width, height]
      const { fov, near, far, at, look } = p.camera
      const camera = new THREE.PerspectiveCamera(fov, width / height, near, far)
      camera.position.fromArray(at)
      camera.lookAt(...look)
      me.camera = camera
      if (p.background !== undefined) scene.background = new THREE.Color(p.background)
      prefab = p
      make()
    },
    project(p: number[]): { x: number; y: number; behind: boolean } {
      const camera = me.camera
      if (!camera) throw new Error('render3d has no camera: it has not ticked, or the scene gives no render3d prefab')
      camera.updateMatrixWorld()
      const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(camera.matrixWorldInverse)
      const along = -v.z
      v.applyMatrix4(camera.projectionMatrix)
      return { x: ((v.x + 1) / 2) * size[0], y: ((1 - v.y) / 2) * size[1], behind: !(along >= camera.near && along <= camera.far) }
    },
    splice(key: string, s: Splice) {
      if (splices.has(key)) throw new Error(`render3d already has the splice ${key}`)
      splices.set(key, s)
      for (const m of dressed) m.needsUpdate = true
    },
    pass(key: string, effect: Effect) {
      if (effects.has(key)) throw new Error(`render3d already has the pass ${key}`)
      effects.set(key, effect)
      if (renderer) compose()
    },
    dress<M extends THREE.Material>(material: M, { surface }: { surface?: Splice } = {}): M {
      const own = text(surface)
      material.onBeforeCompile = shader => {
        const parts: [string, Splice][] = [['vDressWorld', WORLD], ...(surface ? [['the surface', surface] as [string, Splice]] : []), ...splices]
        for (const [, part] of parts) Object.assign(shader.uniforms, part.uniforms)
        shader.vertexShader = insert(shader.vertexShader, 'vertex', parts)
        shader.fragmentShader = insert(shader.fragmentShader, 'fragment', parts)
      }
      material.customProgramCacheKey = () => [...splices.keys(), own].join('|')
      if (!dressed.has(material)) {
        dressed.add(material)
        const drop = () => { dressed.delete(material); material.removeEventListener('dispose', drop) }
        material.addEventListener('dispose', drop)
      }
      material.needsUpdate = true
      return material
    },
    claim(owner: unknown) {
      if (holder !== undefined && holder !== owner) return false
      holder = owner
      return true
    },
    release(owner: unknown) { if (holder === owner) holder = undefined },
    claimed() { return holder },
    afterTick() {
      if (!me.canvas) return
      me.canvas.style.display = ''
      if (!renderer || !me.camera) return
      if (overlay.scene.children.length) follow(overlay.camera, me.camera)
      if (!post) {
        renderer.render(scene, me.camera)
        if (!overlay.scene.children.length) return
        const was = renderer.autoClear
        renderer.autoClear = false
        renderer.clearDepth()
        renderer.render(overlay.scene, overlay.camera)
        renderer.autoClear = was
        return
      }
      // The scene pass draws into the composer's read target, and the AO and every effect read that
      // target's depth.
      const depth = post.composer.readBuffer.depthTexture
      post.gtao?.setGBuffer(depth!)
      for (const effect of effects.values()) effect.depth = depth
      post.composer.render()
    },
    // The renderer lets go of everything it put on the GPU and of the WebGL context itself, and the
    // canvas leaves the page. `dispose` alone keeps the context until the canvas is collected.
    close() {
      if (post) {
        for (const pass of post.own) pass.dispose()
        post.composer.dispose()
        post = undefined
      }
      for (const effect of effects.values()) effect.dispose()
      effects.clear()
      renderer?.dispose()
      renderer?.forceContextLoss()
      renderer = undefined
      me.renderer = undefined
      dressed.clear()
      me.canvas?.remove()
    },
  }
  return me
}
