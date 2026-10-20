# anim's export: a rig file's clips baked onto each body it names, one glb per body, and the rig's
# `table` measured. Run by the anim extension's route (`anim.route.ts`), or by hand:
#
#   Blender -b --factory-startup --python plugins/anim/anim.export.py -- \
#       <rig.json> <table.json> <body>=<out.glb> [<body>=<out.glb> ...]
#
# The rig file names its bodies and the file of each clip, paths under ~/troupe-collection:
#   bodies  `{ <body>: "<fbx>" }`, the rigged characters. Each `<body>=<out.glb>` names one of them.
#   clips   `<name>: "<fbx>"` or `{ file, rebase, ... }`. A clip with no `file` (a `mirror`) is built
#           by anim itself and is skipped here.
#   rebase  `{ from: "<fbx>", onto: "<clip>" }`: the clip is moved from the pose it was authored
#           around to the pose another clip starts in. Each bone's turn on each frame is taken as a
#           turn away from its turn on the first frame of `from`, and that same turn is laid onto the
#           bone's turn on the first frame of `onto`; the hips' position likewise. A pack's fire and
#           reload were authored around a rifle held 22 cm further forward than the locomotion pack's
#           aim, and on the upper channel that difference would jump the rifle on every shot.
#
# Every clip is sampled once, as each bone's position and turn from its rest (`matrix_basis`), and
# written onto each body as an action of its own name, one NLA track per clip, which the glTF
# exporter writes as one named animation. Only the hips keep their position keys: every other bone
# stands where its body's rest puts it, so a body of other proportions than the one the clips were
# pulled on keeps its own limbs. The bones are matched by name without the `mixamorig…:` prefix,
# which differs between packs.
#
# The table is measured on the first body named, once its clips are written, and written to
# <table.json> as `{ <clip>: { frames, dur, forward, left, yaw, rise, height, low, peak, travel } }`:
# forward is the body's own facing on the first frame (a Mixamo body faces −Y in Blender, +Z once
# exported), left is +X in that frame, yaw how far the facing turned by the last frame, positive
# left, rise the highest the hips got over their first frame, height the hips' height on frame 0,
# low how far they dip, peak the second the right hand moves fastest, and travel rows
# `[t, forward, left, yawDeg]` every tenth of a second and at the end. The route writes it into the
# rig file.
import bpy
import json
import math
import os
import re
import sys
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
RIG, TABLE = args[0], args[1]
OUTS = dict(a.split('=', 1) for a in args[2:])
C = os.path.expanduser('~/troupe-collection')
FPS = 30
SAMPLE_HZ = 10
FWD = Vector((0, -1, 0))
LEFT = Vector((1, 0, 0))

spec = json.load(open(RIG))
bare = lambda n: re.sub(r'^mixamorig\d*:?', '', n)


def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS


def load(path):
    full = os.path.join(C, path)
    if not os.path.exists(full):
        raise SystemExit(f'anim export: no file at {full}')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=full)
    new = [o for o in bpy.data.objects if o not in before]
    return next(o for o in new if o.type == 'ARMATURE'), new


def drop(objs):
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        if a.users == 0:
            bpy.data.actions.remove(a)


def sample(path):
    """Every frame of a clip: bare bone name to (position, turn) from its rest."""
    arm, new = load(path)
    act = arm.animation_data.action
    sc = bpy.context.scene
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    frames = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        frames.append({bare(pb.name): (pb.matrix_basis.to_translation(), pb.matrix_basis.to_quaternion()) for pb in arm.pose.bones})
    drop(new)
    return frames


fresh()
seen = {}


def frames_of(path):
    if path not in seen:
        seen[path] = sample(path)
        print(f'SAMPLE {path} frames={len(seen[path])}')
    return seen[path]


def file_of(e):
    return e if isinstance(e, str) else e.get('file')


clips = {}
for name, e in spec['clips'].items():
    f = file_of(e)
    if not f:
        continue
    fr = frames_of(f)
    rb = None if isinstance(e, str) else e.get('rebase')
    if rb:
        base = frames_of(rb['from'])[0]
        onto = frames_of(file_of(spec['clips'][rb['onto']]))[0]
        fr = [{b: (onto[b][0] + (loc - base[b][0]), onto[b][1] @ base[b][1].inverted() @ rot) for b, (loc, rot) in pose.items()}
              for pose in fr]
    clips[name] = fr


