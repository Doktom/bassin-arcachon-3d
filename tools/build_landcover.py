"""Rastérise l'occupation du sol OSM en masque PNG aligné sur la grille bathymétrique.
R = forêt (landuse=forest, natural=wood) · G = bâti (residential, commercial, industrial, retail) · B = sable (natural=sand, Dune du Pilat).
Usage : python tools/build_landcover.py dossier_raw   (landcover.json = réponse Overpass « out geom »)
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw

RAW = sys.argv[1]
BM = json.load(open("data/bathy.json", encoding="utf-8"))
GW, GH = BM["width"], BM["height"]
pxl, pyl = (BM["east"] - BM["west"]) / GW, (BM["north"] - BM["south"]) / GH
W, E, N, S = BM["west"] + pxl / 2, BM["east"] - pxl / 2, BM["north"] - pyl / 2, BM["south"] + pyl / 2  # centres des pixels (comme le JS)
SC = 2
OW, OH = (GW - 1) * SC + 1, (GH - 1) * SC + 1
px = lambda lon, lat: ((lon - W) / (E - W) * (OW - 1), (N - lat) / (N - S) * (OH - 1))

def assemble(ways):
    segs = [w[:] for w in ways if len(w) > 1]; rings = []
    while segs:
        cur = segs.pop(0); changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]: cur += s[1:]
                elif s[-1] == cur[-1]: cur += s[::-1][1:]
                elif s[-1] == cur[0]: cur = s[:-1] + cur
                elif s[0] == cur[0]: cur = s[::-1][:-1] + cur
                else: continue
                segs.pop(i); changed = True; break
        if len(cur) >= 4: rings.append(cur)
    return rings
ring = lambda g: [(p["lon"], p["lat"]) for p in g]

def rings_of(e):
    if e["type"] == "way" and "geometry" in e:
        r = ring(e["geometry"]); return ([r], []) if len(r) >= 4 and r[0] == r[-1] else ([], [])
    if e["type"] == "relation":
        o = assemble([ring(m["geometry"]) for m in e.get("members", []) if m.get("role") in ("outer", "") and "geometry" in m])
        i = assemble([ring(m["geometry"]) for m in e.get("members", []) if m.get("role") == "inner" and "geometry" in m])
        return o, i
    return [], []

CLS = {"forest": 0, "wood": 0, "residential": 1, "commercial": 1, "industrial": 1, "retail": 1, "sand": 2}
layers = [Image.new("L", (OW, OH), 0) for _ in range(3)]
holes = [Image.new("L", (OW, OH), 0) for _ in range(3)]
for e in json.load(open(os.path.join(RAW, "landcover.json"), encoding="utf-8"))["elements"]:
    t = e.get("tags", {}); k = t.get("landuse") or t.get("natural")
    if k not in CLS: continue
    c = CLS[k]; outers, inners = rings_of(e)
    for r in outers: ImageDraw.Draw(layers[c]).polygon([px(*p) for p in r], fill=255)
    for r in inners: ImageDraw.Draw(holes[c]).polygon([px(*p) for p in r], fill=255)
A = [np.where(np.asarray(h) > 0, 0, np.asarray(l)) for l, h in zip(layers, holes)]
R, G, B = [a.astype(np.uint8) for a in A]
# Dune du Pilat : toute terre non boisée du relief IGN est du sable nu
pm = json.load(open("data/pilat.json", encoding="utf-8"))
PZ = np.fromfile("data/pilat.bin", dtype="<i2").reshape(pm["height"], pm["width"]) / 100.0
for j in range(OH):
    lat = N - j / (OH - 1) * (N - S)
    if not (pm["south"] < lat < pm["north"]): continue
    for i in range(OW):
        lon = W + i / (OW - 1) * (E - W)
        if not (pm["west"] < lon < pm["east"]): continue
        pi = int((lon - pm["west"]) / (pm["east"] - pm["west"]) * (pm["width"] - 1)); pj = int((pm["north"] - lat) / (pm["north"] - pm["south"]) * (pm["height"] - 1))
        if PZ[pj, pi] > 3 and R[j, i] < 128 and G[j, i] < 128: B[j, i] = 255
# urbain prioritaire sur la forêt
R = np.where(G > 127, 0, R)
img = Image.fromarray(np.dstack([R, G, B]).astype(np.uint8), "RGB").filter(__import__("PIL.ImageFilter", fromlist=["x"]).GaussianBlur(0.7))
img.save("data/landcover.png", optimize=True)
print("landcover", img.size, "forêt %.0f%%" % (100 * (R > 127).mean()), "bâti %.0f%%" % (100 * (G > 127).mean()), "sable %.1f%%" % (100 * (B > 127).mean()))
