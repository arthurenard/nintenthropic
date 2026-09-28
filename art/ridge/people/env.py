"""Paths, and High Noon's character library on sys.path (imported read-only:
nothing under art/western/ is ever written; variants live in this package)."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RIDGE = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(RIDGE, "..", ".."))
CHARS = os.path.join(REPO, "art", "western", "characters")
if CHARS not in sys.path:
    sys.path.insert(0, CHARS)

ASSETS = os.path.join(REPO, "public", "assets", "ridge")
BUILD = os.path.join(RIDGE, "build")
REVIEW = os.path.join(BUILD, "review", "people")
BLEND = os.path.join(BUILD, "people")


def log(*a):
    print("[people]", *a, flush=True)
