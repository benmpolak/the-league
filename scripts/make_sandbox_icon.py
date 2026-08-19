"""Build the SANDBOX crest from the real one: no build step, no dependencies.

The two sites serve identical files from the same repo, so the practice league
had the same name and the same crest as the real one and nobody could tell the
installed apps apart. This tints the crest cyan and frames it, so the sandbox
reads as the sandbox from the home screen.
"""
import struct, zlib, sys, os

ROOT = '/home/user/the-league'


def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', 'not a png'
    pos, idat = 8, b''
    w = h = None
    while pos < len(d):
        ln = struct.unpack('>I', d[pos:pos + 4])[0]
        typ = d[pos + 4:pos + 8]
        body = d[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, bd, ct, cm, fl, il = struct.unpack('>IIBBBBB', body)
            assert (bd, ct, il) == (8, 6, 0), 'expect 8-bit RGBA, non-interlaced'
        elif typ == b'IDAT':
            idat += body
        elif typ == b'IEND':
            break
        pos += 12 + ln
    raw = zlib.decompress(idat)
    # undo per-scanline filters
    stride = w * 4
    out = bytearray(w * h * 4)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if f == 1:
            for i in range(4, stride):
                line[i] = (line[i] + line[i - 4]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                c = prev[i - 4] if i >= 4 else 0
                b = prev[i]
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, out


def write_png(path, w, h, px):
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)  # filter: none — these are small, clarity beats bytes
        raw += px[y * stride:(y + 1) * stride]
    def chunk(typ, body):
        return (struct.pack('>I', len(body)) + typ + body
                + struct.pack('>I', zlib.crc32(typ + body) & 0xffffffff))
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    open(path, 'wb').write(png)


def tint(w, h, px):
    """Gold -> cyan, and a hard cyan frame round the edge."""
    out = bytearray(px)
    for i in range(0, len(out), 4):
        r, g, b = out[i], out[i + 1], out[i + 2]
        # the crest is gold on near-black: rotate the warm channels to cool ones
        out[i] = b if b > r else int(r * 0.35)
        out[i + 1] = g
        out[i + 2] = max(r, g)
    band = max(3, w // 22)
    for y in range(h):
        for x in range(w):
            edge = x < band or y < band or x >= w - band or y >= h - band
            if not edge:
                continue
            i = (y * w + x) * 4
            out[i], out[i + 1], out[i + 2], out[i + 3] = 34, 224, 210, 255
    return out


def halve(w, h, px, times=1):
    """Box-average downscale by 2, repeated. 512 -> 256 -> 128 is exact."""
    for _ in range(times):
        nw, nh = w // 2, h // 2
        out = bytearray(nw * nh * 4)
        for y in range(nh):
            for x in range(nw):
                acc = [0, 0, 0, 0]
                for dy in (0, 1):
                    for dx in (0, 1):
                        i = ((y * 2 + dy) * w + (x * 2 + dx)) * 4
                        for c in range(4):
                            acc[c] += px[i + c]
                o = (y * nw + x) * 4
                for c in range(4):
                    out[o + c] = acc[c] // 4
        w, h, px = nw, nh, out
    return w, h, px


def resize_to(w, h, px, target):
    """Nearest-neighbour to an exact target (only used for 512 -> 192)."""
    out = bytearray(target * target * 4)
    for y in range(target):
        sy = y * h // target
        for x in range(target):
            sx = x * w // target
            i = (sy * w + sx) * 4
            o = (y * target + x) * 4
            out[o:o + 4] = px[i:i + 4]
    return target, target, out


src = os.path.join(ROOT, 'icons', 'icon-512.png')
w, h, px = read_png(src)
print('read', w, h)
sw, sh, spx = w, h, tint(w, h, px)
write_png(os.path.join(ROOT, 'icons', 'icon-sandbox-512.png'), sw, sh, spx)
# 512 -> 256 by box average, then 256 -> 192 nearest: keeps edges crisp
w2, h2, p2 = halve(sw, sh, spx, 1)
w3, h3, p3 = resize_to(w2, h2, p2, 192)
write_png(os.path.join(ROOT, 'icons', 'icon-sandbox-192.png'), w3, h3, p3)
print('wrote sandbox icons')
