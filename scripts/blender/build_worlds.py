"""Build the nine local-only architectural world bundles.

Run with Blender 4.5 LTS:
  blender --background --python scripts/blender/build_worlds.py -- --root <project>

The script deliberately owns architecture and set dressing only. Interactive
books and shelf coordinates remain runtime data so every volume still maps to
one Markdown source file.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector


def parse_args() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--world", action="append", dest="worlds")
    return parser.parse_args(raw)


ARGS = parse_args()
ROOT = Path(ARGS.root).resolve()
CACHE = ROOT / ".asset-cache" / "worlds"
OUTPUT = ROOT / ".asset-cache" / "worlds" / "generated-models"
SOURCE = ROOT / "art-source" / "worlds"
GENERATED_MATERIALS = ROOT / "art-source" / "generated" / "materials"
OUTPUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
GENERATED_MATERIALS.mkdir(parents=True, exist_ok=True)

WORLD_IDS = ("heritage", "gothic", "modern", "renaissance", "deco", "foundry", "lunar", "arkship", "alexandria")
SELECTED_WORLDS = tuple(ARGS.worlds or WORLD_IDS)

COLLECTIONS: dict[str, bpy.types.Collection] = {}
MATERIALS: dict[str, bpy.types.Material] = {}
ASSET_MANIFEST: list[dict[str, object]] = []


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    COLLECTIONS.clear()
    MATERIALS.clear()
    ASSET_MANIFEST.clear()
    for name in ("BASE", "DETAIL", "ANCHORS"):
        collection = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(collection)
        COLLECTIONS[name] = collection
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.image_settings.file_format = "PNG"


def move_to_collection(obj: bpy.types.Object, collection_name: str) -> None:
    target = COLLECTIONS[collection_name]
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    target.objects.link(obj)
    obj["fidelityTier"] = "cinematic" if collection_name == "DETAIL" else "lite"


def principled_input(node: bpy.types.Node, *names: str):
    for name in names:
        socket = node.inputs.get(name)
        if socket:
            return socket
    raise KeyError(f"Missing Principled input: {names}")


def solid_material(
    name: str,
    color: str,
    roughness: float = 0.6,
    metalness: float = 0.0,
    emission: str | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    key = f"solid:{name}:{color}:{roughness}:{metalness}:{emission}:{emission_strength}"
    if key in MATERIALS:
        return MATERIALS[key]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    principled_input(bsdf, "Base Color").default_value = hex_rgba(color)
    principled_input(bsdf, "Roughness").default_value = roughness
    principled_input(bsdf, "Metallic").default_value = metalness
    if emission:
        principled_input(bsdf, "Emission Color", "Emission").default_value = hex_rgba(emission)
        principled_input(bsdf, "Emission Strength").default_value = emission_strength
    MATERIALS[key] = mat
    return mat


def find_texture(material_id: str, suffix: str) -> Path | None:
    folder = CACHE / "ambientcg" / material_id
    matches = sorted(folder.glob(f"*_{suffix}.jpg"))
    return matches[0] if matches else None


def pbr_material(name: str, material_id: str, roughness: float = 0.65, metalness: float = 0.0) -> bpy.types.Material:
    key = f"pbr:{material_id}:{roughness}:{metalness}"
    if key in MATERIALS:
        return MATERIALS[key]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    principled_input(bsdf, "Roughness").default_value = roughness
    principled_input(bsdf, "Metallic").default_value = metalness

    color_path = find_texture(material_id, "Color")
    normal_path = find_texture(material_id, "NormalGL")
    roughness_path = find_texture(material_id, "Roughness")
    metal_path = find_texture(material_id, "Metalness")
    if color_path:
        node = nodes.new("ShaderNodeTexImage")
        node.name = f"{material_id}_BaseColor"
        node.image = bpy.data.images.load(str(color_path), check_existing=True)
        node.image.colorspace_settings.name = "sRGB"
        links.new(node.outputs["Color"], principled_input(bsdf, "Base Color"))
    if roughness_path:
        node = nodes.new("ShaderNodeTexImage")
        node.name = f"{material_id}_Roughness"
        node.image = bpy.data.images.load(str(roughness_path), check_existing=True)
        node.image.colorspace_settings.name = "Non-Color"
        links.new(node.outputs["Color"], principled_input(bsdf, "Roughness"))
    if metal_path:
        node = nodes.new("ShaderNodeTexImage")
        node.name = f"{material_id}_Metalness"
        node.image = bpy.data.images.load(str(metal_path), check_existing=True)
        node.image.colorspace_settings.name = "Non-Color"
        links.new(node.outputs["Color"], principled_input(bsdf, "Metallic"))
    if normal_path:
        image = nodes.new("ShaderNodeTexImage")
        image.name = f"{material_id}_Normal"
        image.image = bpy.data.images.load(str(normal_path), check_existing=True)
        image.image.colorspace_settings.name = "Non-Color"
        normal = nodes.new("ShaderNodeNormalMap")
        normal.inputs["Strength"].default_value = 0.55
        links.new(image.outputs["Color"], normal.inputs["Color"])
        links.new(normal.outputs["Normal"], principled_input(bsdf, "Normal"))
    mat["assetSource"] = f"ambientCG:{material_id}"
    MATERIALS[key] = mat
    return mat


def hex_rgba(value: str) -> tuple[float, float, float, float]:
    value = value.lstrip("#")
    return tuple(int(value[index : index + 2], 16) / 255 for index in (0, 2, 4)) + (1.0,)


def write_alexandrian_papyrus_maps(size: int = 512) -> None:
    """Render reproducible papyrus PBR maps from a real Blender node graph."""
    scene = bpy.context.scene
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "None"
    scene.view_settings.view_transform = "Standard"

    bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 0, 0))
    plane = bpy.context.object
    plane.name = "PAPYRUS_TEXTURE_BAKE_PLANE"
    material = bpy.data.materials.new("Procedural Alexandrian Papyrus")
    material.use_nodes = True
    plane.data.materials.append(material)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    principled_input(shader, "Base Color").default_value = (0.8, 0.61, 0.35, 1)
    principled_input(shader, "Roughness").default_value = 1.0
    principled_input(shader, "Emission Strength").default_value = 1.0
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    coordinates = nodes.new("ShaderNodeTexCoord")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 5.2
    noise.inputs["Detail"].default_value = 8.0
    noise.inputs["Roughness"].default_value = 0.78
    noise.inputs["Distortion"].default_value = 0.24
    fiber_a = nodes.new("ShaderNodeTexWave")
    fiber_a.wave_type = "BANDS"
    fiber_a.wave_profile = "SAW"
    fiber_a.bands_direction = "X"
    fiber_a.inputs["Scale"].default_value = 116.0
    fiber_a.inputs["Distortion"].default_value = 6.4
    fiber_a.inputs["Detail"].default_value = 4.0
    fiber_b = nodes.new("ShaderNodeTexWave")
    fiber_b.wave_type = "BANDS"
    fiber_b.wave_profile = "SAW"
    fiber_b.bands_direction = "Y"
    fiber_b.inputs["Scale"].default_value = 154.0
    fiber_b.inputs["Distortion"].default_value = 4.2
    fiber_b.inputs["Detail"].default_value = 3.0
    links.new(coordinates.outputs["Generated"], noise.inputs["Vector"])
    links.new(coordinates.outputs["Generated"], fiber_a.inputs["Vector"])
    links.new(coordinates.outputs["Generated"], fiber_b.inputs["Vector"])

    fiber_mix = nodes.new("ShaderNodeMixRGB")
    fiber_mix.blend_type = "MULTIPLY"
    fiber_mix.inputs[0].default_value = 0.68
    links.new(fiber_a.outputs["Color"], fiber_mix.inputs[1])
    links.new(fiber_b.outputs["Color"], fiber_mix.inputs[2])
    height_mix = nodes.new("ShaderNodeMixRGB")
    height_mix.blend_type = "MULTIPLY"
    height_mix.inputs[0].default_value = 0.52
    links.new(noise.outputs["Fac"], height_mix.inputs[1])
    links.new(fiber_mix.outputs["Color"], height_mix.inputs[2])

    color_ramp = nodes.new("ShaderNodeValToRGB")
    color_ramp.color_ramp.elements[0].position = 0.28
    color_ramp.color_ramp.elements[0].color = (0.39, 0.2, 0.055, 1)
    color_ramp.color_ramp.elements[1].position = 0.76
    color_ramp.color_ramp.elements[1].color = (1.0, 0.94, 0.7, 1)
    color_ramp.color_ramp.elements.new(0.42).color = (0.65, 0.38, 0.12, 1)
    color_ramp.color_ramp.elements.new(0.53).color = (0.84, 0.59, 0.25, 1)
    color_ramp.color_ramp.elements.new(0.63).color = (0.96, 0.79, 0.46, 1)
    links.new(height_mix.outputs["Color"], color_ramp.inputs["Fac"])

    roughness_ramp = nodes.new("ShaderNodeValToRGB")
    roughness_ramp.color_ramp.elements[0].color = (0.58, 0.58, 0.58, 1)
    roughness_ramp.color_ramp.elements[1].color = (0.99, 0.99, 0.99, 1)
    links.new(height_mix.outputs["Color"], roughness_ramp.inputs["Fac"])

    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.25
    bump.inputs["Distance"].default_value = 0.13
    links.new(height_mix.outputs["Color"], bump.inputs["Height"])
    normal_scale = nodes.new("ShaderNodeVectorMath")
    normal_scale.operation = "SCALE"
    normal_scale.inputs[3].default_value = 0.5
    links.new(bump.outputs["Normal"], normal_scale.inputs[0])
    normal_bias = nodes.new("ShaderNodeVectorMath")
    normal_bias.operation = "ADD"
    normal_bias.inputs[1].default_value = (0.5, 0.5, 0.5)
    links.new(normal_scale.outputs["Vector"], normal_bias.inputs[0])

    bpy.ops.object.camera_add(location=(0, 0, 2.5))
    camera = bpy.context.object
    camera.name = "PAPYRUS_TEXTURE_BAKE_CAMERA"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 2.0
    scene.camera = camera

    emission = principled_input(shader, "Emission Color", "Emission")
    for filename, source in (
        ("alexandria-papyrus-color.png", color_ramp.outputs["Color"]),
        ("alexandria-papyrus-normal.png", normal_bias.outputs["Vector"]),
        ("alexandria-papyrus-roughness.png", roughness_ramp.outputs["Color"]),
    ):
        for link in list(emission.links):
            links.remove(link)
        links.new(source, emission)
        scene.render.filepath = str(GENERATED_MATERIALS / filename)
        bpy.ops.render.render(write_still=True)

    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.objects.remove(plane, do_unlink=True)
    bpy.data.materials.remove(material)

    ASSET_MANIFEST.append({
        "source": "project-generated:Blender procedural papyrus",
        "license": "Project-generated",
        "files": [
            "art-source/generated/materials/alexandria-papyrus-color.png",
            "art-source/generated/materials/alexandria-papyrus-normal.png",
            "art-source/generated/materials/alexandria-papyrus-roughness.png",
        ],
    })


def apply_bevel(obj: bpy.types.Object, amount: float, segments: int = 2) -> None:
    if amount <= 0 or obj.type != "MESH":
        return
    modifier = obj.modifiers.new("Edge highlights", "BEVEL")
    modifier.width = amount
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    if hasattr(modifier, "harden_normals"):
        modifier.harden_normals = True
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def cube_uv(obj: bpy.types.Object, cube_size: float = 1.5) -> None:
    if obj.type != "MESH":
        return
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cube_project(cube_size=cube_size, correct_aspect=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)


def box(
    name: str,
    location: tuple[float, float, float],
    dimensions: tuple[float, float, float],
    material: bpy.types.Material,
    bevel: float = 0.012,
    collection: str = "BASE",
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    uv_scale: float = 1.5,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    cube_uv(obj, uv_scale)
    apply_bevel(obj, bevel, 3 if collection == "DETAIL" else 1)
    obj.data.materials.append(material)
    move_to_collection(obj, collection)
    return obj


def cylinder(
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    material: bpy.types.Material,
    vertices: int = 32,
    collection: str = "BASE",
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel: float = 0.008,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    # Match Three.js CylinderGeometry, whose primary axis is Y rather than
    # Blender's native Z. Explicit rotations are authored in app coordinates.
    obj.rotation_euler = (Euler(rotation).to_matrix().to_4x4() @ Matrix.Rotation(-math.pi / 2, 4, "X")).to_euler()
    obj["syncTransform"] = True
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    cube_uv(obj, 1.2)
    apply_bevel(obj, bevel, 2)
    obj.data.materials.append(material)
    move_to_collection(obj, collection)
    return obj


def sphere(
    name: str,
    location: tuple[float, float, float],
    radius: float,
    material: bpy.types.Material,
    collection: str = "DETAIL",
    segments: int = 18,
    rings: int = 12,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        radius=radius,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    move_to_collection(obj, collection)
    return obj


def torus(
    name: str,
    location: tuple[float, float, float],
    major_radius: float,
    minor_radius: float,
    material: bpy.types.Material,
    collection: str = "DETAIL",
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=48 if collection == "DETAIL" else 24,
        minor_segments=10 if collection == "DETAIL" else 6,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    move_to_collection(obj, collection)
    return obj


def curve_tube(
    name: str,
    points: list[tuple[float, float, float]],
    radius: float,
    material: bpy.types.Material,
    collection: str = "DETAIL",
    cyclic: bool = False,
) -> bpy.types.Object:
    curve_data = bpy.data.curves.new(name, "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 2
    curve_data.bevel_depth = radius
    curve_data.bevel_resolution = 3 if collection == "DETAIL" else 1
    spline = curve_data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve_data)
    COLLECTIONS[collection].objects.link(obj)
    obj.data.materials.append(material)
    obj["fidelityTier"] = "cinematic" if collection == "DETAIL" else "lite"
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    return obj


def round_arch(
    name: str,
    center: tuple[float, float, float],
    width: float,
    spring_height: float,
    material: bpy.types.Material,
    radius: float = 0.07,
    collection: str = "DETAIL",
    facing: str = "z",
    include_legs: bool = True,
) -> None:
    cx, cy, cz = center
    half = width / 2
    points: list[tuple[float, float, float]] = []
    if facing == "z":
        if include_legs:
            points.append((cx - half, cy - spring_height, cz))
            points.append((cx - half, cy, cz))
        points.extend((cx + math.cos(math.pi - i * math.pi / 12) * half, cy + math.sin(math.pi - i * math.pi / 12) * half, cz) for i in range(13))
        if include_legs:
            points.append((cx + half, cy - spring_height, cz))
    else:
        if include_legs:
            points.append((cx, cy - spring_height, cz - half))
            points.append((cx, cy, cz - half))
        points.extend((cx, cy + math.sin(math.pi - i * math.pi / 12) * half, cz + math.cos(math.pi - i * math.pi / 12) * half) for i in range(13))
        if include_legs:
            points.append((cx, cy - spring_height, cz + half))
    curve_tube(name, points, radius, material, collection)


def pointed_arch(
    name: str,
    center: tuple[float, float, float],
    width: float,
    height: float,
    material: bpy.types.Material,
    radius: float = 0.075,
    collection: str = "DETAIL",
) -> None:
    cx, cy, cz = center
    half = width / 2
    points = [
        (cx - half, cy - height * 0.62, cz),
        (cx - half, cy, cz),
        (cx - half * 0.72, cy + height * 0.37, cz),
        (cx, cy + height, cz),
        (cx + half * 0.72, cy + height * 0.37, cz),
        (cx + half, cy, cz),
        (cx + half, cy - height * 0.62, cz),
    ]
    curve_tube(name, points, radius, material, collection)


def empty(name: str, location: tuple[float, float, float], **extras: object) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    obj.location = location
    obj.empty_display_type = "CUBE"
    obj.empty_display_size = 0.25
    for key, value in extras.items():
        obj[key] = value
    COLLECTIONS["ANCHORS"].objects.link(obj)
    return obj


def add_standard_anchors(
    world: str,
    bays: list[tuple[float, ...]],
    spawn: tuple[float, float, float] = (0, 1.72, 7.2),
) -> None:
    for index, bay in enumerate(bays):
        x, y, z, rotation_y, *dimensions = bay
        width = dimensions[0] if dimensions else 4.0
        anchor = empty(f"SHELF_BAY_{index:02d}", (x, y, z), bayIndex=index, world=world)
        anchor.rotation_euler[1] = rotation_y
        clearance = empty(
            f"CLEARANCE_BAY_{index:02d}",
            (x, 1.4, z),
            bayIndex=index,
            world=world,
            width=width,
            depth=3.0,
            height=2.8,
        )
        clearance.rotation_euler[1] = rotation_y
    empty("SPAWN", spawn, world=world)
    empty(f"LANDMARK_{world.upper()}", (0, 2.0, -2.0), world=world)


def add_collider(name: str, bounds: tuple[float, float, float, float]) -> None:
    min_x, max_x, min_z, max_z = bounds
    empty(
        f"COLLIDER_{name}",
        ((min_x + max_x) / 2, 1.0, (min_z + max_z) / 2),
        minX=min_x,
        maxX=max_x,
        minZ=min_z,
        maxZ=max_z,
    )


def import_prop(
    asset_id: str,
    name: str,
    location: tuple[float, float, float],
    target_size: float,
    rotation_y: float = 0.0,
    collection: str = "DETAIL",
) -> bpy.types.Object | None:
    source = CACHE / "polyhaven" / "models" / asset_id / f"{asset_id}_1k.gltf"
    if not source.exists():
        print(f"Missing optional prop: {source}")
        return None
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(source))
    imported = [obj for obj in bpy.data.objects if obj not in before]
    if not imported:
        return None
    pivot = bpy.data.objects.new(name, None)
    COLLECTIONS[collection].objects.link(pivot)
    roots = [obj for obj in imported if obj.parent not in imported]
    for obj in imported:
        move_to_collection(obj, collection)
        obj["assetSource"] = f"PolyHaven:{asset_id}"
    for obj in roots:
        matrix = obj.matrix_world.copy()
        obj.parent = pivot
        obj.matrix_world = matrix

    bounds: list[Vector] = []
    for obj in imported:
        if obj.type == "MESH":
            bounds.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not bounds:
        return pivot
    minimum = Vector((min(v.x for v in bounds), min(v.y for v in bounds), min(v.z for v in bounds)))
    maximum = Vector((max(v.x for v in bounds), max(v.y for v in bounds), max(v.z for v in bounds)))
    center = (minimum + maximum) * 0.5
    extent = max(maximum.x - minimum.x, maximum.y - minimum.y, maximum.z - minimum.z)
    scale = target_size / extent if extent else 1.0
    transform = Matrix.Translation(Vector(location)) @ Matrix.Rotation(rotation_y, 4, "Y") @ Matrix.Scale(scale, 4) @ Matrix.Translation(-center)
    pivot.matrix_world = transform
    pivot["assetSource"] = f"PolyHaven:{asset_id}"
    pivot["fidelityTier"] = "cinematic"
    ASSET_MANIFEST.append({"id": asset_id, "node": name, "source": str(source.relative_to(ROOT)).replace("\\", "/")})
    return pivot


def build_heritage() -> None:
    wood = pbr_material("Georgian Oak", "Wood051", 0.48)
    floor = pbr_material("Oak Parquet", "WoodFloor051", 0.52)
    plaster = pbr_material("Aged Plaster", "Plaster001", 0.82)
    brass = solid_material("Aged Brass", "#b48a46", 0.28, 0.72)
    black = solid_material("Firebox", "#090605", 0.88)
    oxblood = solid_material("Oxblood Wool", "#521c22", 0.95)

    box("Oak parquet floor", (0, -0.08, 0), (20, 0.16, 22), floor, 0.008, uv_scale=1.4)
    box("Coffered ceiling", (0, 7.55, 0), (19.8, 0.22, 21.8), plaster, 0.02, "BASE", uv_scale=2.5)
    box("West paneled wall", (-9.72, 3.75, 0), (0.36, 7.5, 21.8), wood, 0.025, uv_scale=1.2)
    box("East paneled wall", (9.72, 3.75, 0), (0.36, 7.5, 21.8), wood, 0.025, uv_scale=1.2)
    box("North paneled wall", (0, 3.75, -10.72), (19.8, 7.5, 0.36), wood, 0.025, uv_scale=1.2)
    for z in (-8.2, -4.1, 0.0, 4.1, 8.2):
        for x in (-9.48, 9.48):
            box(f"Carved pilaster {x} {z}", (x, 3.45, z), (0.28, 6.9, 0.48), wood, 0.045, "DETAIL")
            box(f"Pilaster capital {x} {z}", (x, 6.82, z), (0.54, 0.28, 0.76), brass, 0.025, "DETAIL")
    for x in (-7.2, -3.6, 0, 3.6, 7.2):
        box(f"Long ceiling beam {x}", (x, 7.34, 0), (0.24, 0.34, 21.1), wood, 0.035, "BASE")
    for z in (-8, -4, 0, 4, 8):
        box(f"Cross ceiling beam {z}", (0, 7.31, z), (19.1, 0.4, 0.24), wood, 0.035, "BASE")
    for side in (-1, 1):
        box(f"Balcony {side}", (side * 8.55, 4.0, 0), (1.75, 0.24, 20.0), wood, 0.03)
        # The balcony guard is part of the room silhouette, not optional set
        # dressing. Keep it in both tiers so an adaptive-quality transition can
        # never make the guard disappear while the user is looking at it.
        box(f"Balcony rail {side}", (side * 7.78, 4.78, 0), (0.12, 1.42, 19.4), brass, 0.02, "BASE")
        for z in range(-9, 10, 1):
            cylinder(f"Baluster {side} {z}", (side * 7.78, 4.7, float(z)), 0.028, 1.22, brass, 12, "BASE")
    for x in (-5.8, 0, 5.8):
        round_arch(f"Arched window {x}", (x, 4.7, -10.48), 2.7, 2.05, brass, 0.075)
    box("Fireplace body", (0, 1.55, -10.25), (4.35, 3.1, 0.92), wood, 0.07)
    box("Fireplace opening", (0, 1.25, -9.75), (2.45, 1.9, 0.08), black, 0.02)
    box("Fireplace mantle", (0, 3.12, -9.9), (5.1, 0.32, 1.25), brass, 0.045)
    box("Central wool rug", (0, 0.015, 1.3), (9.2, 0.025, 5.5), oxblood, 0.02, "BASE")
    # One shared reading table keeps the fireplace axis legible. The previous
    # three-table row filled almost the full rug and competed with the room's
    # shelves before a visitor had taken a step.
    for x in (0,):
        box(f"Reading table {x}", (x, 0.88, 1.2), (2.6, 0.16, 1.22), wood, 0.05, "BASE")
        box(f"Reading table long apron {x}", (x, 0.75, 1.2), (2.24, 0.18, 0.82), wood, 0.035, "BASE")
        for dx in (-1.0, 1.0):
            for dz in (-0.43, 0.43):
                cylinder(f"Table leg {x} {dx} {dz}", (x + dx, 0.39, 1.2 + dz), 0.1, 0.78, wood, 20, "BASE")
        box(f"Reading table stretcher {x}", (x, 0.3, 1.2), (2.0, 0.08, 0.08), brass, 0.02, "BASE")
    add_standard_anchors("heritage", [(-5.6, 0, -9.92, 0), (5.6, 0, -9.92, 0), (-8.72, 0, -6.7, math.pi / 2), (-8.72, 0, -2.1, math.pi / 2), (-8.72, 0, 2.5, math.pi / 2), (-8.72, 0, 7.1, math.pi / 2), (8.72, 0, -5.2, -math.pi / 2), (8.72, 0, 0, -math.pi / 2), (8.72, 0, 5.2, -math.pi / 2)])
    add_collider("TABLE", (-1.4, 1.4, 0.3, 2.15))
    add_collider("FIREPLACE", (-2.3, 2.3, -8.9, -7.2))


def build_gothic() -> None:
    stone = pbr_material("Cathedral Limestone", "Travertine009", 0.88)
    marble = pbr_material("Nave Marble", "Marble012", 0.48)
    iron = solid_material("Black Iron", "#171b20", 0.33, 0.78)
    crimson = solid_material("Crimson Runner", "#4e1321", 0.94)
    candle_wax = solid_material("Ivory Candle Wax", "#ead9b8", 0.72)

    box("Marble nave floor", (0, -0.08, 0), (17.5, 0.16, 27), marble, 0.008, uv_scale=1.35)
    box("West limestone wall", (-8.18, 4.2, 0), (0.44, 8.4, 26.8), stone, 0.025, uv_scale=1.3)
    box("East limestone wall", (8.18, 4.2, 0), (0.44, 8.4, 26.8), stone, 0.025, uv_scale=1.3)
    box("Apse wall", (0, 4.2, -13.28), (16.8, 8.4, 0.44), stone, 0.025, uv_scale=1.3)
    box("Crimson nave runner", (0, 0.012, 0.8), (3.1, 0.025, 23.0), crimson, 0.018)
    # Keep a full browsing aisle between the side-wall bookcases and the nave
    # supports. The former 5.35 m pier line left the camera squeezed against
    # the shelves on mobile; 4.5 m preserves the clustered-pier rhythm while
    # giving each shelf face a little over two metres of visual clearance.
    pier_x = 4.5
    for z in (-9, -4.5, 0, 4.5, 9):
        for x in (-pier_x, pier_x):
            cylinder(f"Clustered pier {x} {z}", (x, 3.6, z), 0.42, 7.2, stone, 16, "BASE", bevel=0.02)
            for offset in (-0.28, 0.28):
                cylinder(f"Pier shaft {x} {z} {offset}", (x + offset, 3.55, z), 0.11, 7.0, stone, 12, "DETAIL")
        curve_tube(f"Vault rib west {z}", [(-pier_x, 6.8, z), (-2.7, 8.1, z), (0, 8.65, z)], 0.1, stone, "BASE")
        curve_tube(f"Vault rib east {z}", [(pier_x, 6.8, z), (2.7, 8.1, z), (0, 8.65, z)], 0.1, stone, "BASE")
        curve_tube(f"Diagonal rib A {z}", [(-pier_x, 6.8, z - 2.1), (0, 8.6, z), (pier_x, 6.8, z + 2.1)], 0.055, stone, "DETAIL")
        curve_tube(f"Diagonal rib B {z}", [(pier_x, 6.8, z - 2.1), (0, 8.6, z), (-pier_x, 6.8, z + 2.1)], 0.055, stone, "DETAIL")
    for x in (-3.6, 0, 3.6):
        pointed_arch(f"Traceried window {x}", (x, 4.7, -13.0), 2.35, 2.4, iron, 0.07)
    torus("Rose window frame", (0, 6.0, -12.98), 2.15, 0.11, iron, "BASE", (math.pi / 2, 0, 0))
    for angle in (0, math.pi / 4, math.pi / 2, 3 * math.pi / 4):
        box(f"Rose tracery {angle}", (0, 6.0, -12.84), (0.07, 4.0, 0.08), iron, 0.008, "DETAIL", (0, 0, angle))
    # The stained-glass image is rendered at runtime, so the base model does
    # not carry a second hidden glass slab behind it.
    for side in (-1, 1):
        for z in (-7.2, 0, 7.2):
            cylinder(f"Iron candle standard {side} {z}", (side * 3.75, 0.72, z), 0.045, 1.36, iron, 12, "BASE")
            cylinder(f"Iron candle foot {side} {z}", (side * 3.75, 0.055, z), 0.2, 0.055, iron, 16, "BASE")
            cylinder(f"Iron candle bobeche {side} {z}", (side * 3.75, 1.42, z), 0.14, 0.04, iron, 16, "BASE")
            cylinder(f"Ivory candle body {side} {z}", (side * 3.75, 1.53, z), 0.045, 0.18, candle_wax, 12, "BASE")
    # Bay zero receives the bundled starter book. Put it on the open east
    # gallery beside the entrance instead of behind an apse pier.
    add_standard_anchors("gothic", [
        (7.45, 0, 7, -math.pi / 2, 4.3),
        (7.45, 0, 0, -math.pi / 2, 4.3),
        (7.45, 0, -7, -math.pi / 2, 4.3),
        (4.7, 0, -11.8, 0, 3.5),
        (-4.7, 0, -11.8, 0, 3.5),
        (-7.45, 0, -9, math.pi / 2, 3.9),
        (-7.45, 0, -3, math.pi / 2, 3.9),
        (-7.45, 0, 3, math.pi / 2, 3.9),
        (-7.45, 0, 9, math.pi / 2, 3.9),
    ], (0, 1.72, 9.2))
    add_collider("ALTAR", (-1.8, 1.8, -1.7, 1.7))


def build_modern() -> None:
    travertine = pbr_material("Honed Travertine", "Travertine009", 0.55)
    concrete = pbr_material("Architectural Concrete", "Concrete034", 0.78)
    pale_oak = pbr_material("Pale Oak", "Wood051", 0.5)
    steel = solid_material("Blackened Steel", "#263039", 0.29, 0.74)
    cobalt = solid_material("Cobalt Wayfinding", "#175f9e", 0.38, 0.12, "#216da9", 0.4)
    glass = solid_material("Museum Glass", "#bcd4d8", 0.08, 0.05)
    green = solid_material("Planting", "#315d45", 0.88)

    box("Travertine atrium floor", (0, -0.08, 0), (26, 0.16, 20), travertine, 0.006, uv_scale=1.2)
    box("North concrete datum", (0, 4.0, -9.65), (25.5, 8.0, 0.42), concrete, 0.02, uv_scale=1.6)
    # The west and south walls are split around real entrance apertures. This
    # prevents the old solid white wall from sitting behind the laser portal.
    box("East concrete datum", (12.7, 4.0, 0), (0.42, 8.0, 19.4), concrete, 0.02, uv_scale=1.6)
    box("West concrete datum", (-12.7, 4.0, -2.5), (0.42, 8.0, 14.4), concrete, 0.02, uv_scale=1.6)
    for x in (-7.65, 7.65):
        box(f"South concrete return {x}", (x, 4.0, 9.7), (10.1, 8.0, 0.42), concrete, 0.02, uv_scale=1.6)
    for x in (-10.5, -5.25, 0, 5.25, 10.5):
        box(f"Skylight mullion {x}", (x, 8.15, 0), (0.14, 0.16, 18.6), steel, 0.018, "BASE")
    for z in (-8, -4, 0, 4, 8):
        box(f"Skylight transom {z}", (0, 8.15, z), (24.5, 0.16, 0.14), steel, 0.018, "BASE")
    for side in (-1, 1):
        box(f"Glass bridge {side}", (side * 5.3, 4.8, -0.8), (4.0, 0.18, 13.5), glass, 0.02, "DETAIL")
        box(f"Bridge rail {side}", (side * 3.35, 5.45, -0.8), (0.06, 1.25, 13.2), steel, 0.012, "BASE")
    cylinder("Central index desk", (0, 0.58, 0), 2.55, 1.15, pale_oak, 64, "BASE", bevel=0.04)
    cylinder("Index desk inset", (0, 0.72, 0), 1.65, 1.48, steel, 64, "DETAIL", bevel=0.025)
    torus("Cobalt index ring", (0, 1.34, 0), 2.08, 0.055, cobalt, "DETAIL", (math.pi / 2, 0, 0))
    # Two compact planters soften the atrium without occupying a shelf-browsing
    # lane. Their foliage remains in the lite model so mobile never falls back
    # to an empty pot or a crude substitute tree.
    for x, z in ((-7.2, -5.7), (7.2, 5.7)):
        cylinder(f"Planter {x} {z}", (x, 0.38, z), 0.48, 0.72, concrete, 32, "BASE")
        for leaf in range(7):
            curve_tube(
                f"Plant {x} {z} {leaf}",
                [(x, 0.72, z), (x + math.sin(leaf) * 0.32, 1.18, z + math.cos(leaf) * 0.32), (x + math.sin(leaf) * 0.52, 1.58, z + math.cos(leaf) * 0.52)],
                0.05,
                green,
                "BASE",
            )
    for z in (-5.0, 5.0):
        box(f"Cobalt direction bar {z}", (0, 0.04, z), (18, 0.018, 0.16), cobalt, 0.005, "DETAIL")
    import_prop("modern_ceiling_lamp_01", "Atrium pendant west", (-3.0, 5.7, 1.5), 1.8)
    import_prop("modern_ceiling_lamp_01", "Atrium pendant east", (3.0, 5.7, 1.5), 1.8)
    add_standard_anchors("modern", [(-10.8, 0, -6.9, math.pi / 2, 4.15), (-10.8, 0, -2.3, math.pi / 2, 4.15), (-10.8, 0, 2.3, math.pi / 2, 4.15), (-10.8, 0, 6.9, math.pi / 2, 4.15), (10.8, 0, -6.9, -math.pi / 2, 4.15), (10.8, 0, -2.3, -math.pi / 2, 4.15), (10.8, 0, 2.3, -math.pi / 2, 4.15), (10.8, 0, 6.35, -math.pi / 2, 3.2), (-6.6, 0, 8.85, math.pi, 4.2)])
    add_collider("INDEX", (-2.8, 2.8, -1.9, 1.9))


def build_renaissance() -> None:
    plaster = pbr_material("Sunwashed Plaster", "Plaster001", 0.86)
    terracotta = pbr_material("Glazed Terracotta", "GlazedTerracotta001", 0.66)
    walnut = pbr_material("Italian Walnut", "Wood051", 0.5)
    marble = pbr_material("Carrara Marble", "Marble012", 0.42)
    limewash = solid_material("Tuscan Limewash", "#d8bf91", 0.9)
    bronze = solid_material("Renaissance Bronze", "#9f6a36", 0.3, 0.62)
    water = solid_material("Fountain Water", "#5fa7a7", 0.12, 0.05, "#4f9295", 0.2)
    lapis = solid_material("Lapis Inlay", "#294f86", 0.46, 0.08)

    box("Terracotta loggia floor", (0, -0.08, 0), (22, 0.16, 22), terracotta, 0.006, uv_scale=1.1)
    # Warm uninterrupted limewash gives the shelf galleries a quiet backdrop.
    # Decorative fresco panels were removed because their frames read as a
    # second layer of windows and pictures behind the bookcases.
    # A real recessed landscape opening, with the existing image behind its returns.
    for side in (-1, 1):
        box(f"North plaster wing {side}", (side * 8.1, 3.8, -10.9), (5.8, 7.6, 0.38), plaster, 0.02, uv_scale=1.5)
        box(f"Landscape stone jamb {side}", (side * 5.32, 4.0, -10.92), (0.24, 5.9, 0.8), marble, 0.025)
    box("North plaster below window", (0, 0.55, -10.9), (10.4, 1.1, 0.38), plaster, 0.02)
    box("North plaster window lintel", (0, 7.08, -10.9), (10.4, 1.04, 0.38), plaster, 0.02)
    box("Landscape stone sill", (0, 1.04, -10.91), (10.88, 0.16, 0.86), marble, 0.025)
    box("Landscape stone lintel", (0, 6.54, -10.92), (10.88, 0.16, 0.8), marble, 0.025)
    box("West limewash wall", (-10.9, 3.8, 0), (0.38, 7.6, 22), plaster, 0.02, uv_scale=1.5)
    box("East limewash wall", (10.9, 3.8, 0), (0.38, 7.6, 22), plaster, 0.02, uv_scale=1.5)
    for side in (-1, 1):
        box(f"Gallery marble plinth {side}", (side * 10.63, 0.25, 0), (0.2, 0.5, 21.4), marble, 0.02)
        box(f"Gallery plaster frieze {side}", (side * 10.58, 6.72, 0), (0.3, 0.35, 21.4), plaster, 0.025)
        divisions = (-4.79, -1.2, 2.4, 7.1) if side < 0 else (-4.2, 1.4, 7.1)
        for z in divisions:
            box(f"Gallery plaster pilaster {side} {z}", (side * 10.64, 3.45, z), (0.16, 5.9, 0.2), plaster, 0.018)
            box(f"Gallery pilaster foot {side} {z}", (side * 10.6, 0.57, z), (0.22, 0.14, 0.34), marble, 0.018)
    box("Landscape window seat", (0, 0.51, -9.7), (3.6, 0.18, 0.7), marble, 0.05)
    for x in (-1.3, 1.3):
        box(f"Window seat support {x}", (x, 0.23, -9.7), (0.32, 0.46, 0.6), marble, 0.025)

    # The inner arcade is now a real structural rhythm. Every arch starts and
    # ends on a capital, the unsupported bay beside the north shelf wall is
    # deliberately omitted, and a continuous entablature carries the gallery
    # beams above. Column positions remain outside the 0.6-2.8 m shelf service
    # lane, leaving all nine cases fully reachable.
    arcade_columns = (-5.6, -2.8, 0, 2.8, 5.6, 8.4)
    for side in (-1, 1):
        for coordinate in arcade_columns:
            x, z = (side * 5.25, coordinate)
            cylinder(f"Arcade column {side} {coordinate}", (x, 2.15, z), 0.25, 4.3, marble, 24, "BASE", bevel=0.018)
            cylinder(f"Column base {side} {coordinate}", (x, 0.18, z), 0.39, 0.3, marble, 24, "BASE", bevel=0.02)
            cylinder(f"Column capital {side} {coordinate}", (x, 4.25, z), 0.42, 0.34, marble, 24, "BASE", bevel=0.02)
            box(f"Column abacus {side} {coordinate}", (x, 4.43, z), (0.68, 0.14, 0.68), marble, 0.025, "BASE")
            cylinder(f"Capital bronze neck {side} {coordinate}", (x, 4.05, z), 0.3, 0.08, bronze, 24, "DETAIL", bevel=0.012)
        for z in (-4.2, -1.4, 1.4, 4.2, 7.0):
            round_arch(
                f"Cloister arch {side} {z}",
                (side * 5.25, 4.43, z),
                2.8,
                2.4,
                plaster,
                0.15,
                "BASE",
                "x",
                include_legs=False,
            )
            round_arch(
                f"Bronze archivolt {side} {z}",
                (side * 5.25 - side * 0.13, 4.43, z),
                2.8,
                2.4,
                bronze,
                0.035,
                "DETAIL",
                "x",
                include_legs=False,
            )
        box(f"Arcade entablature {side}", (side * 5.25, 5.98, 1.4), (0.56, 0.34, 14.4), plaster, 0.035, "BASE")
        box(f"Arcade supporting frieze {side}", (side * 5.25, 6.3, 1.4), (0.5, 0.34, 14.4), plaster, 0.025, "BASE")
        box(f"Entablature bronze band {side}", (side * 5.25 - side * 0.16, 5.9, 1.4), (0.075, 0.075, 14.5), bronze, 0.012, "DETAIL")
        box(f"Gallery wall cornice {side}", (side * 10.66, 6.42, 0), (0.22, 0.26, 20.7), walnut, 0.035, "BASE")
        for coordinate in arcade_columns:
            box(
                f"Gallery ceiling beam {side} {coordinate}",
                (side * 7.96, 6.52, coordinate),
                (5.42, 0.28, 0.28),
                walnut,
                0.035,
                "BASE",
            )

    box("Bronze arrival inlay", (0, 0.008, 7.7), (0.055, 0.016, 5.9), bronze, 0.004, "BASE")
    cylinder("Fountain basin", (0, 0.32, 0), 2.25, 0.55, marble, 64, "BASE", bevel=0.04)
    cylinder("Fountain water", (0, 0.62, 0), 1.9, 0.06, water, 64, "DETAIL", bevel=0.01)
    cylinder("Fountain pedestal", (0, 1.05, 0), 0.34, 1.35, marble, 32, "BASE", bevel=0.025)
    curve_tube("Fountain jet", [(0, 1.7, 0), (0.1, 2.5, 0), (0, 3.0, 0)], 0.035, water, "DETAIL")
    bays = [(-9.35, 0, -7.4, math.pi / 2, 4.0)]
    bays.extend([(-9.35, 0, z, math.pi / 2, 2.35) for z in (-3.0, 0.6, 4.2)])
    bays.extend([(9.35, 0, z, -math.pi / 2, 2.35) for z in (-7.0, -1.4, 4.2)])
    bays.extend([(x, 0, 9.6, math.pi, 3.4) for x in (-8.2, 8.2)])
    add_standard_anchors("renaissance", bays, (0, 1.82, 8.8))
    add_collider("COURTYARD", (-2.3, 2.3, -2.3, 2.3))
    add_collider("WINDOW_SEAT", (-1.85, 1.85, -10.1, -9.25))
    for side in (-1, 1):
        for z in arcade_columns:
            x = side * 5.25
            add_collider(f"COLUMN_{side}_{z}", (x - 0.39, x + 0.39, z - 0.39, z + 0.39))


def build_deco() -> None:
    marble = pbr_material("Athenaeum Marble", "Marble012", 0.32)
    ebony = pbr_material("Ebony Veneer", "Wood051", 0.34)
    brass = solid_material("Polished Brass", "#c7a65d", 0.2, 0.84)
    onyx = solid_material("Black Onyx", "#111412", 0.22, 0.12)
    glow = solid_material("Deco Glow", "#ffd58a", 0.2, 0, "#ffc163", 2.0)

    cylinder("Octagonal marble floor", (0, -0.09, 0), 10.2, 0.18, marble, 8, "BASE", bevel=0.03, rotation=(0, math.pi / 8, 0))
    for index in range(8):
        angle = index * math.pi / 4
        x, z = math.sin(angle) * 9.4, math.cos(angle) * 9.4
        if index == 0:
            # A single south-wall opening receives the closed runtime doors.
            for side in (-1, 1):
                box(f"South entrance jamb {side}", (side * 2.865, 3.7, z), (2.13, 7.4, 0.34), ebony, 0.025, "BASE", uv_scale=1.2)
            box("South entrance header", (0, 6, z), (3.6, 2.8, 0.34), ebony, 0.025, "BASE", uv_scale=1.2)
        else:
            box(f"Ebony wall {index}", (x, 3.7, z), (7.86, 7.4, 0.34), ebony, 0.035, "BASE", (0, angle, 0), 1.2)
        box(f"Perimeter cove ledge {index}", (math.sin(angle) * 9.1, 6.52, math.cos(angle) * 9.1), (7.6, 0.14, 0.45), brass, 0.02, "BASE", (0, angle, 0))
        box(f"Warm cove diffuser {index}", (math.sin(angle) * 9.02, 6.67, math.cos(angle) * 9.02), (7.42, 0.12, 0.14), glow, 0.02, "BASE", (0, angle, 0))
    cylinder("Continuous octagonal ceiling", (0, 7.48, 0), 10.4, 0.2, onyx, 8, "BASE", rotation=(0, math.pi / 8, 0))
    for radius, height in ((7.4, 7.1), (5.8, 7.35), (4.2, 7.58)):
        cylinder(f"Stepped ceiling {radius}", (0, height, 0), radius, 0.18, onyx, 8, "BASE", bevel=0.025)
    for angle in range(0, 360, 45):
        radians = math.radians(angle)
        curve_tube(f"Ceiling ray {angle}", [(0, 7.48, 0), (math.sin(radians) * 7.4, 7.3, math.cos(radians) * 7.4)], 0.045, brass, "DETAIL")
    # The live directory is rendered at runtime. Movable seating belongs to
    # RoomDetails, where its footprint stays clear of every radial shelf face.
    for x in (-4.0, 0, 4.0):
        box(f"Geometric ceiling light {x}", (x, 6.9, 0), (1.7, 0.12, 0.55), glow, 0.035, "DETAIL")
    bays = [(-2.035, 0, -8.35, 0, 3), (2.035, 0, -8.35, 0, 3),
            (-6, 0, -6, math.pi / 4, 4.2), (-8.35, 0, 0, math.pi / 2, 4.2),
            (-6.75, 0, 5.05, 3 * math.pi / 4, 4.2),
            (8.35, 0, 2.035, -math.pi / 2, 3), (6, 0, 6, -3 * math.pi / 4, 4.2),
            (8.35, 0, -2.035, -math.pi / 2, 3), (6, 0, -6, -math.pi / 4, 4.2)]
    add_standard_anchors("deco", bays, (-0.7, 1.82, 5.8))
    add_collider("INDEX", (-1.05, 1.05, -1.05, 1.05))
    add_collider("ENTRANCE", (-1.9, 1.9, 8.84, 9.6))


def build_foundry() -> None:
    concrete = pbr_material("Foundry Concrete", "Concrete034", 0.84)
    steel_pbr = pbr_material("Oily Steel", "Metal063", 0.38, 0.82)
    black = solid_material("Black Steel", "#111a1f", 0.3, 0.76)
    amber = solid_material("Caged Amber", "#f0a04a", 0.2, 0.05, "#ff8a31", 2.1)

    box("Concrete foundry floor", (0, -0.08, 0), (25, 0.16, 21), concrete, 0.008, uv_scale=1.25)
    box("Rear machine wall", (0, 4.2, -10.45), (24.6, 8.4, 0.42), steel_pbr, 0.02, uv_scale=1.3)
    for x in (-12.3, 12.3):
        box(f"Industrial side wall {x}", (x, 4.2, 0), (0.42, 8.4, 20.6), concrete, 0.02, uv_scale=1.4)
    for x in (-10, -5, 0, 5, 10):
        box(f"Overhead girder {x}", (x, 7.8, 0), (0.34, 0.48, 20.0), black, 0.025, "BASE")
    for z in (-8, -4, 0, 4, 8):
        box(f"Cross girder {z}", (0, 7.8, z), (24.0, 0.48, 0.34), black, 0.025, "BASE")
    for x in (-8, -4, 0, 4, 8):
        box(f"Caged light {x}", (x, 6.3, 2.5), (0.22, 0.55, 0.22), amber, 0.03, "DETAIL")
    # The Aether Index and service runs are rendered at runtime, avoiding
    # hidden duplicate machinery and imported-prop texture payloads here.
    add_standard_anchors("foundry", [(-7.5, 0, -8.65, 0), (-2.5, 0, -8.65, 0), (2.5, 0, -8.65, 0), (7.5, 0, -8.65, 0), (-11.15, 0, -4.4, math.pi / 2), (-11.15, 0, 3.2, math.pi / 2, 3.2), (11.15, 0, -4.4, -math.pi / 2), (11.15, 0, 3.2, -math.pi / 2, 3.2), (11.15, 0, 7.3, -math.pi / 2)])
    add_collider("INDEX", (-2.25, 2.25, 2.7, 4.1))


def build_lunar() -> None:
    regolith = pbr_material("Regolith Composite", "Concrete034", 0.78)
    alloy = pbr_material("Pressure Hull Alloy", "Metal063", 0.3, 0.78)
    deck = solid_material("Sealed Deck", "#2b333a", 0.42, 0.48)
    composite = solid_material("White Hull Composite", "#cdd4d5", 0.46, 0.16)
    dark = solid_material("Airlock Recess", "#10171d", 0.48, 0.58)
    amber = solid_material("Habitat Amber", "#df9643", 0.2, 0.18, "#d68434", 2.2)
    blue = solid_material("Navigation Blue", "#4aa6d8", 0.18, 0.12, "#3d96c5", 1.8)
    glass = solid_material("Pressure Glass", "#54798a", 0.08, 0.08)

    box("Lunar pressure deck", (0, -0.08, 0), (21.5, 0.16, 20.8), deck, 0.008, uv_scale=1.2)
    box("Lunar ceiling pressure plate", (0, 6.65, 0), (21.3, 0.22, 20.6), composite, 0.025, uv_scale=2.0)
    box("West pressure hull", (-10.7, 3.25, 0), (0.34, 6.5, 20.8), composite, 0.025, uv_scale=1.4)
    box("East pressure hull", (10.7, 3.25, 0), (0.34, 6.5, 20.8), composite, 0.025, uv_scale=1.4)

    # The Earthwatch glazing is real open geometry rather than a painted wall.
    box("Earthwatch lower hull", (0, 0.38, -10.42), (21.0, 0.76, 0.34), alloy, 0.025)
    box("Earthwatch upper hull", (0, 6.05, -10.42), (21.0, 1.14, 0.34), alloy, 0.025)
    box("Earthwatch west jamb", (-9.35, 3.18, -10.42), (2.3, 4.85, 0.34), alloy, 0.03)
    box("Earthwatch east jamb", (9.35, 3.18, -10.42), (2.3, 4.85, 0.34), alloy, 0.03)
    for x in (-6.2, -3.1, 0, 3.1, 6.2):
        box(f"Earthwatch mullion {x}", (x, 3.18, -10.39), (0.12, 4.85, 0.16), alloy, 0.018, "DETAIL")
    box("Earthwatch pressure glass", (0, 3.18, -10.5), (16.45, 4.82, 0.035), glass, 0.005, "DETAIL")

    # Rear wall wraps a modeled airlock. The laser barrier sits inside this
    # believable threshold, with a lit service corridor continuing beyond it.
    box("Aft hull west", (-3.3, 3.25, 10.38), (14.4, 6.5, 0.34), composite, 0.025)
    box("Aft hull east", (8.05, 3.25, 10.38), (5.1, 6.5, 0.34), composite, 0.025)
    box("Aft airlock header", (4.0, 5.45, 10.27), (3.6, 2.1, 0.55), alloy, 0.035)
    box("Aft airlock west jamb", (2.15, 2.25, 10.27), (0.25, 4.4, 0.55), alloy, 0.03)
    box("Aft airlock east jamb", (5.85, 2.25, 10.27), (0.25, 4.4, 0.55), alloy, 0.03)
    box("Airlock status lintel", (4.0, 4.48, 10.0), (2.8, 0.11, 0.15), amber, 0.025, "DETAIL")

    # Ribs align with bay seams, never the interactive spine plane.
    for z in (-9.55, -4.7, 0.1, 4.9, 9.55):
        box(f"West pressure rib {z}", (-10.42, 3.3, z), (0.34, 6.35, 0.24), alloy, 0.04, "BASE")
        box(f"East pressure rib {z}", (10.42, 3.3, z), (0.34, 6.35, 0.24), alloy, 0.04, "BASE")
        box(f"Ceiling pressure rib {z}", (0, 6.43, z), (20.45, 0.28, 0.24), alloy, 0.04, "BASE")
    for x in (-7.6, -3.8, 0, 3.8, 7.6):
        box(f"Ceiling service rail {x}", (x, 6.34, 0), (0.11, 0.12, 19.3), blue, 0.025, "DETAIL")

    box("Earthwatch research table", (0, 0.78, 0.2), (3.0, 0.16, 1.35), regolith, 0.08, "BASE")
    box("Earthwatch map glass", (0, 0.9, 0.2), (2.45, 0.05, 0.95), blue, 0.025, "DETAIL")
    for x in (-1.18, 1.18):
        box(f"Research table support {x}", (x, 0.39, 0.2), (0.16, 0.78, 0.82), alloy, 0.035, "BASE")
    box("Research table lower brace", (0, 0.22, 0.2), (2.32, 0.1, 0.12), alloy, 0.025, "BASE")
    for x in (-7.4, 7.4):
        box(f"Habitat practical {x}", (x, 6.05, 0.8), (1.7, 0.09, 0.28), amber, 0.025, "DETAIL")

    bays = [
        (-10.05, 0, -7.1, math.pi / 2, 4.1), (-10.05, 0, -2.3, math.pi / 2, 4.1),
        (-10.05, 0, 2.5, math.pi / 2, 4.1), (-10.05, 0, 7.3, math.pi / 2, 4.1),
        (10.05, 0, -7.1, -math.pi / 2, 4.1), (10.05, 0, -2.3, -math.pi / 2, 4.1),
        (10.05, 0, 2.5, -math.pi / 2, 4.1), (10.05, 0, 7.3, -math.pi / 2, 4.1),
        (-5.1, 0, 9.55, math.pi, 4.2),
    ]
    add_standard_anchors("lunar", bays, (0, 1.72, 7.8))
    add_collider("EARTHWATCH_TABLE", (-1.8, 1.8, -0.8, 1.2))


def build_arkship() -> None:
    alloy = pbr_material("Arkship Alloy", "Metal063", 0.27, 0.82)
    deck = pbr_material("Arkship Deck", "Concrete034", 0.58)
    dark = solid_material("Deep Hull", "#090f18", 0.35, 0.64)
    panel = solid_material("Warm Composite", "#25313b", 0.48, 0.28)
    copper = solid_material("Reading Copper", "#a86d3c", 0.28, 0.68)
    cyan = solid_material("Voyage Cyan", "#61c7da", 0.16, 0.12, "#4fb9ce", 2.0)
    amber = solid_material("Reading Amber", "#d69a52", 0.18, 0.12, "#cf8734", 2.4)
    glass = solid_material("Observation Pressure Glass", "#274b5a", 0.08, 0.06)

    # Arkship is an asymmetrical midships gallery, not another rectangular
    # habitat. The archive occupies the protected port side while a long
    # starboard observation wall exposes the vessel's exterior superstructure.
    box("Arkship library deck", (0, -0.08, 0), (21.5, 0.16, 27.8), deck, 0.008, uv_scale=1.15)
    box("Port pressure hull", (-10.72, 3.35, 0), (0.34, 6.7, 27.7), panel, 0.025, uv_scale=1.4)

    # A shallow barrel vault gives the room a long-distance ship silhouette.
    box("Port vaulted ceiling", (-5.35, 6.92, 0), (10.9, 0.24, 27.5), dark, 0.025, uv_scale=1.8, rotation=(0, 0, -0.075))
    box("Starboard vaulted ceiling", (5.35, 6.92, 0), (10.9, 0.24, 27.5), dark, 0.025, uv_scale=1.8, rotation=(0, 0, 0.075))
    for z in (-12.25, -6.15, 0, 6.05, 12.2):
        curve_tube(
            f"Vault pressure rib {z}",
            [(-10.35, 6.18, z), (-5.3, 7.25, z), (0, 7.48, z), (5.3, 7.25, z), (10.35, 6.18, z)],
            0.11,
            alloy,
            "BASE",
        )

    # The starboard ribbon window is a true opening with real 3D exterior hull
    # beyond it. Broad wall caps keep the opening believable at oblique angles.
    box("Starboard observation sill", (10.72, 0.43, -0.25), (0.36, 0.86, 27.2), alloy, 0.025)
    box("Starboard observation header", (10.72, 6.25, -0.25), (0.36, 1.5, 27.2), alloy, 0.025)
    box("Starboard forward window cap", (10.72, 3.25, -12.82), (0.36, 4.95, 2.1), panel, 0.025)
    box("Starboard aft window cap", (10.72, 3.25, 12.45), (0.36, 4.95, 2.65), panel, 0.025)
    for z in (-9.4, -4.7, 0, 4.7, 9.4):
        box(f"Observation mullion {z}", (10.62, 3.25, z), (0.2, 4.95, 0.18), alloy, 0.025, "DETAIL")
    box("Observation pressure glass", (10.82, 3.25, -0.25), (0.035, 4.92, 23.0), glass, 0.005, "DETAIL")

    # The forward end is a solid navigation bulkhead. Its live route display is
    # rendered at runtime; these pieces provide a deep, believable instrument bay.
    box("Forward navigation bulkhead", (0, 3.35, -13.82), (21.5, 6.7, 0.38), panel, 0.025, uv_scale=1.4)
    box("Forward navigation instrument well", (0, 3.62, -13.57), (9.5, 3.45, 0.2), dark, 0.035, "DETAIL")
    box("Forward navigation header", (0, 5.52, -13.43), (10.35, 0.24, 0.42), alloy, 0.035, "DETAIL")
    box("Forward navigation sill", (0, 1.7, -13.37), (10.35, 0.32, 0.52), alloy, 0.035, "DETAIL")
    box("Forward navigation console", (0, 1.34, -12.98), (8.85, 0.5, 0.92), dark, 0.045, "DETAIL")
    for x in (-5.18, 5.18):
        box(f"Forward navigation side tower {x}", (x, 3.55, -13.42), (0.7, 3.75, 0.48), alloy, 0.035, "DETAIL")
        box(f"Forward navigation side status {x}", (x, 3.7, -13.13), (0.34, 2.65, 0.08), amber if x < 0 else cyan, 0.015, "DETAIL")

    # The aft opening is deliberately broad and aligned with the runtime portal.
    # It reads as a pressure lock, not a narrow decorative doorway.
    box("Aft bulkhead port", (-4.6, 3.35, 13.82), (12.3, 6.7, 0.38), panel, 0.025)
    box("Aft bulkhead starboard", (8.85, 3.35, 13.82), (3.8, 6.7, 0.38), panel, 0.025)
    box("Aft transfer header", (4.25, 5.6, 13.66), (5.4, 2.1, 0.62), alloy, 0.035)
    box("Aft transfer port jamb", (1.55, 2.3, 13.58), (0.3, 4.5, 0.6), alloy, 0.03)
    box("Aft transfer starboard jamb", (6.95, 2.3, 13.58), (0.3, 4.5, 0.6), alloy, 0.03)
    box("Transfer status bar", (4.25, 4.48, 13.27), (4.25, 0.12, 0.18), cyan, 0.02, "DETAIL")
    box("Transfer pressure lintel", (4.25, 4.83, 13.36), (4.75, 0.12, 0.22), copper, 0.025, "DETAIL")
    for x in (-7.4, -3.8, -0.55, 8.7):
        box(f"Aft service panel {x}", (x, 3.2, 13.56), (2.25, 4.75, 0.18), dark, 0.025, "DETAIL")
        box(f"Aft service datum {x}", (x, 3.25, 13.43), (1.55, 0.08, 0.07), cyan if x < 0 else amber, 0.01, "DETAIL")
        box(f"Aft service datum upper {x}", (x, 4.15, 13.43), (1.05, 0.05, 0.07), alloy, 0.01, "DETAIL")

    # Continuous aisle lighting sits over circulation, never over shelf crowns.
    box("Archive amber ceiling line", (-7.45, 6.62, 0), (0.11, 0.07, 24.8), amber, 0.02, "BASE")
    box("Observation cyan ceiling line", (8.65, 6.62, 0), (0.11, 0.07, 23.4), cyan, 0.02, "BASE")
    box("Memory stack fore light", (0, 6.72, -5.2), (5.8, 0.06, 0.09), amber, 0.02, "BASE")
    box("Memory stack aft light", (0, 6.72, 4.4), (5.8, 0.06, 0.09), amber, 0.02, "BASE")

    # A compact astrogation mast beside the window replaces the luminous slab
    # that previously dominated circulation and read as unfinished geometry.
    cylinder("Astrogation mast base", (7.75, 0.18, 0), 0.72, 0.36, dark, 10, "BASE", bevel=0.04)
    cylinder("Astrogation mast", (7.75, 2.25, 0), 0.22, 4.05, alloy, 16, "BASE", bevel=0.02)
    cylinder("Astrogation lantern", (7.75, 4.45, 0), 0.34, 0.32, copper, 12, "DETAIL", bevel=0.025)
    torus("Astrogation orbit low", (7.75, 2.3, 0), 0.72, 0.035, cyan, "DETAIL", (math.pi / 2, 0.18, 0))
    torus("Astrogation orbit high", (7.75, 3.05, 0), 0.55, 0.03, amber, "DETAIL", (math.pi / 2, -0.32, 0))

    bays = [
        (-10.05, 0, -9.2, math.pi / 2, 4.15), (-10.05, 0, -3.1, math.pi / 2, 4.15),
        (-10.05, 0, 3.0, math.pi / 2, 4.15), (-10.05, 0, 9.1, math.pi / 2, 4.15),
        (0, 0, -4.82, 0, 4.4), (0, 0, -5.58, math.pi, 4.4),
        (0, 0, 4.78, 0, 4.4), (0, 0, 4.02, math.pi, 4.4),
        (-3.7, 0, 13.2, math.pi, 4.4),
    ]
    add_standard_anchors("arkship", bays, (0, 1.72, 10.8))
    add_collider("FORE_MEMORY_STACK", (-2.55, 2.55, -6.05, -4.35))
    add_collider("AFT_MEMORY_STACK", (-2.55, 2.55, 3.55, 5.25))
    add_collider("ASTROGATION_MAST", (7.0, 8.5, -0.8, 0.8))


def build_alexandria() -> None:
    write_alexandrian_papyrus_maps()
    limestone = pbr_material("Alexandrian Limestone", "Travertine009", 0.68)
    floor_limestone = pbr_material("Mouseion Floor Limestone", "Travertine009", 0.94)
    floor_bsdf = floor_limestone.node_tree.nodes.get("Principled BSDF")
    principled_input(floor_bsdf, "Coat Weight").default_value = 0.012
    principled_input(floor_bsdf, "Coat Roughness").default_value = 0.92
    marble = pbr_material("Ptolemaic Marble", "Marble012", 0.44)
    plaster = pbr_material("Sun Aged Plaster", "Plaster001", 0.82)
    cedar = pbr_material("Lebanese Cedar", "Wood051", 0.56)
    terracotta = pbr_material("Alexandrian Terracotta", "GlazedTerracotta001", 0.58)
    bronze = solid_material("Antique Bronze", "#b48a49", 0.3, 0.62)
    blue = solid_material("Egyptian Blue", "#174f76", 0.56)
    red = solid_material("Red Ochre", "#9c4f36", 0.72)
    dark = solid_material("Scroll Niche Shadow", "#21150f", 0.88)

    box("Mouseion limestone floor", (0, -0.08, 0), (23.5, 0.16, 22.2), floor_limestone, 0.008, uv_scale=1.35)
    box("Cedar coffered roof", (0, 7.55, 0.35), (23.4, 0.24, 21.5), cedar, 0.025, uv_scale=1.65)
    box("West plaster wall", (-11.58, 3.72, 0.35), (0.34, 7.45, 21.5), plaster, 0.025, uv_scale=2.1)
    box("East plaster wall", (11.58, 3.72, 0.35), (0.34, 7.45, 21.5), plaster, 0.025, uv_scale=2.1)
    # The runtime portal and both model tiers share one centered opening.
    # The old asymmetric returns covered the gate and fresco at x=0.
    entrance = json.loads((ROOT / "src/worlds/alexandriaArchitecture.json").read_text())
    return_width = entrance["wallHalfSpan"] - entrance["openingWidth"] / 2
    for side, label in ((-1, "west"), (1, "east")):
        x = entrance["centerX"] + side * (entrance["openingWidth"] / 2 + return_width / 2)
        box(f"South wall {label} return", (x, entrance["wallHeight"] / 2, entrance["wallZ"]),
            (return_width, entrance["wallHeight"], entrance["wallDepth"]), plaster, 0.025, uv_scale=2.1)
    lintel_height = entrance["wallHeight"] - entrance["openingHeight"]
    box("South doorway structural lintel", (entrance["centerX"], entrance["openingHeight"] + lintel_height / 2, entrance["wallZ"]),
        (entrance["openingWidth"] + 0.1, lintel_height, entrance["wallDepth"]), plaster, 0.025, uv_scale=2.1)

    # A true harbor loggia. The generated harbor vista sits well beyond these
    # columns, so walking laterally produces architectural parallax.
    box("Harbor parapet", (0, 0.52, -10.82), (23.2, 1.04, 0.38), limestone, 0.025)
    box("Harbor architrave", (0, 6.78, -10.62), (23.2, 0.42, 0.62), limestone, 0.035)
    box("Harbor blue frieze", (0, 7.08, -10.55), (22.6, 0.18, 0.16), blue, 0.02, "DETAIL")
    for index, x in enumerate((-10.2, -6.8, -3.4, 0, 3.4, 6.8, 10.2)):
        box(f"Harbor column plinth {index}", (x, 0.09, -10.35), (0.9, 0.18, 0.9), limestone, 0.025, "BASE")
        cylinder(f"Harbor column lower torus {index}", (x, 0.24, -10.35), 0.46, 0.22, marble, 32, "BASE", bevel=0.025)
        cylinder(f"Harbor column upper torus {index}", (x, 0.38, -10.35), 0.38, 0.15, marble, 32, "DETAIL", bevel=0.018)
        cylinder(f"Harbor column {index}", (x, 3.34, -10.35), 0.28, 5.92, marble, 32, "BASE", bevel=0.012)
        cylinder(f"Harbor column neck ring {index}", (x, 6.26, -10.35), 0.35, 0.16, marble, 32, "DETAIL", bevel=0.015)
        box(f"Papyrus capital {index}", (x, 6.46, -10.35), (0.78, 0.28, 0.78), bronze, 0.045, "DETAIL")
        box(f"Capital blue band {index}", (x, 6.29, -10.35), (0.62, 0.11, 0.62), blue, 0.018, "DETAIL")
        box(f"Harbor column abacus {index}", (x, 6.66, -10.35), (0.96, 0.14, 0.96), limestone, 0.025, "BASE")

    # Coffers and painted ceiling bands keep the high room visually finished.
    for x in (-9.3, -6.2, -3.1, 0, 3.1, 6.2, 9.3):
        box(f"Long cedar ceiling beam {x}", (x, 7.34, 0.15), (0.22, 0.34, 21.0), cedar, 0.03)
    for index, z in enumerate((-8.2, -5.1, -2.0, 1.1, 4.2, 7.3, 10.0)):
        box(f"Cross cedar ceiling beam {index}", (0, 7.31, z), (22.8, 0.4, 0.22), cedar, 0.03)
        if index % 2 == 0:
            box(f"Painted ceiling band {index}", (0, 7.08, z), (22.1, 0.055, 0.13), blue if index % 4 == 0 else red, 0.01, "DETAIL")

    # A mosaic route leads from the entrance to the catalogue and harbor.
    box("Processional mosaic blue", (0, 0.012, 1.0), (1.55, 0.025, 18.7), blue, 0.004, "DETAIL")
    box("Processional mosaic ivory", (0, 0.027, 1.0), (1.12, 0.026, 18.4), limestone, 0.004, "DETAIL")
    for z in (-7.9, -4.7, -1.5, 1.7, 4.9, 8.1):
        box(f"Mosaic cross band {z}", (0, 0.045, z), (4.8, 0.028, 0.12), red, 0.004, "DETAIL")

    # A compact Pinakes rotunda grounds the runtime Antikythera exhibit while
    # preserving broad circulation around the room. The former armillary,
    # stem, collar, rings, and axis must not be authored into this base model:
    # Alexandria's optimized material joins make those parts impossible to
    # remove reliably by node name at runtime.
    cylinder("Pinakes mosaic plinth", (0, 0.08, 0), 1.24, 0.16, limestone, 32, "BASE", bevel=0.025)
    cylinder("Pinakes cedar drum", (0, 0.42, 0), 0.92, 0.62, cedar, 32, "BASE", bevel=0.04)
    cylinder("Pinakes bronze foot band", (0, 0.16, 0), 0.99, 0.08, bronze, 32, "DETAIL", bevel=0.012)
    cylinder("Pinakes catalogue crown", (0, 0.79, 0), 1.08, 0.18, cedar, 32, "BASE", bevel=0.04)
    cylinder("Pinakes bronze crown band", (0, 0.86, 0), 1.11, 0.055, bronze, 32, "DETAIL", bevel=0.008)
    for index in range(8):
        angle = index * math.pi / 4
        radius = 0.935
        x = math.sin(angle) * radius
        z = math.cos(angle) * radius
        box(
            f"Pinakes drawer {index}",
            (x, 0.47, z),
            (0.5, 0.27, 0.055),
            terracotta,
            0.018,
            "DETAIL",
            rotation=(0, angle, 0),
        )
        cylinder(
            f"Pinakes drawer pull {index}",
            (math.sin(angle) * 0.97, 0.47, math.cos(angle) * 0.97),
            0.025,
            0.05,
            bronze,
            12,
            "DETAIL",
            rotation=(math.pi / 2, angle, 0),
        )
    for index, angle in enumerate((0, math.pi / 2, math.pi, 3 * math.pi / 2)):
        x = math.sin(angle) * 0.48
        z = math.cos(angle) * 0.48
        box(f"Pinakes catalogue tablet {index}", (x, 0.94, z), (0.68, 0.045, 0.4), terracotta, 0.02, "DETAIL", rotation=(-0.11, angle, 0))

    # Painted dado bands connect the nine runtime papyrus cabinets to the room.
    for x in (-11.36, 11.36):
        box(f"Side wall blue dado {x}", (x, 1.2, 0.35), (0.06, 0.2, 20.7), blue, 0.006, "DETAIL")
        box(f"Side wall ochre dado {x}", (x, 1.5, 0.35), (0.055, 0.08, 20.7), red, 0.006, "DETAIL")

    bays = [
        (-10.55, 0, -7.6, math.pi / 2, 4.15), (-10.55, 0, -2.4, math.pi / 2, 4.15),
        (-10.55, 0, 2.8, math.pi / 2, 4.15), (-10.55, 0, 8.0, math.pi / 2, 4.15),
        (10.55, 0, -7.6, -math.pi / 2, 4.15), (10.55, 0, -2.4, -math.pi / 2, 4.15),
        (10.55, 0, 2.8, -math.pi / 2, 4.15), (10.55, 0, 8.0, -math.pi / 2, 4.15),
        (entrance["rearShelfCenterX"], 0, 10.35, math.pi, 4.15),
    ]

    # Cabinet surrounds are authored here while the searchable scrolls remain
    # runtime instances. Deep mouldings, dentils, and bronze joinery give each
    # archive bay a furniture-scale silhouette without duplicating content.
    def cabinet_point(anchor, local_x: float, local_y: float, local_z: float):
        ax, ay, az, rotation_y, _ = anchor
        sin_y = math.sin(rotation_y)
        cos_y = math.cos(rotation_y)
        return (
            ax + local_x * cos_y + local_z * sin_y,
            ay + local_y,
            az - local_x * sin_y + local_z * cos_y,
        )

    for bay_index, anchor in enumerate(bays):
        _, _, _, rotation_y, bay_width = anchor
        for side in (-1, 1):
            x = side * (bay_width / 2 + 0.31)
            box(
                f"Papyrus cabinet {bay_index} carved stile {side}",
                cabinet_point(anchor, x, 3.02, -0.02),
                (0.34, 5.96, 0.88),
                cedar,
                0.055,
                "BASE",
                rotation=(0, rotation_y, 0),
                uv_scale=0.62,
            )
            box(
                f"Papyrus cabinet {bay_index} bronze stile inlay {side}",
                cabinet_point(anchor, x - side * 0.09, 3.12, 0.44),
                (0.035, 5.28, 0.045),
                bronze,
                0.008,
                "DETAIL",
                rotation=(0, rotation_y, 0),
            )
        for y, inset, depth in ((0.16, 0.0, 1.02), (0.34, 0.18, 0.9), (6.02, 0.0, 0.96), (6.25, 0.26, 0.72)):
            box(
                f"Papyrus cabinet {bay_index} moulding {y}",
                cabinet_point(anchor, 0, y, -0.02),
                (bay_width + 0.92 - inset, 0.24 if y in (0.16, 6.02) else 0.16, depth),
                cedar,
                0.045,
                "BASE" if y in (0.16, 6.02) else "DETAIL",
                rotation=(0, rotation_y, 0),
                uv_scale=0.7,
            )
    add_standard_anchors("alexandria", bays, (2.7, 1.72, 8.5))
    add_collider("PINAKES_ROTUNDA", (-1.28, 1.28, -1.28, 1.28))
    add_collider("ARCHIVE_DOORWAY", (-3.05, 3.05, 10.15, 11.13))


BUILDERS = {
    "heritage": build_heritage,
    "gothic": build_gothic,
    "modern": build_modern,
    "renaissance": build_renaissance,
    "deco": build_deco,
    "foundry": build_foundry,
    "lunar": build_lunar,
    "arkship": build_arkship,
    "alexandria": build_alexandria,
}


def export_glb(path: Path, include_detail: bool) -> None:
    detail = COLLECTIONS["DETAIL"]
    detail.hide_viewport = not include_detail
    detail.hide_render = not include_detail
    for obj in detail.all_objects:
        obj.hide_set(not include_detail)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_visible=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_attributes=True,
        export_extras=True,
        export_yup=True,
    )
    detail.hide_viewport = False
    detail.hide_render = False
    for obj in detail.all_objects:
        obj.hide_set(False)


def orient_scene_for_gltf() -> None:
    """Map app coordinates (X, Y-up, Z-depth) into Blender's Z-up space.

    Blender's glTF exporter then maps the rotated scene back to the app's
    expected Y-up basis. Keeping this as one authored root also makes the
    coordinate contract visible when the source .blend file is opened.
    """
    root = bpy.data.objects.new("WORLD_COORDINATE_ROOT", None)
    COLLECTIONS["BASE"].objects.link(root)
    # Fresh empties have unapplied dependency-graph transforms. Resolve them
    # before preserving world matrices during reparenting, or anchors collapse
    # to the origin even though their names and custom properties survive.
    bpy.context.view_layer.update()
    for obj in list(bpy.context.scene.objects):
        if obj is root or obj.parent is not None:
            continue
        world_matrix = obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = world_matrix
    root.rotation_euler[0] = math.pi / 2
    root["coordinateContract"] = "App X/Y-up/Z-depth"


def build_world(world: str) -> None:
    if world not in BUILDERS:
        raise ValueError(f"Unknown world: {world}")
    print(f"Building {world}...")
    reset_scene()
    BUILDERS[world]()
    orient_scene_for_gltf()
    bpy.context.scene["worldId"] = world
    bpy.context.scene["pipeline"] = "scripts/blender/build_worlds.py"
    bpy.context.scene["assetManifest"] = json.dumps(ASSET_MANIFEST, separators=(",", ":"))
    blend_path = SOURCE / f"{world}.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), compress=True)
    export_glb(OUTPUT / f"{world}-cinematic.raw.glb", True)
    export_glb(OUTPUT / f"{world}-lite.raw.glb", False)
    print(f"Built {world}: {len(bpy.data.objects)} objects, {len(bpy.data.materials)} materials")


for world_id in SELECTED_WORLDS:
    build_world(world_id)
