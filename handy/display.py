"""Working out how big the screen is, before anything is drawn on it."""

from __future__ import annotations

import ctypes
import ctypes.util
import json
import platform
import re
import subprocess
import sys

Size = tuple[int, int]

#: Used only when the screen cannot be measured or asked about at all.
FALLBACK = (1280, 720)

#: Anything outside this is not a screen we can believe in.
SMALLEST = (640, 400)
LARGEST = (16384, 16384)


def believable(size: Size | None) -> bool:
    """Whether this could plausibly be a screen. Tolerates None and junk."""
    if size is None:
        return False
    try:
        width, height = size
    except (TypeError, ValueError):
        return False
    if not isinstance(width, int) or not isinstance(height, int):
        return False
    return (SMALLEST[0] <= width <= LARGEST[0]
            and SMALLEST[1] <= height <= LARGEST[1])


class _Rect(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double),
                ("width", ctypes.c_double), ("height", ctypes.c_double)]


def _main_screen_rect(selector: bytes) -> tuple[int, int, int, int] | None:
    """Ask AppKit's NSScreen.mainScreen for `frame` or `visibleFrame`, in points.

    Done through the Objective-C runtime with ctypes so it needs no extra
    dependency. Anything at all going wrong means None, never an exception.
    """
    if sys.platform != "darwin":
        return None
    try:
        objc = ctypes.CDLL(ctypes.util.find_library("objc"))
        ctypes.CDLL(ctypes.util.find_library("AppKit"))
        objc.objc_getClass.restype = ctypes.c_void_p
        objc.objc_getClass.argtypes = [ctypes.c_char_p]
        objc.sel_registerName.restype = ctypes.c_void_p
        objc.sel_registerName.argtypes = [ctypes.c_char_p]
        send_id = ctypes.cast(objc.objc_msgSend, ctypes.CFUNCTYPE(
            ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p))
        # A 32-byte struct comes back in registers on arm64, via the
        # stret variant on Intel.
        returner = (objc.objc_msgSend if platform.machine() == "arm64"
                    else objc.objc_msgSend_stret)
        send_rect = ctypes.cast(returner, ctypes.CFUNCTYPE(
            _Rect, ctypes.c_void_p, ctypes.c_void_p))
        screen = send_id(objc.objc_getClass(b"NSScreen"),
                         objc.sel_registerName(b"mainScreen"))
        if not screen:
            return None
        rect = send_rect(screen, objc.sel_registerName(selector))
        return (int(round(rect.x)), int(round(rect.y)),
                int(round(rect.width)), int(round(rect.height)))
    except Exception:
        return None


#: NSApplicationPresentationOptions: hide the Dock and the menu bar.
_HIDE_DOCK, _HIDE_MENU_BAR = 2, 8


def _set_presentation_options(options: int) -> bool:
    """Ask AppKit to hide (or restore) the menu bar and Dock for this app."""
    if sys.platform != "darwin":
        return False
    try:
        objc = ctypes.CDLL(ctypes.util.find_library("objc"))
        ctypes.CDLL(ctypes.util.find_library("AppKit"))
        objc.objc_getClass.restype = ctypes.c_void_p
        objc.objc_getClass.argtypes = [ctypes.c_char_p]
        objc.sel_registerName.restype = ctypes.c_void_p
        objc.sel_registerName.argtypes = [ctypes.c_char_p]
        send_id = ctypes.cast(objc.objc_msgSend, ctypes.CFUNCTYPE(
            ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p))
        send_ulong = ctypes.cast(objc.objc_msgSend, ctypes.CFUNCTYPE(
            ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong))
        app = send_id(objc.objc_getClass(b"NSApplication"),
                      objc.sel_registerName(b"sharedApplication"))
        if not app:
            return False
        send_ulong(app, objc.sel_registerName(b"setPresentationOptions:"), options)
        return True
    except Exception:
        return False


def hide_system_chrome() -> bool:
    """Hide the menu bar and Dock, as a fullscreen game does.

    OpenCV's "fullscreen" is a window under the menu bar, not a fullscreen
    Space, so the bar stays unless it is asked to go. On a notched MacBook the
    strip beside the notch is never handed to any app - fullscreen games show
    it black - so this buys exactly what a real fullscreen app gets. Call
    after the window exists (the app object is created with it).
    """
    return _set_presentation_options(_HIDE_DOCK | _HIDE_MENU_BAR)


def restore_system_chrome() -> None:
    _set_presentation_options(0)


