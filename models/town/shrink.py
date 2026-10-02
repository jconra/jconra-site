# Shrinks a Tripo .glb's embedded texture(s): writes <out>/<name>.glb with pictures at `size` px (JPEG), the
# geometry untouched. Used for the town: 2048 px for normal and gaming (models/town), 1024 for potato (models/town/lo).
#   python3 shrink.py <size> <out dir> <in.glb> [<in.glb> ...]
import json, struct, io, sys, os
from PIL import Image

def shrink(src, dst, size, quality=86):
    b = open(src, 'rb').read()
    assert b[:4] == b'glTF'
    jl = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + jl])
    off = 20 + jl; bl = struct.unpack('<I', b[off:off + 4])[0]; binc = b[off + 8: off + 8 + bl]
    views = j['bufferViews']
    imgs = {im['bufferView']: im for im in j.get('images', []) if 'bufferView' in im}
    # rebuild the binary chunk view by view, re-encoding the pictures
    out = bytearray(); new_views = []
    for vi, v in enumerate(views):
        data = binc[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
        if vi in imgs:
            im = Image.open(io.BytesIO(data)).convert('RGB')
            if max(im.size) > size: im = im.resize((size, size), Image.LANCZOS)
            buf = io.BytesIO(); im.save(buf, 'JPEG', quality=quality, optimize=True); data = buf.getvalue()
            imgs[vi]['mimeType'] = 'image/jpeg'
        while len(out) % 4: out += b'\0'
        nv = dict(v); nv['byteOffset'] = len(out); nv['byteLength'] = len(data); out += data; new_views.append(nv)
    while len(out) % 4: out += b'\0'
    j['bufferViews'] = new_views; j['buffers'][0]['byteLength'] = len(out)
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(dst, 'wb') as fh:
        fh.write(struct.pack('<4sII', b'glTF', 2, total)); fh.write(struct.pack('<I4s', len(js), b'JSON')); fh.write(js)
        fh.write(struct.pack('<I4s', len(out), b'BIN\0')); fh.write(out)

if __name__ == '__main__':
    size, outdir = int(sys.argv[1]), sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    for f in sys.argv[3:]:
        d = os.path.join(outdir, os.path.basename(f)); shrink(f, d, size)
        print(f'{os.path.basename(f):22} {os.path.getsize(f) / 1e6:5.1f} MB -> {os.path.getsize(d) / 1e6:5.2f} MB')
