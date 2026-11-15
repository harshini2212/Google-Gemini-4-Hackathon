"""Bake the two accent-wall treatments from the original Matterport face."""

import sys
from pathlib import Path

import bpy


def srgb_to_linear(value):
    channel = value / 255
    return (channel / 12.92) if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


source, mask, destination = map(Path, sys.argv[sys.argv.index("--") + 1 :])
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.mesh.primitive_plane_add(size=2)
plane = bpy.context.object
material = bpy.data.materials.new("Paint preview")
plane.data.materials.append(material)
nodes = material.node_tree.nodes
links = material.node_tree.links
nodes.clear()
photo = nodes.new("ShaderNodeTexImage")
photo.image = bpy.data.images.load(str(source))
matte = nodes.new("ShaderNodeTexImage")
matte.image = bpy.data.images.load(str(mask))
matte.image.colorspace_settings.name = "Non-Color"
brightness = nodes.new("ShaderNodeRGBToBW")
links.new(photo.outputs["Color"], brightness.inputs["Color"])
tint = nodes.new("ShaderNodeMixRGB")
tint.blend_type = "MULTIPLY"
tint.inputs[0].default_value = 1
links.new(brightness.outputs[0], tint.inputs[1])
blend = nodes.new("ShaderNodeMixRGB")
links.new(matte.outputs["Color"], blend.inputs[0])
links.new(photo.outputs["Color"], blend.inputs[1])
links.new(tint.outputs[0], blend.inputs[2])
emission = nodes.new("ShaderNodeEmission")
links.new(blend.outputs[0], emission.inputs["Color"])
output = nodes.new("ShaderNodeOutputMaterial")
links.new(emission.outputs[0], output.inputs["Surface"])

bpy.ops.object.camera_add(location=(0, 0, 3))
scene = bpy.context.scene
scene.camera = bpy.context.object
scene.camera.data.type = "ORTHO"
scene.camera.data.ortho_scale = 2
scene.view_settings.view_transform = "Standard"
scene.render.engine = "CYCLES"
scene.cycles.samples = 1
scene.cycles.use_denoising = False
scene.render.resolution_x = scene.render.resolution_y = 1400
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"

for name, color in {"sage": (129, 149, 118), "clay": (188, 130, 110)}.items():
    gray = srgb_to_linear(160)
    tint.inputs[2].default_value = (*[srgb_to_linear(c) / gray for c in color], 1)
    scene.render.filepath = str(destination / f"{name}-4.png")
    bpy.ops.render.render(write_still=True)
