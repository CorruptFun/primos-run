#!/usr/bin/env python3
"""
Generate game art with Gemini, chroma-key it, and write trimmed PNGs.

    source ~/.gemini_env && python3 scripts/gen_art.py parts
    source ~/.gemini_env && python3 scripts/gen_art.py props
    source ~/.gemini_env && python3 scripts/gen_art.py --only torso

The API only returns JPEG, so every asset is generated on a pure chroma-green
field and keyed out here. JPEG ringing around the edges is why this does a
despill pass and an alpha erode rather than a plain colour==key test.

Writes:
    art/<name>.png          trimmed RGBA cutout
    art/manifest.json       size + pivot for each asset, consumed by the rig
    art/raw/<name>.jpg      unmodified generation, for eyeballing
"""

import base64
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "art"
RAW = ART / "raw"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"
MODEL = "gemini-3-pro-image"
KEY_RGB = (0, 255, 0)

# Every prompt ends with this so the keyer has something clean to work with.
CHROMA = (
    " The subject is fully isolated and centred, occupying most of the frame, "
    "on a completely flat pure chroma-key green background (hex #00FF00) with "
    "no gradient, no shadow cast onto the background, no vignette and no props. "
    "Nothing in the subject itself may be green."
)

STYLE = (
    "3D ANIMATED CHARACTER style, like a Pixar or DreamWorks feature film asset. "
    "Chunky simplified cartoon proportions, smooth clean rounded surfaces, soft "
    "global illumination, warm low-sun key light from behind and above, cool "
    "purple ambient fill, clean readable silhouette. STYLISED, NOT photoreal and "
    "NOT anatomically realistic — no visible veins, no muscle striations, no skin "
    "pores, no fabric micro-detail. Bold simple forms that read at small size. "
    "No text, no watermark, no outline stroke."
)

# Chicano / East LA barrio character, matching the Primos collection's wardrobe.
BODY = (
    "The character is a stylised cartoon Chicano street runner from East Los "
    "Angeles — chunky animated-film proportions with a big head and a small "
    "compact body — wearing a short-sleeve blue-and-white plaid Pendleton "
    "flannel, dark indigo jeans, and white Cortez-style sneakers with a red "
    "stripe. Warm brown skin, smooth and simplified."
)

PARTS = [
    ("torso", "3:4",
     f"{STYLE} A single isolated game-asset piece: ONLY the TORSO of {BODY} "
     "Seen from DIRECTLY BEHIND — you are looking at the unbroken BACK PANEL of "
     "the plaid shirt. No collar opening, no buttons, no white t-shirt visible, "
     "no face, no chest. Just the back of the shirt from the shoulder seam down "
     "to the hem, with short flannel sleeve caps covering the top of each "
     "shoulder and a small band of white t-shirt collar at the very top. "
     "Absolutely no head, no neck stump, no bare arms, no legs, no hips or "
     "jeans below the hem. The shirt hangs with soft natural fabric folds." + CHROMA),

    ("upperarm", "1:1",
     f"{STYLE} A single isolated game-asset piece: ONLY a bare human UPPER ARM "
     "segment (bicep, from just below a shirt sleeve down to the elbow), warm "
     "brown skin, athletic, slightly tapered, rounded at both ends, oriented "
     "vertically with the shoulder end at the top. No hand, no forearm, no "
     "clothing, no body." + CHROMA),

    ("forearm", "1:1",
     f"{STYLE} A single isolated game-asset piece: ONLY a bare human FOREARM "
     "with a loosely clenched running fist at the bottom, warm brown skin, "
     "athletic, oriented vertically with the elbow end at the top. No upper arm, "
     "no clothing, no body." + CHROMA),

    ("thigh", "1:1",
     "%s A single isolated game-asset piece: ONLY a THIGH segment of dark indigo "
     "denim jeans, from hip to knee, oriented vertically with the hip end at the "
     "top, visible denim weave, a stitched outseam and soft fabric folds. No "
     "knee joint detail, no shin, no shoe, no body." % STYLE + CHROMA),

    ("shin", "1:1",
     "%s A single isolated game-asset piece: ONLY a SHIN segment of dark indigo "
     "denim jean leg, from knee to ankle, oriented vertically with the knee end "
     "at the top, with a cuff at the bottom. No shoe, no foot, no thigh, no "
     "body." % STYLE + CHROMA),

    ("shoe", "1:1",
     "%s A single isolated game-asset piece: ONLY one white Nike Cortez sneaker "
     "with a red swoosh stripe, cream midsole and gum outsole, in strict SIDE "
     "PROFILE view facing right, laces visible. No foot, no leg, no ankle." % STYLE
     + CHROMA),
]

