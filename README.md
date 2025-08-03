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
- Automatische Erkennung des NEEO Brain via mDNS oder IP / Port in Settings
- Erstellung von Objekten:
  - Räume
  - Geräte pro Raum mit Makros und Kommandos
  - Rezepte pro Raum mit Status und Power Toggle
  - Szenarien (zusammengehörende Rezepte) pro Raum Status und Power Toggle
- Polling von Recipes mit Statusaktualisierung
- Brain Online Statusüberwachung über `info.connection`

## Custom Features
- Pro Raum Status (isactive) und Power Toggle (powerToggle) verfügbar 
- Über folgende Objekte konfigurierbar (müssen selber angelegt werden)
  - Standard Raum Einschaltrezept über 0_userdata.0.neeo.<Instanz>.<RaumId>.roomDefault (string)
  - Einschaltverzögerung pro Raum über 0_userdata.0.neeo.<Instanz>.<RaumId>.roomDelay (number)

## Known Issues
- Statusüberwachung Brain erst nach erstem Pollzyklus
- Status isactive von Rezepten nach powerToggle erst nach Pollzyklus aktuell (Status Raum und Szenarien sind ok)
- Tests nicht verfügbar

## Installation
Die Installation erfolgt über den ioBroker Admin oder manuell per Konsole:

```bash
npm install iobroker.neeo
```

## Changelog

### 1.0.1
* Szenario und Custom Status pro Raum hinzugefügt

### 1.0.0
* Initiale Version

## License
MIT License © 2025 tom