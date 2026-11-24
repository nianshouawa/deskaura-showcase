"""Create only a disposable, synthetic Blender test scene at an explicit target."""
import sys
import bpy
target = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
bpy.ops.wm.save_as_mainfile(filepath=target)
