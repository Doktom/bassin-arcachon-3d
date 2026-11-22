"""Convertit les extraits Overpass (OSM) en GeoJSON allégés pour la carte.

Usage : python tools/build_osm.py dossier_raw
  dossier_raw contient nat.json, seamarks.json, ports.json, places.json (réponses Overpass « out geom »).
Données © contributeurs OpenStreetMap, licence ODbL.
"""
import json, os, sys

RAW = sys.argv[1]
R = lambda v: round(v, 5)

def load(name):
    p = os.path.join(RAW, name + ".json")
    if not os.path.exists(p):
        print("absent:", name); return []
    return json.load(open(p, encoding="utf-8"))["elements"]

def ring_of(geom):
    return [[R(p["lon"]), R(p["lat"])] for p in geom]

def assemble(ways):
    """Assemble des segments de ways en anneaux fermés."""
    segs = [w[:] for w in ways if len(w) > 1]
    rings = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]: cur += s[1:]
                elif s[-1] == cur[-1]: cur += s[::-1][1:]
                elif s[-1] == cur[0]: cur = s[:-1] + cur
                elif s[0] == cur[0]: cur = s[::-1][:-1] + cur
                else: continue
                segs.pop(i); changed = True; break
        if len(cur) >= 4:
            if cur[0] != cur[-1]: cur.append(cur[0])
            rings.append(cur)
    return rings

def polygons(e):
    if e["type"] == "way" and "geometry" in e:
        r = ring_of(e["geometry"])
        if len(r) >= 4 and r[0] == r[-1]:
            return [[r]]
        return None
    if e["type"] == "relation":
        outers = [ring_of(m["geometry"]) for m in e.get("members", []) if m.get("role") in ("outer", "") and "geometry" in m]
        inners = [ring_of(m["geometry"]) for m in e.get("members", []) if m.get("role") == "inner" and "geometry" in m]
        o = assemble(outers); i = assemble(inners)
        if not o: return None
        return [[ring] + (i if k == 0 else []) for k, ring in enumerate(o)]
    return None

def centroid(e):
    if e["type"] == "node": return [R(e["lon"]), R(e["lat"])]
    if "center" in e: return [R(e["center"]["lon"]), R(e["center"]["lat"])]
    if "bounds" in e:
        b = e["bounds"]; return [R((b["minlon"] + b["maxlon"]) / 2), R((b["minlat"] + b["maxlat"]) / 2)]
    if "geometry" in e:
        g = e["geometry"]; return [R(sum(p["lon"] for p in g) / len(g)), R(sum(p["lat"] for p in g) / len(g))]
    return None

def classify_zone(t):
    n, w, pl = t.get("natural"), t.get("wetland"), t.get("place")
    if w == "tidalflat" or n in ("mud",): return "crassat"
    if w == "saltmarsh": return "pre_sale"
    if w in ("reedbed", "marsh", "swamp", "wet_meadow") or (n == "wetland" and not w): return "marais"
    if w == "sand" or n in ("sand", "shoal"): return "banc_sable"
    if n == "beach": return "plage"
    if pl in ("island", "islet"): return "ile"
    return None

# ---------- zones naturelles ----------
feats = []
for e in load("nat"):
    t = e.get("tags", {})
    c = classify_zone(t)
    if not c: continue
    polys = polygons(e)
    if not polys: continue
    props = {"cls": c, "name": t.get("name", ""), "osm": f'{e["type"]}/{e["id"]}'}
    for k in ("description", "wikipedia", "protect_class"):
        if k in t: props[k] = t[k]
    feats.append({"type": "Feature", "properties": props,
                  "geometry": {"type": "MultiPolygon", "coordinates": polys}})
json.dump({"type": "FeatureCollection", "features": feats}, open("data/zones.geojson", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("zones", len(feats))

# ---------- balisage / navigation ----------
KEEP = ("seamark:", "name", "ref")
nav, navlines = [], []
for e in load("seamarks"):
    t = e.get("tags", {})
    props = {k: v for k, v in t.items() if k.startswith(KEEP)}
    props["osm"] = f'{e["type"]}/{e["id"]}'
    st = t.get("seamark:type", "")
    if e["type"] == "node":
        nav.append({"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": [R(e["lon"]), R(e["lat"])]}})
    elif e["type"] == "way" and "geometry" in e:
        coords = ring_of(e["geometry"])
        if st in ("harbour", "anchorage", "restricted_area", "small_craft_facility", "mooring", "landmark", "light_major", "light_minor", "building", "bridge"):
            c = centroid(e)
            nav.append({"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": c}})
        if len(coords) > 1:
            navlines.append({"type": "Feature", "properties": props, "geometry": {"type": "LineString", "coordinates": coords}})
    elif e["type"] == "relation":
        c = centroid(e)
        if c: nav.append({"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": c}})
