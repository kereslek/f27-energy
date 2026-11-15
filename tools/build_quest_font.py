from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
import copy, sys

f = TTFont('LilitaOne-Regular.ttf')
glyf, hmtx, gs = f['glyf'], f['hmtx'], f.getGlyphSet()

def contours(name):
    """a glifa kontúrjai pontlistaként (TrueType: on/off-curve pontok)"""
    g = glyf[name]
    coords, ends, flags = g.getCoordinates(glyf)
    out, s = [], 0
    for e in ends:
        out.append((list(coords[s:e + 1]), list(flags[s:e + 1]))); s = e + 1
    return out

def accent_of(name):
    cs = contours(name)
    acc = max(cs, key=lambda c: min(p[1] for p in c[0]))   # a legmagasabbra eső kontúr a vessző
    return acc

def build(dst, base, acute_src, gap):
    base_cs = contours(base)
    acc_pts, acc_fl = accent_of(acute_src)
    xs = [p[0] for p in acc_pts]; cx = (min(xs) + max(xs)) / 2; w = max(xs) - min(xs)
    # két vessző: kicsit keskenyebbek (0,82), egymás mellett, a gyári vessző közepe körül
    sc = 0.82
    def tr(p, dx):
        return (round(cx + (p[0] - cx) * sc + dx), p[1])
    d = w * sc * 0.5 + gap
    newcs = base_cs + [([tr(p, -d) for p in acc_pts], acc_fl), ([tr(p, d) for p in acc_pts], acc_fl)]
    from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphCoordinates
    g = Glyph(); g.numberOfContours = len(newcs)
    pts, ends, fl = [], [], []
    for c, flg in newcs:
        pts += c; fl += [x & 1 for x in flg]; ends.append(len(pts) - 1)
    g.coordinates = GlyphCoordinates(pts); g.endPtsOfContours = ends; g.flags = bytearray(fl); g.program = None
    from fontTools.ttLib.tables import ttProgram
    g.program = ttProgram.Program(); g.program.fromBytecode(b'')
    g.recalcBounds(glyf)
    glyf[dst] = g
    hmtx[dst] = (hmtx[base][0], g.xMin)
    return dst

order = f.getGlyphOrder()
new = [('ohungarumlaut', 'o', 'oacute', 0x151, 18), ('uhungarumlaut', 'u', 'uacute', 0x171, 18),
       ('Ohungarumlaut', 'O', 'Oacute', 0x150, 22), ('Uhungarumlaut', 'U', 'Uacute', 0x170, 22)]
for dst, base, src, cp, gap in new:
    if dst not in order: order.append(dst)
f.setGlyphOrder(order)
for dst, base, src, cp, gap in new:
    build(dst, base, src, gap)
    for t in f['cmap'].tables:
        if t.isUnicode(): t.cmap[cp] = dst
if 'post' in f and hasattr(f['post'], 'extraNames'):
    pass
f['maxp'].numGlyphs = len(order)
if 'DSIG' in f: del f['DSIG']
# név: a Reserved Font Name ("Lilita") miatt a módosított változat más nevet kap (OFL 1.1, 3. pont)
for rec in f['name'].names:
    if rec.nameID in (1, 4, 16, 21): rec.string = 'Quest Display'
    elif rec.nameID == 6: rec.string = 'QuestDisplay-Regular'
    elif rec.nameID == 3: rec.string = 'QuestDisplay-Regular-HU-2026'
    elif rec.nameID == 5: rec.string = 'Version 1.000; Lilita One + Hungarian double acute (F27 Energy, 2026)'
f.save('QuestDisplay-Regular.ttf')
f.flavor = 'woff2'; f.save('QuestDisplay-Regular.woff2')
print('kész', len(order))
