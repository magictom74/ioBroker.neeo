![Logo](admin/neeo.png)

# ioBroker.neeo

[![NPM version](https://img.shields.io/npm/v/iobroker.neeo.svg)](https://www.npmjs.com/package/iobroker.neeo)
[![Downloads](https://img.shields.io/npm/dm/iobroker.neeo.svg)](https://www.npmjs.com/package/iobroker.neeo)
![Installations](https://iobroker.live/badges/neeo-installed.svg)
![Stable](https://iobroker.live/badges/neeo-stable.svg)
![Build](https://github.com/magictom74/ioBroker.neeo/workflows/Test%20and%20Release/badge.svg)


## ioBroker Adapter for NEEO Brain
Dieser Adapter verbindet ioBroker mit dem NEEO NEEO Brain.  
Er erkennt Räume, Geräte, Rezepte, Szenarien und stellt diese als Objekte in ioBroker zur Verfügung.  
Die Verbindung erfolgt wahlweise über manuelle IP-Konfiguration oder automatische mDNS-Erkennung.

### Funktionen
- Automatische Erkennung des NEEO Brain via mDNS
- Erstellung von Objekten für:
  - Räume, Geräte, Makros
  - Globale Kommandos, Szenarien und Rezepte
- Ausführung von Recipes und Makros per ioBroker State
- Custom State und Commands pro Raum
- Polling von Recipes mit Statusaktualisierung
- Statusüberwachung über `info.connection`

## Known Issues
- Statusüberwachung Host erst nach erstem Pollzyklus grün
- Tests nicht verfügbar

## Installation
Die Installation erfolgt über den ioBroker Admin oder manuell per Konsole:

```bash
npm install iobroker.neeo
```

## Changelog
1.0.0   Initiale Version

## Lizenz
MIT License © 2025 tom