"""render_blender.py — import a street GLB and render a Cycles beauty shot.

Run headless:
    blender -b -P render_blender.py -- --params params.json

params.json keys (all optional except glb/out):
    glb, out, cache_dir,
    environment (day|night|sunny-*|cloudy*|foggy|color), background_color,
    width, height, fov, azimuth, elevation, margin, ground(bool), samples

Ports the environment presets from src/aframe-components/street-environment.js
and the camera corner-fit from src/render/street-render-harness.js frameCamera().
The GLB is authored in glTF Y-up; Blender imports it Z-up, so the framing math
runs in glTF space and the resulting camera pose is converted back to Blender.
"""

import bpy
import sys
import os
import json
import math
import urllib.request
import numpy as np
from mathutils import Vector

# ---------------------------------------------------------------------------
# environment presets (street-environment.js setEnvOption)
#   ambient intensity, directional intensity, directional glTF position, sky img
# ---------------------------------------------------------------------------
ASSET_BASE = "https://assets.3dstreet.app/"
PRESETS = {
    "night": (0.5, 0.15, (-40, 56, -43), "images/AdobeStock_286725174-min.jpeg"),
    "day": (0.8, 2.2, (-40, 56, -43), "images/skies/2048-polyhaven-wasteland_clouds_puresky.jpeg"),
    "sunny-morning": (0.8, 2.2, (-60, 56, -16), "images/skies/2048-polyhaven-qwantani_puresky-sdr.jpeg"),
    "cloudy-afternoon": (2, 0.6, (-40, 56, -43), "images/skies/2048-mud_road_puresky-sdr.jpeg"),
    "sunny-afternoon": (2, 2.2, (60, 56, -16), "images/skies/2048-kloofendal_43d_clear_puresky-sdr.jpeg"),
    "sunny-noon": (2, 2.2, (5, 56, -16), "images/skies/2048-kloppenheim_05_puresky-sdr.jpeg"),
    "foggy": (2, 0.6, (-40, 56, -43), "images/skies/2048-kloofendal_misty_morning_puresky-sdr.jpeg"),
    "cloudy": (2, 0.6, (-40, 56, -43), "images/skies/2048-kloofendal_48d_partly_cloudy_puresky-sdr.jpeg"),
    # sunset is an alias people expect; map to the warm afternoon sky.
    "sunset": (1.4, 2.0, (60, 56, -16), "images/skies/2048-kloofendal_43d_clear_puresky-sdr.jpeg"),
}


def gltf_to_blender(v):
    """glTF (x,y,z) -> Blender (x,-z,y)."""
    return Vector((v[0], -v[2], v[1]))


def blender_to_gltf(v):
    """Blender (x,y,z) -> glTF (x,z,-y)."""
    return (v[0], v[2], -v[1])


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    params = {}
    if "--params" in argv:
        with open(argv[argv.index("--params") + 1]) as f:
            params = json.load(f)
    return params


def download_cached(url, cache_dir):
    os.makedirs(cache_dir, exist_ok=True)
    name = url.split("/")[-1]
    path = os.path.join(cache_dir, name)
    if not os.path.exists(path):
        urllib.request.urlretrieve(url, path)
    return path


def setup_world(params):
    env = params.get("environment", "day")
    preset = PRESETS.get(env)
    world = bpy.data.worlds.new("street-world")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new("ShaderNodeBackground")
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

    if preset is None:
        # 'color' preset — solid background.
        col = params.get("background_color", "#808080")
        bg.inputs["Color"].default_value = (*hex_to_rgb(col), 1.0)
        bg.inputs["Strength"].default_value = 0.9
        ambient, directional, sun_pos = 0.8, 2.2, (-40, 56, -43)
    else:
        ambient, directional, sun_pos, sky_rel = preset
        try:
            sky_path = download_cached(ASSET_BASE + sky_rel, params["cache_dir"])
            img = bpy.data.images.load(sky_path, check_existing=True)
            env_tex = nt.nodes.new("ShaderNodeTexEnvironment")
            env_tex.image = img
            nt.links.new(env_tex.outputs["Color"], bg.inputs["Color"])
            # sky doubles as the IBL fill; lift it so surfaces facing away from
            # the sun (pedestrian sides, car flanks) aren't crushed to black.
            bg.inputs["Strength"].default_value = float(ambient) + 1.3
        except Exception as exc:  # noqa: BLE001
            print("[render] sky load failed:", exc)
            bg.inputs["Color"].default_value = (0.5, 0.6, 0.75, 1.0)
            bg.inputs["Strength"].default_value = float(ambient)

    add_sun(sun_pos, directional)


