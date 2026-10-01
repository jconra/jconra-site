# GROUND-PLANT SHEET: the 16 plants Jacob picked in the Plant Lab, cut from their Tripo sheets with the
# same clean-up as labs/plants/process.py (weld, faces one way, flat faces merged, back to triangles,
# shrunk toward the picked count, thinned unless the pick says not to), laid out as a 4 x 4 wall (x
# across, z up, each standing in its cell) and baked onto ONE shared 2K texture: a fresh UV layout for
# all 16, then each plant's own picture copied across through its old layout (Cycles, Emit bake).
import bpy, bmesh, json, math, os, random
T = r'C:\Users\bitwizard\AppData\Local\Temp\plantlab'
picks = json.load(open(os.path.join(T, 'picks.json')))['picks']
CELL, ROW = 0.5, 1.0                               # a cell's width and a row's height, far more than any plant: the lab
                                                   # splits the sheet by these fixed sizes (cell = floor(x / 0.5), row = 3 - floor(y / 1.0))
def tris(ob): return sum(len(p.vertices) - 2 for p in ob.data.polygons)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
sheets = {}
def cut(sheet, n):
    """plant n of a sheet as its own object, standing at the origin"""
    if sheet not in sheets:
        before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=os.path.join(T, 'in', sheet + '.glb'))
        src = [o for o in bpy.data.objects if o not in before and o.type == 'MESH'][0]
        bpy.ops.object.select_all(action='DESELECT'); src.select_set(True); bpy.context.view_layer.objects.active = src
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True); src.hide_set(True); sheets[sheet] = src
    src = sheets[sheet]; src.hide_set(False)
    xs = [v.co.x for v in src.data.vertices]; zs = [v.co.z for v in src.data.vertices]; x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    cellOf = lambda c: min(2, max(0, int((z1 - c.z) / (z1 - z0) * 3))) * 3 + min(2, max(0, int((c.x - x0) / (x1 - x0) * 3)))
    ob = src.copy(); ob.data = src.data.copy(); bpy.context.collection.objects.link(ob); src.hide_set(True)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if cellOf(f.calc_center_median()) != n], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(ob.data); bm.free()
    me = ob.data; xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    cx, cy, zmin = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)
    for v in me.vertices: v.co.x -= cx; v.co.y -= cy; v.co.z -= zmin
    return ob
def clean(ob, target, thin=True):
    me = ob.data; bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.000001); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces: f.smooth = True
    bm.to_mesh(me); bm.free(); me.use_auto_smooth = True; me.auto_smooth_angle = math.radians(35)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    m = ob.modifiers.new('planar', 'DECIMATE'); m.decimate_type = 'DISSOLVE'; m.angle_limit = math.radians(5); m.delimit = {'UV'}; bpy.ops.object.modifier_apply(modifier='planar')
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    t = tris(ob)
    if t > target:
        m = ob.modifiers.new('collapse', 'DECIMATE'); m.ratio = target / t; m.use_collapse_triangulate = True; bpy.ops.object.modifier_apply(modifier='collapse')
    if thin and tris(ob) > target * 1.08:
        bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table(); seen, islands = set(), []
        for f in bm.faces:
            if f.index in seen: continue
            stack, isl = [f], []; seen.add(f.index)
            while stack:
                g = stack.pop(); isl.append(g)
                for e in g.edges:
                    for h in e.link_faces:
                        if h.index not in seen: seen.add(h.index); stack.append(h)
            islands.append(isl)
        random.seed(len(islands))
        def reach(isl):
            vs = [v.co for f in isl for v in f.verts]
            return sum((max(getattr(v, a) for v in vs) - min(getattr(v, a) for v in vs)) ** 2 for a in 'xyz')
        islands.sort(key=lambda isl: (reach(isl), random.random()))
        total = sum(len(f.verts) - 2 for f in bm.faces); gone = []
        for isl in islands[:-1]:
            if total <= target: break
            gone.extend(isl); total -= sum(len(f.verts) - 2 for f in isl)
        bmesh.ops.delete(bm, geom=gone, context='FACES'); bm.to_mesh(me); bm.free()
plants = []
for p in picks:
    ob = cut(p['sheet'], p['plant']); clean(ob, int(p['version'][3:]), p.get('thin', True))
    c = p['cell'] - 1; ob.location = ((c % 4 + 0.5) * CELL, 0, (3 - c // 4) * ROW + 0.01); ob.name = f"{c}:{p['name']}"
    plants.append(ob); print('plant', ob.name, tris(ob), flush=True)
for s in sheets.values(): bpy.data.objects.remove(s)
# one object, a fresh UV layout over all 16 (their old layouts kept, to read the pictures through)
bpy.ops.object.select_all(action='DESELECT')
for ob in plants: ob.select_set(True)
bpy.context.view_layer.objects.active = plants[0]; bpy.ops.object.transform_apply(location=True); bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active; ob.name = 'groundPlants'; me = ob.data
old = me.uv_layers[0].name; new = me.uv_layers.new(name='atlas'); me.uv_layers.active = new
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003); bpy.ops.uv.pack_islands(margin=0.003)
bpy.ops.object.mode_set(mode='OBJECT')
img = bpy.data.images.new('groundPlants', 2048, 2048, alpha=False)
for mat in me.materials:                             # each source material: its picture through the OLD layout, emitted; the target picked
    nt = mat.node_tree; tex = next(n for n in nt.nodes if n.type == 'TEX_IMAGE')
    uv = nt.nodes.new('ShaderNodeUVMap'); uv.uv_map = old; nt.links.new(uv.outputs['UV'], tex.inputs['Vector'])
    em = nt.nodes.new('ShaderNodeEmission'); nt.links.new(tex.outputs['Color'], em.inputs['Color'])
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'); nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    tgt = nt.nodes.new('ShaderNodeTexImage'); tgt.image = img; nt.nodes.active = tgt
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 1
sc.render.bake.margin = 64;   # fills the gaps between pieces with their edge colour, so a plant seen small (a coarse mip) has no black in it sc.render.bake.use_selected_to_active = False
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
bpy.ops.object.bake(type='EMIT'); print('baked', flush=True)
img.filepath_raw = os.path.join(T, 'groundPlants.jpg'); img.file_format = 'JPEG'; sc.render.image_settings.quality = 90; img.save()
# one plain material on the new layout; the old layout goes
mat = bpy.data.materials.new('groundPlants'); mat.use_nodes = True; mat.use_backface_culling = False
bsdf = mat.node_tree.nodes['Principled BSDF']; bsdf.inputs['Roughness'].default_value = 0.9
tx = mat.node_tree.nodes.new('ShaderNodeTexImage'); tx.image = img; mat.node_tree.links.new(tx.outputs['Color'], bsdf.inputs['Base Color'])
me.materials.clear(); me.materials.append(mat)
me.uv_layers.remove(me.uv_layers[old]); me.uv_layers['atlas'].name = 'UVMap'
bpy.ops.export_scene.gltf(filepath=os.path.join(T, 'groundPlants.glb'), export_format='GLB', export_image_format='JPEG', export_jpeg_quality=90, use_selection=True)
print('SHEET DONE', tris(ob), flush=True)
