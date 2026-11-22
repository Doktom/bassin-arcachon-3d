# Bassin d'Arcachon — carte 3D interactive

Carte 3D du Bassin d'Arcachon centrée sur l'eau : bathymétrie réelle, crassats (bancs intertidaux), bancs de sable, prés salés et marais, ports, communes et un **calque de navigation** (balisage IALA A, feux animés, zones portuaires et réglementées).

**▶ Démo : https://doktom.github.io/bassin-arcachon-3d/**

## Fonctionnalités

- **Relief bathymétrique 3D** (EMODnet, ~115 m ré-échantillonné) avec exagération verticale réglable : chenaux (Teychan, Piquey, Courbey…), passes, crassats, Banc d'Arguin, Dune du Pilat.
- **Curseur de marée** (hauteur d'eau au-dessus du zéro hydrographique) avec préréglages PM/BM vives-eaux et mortes-eaux, et animation d'un cycle complet : les crassats découvrent et se recouvrent en temps réel.
- **Isobathes** 0 / 2 / 5 / 10 / 20 m calculées dans le shader.
- **Milieux** (OpenStreetMap) : ~180 crassats nommés, prés salés, marais et roselières (delta de l'Eyre, Île aux Oiseaux…), bancs de sable et plages.
- **Repères** : les 10 communes du Bassin (COBAS / COBAN), ports de plaisance et ostréicoles, cales.
- **Calque navigation** : ~500 marques (bouées et balises latérales, cardinales, spéciales…) modélisées en 3D avec couleurs, formes et voyants ; feux avec leur rythme réel (`Fl(2) G 6s`…) ; mode nuit ; zones portuaires / réglementées drapées.
- **Lecture au curseur** : position en degrés-minutes, sonde, hauteur d'eau à la marée choisie, nom du crassat survolé. Clic = fiche détaillée.
- **Fond alternatif** : orthophotographie IGN drapée sur le relief.

> ⚠️ Carte de découverte, **ne pas utiliser pour la navigation**. Les bancs du Bassin bougent en permanence : référez-vous aux cartes SHOM (7428, 7429) et aux avis aux navigateurs.

## Données

| Couche | Source | Licence |
|---|---|---|
| Bathymétrie / relief | [EMODnet Bathymetry](https://emodnet.ec.europa.eu/en/bathymetry) DTM (moyenne), réf. ≈ LAT / zéro hydrographique | CC-BY 4.0 |
| Crassats, marais, plages, ports, balisage, toponymes | © contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright) | ODbL |
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
```

## Technique

[three.js](https://threejs.org/) (r160) : maillage de 864 × 672 sommets, coloration bathymétrique, marée, isobathes et drapage des couches vectorielles (rendues dans des canvas 4096²) entièrement dans un shader ; étiquettes HTML avec gestion des collisions ; picking par lancer de rayon sur le champ de hauteurs.
