"""Construit data/bathy.bin depuis le MNT EMODnet Bathymetry (WCS).

Source : EMODnet Bathymetry Consortium, DTM (moyenne), réf. verticale ~ LAT (zéro hydrographique).
Usage : python tools/build_bathy.py chemin/vers/emod.tif
  (le GeoTIFF s'obtient via :
   https://ows.emodnet-bathymetry.eu/wcs?service=wcs&version=1.0.0&request=getcoverage
   &coverage=emodnet:mean&crs=EPSG:4326&BBOX=-1.40,44.45,-0.95,44.80&format=image/tiff
   &resx=0.0010416667&resy=0.0010416667)
"""
import json, sys
import numpy as np, tifffile
from PIL import Image

W, S, E, N = -1.40, 44.45, -0.95, 44.80
UP = 2  # sur-échantillonnage bicubique pour lisser le maillage

a = tifffile.imread(sys.argv[1]).astype(np.float32)
a[~np.isfinite(a)] = -30
h, w = a.shape
im = Image.fromarray(a, mode="F").resize((w * UP, h * UP), Image.BICUBIC)
b = np.asarray(im, dtype=np.float32)
cm = np.clip(np.round(b * 100), -32000, 32000).astype("<i2")
cm.tofile("data/bathy.bin")
meta = {"west": W, "south": S, "east": E, "north": N, "width": int(b.shape[1]), "height": int(b.shape[0]),
        "unit": "cm", "datum": "LAT / zéro hydrographique (approx.)", "min_m": float(b.min()), "max_m": float(b.max()),
        "source": "EMODnet Bathymetry DTM (mean) — https://emodnet.ec.europa.eu/en/bathymetry"}
json.dump(meta, open("data/bathy.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(meta)
