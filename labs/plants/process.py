# PLANT LAB: split each Tripo plant sheet (a 3x3 wall of plants) into its plants, stand each on the
# ground, and write clean-up versions for comparison:
#   raw       as Tripo made it
#   weld      vertices at the same spot merged (within 0.001 mm: wider glued thin leaves' top and bottom together) (Merge by Distance: Tripo splits along seams). Tripo
#             makes leaves double-layered (two faces back to back), so this alone breaks their shading
#   fixed     weld, then every face of a surface turned to face the same way (Tripo's aren't, which is
#             what blackens a welded leaf), shading smoothed only across angles under 35 deg; two-sided
#   planar    fixed, then faces lying flat together merged (Decimate Planar, 5 deg, keeping UV seams)
#   tri600 / tri300   planar, then shrunk to ~600 / ~300 triangles (Decimate Collapse)
# Each version of a sheet is one .gltf (all 9 plants, named) sharing one 2K texture; counts go in
# manifest.json.
import bpy, bmesh, json, math, os, sys
IN = r'C:\Users\bitwizard\AppData\Local\Temp\plantlab\in'
OUT = r'C:\Users\bitwizard\AppData\Local\Temp\plantlab\out'
SHEETS = {
  'grassesLow': ['bunchgrass', 'reeds', 'dry grass', 'broad-leaf hosta', 'clover', 'wild strawberry', 'dandelion', 'plantain', 'purple-top grass'],
  'flowers': ['lupine', 'paintbrush', 'yarrow', 'columbine', 'thistle', 'yucca', 'snowdrops', 'violets', 'marsh marigold'],
  'shrubs': ['sagebrush', 'low juniper', 'sprig shrub', 'wild rose', 'spruce sapling', 'cattails', 'flowering shrub', 'grass clump', 'leafy shrub'],
  'longGrass': ['feather grass', 'broad-blade grass', 'golden wheatgrass', 'silver plume grass', 'tall seed grass', 'oat grass', 'purple plume grass', 'timothy grass', 'mixed plume grass'],
}
VERSIONS = ['tri900', 'tri600', 'tri300']   # every one: weld, fixed, planar, then shrunk toward its count
def tris(ob):
    me = ob.data; return sum(len(p.vertices) - 2 for p in me.polygons)
def clear():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
    for d in (bpy.data.meshes, bpy.data.materials, bpy.data.images): [d.remove(x) for x in list(d) if x.users == 0]
# optional: only some sheets (blender ... -P process.py -- longGrass), merged into an existing manifest
ONLY = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
mpath = os.path.join(OUT, 'manifest.json')
manifest = json.load(open(mpath)) if ONLY and os.path.exists(mpath) else {}
for sheet, names in SHEETS.items():
    if ONLY and sheet not in ONLY: continue
    print('sheet', sheet, flush=True)
    manifest[sheet] = {'plants': names, 'counts': {}}
    for ver in VERSIONS:
        clear()
        bpy.ops.import_scene.gltf(filepath=os.path.join(IN, sheet + '.glb'))
        src = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
        bpy.ops.object.select_all(action='DESELECT'); src.select_set(True); bpy.context.view_layer.objects.active = src
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        xs = [v.co.x for v in src.data.vertices]; zs = [v.co.z for v in src.data.vertices]
        x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
        # each plant: the faces whose middle lies in its cell (columns across x, rows down z), picked
        # fresh each time in edit mode (face numbers change as plants are split off)
        cellOf = lambda c: min(2, max(0, int((z1 - c.z) / (z1 - z0) * 3))) * 3 + min(2, max(0, int((c.x - x0) / (x1 - x0) * 3)))
        plants = []
        for n in range(9):
            bpy.ops.object.select_all(action='DESELECT'); src.select_set(True); bpy.context.view_layer.objects.active = src
            bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_mode(type='FACE'); bpy.ops.mesh.select_all(action='DESELECT')
            bm = bmesh.from_edit_mesh(src.data); any_ = False
            for f in bm.faces:
                if cellOf(f.calc_center_median()) == n: f.select_set(True); any_ = True
            bmesh.update_edit_mesh(src.data)
            if any_: bpy.ops.mesh.separate(type='SELECTED')
            bpy.ops.object.mode_set(mode='OBJECT')
            if not any_: print('empty cell', sheet, n, flush=True); continue
            new = [o for o in bpy.context.selected_objects if o is not src][-1]; new.name = f'{n}:{names[n]}'; plants.append(new)
        bpy.data.objects.remove(src)
        counts = []; raw = []
        for ob in plants:
            raw.append({'tris': tris(ob), 'verts': len(ob.data.vertices)})
            me = ob.data
            # stand it on the ground, centred
            xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
            cx, cy, zmin = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)
            for v in me.vertices: v.co.x -= cx; v.co.y -= cy; v.co.z -= zmin
            bm = bmesh.new(); bm.from_mesh(me)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.000001)
            if True:                    # every face of a surface facing the same way, shaded smooth
                bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
                for f in bm.faces: f.smooth = True
            bm.to_mesh(me); bm.free()
            me.use_auto_smooth = True; me.auto_smooth_angle = math.radians(35)   # creases sharper than 35 deg stay crisp
            bpy.context.view_layer.objects.active = ob
            print('  plant', ob.name, tris(ob), 'welded', flush=True)
            if True:
                m = ob.modifiers.new('planar', 'DECIMATE'); m.decimate_type = 'DISSOLVE'; m.angle_limit = math.radians(5); m.delimit = {'UV'}; bpy.ops.object.modifier_apply(modifier='planar')
            # back to triangles before shrinking: the flattening leaves big many-sided faces, and shrinking
            # those crashed Blender 4.0 on one plant (it asked for 25 GB)
            bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
            print('  planar done', tris(ob), flush=True)
            if True:
                target = int(ver[3:]); t = tris(ob)
                if t > target:
                    m = ob.modifiers.new('collapse', 'DECIMATE'); m.ratio = target / t; m.use_collapse_triangulate = True; bpy.ops.object.modifier_apply(modifier='collapse')
            # x spread so the sheet still reads as a row of plants in a viewer; the lab places them itself
            ob.location.x = n * 0.4
            counts.append({'tris': tris(ob), 'verts': len(me.vertices)})
        manifest[sheet]['counts'][ver] = counts; manifest[sheet]['counts']['raw'] = raw
        for mat in bpy.data.materials: mat.use_backface_culling = False   # two-sided (glTF doubleSided)
        for img in bpy.data.images:
            if img.size[0] > 2048: img.scale(2048, 2048)
            img.name = sheet; img.file_format = 'JPEG'
        os.makedirs(os.path.join(OUT, sheet), exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, sheet, ver + '.gltf'), export_format='GLTF_SEPARATE', export_image_format='JPEG', export_jpeg_quality=85, export_apply=True)
        print('done', sheet, ver, sum(c['tris'] for c in counts), flush=True)
json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
print('ALL DONE', flush=True)