def add_sun(gltf_pos, intensity):
    # A-Frame directional lights point from position toward the origin.
    d_gltf = np.array(gltf_pos, dtype=float)
    d_gltf = -d_gltf / (np.linalg.norm(d_gltf) or 1.0)  # direction of travel of light
    d_blender = gltf_to_blender(d_gltf)
    light = bpy.data.lights.new("sun", "SUN")
    light.energy = float(intensity) * 2.4
    light.angle = math.radians(1.5)  # soft-ish shadows
    obj = bpy.data.objects.new("Sun", light)
    bpy.context.collection.objects.link(obj)
    # Orient the sun so its -Z points along the light travel direction.
    obj.rotation_euler = d_blender.to_track_quat("-Z", "Y").to_euler()


def hex_to_rgb(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    # sRGB -> linear for Blender color inputs
    def s2l(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (s2l(r), s2l(g), s2l(b))


def street_bbox_gltf():
    mn = np.array([1e18] * 3)
    mx = np.array([-1e18] * 3)
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name == "Ground":
            continue
        for corner in obj.bound_box:
            w = obj.matrix_world @ Vector(corner)
            g = np.array(blender_to_gltf(w))
            mn = np.minimum(mn, g)
            mx = np.maximum(mx, g)
    return mn, mx


def frame_camera(params):
    """Port of street-render-harness.js frameCamera() in glTF space."""
    width = int(params.get("width", 1280))
    height = int(params.get("height", 800))
    fov = float(params.get("fov", 20))
    azimuth = float(params.get("azimuth", 20))
    elevation = float(params.get("elevation", 30))
    margin = float(params.get("margin", 1.12))

    mn, mx = street_bbox_gltf()
    center = (mn + mx) / 2.0
    aspect = width / height

    v_fov = math.radians(fov)
    h_fov = 2 * math.atan(math.tan(v_fov / 2) * aspect)
    az = math.radians(azimuth)
    elev = math.radians(elevation)

    d = np.array([
        math.sin(az) * math.cos(elev),
        math.sin(elev),
        math.cos(az) * math.cos(elev),
    ])
    forward = -d
    right = np.cross(forward, [0, 1, 0])
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)

    corners = []
    for xi in (mn[0], mx[0]):
        for yi in (mn[1], mx[1]):
            for zi in (mn[2], mx[2]):
                corners.append(np.array([xi, yi, zi]))

    tan_h = math.tan(h_fov / 2)
    tan_v = math.tan(v_fov / 2)
    dist = 0.0
    for c in corners:
        o = c - center
        along = np.dot(o, forward)
        needed = along + max(abs(np.dot(o, right)) / tan_h, abs(np.dot(o, up)) / tan_v)
        dist = max(dist, needed)

    # screen-space refit (perspective-projection loop)
    target = center.copy()
    for _ in range(3):
        probe = target + d * dist
        min_x = min_y = 1e18
        max_x = max_y = -1e18
        for c in corners:
            rel = c - probe
            depth = np.dot(rel, forward)
            if depth <= 1e-6:
                continue
            ndc_x = (np.dot(rel, right) / depth) / (tan_v * aspect)
            ndc_y = (np.dot(rel, up) / depth) / tan_v
            min_x = min(min_x, ndc_x); max_x = max(max_x, ndc_x)
            min_y = min(min_y, ndc_y); max_y = max(max_y, ndc_y)
        ndc_cx = (min_x + max_x) / 2
        ndc_cy = (min_y + max_y) / 2
        target = target + right * (ndc_cx * tan_h * dist) + up * (ndc_cy * tan_v * dist)
        extent = max((max_x - min_x) / 2, (max_y - min_y) / 2)
        if extent > 0:
            dist *= extent * margin

    cam_pos = target + d * dist
    near = max(0.1, dist / 100)
    far = dist * 20

    cam_data = bpy.data.cameras.new("cam")
    cam_data.sensor_fit = "VERTICAL"
    cam_data.angle = v_fov
    cam_data.clip_start = near
    cam_data.clip_end = far
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)

    cam.location = gltf_to_blender(cam_pos)
    look_dir = gltf_to_blender(target) - cam.location
    cam.rotation_euler = look_dir.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam


def add_ground(params):
    mn, mx = street_bbox_gltf()
    span = max(mx[0] - mn[0], mx[2] - mn[2]) * 4 + 60
    bpy.ops.mesh.primitive_plane_add(size=span, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = "Ground"
    mat = bpy.data.materials.new("ground")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.19, 0.21, 0.19, 1.0)
    bsdf.inputs["Roughness"].default_value = 1.0
    ground.data.materials.append(mat)


def setup_render(params):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = int(params.get("samples", 12))
    scene.cycles.use_denoising = True
    scene.render.resolution_x = int(params.get("width", 1280))
    scene.render.resolution_y = int(params.get("height", 800))
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    # Standard (sRGB) transform matches the browser's WebGL look far better than
    # AgX/Filmic, which crush the street into darkness.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = float(params.get("exposure", 1.0))
    scene.render.filepath = params["out"]


def main():
    params = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=params["glb"])

    setup_world(params)
    frame_camera(params)
    if params.get("ground", True):
        add_ground(params)
    setup_render(params)
    bpy.ops.render.render(write_still=True)
    print("[render] wrote", params["out"])


main()