json.dump({"type": "FeatureCollection", "features": nav}, open("data/seamarks.geojson", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
json.dump({"type": "FeatureCollection", "features": navlines}, open("data/navlines.geojson", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("seamarks", len(nav), "navlines", len(navlines))

# ---------- ports ----------
ports = []
for e in load("ports"):
    t = e.get("tags", {})
    c = centroid(e)
    if not c: continue
    kind = ("marina" if t.get("leisure") == "marina" else "slipway" if t.get("leisure") == "slipway"
            else "lighthouse" if t.get("man_made") == "lighthouse" else "pier" if t.get("man_made") in ("pier", "breakwater")
            else "harbour")
    if kind in ("pier",) and not t.get("name"): continue
    props = {"kind": kind, "name": t.get("name", ""), "osm": f'{e["type"]}/{e["id"]}'}
    for k in ("harbour", "harbour:category", "capacity", "website", "operator", "seamark:harbour:category", "mooring", "fee"):
        if k in t: props[k] = t[k]
    ports.append({"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": c}})
json.dump({"type": "FeatureCollection", "features": ports}, open("data/ports.geojson", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("ports", len(ports))

# ---------- lieux ----------
# On ne garde que les lieux « du bord de l'eau » : distance à l'eau estimée sur la grille bathymétrique.
import numpy as np
BM = json.load(open("data/bathy.json", encoding="utf-8"))
GRID = np.fromfile("data/bathy.bin", dtype="<i2").reshape(BM["height"], BM["width"]) / 100.0
def near_water(lon, lat, radius_m=700):
    if not (BM["west"] < lon < BM["east"] and BM["south"] < lat < BM["north"]): return False
    fx = (lon - BM["west"]) / (BM["east"] - BM["west"]) * (BM["width"] - 1)
    fy = (BM["north"] - lat) / (BM["north"] - BM["south"]) * (BM["height"] - 1)
    r = int(radius_m / 58) + 1  # ~58 m par cellule
    x0, y0 = int(fx), int(fy)
    win = GRID[max(y0 - r, 0):y0 + r + 1, max(x0 - r, 0):x0 + r + 1]
    return bool((win < 2.5).any())
places, seen = [], set()
for e in load("places"):
    t = e.get("tags", {})
    if not t.get("name"): continue
    kind = t.get("place") or t.get("natural") or ("waterway:" + t.get("waterway", ""))
    if kind.startswith("waterway:") and kind not in ("waterway:river", "waterway:canal"): continue
    if kind in ("town", "village") : pass
    if kind.startswith("waterway:"):
        # point représentatif : le sommet le plus proche de l'eau du Bassin
        pts = [(p["lon"], p["lat"]) for p in e.get("geometry", [])]
        wet = [p for p in pts if near_water(p[0], p[1], 150)]
        if not wet or t["name"] in seen: continue
        seen.add(t["name"]); c = [R(wet[len(wet) // 2][0]), R(wet[len(wet) // 2][1])]
    else:
        c = centroid(e)
        if not c: continue
        if kind in ("hamlet", "locality", "suburb", "quarter") and not near_water(c[0], c[1]): continue
        if kind == "bay" and "Gascogne" in t["name"]: continue
    import re
    if re.match(r"^(Chenal|Rade|Passe|Fosse|Canelette)", t["name"]): kind = "channel"
    elif re.match(r"^(Estey|Craste|Caste)", t["name"]): kind = "estey"
    places.append({"type": "Feature", "properties": {"kind": kind, "name": t["name"], "osm": f'{e["type"]}/{e["id"]}'},
                   "geometry": {"type": "Point", "coordinates": c}})
json.dump({"type": "FeatureCollection", "features": places}, open("data/places.geojson", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("places", len(places))
