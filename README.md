# Bassin d'Arcachon — carte 3D interactive

Carte 3D du Bassin d'Arcachon centrée sur l'eau : bathymétrie réelle, crassats (bancs intertidaux), bancs de sable, prés salés et marais, ports, communes et un **calque de navigation** (balisage IALA A, feux animés, zones portuaires et réglementées).

**▶ Démo : https://doktom.github.io/bassin-arcachon-3d/**

## Fonctionnalités

- **Diorama 3D** du Bassin : relief bathymétrique réel (EMODnet), socle en coupe avec la tranche d'eau, reflets animés, nuages low-poly.
- **Environnement terrestre low-poly** : relief à facettes, **forêt de pins maritimes** (≈ 32 000 pins placés d'après les forêts OpenStreetMap, port en parasol caractéristique des Landes), zones bâties sobres, lac de Cazaux.
- **Dune du Pilat** en haute résolution (≈ 12 m, IGN RGE ALTI) : altitude au clic.
- **Cabanes tchanquées** n°51 (volets rouges) et n°53 (volets blancs) sur pilotis, et cabanes ostréicoles de l'Île aux Oiseaux, à leurs positions OSM.
- **Écran sobre** : titre et recherche, barre de marée, commandes de vue ; tout le reste dans le panneau « Calques ».
- **Tutoriel** en 5 étapes au premier lancement, passable à tout moment, relançable avec « ? ».
- **Marée** : courbe cliquable (BM → PM → BM), coefficient 45 → 115, animation ; les crassats découvrent en direct.
- **3 fonds de carte** : *Naturel*, *Carte marine* (conventions SHOM), *Photo IGN* drapée.
- **Recherche** (crassats, chenaux, esteys, ports, communes, marques, cabanes) et **lieux à découvrir** avec vol animé.
- **Milieux** : ~180 crassats nommés, prés salés, marais, bancs de sable ; toponymie cartographique.
- **Calque navigation** : ~330 marques IALA A en 3D (couleurs dans l'ordre OSM, voyants), feux au rythme réel, mode nuit, zones portuaires.

> ⚠️ Carte de découverte, **ne pas utiliser pour la navigation**. Les bancs du Bassin bougent en permanence : référez-vous aux cartes SHOM (7428, 7429) et aux avis aux navigateurs.

## Données

| Couche | Source | Licence |
|---|---|---|
| Bathymétrie / relief | [EMODnet Bathymetry](https://emodnet.ec.europa.eu/en/bathymetry) DTM (moyenne), réf. ≈ LAT / zéro hydrographique | CC-BY 4.0 |
| Crassats, marais, plages, ports, balisage, toponymes | © contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright) | ODbL |
| Dune du Pilat | [IGN](https://geoservices.ign.fr/) RGE ALTI via l'API altimétrie de la Géoplateforme (NGF-IGN69, +2,1 m ≈ zéro hydrographique) | Licence Ouverte Etalab 2.0 |
| Forêts, bâti, lacs, cabanes | © contributeurs OpenStreetMap | ODbL |
| Orthophoto | [IGN Géoplateforme](https://geoservices.ign.fr/) (WMTS, chargée à la demande) | Licence Ouverte Etalab 2.0 |

Les marnages proposés sont indicatifs (Arcachon-Eyrac).

## Lancer en local

Site statique, aucune compilation :

```bash
python -m http.server 8000
# puis http://localhost:8000
```

## Régénérer les données

```bash
pip install numpy pillow tifffile
# 1. Bathymétrie EMODnet (GeoTIFF via WCS, voir l'en-tête du script)
python tools/build_bathy.py emod.tif
# 2. Extraits OpenStreetMap (Overpass) dans ./raw puis conversion
python tools/fetch_osm.py          # à lancer depuis ./raw
python tools/build_osm.py raw
python tools/build_landcover.py raw  # masque forêt / bâti / sable
python tools/fetch_pilat.py          # relief fin de la Dune du Pilat (IGN)
```

## Technique

Le relief terrestre EMODnet est un modèle de surface (il inclut la canopée des pins) : il est simplifié en triangulation low-poly irrégulière (~290 m), tandis que l'eau et l'estran gardent la bathymétrie d'origine intacte.


[three.js](https://threejs.org/) (r160) : maillage de 864 × 672 sommets calés au centre des pixels du MNT, coloration bathymétrique, marée, isobathes et drapage des couches vectorielles (rendues dans des canvas 4096²) entièrement dans un shader ; étiquettes HTML avec gestion des collisions ; picking par lancer de rayon sur le champ de hauteurs.