def window_content_size(title: str) -> Size | None:
    """The content area of this app's window called ``title``, in points.

    The one number that cannot be argued with: not the screen, not what OpenCV
    says about its image, but the view the picture is actually drawn into.
    Measured by walking NSApplication.sharedApplication.windows.
    """
    if sys.platform != "darwin":
        return None
    try:
        objc = ctypes.CDLL(ctypes.util.find_library("objc"))
        ctypes.CDLL(ctypes.util.find_library("AppKit"))
        objc.objc_getClass.restype = ctypes.c_void_p
        objc.objc_getClass.argtypes = [ctypes.c_char_p]
        objc.sel_registerName.restype = ctypes.c_void_p
        objc.sel_registerName.argtypes = [ctypes.c_char_p]
        sel = objc.sel_registerName
        send_id = ctypes.cast(objc.objc_msgSend, ctypes.CFUNCTYPE(
            ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p))
        send_idx = ctypes.cast(objc.objc_msgSend, ctypes.CFUNCTYPE(
            ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong))
        send_ulong = ctypes.cast(objc.objc_msgSend, ctypes.CFUNCTYPE(
            ctypes.c_ulong, ctypes.c_void_p, ctypes.c_void_p))
        send_cstr = ctypes.cast(objc.objc_msgSend, ctypes.CFUNCTYPE(
            ctypes.c_char_p, ctypes.c_void_p, ctypes.c_void_p))
        returner = (objc.objc_msgSend if platform.machine() == "arm64"
                    else objc.objc_msgSend_stret)
        send_rect = ctypes.cast(returner, ctypes.CFUNCTYPE(
            _Rect, ctypes.c_void_p, ctypes.c_void_p))

        app = send_id(objc.objc_getClass(b"NSApplication"), sel(b"sharedApplication"))
        windows = send_id(app, sel(b"windows")) if app else None
        if not windows:
            return None
        wanted = title.encode()
        for index in range(send_ulong(windows, sel(b"count"))):
            window = send_idx(windows, sel(b"objectAtIndex:"), index)
            name = send_id(window, sel(b"title"))
            if not name or send_cstr(name, sel(b"UTF8String")) != wanted:
                continue
            content = send_id(window, sel(b"contentView"))
            if not content:
                return None
            rect = send_rect(content, sel(b"frame"))
            size = (int(round(rect.width)), int(round(rect.height)))
            return size if believable(size) else None
        return None
    except Exception:
        return None


def visible_frame() -> Size | None:
    """The area a window can actually occupy on the main screen, in points.

    This is the screen minus the menu bar (and so minus the notch it sits
    beside). It is what macOS clips OpenCV's "fullscreen" window to: asked for
    the whole 1512x982 panel, the window is handed 1512x949, and the picture
    inside it is scaled to fit - which is where a grey band comes from. This
    measurement is live: hide the menu bar and it grows to the full panel.
    """
    rect = _main_screen_rect(b"visibleFrame")
    if rect is None:
        return None
    size = (rect[2], rect[3])
    return size if believable(size) else None


def _from_appkit() -> Size | None:
    rect = _main_screen_rect(b"frame")
    return None if rect is None else (rect[2], rect[3])


def _from_system_profiler() -> Size | None:
    """The main display's size in points, as macOS reports it.

    Points, not pixels: a Retina panel of 3024x1964 pixels presents itself to
    windows as 1512x982, and it is the window that has to be filled.
    """
    if sys.platform != "darwin":
        return None
    try:
        finished = subprocess.run(
            ["system_profiler", "SPDisplaysDataType", "-json"],
            capture_output=True, text=True, timeout=20, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    if finished.returncode != 0:
        return None
    try:
        groups = json.loads(finished.stdout).get("SPDisplaysDataType", [])
    except (ValueError, AttributeError):
        return None

    for group in groups:
        for display in group.get("spdisplays_ndrvs", []):
            found = re.search(r"(\d+)\s*x\s*(\d+)",
                              str(display.get("_spdisplays_resolution", "")))
            if found:
                size = (int(found.group(1)), int(found.group(2)))
                if believable(size):
                    return size
    return None


def _from_tkinter() -> Size | None:
    """Whatever Tk thinks the screen is. Absent on plenty of Python builds."""
    try:
        import tkinter

        root = tkinter.Tk()
        try:
            size = (root.winfo_screenwidth(), root.winfo_screenheight())
        finally:
            root.destroy()
        return size if believable(size) else None
    except Exception:
        return None


def screen_size() -> Size:
    """The best available guess at the screen, before a window exists.

    A guess is all this is - the window that finally opens is measured, and that
    measurement wins. This only has to be close enough to allocate a canvas and
    lay the interface out on the first frame.
    """
    for source in (_from_appkit, _from_system_profiler, _from_tkinter):
        size = source()
        if believable(size):
            return size
    return FALLBACK
