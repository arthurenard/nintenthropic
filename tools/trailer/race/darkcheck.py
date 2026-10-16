"""Lists frames of a folder that are suspiciously dark or identical to the one before: python3 darkcheck.py DIR [threshold]"""
import sys, glob
from PIL import Image, ImageStat, ImageChops
d = sys.argv[1]
thr = float(sys.argv[2]) if len(sys.argv) > 2 else 12
prev = None
bad = 0
files = sorted(glob.glob(d + "/0*.png")) or sorted(glob.glob(d + "/0*.jpg"))
for f in files:
    im = Image.open(f).convert("L")
    small = im.resize((96, 54))
    mean = ImageStat.Stat(small).mean[0]
    dup = prev is not None and ImageChops.difference(small, prev).getbbox() is None
    if mean < thr or dup:
        print(f"{f.split('/')[-1]}: mean {mean:.1f}{' DUPLICATE' if dup else ''}")
        bad += 1
    prev = small
print(f"{len(files)} frames, {bad} suspicious")
