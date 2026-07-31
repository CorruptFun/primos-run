#!/usr/bin/env python3
"""Render the app icons from the Primos brand mark.

    python3 scripts/make-logo-icons.py

Replaces the procedurally-drawn icons from make-icons.js with the real logo.
Two things this has to get right:

  * ANY vs MASKABLE are different pictures, not the same picture at two sizes.
    Android crops a maskable icon to whatever shape the launcher wants — a
    circle, a squircle, a rounded square — and only the middle ~80% (the safe
    zone) is guaranteed to survive. The logo is a full-bleed disc, so used
    maskable it gets its own edge shaved off. The maskable variant therefore
    sits the mark at 62% on a brand-coloured field with room to lose.

  * iOS ignores transparency on apple-touch-icon and composites it onto black,
    which haloes any soft edge. That one is flattened onto the brand colour
    here rather than left to chance.
"""

import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art', 'primos-logo.png')
BRAND = (26, 16, 36, 255)          # --bg / theme-color #1a1024

# name -> (size, mark scale within the canvas, flatten onto brand)
TARGETS = {
    'favicon.png':          (64,  1.00, False),
    'icon-192.png':         (192, 1.00, False),
    'icon-512.png':         (512, 1.00, False),
    'icon-maskable-512.png': (512, 0.62, True),
    'apple-touch-icon.png': (180, 0.90, True),
}


def render(src, size, scale, flatten):
    canvas = Image.new('RGBA', (size, size), BRAND if flatten else (0, 0, 0, 0))
    side = max(1, int(round(size * scale)))
    # LANCZOS: the mark is high-contrast line art and anything cheaper crawls
    # on the sunglasses and the bandana folds at favicon size.
    mark = src.resize((side, side), Image.LANCZOS)
    off = (size - side) // 2
    canvas.alpha_composite(mark, (off, off))
    return canvas


def main():
    src = Image.open(SRC).convert('RGBA')
    for name, (size, scale, flatten) in TARGETS.items():
        out = render(src, size, scale, flatten)
        if flatten:
            out = out.convert('RGB')          # no alpha for iOS
        path = os.path.join(ROOT, name)
        out.save(path, optimize=True)
        print('%-24s %4dpx  %s' % (name, size, 'flat' if flatten else 'alpha'))


if __name__ == '__main__':
    main()