PROPS = [
    ("dumpster", "1:1",
     f"{STYLE} A battered dark green metal dumpster in a Los Angeles alley, lid "
     "propped half open, graffiti tag on the side, seen from a low three-quarter "
     "rear angle as if you are running toward it." + CHROMA),

    ("barricade", "1:1",
     f"{STYLE} A police checkpoint barricade: a white and red diagonally striped "
     "wooden A-frame road barricade with a blue police sign board and a small "
     "red-and-blue flashing light bar on top, plus one orange traffic cone beside "
     "it. Seen straight on from the front." + CHROMA),

    ("borderwall", "1:1",
     f"{STYLE} A section of tall rusted steel bollard border wall: thick vertical "
     "weathered rust-brown steel slats with narrow gaps, a horizontal steel cap "
     "rail across the top, set in a concrete footing. Seen straight on." + CHROMA),

    ("copcar", "1:1",
     f"{STYLE} A black and white Los Angeles police cruiser with a red and blue "
     "light bar, seen from directly BEHIND, parked. Slightly stylised, chunky "
     "game-asset proportions." + CHROMA),

    ("beer", "1:1",
     f"{STYLE} A single ice-cold amber glass beer bottle with a gold cap and a "
     "colourful Mexican-style label, condensation on the glass, floating upright, "
     "glowing warmly like a collectible pickup in a game." + CHROMA),

    ("taco", "1:1",
     f"{STYLE} A single delicious street taco in a folded corn tortilla, filled "
     "with carne asada, chopped white onion, fresh green cilantro and red salsa, "
     "floating, glowing warmly like a collectible pickup in a game." + CHROMA),
]

GROUPS = {"parts": PARTS, "props": PROPS}


def generate(prompt: str, aspect: str, tries: int = 3) -> bytes:
    body = json.dumps({
        "model": MODEL,
        "input": [{"type": "text", "text": prompt}],
        "response_format": {
            "type": "image",
            "mime_type": "image/jpeg",
            "aspect_ratio": aspect,
            "image_size": "2K",
        },
    }).encode()

    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY not set — run: source ~/.gemini_env")

    # Shelling out to curl rather than urllib: this Python has no configured CA
    # bundle, and curl already uses the system trust store.
    last = None
    for attempt in range(tries):
        with tempfile.NamedTemporaryFile("wb", suffix=".json", delete=False) as fh:
            fh.write(body)
            body_path = fh.name
        try:
            proc = subprocess.run(
                ["curl", "-sS", "--max-time", "300", "-X", "POST", ENDPOINT,
                 "-H", f"x-goog-api-key: {key}",
                 "-H", "Content-Type: application/json",
                 "--data-binary", f"@{body_path}"],
                capture_output=True, timeout=320,
            )
            if proc.returncode != 0:
                last = proc.stderr.decode()[:300]
            else:
                data = json.loads(proc.stdout)
                if "error" in data:
                    last = str(data["error"])[:300]
                else:
                    for step in data.get("steps", []):
                        for block in step.get("content", []):
                            if block.get("type") == "image" and block.get("data"):
                                return base64.b64decode(block["data"])
                    last = "no image block in response"
        except Exception as e:  # noqa: BLE001 - surface whatever went wrong
            last = str(e)[:300]
        finally:
            os.unlink(body_path)
        print(f"    retry {attempt + 1}: {last}")
        time.sleep(4 * (attempt + 1))
    raise RuntimeError(f"generation failed: {last}")


def key_out(img: Image.Image) -> Image.Image:
    """Chroma-key the green field, despill the fringe, trim to content."""
    img = img.convert("RGB")
    px = img.load()
    w, h = img.size
    alpha = Image.new("L", (w, h), 255)
    ap = alpha.load()

    kr, kg, kb = KEY_RGB
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            # Green-dominance test survives JPEG noise far better than a
            # distance-to-key test, which leaves a halo on dark edges.
            dominance = g - max(r, b)
            if dominance > 48:
                ap[x, y] = 0
            elif dominance > 14:
                ap[x, y] = int(255 * (1 - (dominance - 14) / 34))
                # despill: pull the green back toward the other channels
                g2 = min(g, int(max(r, b) * 1.06) + 8)
                px[x, y] = (r, g2, b)

    # Soften, then erode slightly so no green rim survives.
    alpha = alpha.filter(ImageFilter.GaussianBlur(1.1))
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            v = ap[x, y]
            ap[x, y] = 0 if v < 130 else min(255, int((v - 130) * (255 / 125)))

    out = img.convert("RGBA")
    out.putalpha(alpha)
    box = out.getbbox()
    return out.crop(box) if box else out


def main() -> None:
    args = sys.argv[1:]
    only = None
    if "--only" in args:
        only = args[args.index("--only") + 1]
        assets = PARTS + PROPS
    else:
        group = args[0] if args else "parts"
        assets = GROUPS.get(group)
        if assets is None:
            sys.exit(f"unknown group {group!r}; use one of {list(GROUPS)}")

    ART.mkdir(exist_ok=True)
    RAW.mkdir(exist_ok=True)
    manifest_path = ART / "manifest.json"
    manifest = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())

    for name, aspect, prompt in assets:
        if only and name != only:
            continue
        print(f"[{name}] generating…")
        raw = generate(prompt, aspect)
        (RAW / f"{name}.jpg").write_bytes(raw)

        img = Image.open(RAW / f"{name}.jpg")
        cut = key_out(img)
        # Keep assets a sane size; 2K generations are far more than we need.
        if max(cut.size) > 768:
            k = 768 / max(cut.size)
            cut = cut.resize((max(1, int(cut.width * k)), max(1, int(cut.height * k))),
                             Image.LANCZOS)
        cut.save(ART / f"{name}.png")
        manifest[name] = {"w": cut.width, "h": cut.height}
        print(f"    -> art/{name}.png  {cut.width}x{cut.height}")

    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"\nwrote {manifest_path}")


if __name__ == "__main__":
    main()
