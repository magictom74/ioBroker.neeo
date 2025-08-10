![Logo](admin/neeo.png)

# ioBroker.neeo

[![NPM version](https://img.shields.io/npm/v/iobroker.neeo.svg)](https://www.npmjs.com/package/iobroker.neeo)
[![Downloads](https://img.shields.io/npm/dm/iobroker.neeo.svg)](https://www.npmjs.com/package/iobroker.neeo)
![Installations](https://iobroker.live/badges/neeo-installed.svg)
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
- Pro Raum Status (isactive) und Power Toggle (powerToggle), über folgende Objekte konfigurierbar:
  - 0_userdata.0.neeo.<Instanz>.<RaumId>.roomDefault (string) -> Raum Einschaltrezept (Format: 6232364701641080832)
  - 0_userdata.0.neeo.<Instanz>.<RaumId>.roomDelay (number) -> Einschaltverzögerung pro Raum in Sekunden (Format: 5)
- Global Room Status (isactive) und Power Toggle (powerToggle), über folgende Objekte konfigurierbar:
  - 0_userdata.0.neeo.<Instanz>.<RaumId>.roomGlobal (bool) -> Raum in Global powerToggle inkludiert (Format: true / false)
- Pro Raum Volume Macro mit Anzahl Wiederholungen und Verzögerung
  - 0_userdata.0.neeo.<Instanz>.<RaumId>.roomVolDevice (string) -> Raum Volume Device (Format: 6333416566067036160)
  - 0_userdata.0.neeo.<Instanz>.<RaumId>.roomVolUp (string) -> Raum Volume Up Makro (Format: 6333416567207886848)
  - 0_userdata.0.neeo.<Instanz>.<RaumId>.roomVolDown (string) -> Raum Volume Down Makro (Format: 6333416567195303936)
  - 0_userdata.0.neeo.<Instanz>.<RaumId>.roomVolRepeat (number) -> Volume Wiederholungen (Format: 6)
  - 0_userdata.0.neeo.<Instanz>.<RaumId>.roomVolDelay (number) -> Volume Delay in ms (Format: 100)
  
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
### 1.0.2 (2025-08-10)
* Globaler Power Toogle und Volume Makros pro Raum hinzugefügt,

### 1.0.1 (2025-08-04)
* Szenario und Custom Status pro Raum hinzugefügt

### 1.0.0
* Initiale Version

## License
MIT License © 2025 tom