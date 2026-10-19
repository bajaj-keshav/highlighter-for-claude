#!/usr/bin/env python3
"""Draw the extension icons (no extra packages needed).

Run: python3 scripts/make_icons.py
"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "extension", "icons")
SIZES = [16, 32, 48, 128]
SS = 4  # supersampling for smooth edges

BG = (38, 38, 36)         # dark rounded square
LINE = (232, 230, 220)    # text lines
MARK = (250, 204, 21)     # highlighter yellow
INK = (38, 38, 36)        # text on the yellow band


def rounded_rect(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def color_at(u, v):
    """u, v in 0..1. Returns an RGB tuple or None (transparent)."""
    if not rounded_rect(u, v, 0.0, 0.0, 1.0, 1.0, 0.22):
        return None
    # Yellow highlight band behind the middle line.
    if rounded_rect(u, v, 0.14, 0.39, 0.86, 0.61, 0.05):
        if rounded_rect(u, v, 0.22, 0.465, 0.70, 0.535, 0.035):
            return INK
        return MARK
    # Top and bottom text lines.
    if rounded_rect(u, v, 0.22, 0.225, 0.78, 0.295, 0.035):
        return LINE
    if rounded_rect(u, v, 0.22, 0.705, 0.62, 0.775, 0.035):
        return LINE
    return BG


def render(size):
    rows = []
    n = size * SS
    for py in range(size):
        row = bytearray([0])  # filter: none
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    c = color_at((px * SS + sx + 0.5) / n, (py * SS + sy + 0.5) / n)
                    if c:
                        r += c[0]; g += c[1]; b += c[2]; a += 1
            if a:
                row += bytes([r // a, g // a, b // a, round(255 * a / (SS * SS))])
            else:
                row += bytes(4)
        rows.append(bytes(row))
    return b"".join(rows)


def png(size, raw):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for s in SIZES:
        path = os.path.join(OUT, f"icon{s}.png")
        with open(path, "wb") as f:
            f.write(png(s, render(s)))
        print("wrote", os.path.normpath(path))
