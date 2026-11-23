# Bassin d'Arcachon — carte 3D interactive

Carte 3D du Bassin d'Arcachon centrée sur l'eau : bathymétrie réelle, crassats (bancs intertidaux), bancs de sable, prés salés et marais, ports, communes et un **calque de navigation** (balisage IALA A, feux animés, zones portuaires et réglementées).

**▶ Démo : https://doktom.github.io/bassin-arcachon-3d/**

## Fonctionnalités

- **Diorama 3D** du Bassin : relief bathymétrique réel (EMODnet), socle en coupe avec la tranche d'eau, reflets animés à la surface.
- **Marée intuitive** : courbe de marée cliquable (BM → PM → BM), choix du coefficient (mortes-eaux 45 → grande marée 115), animation ; les crassats découvrent et se recouvrent en direct. Réglage fin de la hauteur d'eau au centimètre.
- **3 fonds de carte** : *Naturel* (couleurs de profondeur à la marée choisie), *Carte marine* (conventions SHOM : découvrant vert, sondes 0–2 / 2–5 / 5–10 / >10 m, laisse de marée actuelle), *Photo IGN* drapée sur le relief.
- **Recherche** de n'importe quel crassat, chenal, estey, port, commune ou marque, avec vol animé et mise en évidence de la zone.
- **Vues prédéfinies** : Passes & Arguin, Pointe du Cap Ferret, Île aux Oiseaux, Rade d'Eyrac, ports ostréicoles, delta de l'Eyre, Arès–Andernos.
- **Milieux** (OpenStreetMap) : ~180 crassats nommés, prés salés, marais et roselières, bancs de sable et plages ; toponymie cartographique (hydronymes en italique, communes en capitales).
- **Calque navigation** : ~330 marques (bouées et balises latérales, cardinales, spéciales…) modélisées en 3D avec couleurs, formes et voyants ; feux avec leur rythme réel (`Fl(2) G 6s`…), mode nuit ; zones portuaires et réglementées.
- **Lecture au curseur** : position en degrés-minutes, sonde, hauteur d'eau ; infobulle sur les marques et les crassats ; fiche détaillée au clic ; échelle graphique en km et milles.
- Interface responsive (panneau en tiroir sur mobile).

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

[three.js](https://threejs.org/) (r160) : maillage de 864 × 672 sommets calés au centre des pixels du MNT, coloration bathymétrique, marée, isobathes et drapage des couches vectorielles (rendues dans des canvas 4096²) entièrement dans un shader ; étiquettes HTML avec gestion des collisions ; picking par lancer de rayon sur le champ de hauteurs.
