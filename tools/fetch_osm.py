"""Télécharge les extraits OpenStreetMap (Overpass API) dans le dossier courant. Usage : python fetch_osm.py [nat seamarks ports places landcover cabanes lakes]"""
import json, sys, time, urllib.request, urllib.parse
EPS=["https://overpass-api.de/api/interpreter","https://overpass.private.coffee/api/interpreter","https://overpass.kumi.systems/api/interpreter"]
Q={
"lakes":'[out:json][timeout:120];(way["natural"="water"](44.45,-1.40,44.80,-0.95);relation["natural"="water"](44.45,-1.40,44.80,-0.95););out geom;',
"landcover":'[out:json][timeout:240];(way["landuse"~"^(forest|residential|commercial|industrial|retail|farmland|meadow|grass|military)$"](44.45,-1.40,44.80,-0.95);relation["landuse"~"^(forest|residential|commercial|industrial|retail|farmland|meadow)$"](44.45,-1.40,44.80,-0.95);way["natural"~"^(wood|sand|heath|scrub|dune|grassland)$"](44.45,-1.40,44.80,-0.95);relation["natural"~"^(wood|sand|heath|scrub|grassland)$"](44.45,-1.40,44.80,-0.95););out geom;',
"cabanes":'[out:json][timeout:90];(nwr["name"~"tchanqu",i](44.60,-1.30,44.80,-1.00);nwr["building"](44.695,-1.185,44.715,-1.135);nwr["man_made"](44.695,-1.185,44.715,-1.135););out geom;',
"seamarks":'[out:json][timeout:90];nwr["seamark:type"](44.45,-1.45,44.80,-0.95);out geom;',
"ports":'[out:json][timeout:90];(nwr["leisure"~"^(marina|slipway)$"](44.50,-1.36,44.80,-0.95);nwr["harbour"](44.50,-1.36,44.80,-0.95);nwr["landuse"="harbour"](44.50,-1.36,44.80,-0.95);nwr["man_made"~"^(pier|breakwater|lighthouse)$"](44.50,-1.36,44.80,-0.95););out geom;',
"places":'[out:json][timeout:90];(node["place"~"^(town|village|suburb|hamlet|locality|sea|bay)$"](44.45,-1.45,44.82,-0.92);nwr["natural"~"^(strait|bay|cape|peninsula|dune)$"](44.45,-1.45,44.80,-0.95);nwr["waterway"]["name"](44.50,-1.36,44.80,-0.95););out geom;',
"coast":'[out:json][timeout:120];way["natural"="coastline"](44.40,-1.45,44.85,-0.90);out geom;',
"communes":'[out:json][timeout:120];relation["boundary"="administrative"]["admin_level"="8"](44.58,-1.28,44.76,-0.98);out tags center;',
}
for name in sys.argv[1:] or Q:
    wait=10
    for attempt in range(12):
        ep=EPS[attempt%len(EPS)]
        try:
            data=urllib.parse.urlencode({"data":Q[name]}).encode()
            req=urllib.request.Request(ep,data=data,headers={"User-Agent":"bassin-map-builder"})
            body=urllib.request.urlopen(req,timeout=150).read()
            j=json.loads(body)
            if j.get("remark") and not j["elements"]: raise Exception(j["remark"])
            open(name+".json","wb").write(body); print("OK",name,len(j["elements"]),flush=True); break
        except Exception as e:
            print("fail",name,ep,str(e)[:80],flush=True); time.sleep(wait); wait=min(wait*2,90)
