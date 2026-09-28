"""Image files from numpy, in Blender's Python (OpenImageIO) or system Python
(Pillow): the terrain stages run in both. Arrays are (H, W, C) floats in
0..1, top row first.

A fourth channel is data (a splat weight, the mist, an alpha), never a
premultiplying alpha: OpenImageIO is told so both ways
(oiio:UnassociatedAlpha), or it divides the colour by it on writing and
multiplies on reading - invisible in a round trip through OpenImageIO, but
what a browser reads from the file is ruined."""

import numpy as np


def _oiio():
    try:
        import OpenImageIO as oiio
        return oiio
    except ImportError:
        return None


def write(path, arr, bits=8, quality=None):
    """PNG (8 or 16 bits) or WebP (8 bits; quality None = lossless)."""
    a = np.clip(np.asarray(arr, np.float32), 0, 1)
    if a.ndim == 2:
        a = a[..., None]
    h, w, c = a.shape
    oiio = _oiio()
    if oiio is not None:
        fmt = oiio.UINT16 if bits == 16 else oiio.UINT8
        spec = oiio.ImageSpec(w, h, c, fmt)
        if c == 4:
            spec.attribute("oiio:UnassociatedAlpha", 1)
        if path.lower().endswith(".webp"):
            if quality is None:
                spec.attribute("compression", "lossless")
            else:
                spec.attribute("compression", f"webp:{int(quality)}")
                spec.attribute("webp:quality", int(quality))
        if path.lower().endswith(".png"):
            spec.attribute("png:compressionLevel", 9)
        out = oiio.ImageOutput.create(path)
        if out is None:
            raise RuntimeError(f"cannot write {path}: {oiio.geterror()}")
        out.open(path, spec)
        data = np.ascontiguousarray((a * (65535 if bits == 16 else 255) + 0.5).astype(np.uint16 if bits == 16 else np.uint8))
        if not out.write_image(data):
            raise RuntimeError(f"cannot write {path}: {out.geterror()}")
        out.close()
        return path
    from PIL import Image
    mode = {1: "L", 3: "RGB", 4: "RGBA"}[c]
    if bits == 16 and c == 1:
        Image.fromarray((a[..., 0] * 65535 + 0.5).astype(np.uint16)).save(path)
        return path
    im = Image.fromarray((a * 255 + 0.5).astype(np.uint8) if c > 1 else (a[..., 0] * 255 + 0.5).astype(np.uint8), mode)
    if path.lower().endswith(".webp"):
        im.save(path, lossless=quality is None, quality=quality or 100, method=6)
    else:
        im.save(path, optimize=True)
    return path


def read(path):
    """(H, W, C) float32 in 0..1, top row first."""
    oiio = _oiio()
    if oiio is not None:
        cfg = oiio.ImageSpec()
        cfg.attribute("oiio:UnassociatedAlpha", 1)
        inp = oiio.ImageInput.open(path, cfg)
        spec = inp.spec()
        data = np.asarray(inp.read_image(0, 0, 0, spec.nchannels, oiio.FLOAT)).reshape(spec.height, spec.width, spec.nchannels)
        inp.close()
        return data.astype(np.float32)
    from PIL import Image
    im = Image.open(path)
    a = np.asarray(im).astype(np.float32)
    a /= 65535.0 if a.max() > 255 else 255.0
    return a if a.ndim == 3 else a[..., None]
