"""Relief fin de la Dune du Pilat depuis l'API altimétrique IGN (RGE ALTI, NGF-IGN69).

Usage : python tools/fetch_pilat.py  ->  écrit data/pilat.bin (int16, cm) + data/pilat.json
Le décalage NGF -> zéro hydrographique est estimé en comparant avec la grille EMODnet sur la terre.
"""
import json, time, urllib.request
import numpy as np

W, E, S, N = -1.2240, -1.2000, 44.5700, 44.6040
NX, NY = 161, 316                        # ~12 m de pas
lons = np.linspace(W, E, NX); lats = np.linspace(N, S, NY)
LL = [(lo, la) for la in lats for lo in lons]
z = []
URL = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"
for k in range(0, len(LL), 2000):
    chunk = LL[k:k + 2000]
    body = json.dumps({"lon": "|".join(f"{a:.6f}" for a, _ in chunk), "lat": "|".join(f"{b:.6f}" for _, b in chunk),
                       "resource": "ign_rge_alti_wld", "zonly": "true"}).encode()
    for attempt in range(5):
        try:
            r = urllib.request.urlopen(urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json"}), timeout=120).read()
            z += json.loads(r)["elevations"]; break
        except Exception as e:
            print("retry", k, e); time.sleep(3 * (attempt + 1))
    print(f"{len(z)}/{len(LL)}", flush=True)
Z = np.array(z, dtype=np.float32).reshape(NY, NX)
Z[Z < -50] = np.nan

# NGF-IGN69 -> zéro hydrographique d'Arcachon : ~ +2,1 m (approx.).
# (La grille EMODnet ne peut pas servir de référence à terre : c'est un modèle de surface qui inclut la canopée des pins.)
off = 2.1
Z = np.where(np.isfinite(Z), Z, -5.0) + off
np.round(Z * 100).astype("<i2").tofile("data/pilat.bin")
json.dump({"west": W, "east": E, "south": S, "north": N, "width": NX, "height": NY, "unit": "cm", "offset_ngf_to_grid_m": off, "note": "NGF-IGN69 + 2,1 m ≈ zéro hydrographique d'Arcachon (approx.)",
           "max_m": float(Z.max()), "source": "IGN Géoplateforme — RGE ALTI (API altimétrie)"}, open("data/pilat.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("offset", off, "max", Z.max())
