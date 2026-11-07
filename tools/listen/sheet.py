"""A contact sheet of spectrograms, before beside after, one row a cue (PNG from tools/listen/cues.mjs --spectrograms).

    python3 tools/listen/sheet.py OUT.png DIR cue1 cue2 ...
"""
import sys
from PIL import Image, ImageDraw

out, folder, *cues = sys.argv[1:]
W, H = 640, 256
sheet = Image.new("RGB", (2 * W + 150, len(cues) * (H + 4)), (24, 24, 28))
draw = ImageDraw.Draw(sheet)
for row, cue in enumerate(cues):
    y = row * (H + 4)
    draw.text((6, y + H // 2), cue.replace("kart_", ""), fill=(230, 230, 230))
    for col, label in enumerate(("before", "after")):
        try:
            sheet.paste(Image.open(f"{folder}/{label}-{cue}.png").convert("RGB"), (150 + col * W, y))
        except FileNotFoundError:
            draw.text((150 + col * W + 10, y + H // 2), f"(no {label})", fill=(160, 160, 160))
sheet.save(out)
