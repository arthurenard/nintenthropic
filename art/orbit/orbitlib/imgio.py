"""Image files through OpenImageIO (bundled with Blender): WebP out, WebP,
PNG and EXR in. Every delivered texture goes through here, so the sRGB
encoding and the WebP settings live in one place."""

import os

import numpy as np

F32 = np.float32


def srgb_encode(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def srgb_decode(s):
    s = np.asarray(s, F32)
    return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4).astype(F32)


def to8(a):
    return np.clip(np.round(np.asarray(a, F32) * 255.0), 0, 255).astype(np.uint8)


def write(path, arr, quality=90, lossless=False):
    """Write an 8-bit image. arr: (H, W) or (H, W, C) uint8 or float 0..1
    (already in the file's encoding). Grey images are written as RGB (WebP
    has no one-channel mode; its YUV coding keeps grey cheap)."""
    import OpenImageIO as oiio
    a = arr if arr.dtype == np.uint8 else to8(arr)
    if a.ndim == 2:
        a = np.repeat(a[..., None], 3, -1)
    h, w, c = a.shape
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    spec = oiio.ImageSpec(w, h, c, oiio.UINT8)
    ext = os.path.splitext(path)[1].lower()
    if ext == ".webp":
        spec.attribute("compression", "lossless" if lossless else f"webp:{int(quality)}")
    out = oiio.ImageOutput.create(path)
    if out is None or not out.open(path, spec):
        raise RuntimeError(f"cannot write {path}: {oiio.geterror()}")
    out.write_image(np.ascontiguousarray(a))
    out.close()
    return os.path.getsize(path)


def read(path, channels=None, dtype=F32):
    """Read an image as float 0..1 (8-bit files) or as stored (EXR)."""
    import OpenImageIO as oiio
    inp = oiio.ImageInput.open(path)
    if inp is None:
        raise RuntimeError(f"cannot read {path}: {oiio.geterror()}")
    spec = inp.spec()
    fmt = oiio.FLOAT
    a = np.asarray(inp.read_image(0, 0, 0, spec.nchannels, fmt), F32).reshape(spec.height, spec.width, spec.nchannels)
    inp.close()
    if channels is not None:
        a = a[..., :channels]
    return a


def write_exr(path, arr):
    import OpenImageIO as oiio
    a = np.ascontiguousarray(np.asarray(arr, F32))
    if a.ndim == 2:
        a = a[..., None]
    h, w, c = a.shape
    spec = oiio.ImageSpec(w, h, c, oiio.HALF)
    spec.attribute("compression", "zip")
    out = oiio.ImageOutput.create(path)
    out.open(path, spec)
    out.write_image(a)
    out.close()
