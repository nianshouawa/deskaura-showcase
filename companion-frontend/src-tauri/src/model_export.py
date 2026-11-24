"""Trusted scenes only: disabling script execution is not an OS sandbox."""
import sys
if '--' in sys.argv:
    import bpy
    source, target = sys.argv[sys.argv.index('--') + 1:]
    bpy.ops.wm.open_mainfile(filepath=source, load_ui=False, use_scripts=False)
    bpy.ops.export_scene.gltf(filepath=target, export_format='GLB', export_animations=False)
else:
    import maya.standalone
    maya.standalone.initialize(name='python')
    try:
        from maya import cmds
        source, target = sys.argv[1:]
        cmds.file(source, open=True, force=True, prompt=False, executeScriptNodes=False)
        cmds.loadPlugin('fbxmaya', quiet=True)
        cmds.file(target, force=True, type='FBX export', exportAll=True, options='v=0;')
    finally:
        maya.standalone.uninitialize()