def write(body, name, fr):
    """The clip as an action on the body, and an NLA track that holds it."""
    act = bpy.data.actions.new(name)
    body.animation_data.action = act
    bones = {bare(pb.name): pb for pb in body.pose.bones}
    n = len(fr)
    for b, pb in bones.items():
        if b not in fr[0]:
            continue
        pb.rotation_mode = 'QUATERNION'
        qs, prev = [], None
        for pose in fr:
            q = pose[b][1].copy()
            if prev is not None:
                q.make_compatible(prev)
            qs.append(q)
            prev = q
        channels = [('rotation_quaternion', [[q[i] for q in qs] for i in range(4)])]
        if b == 'Hips':
            channels.append(('location', [[pose[b][0][i] for pose in fr] for i in range(3)]))
        for prop, rows in channels:
            path = f'pose.bones["{pb.name}"].{prop}'
            for i, vals in enumerate(rows):
                fc = act.fcurve_ensure_for_datablock(body, path, index=i, group_name=pb.name)
                fc.keyframe_points.add(n)
                fc.keyframe_points.foreach_set('co', [c for f in range(n) for c in (f, vals[f])])
                for k in fc.keyframe_points:
                    k.interpolation = 'LINEAR'
                fc.update()
    track = body.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, act)
    track.mute = True
    body.animation_data.action = None
    return act


def measure(rig, act):
    sc = bpy.context.scene
    rig.animation_data.action = act
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    hips = next(b for b in rig.pose.bones if bare(b.name) == 'Hips')
    hand = next((b for b in rig.pose.bones if bare(b.name) == 'RightHand'), None)
    sc.frame_set(f0)
    m0 = rig.matrix_world @ hips.matrix
    p0 = m0.translation.copy()
    axis = m0.to_3x3().inverted() @ FWD
    pts, rise, low = [], 0.0, 0.0
    h_prev, peak_v, peak_f = None, 0.0, f0
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        m = rig.matrix_world @ hips.matrix
        p = m.translation - p0
        rise, low = max(rise, p.z), min(low, p.z)
        if hand is not None:
            h = (rig.matrix_world @ hand.matrix).translation.copy()
            if h_prev is not None and (h - h_prev).length * FPS > peak_v:
                peak_v, peak_f = (h - h_prev).length * FPS, f
            h_prev = h
        fwd = m.to_3x3() @ axis
        fwd.z = 0
        yaw = math.degrees(math.atan2(FWD.cross(fwd).z, FWD.dot(fwd))) if fwd.length > 1e-6 else 0.0
        pts.append((f - f0, p.dot(FWD), p.dot(LEFT), yaw))
    rig.animation_data.action = None
    n = f1 - f0
    step = max(1, round(FPS / SAMPLE_HZ))
    keep = [pts[i] for i in range(0, n + 1, step)]
    if keep[-1][0] != n:
        keep.append(pts[-1])
    num = lambda v, places=3: (lambda x: int(x) if x == int(x) else x)(round(v, places))
    return {
        'frames': n, 'dur': num(n / FPS),
        'forward': num(pts[-1][1]), 'left': num(pts[-1][2]), 'yaw': num(pts[-1][3], 1), 'rise': num(rise),
        'height': num(p0.z), 'low': num(low), 'peak': num((peak_f - f0) / FPS),
        'travel': [[num(fr / FPS), num(a), num(b), num(y, 1)] for fr, a, b, y in keep],
    }


table = None
for body_name, out in OUTS.items():
    fresh()
    body, keep = load(spec['bodies'][body_name])
    body.name = 'rig'
    body.animation_data_create()
    body.animation_data.action = None
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    acts = {name: write(body, name, fr) for name, fr in clips.items()}
    if table is None:
        table = {name: measure(body, act) for name, act in acts.items()}
    for img in bpy.data.images:
        if img.size[0] > 1024 or img.size[1] > 1024:
            img.scale(min(1024, img.size[0]), min(1024, img.size[1]))
    bpy.ops.object.select_all(action='DESELECT')
    for o in keep:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=out, use_selection=True, export_animations=True,
                              export_animation_mode='NLA_TRACKS', export_anim_single_armature=True,
                              export_apply=True, export_optimize_animation_size=True,
                              export_image_format='JPEG', export_jpeg_quality=75)
    print(f'MODEL {body_name} {out} clips={len(acts)} meshes={sum(o.type == "MESH" for o in keep)}')

json.dump(table, open(TABLE, 'w'))
print(f'TABLE {TABLE} clips={len(table)}')
