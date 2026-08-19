# Batto OBS Tool

Offizielles Windows-Projekt von **Crazy_Batto / Team Alpha**.

## Aktueller stabiler Release

**Batto OBS Tool 1.9.1**

- [Windows-Komplettpaket herunterladen](https://github.com/dannymeienbrock99-prog/Batto-OBS-Tool/releases/download/v1.9.1/Batto-OBS-Tool-1.9.1-Windows.zip)
- [Windows-Installer herunterladen](https://github.com/dannymeienbrock99-prog/Batto-OBS-Tool/releases/download/v1.9.1/Batto-OBS-Tool-Setup-1.9.1.exe)
- [Release und Prüfsummen öffnen](https://github.com/dannymeienbrock99-prog/Batto-OBS-Tool/releases/tag/v1.9.1)

## Entwicklungsstand 2.0.0

Die 2.0-Quellen führen den bisherigen Editor und die erweiterten Funktionen in **einem Touch-Deck** zusammen:

- Ausführen-/Bearbeiten-Modus, Vollbild und große Touch-Ziele für einen zweiten Touch-Monitor,
- Profile, Ordner, variable Raster, Mehrfachaktionen, Import/Export und berührbares Verschieben,
- automatische Suche in den originalen Elgato-Pluginordnern,
- sicherer Import von `.streamDeckPlugin`-Paketen und `.sdPlugin`-Ordnern,
- lokale Elgato-WebSocket-Laufzeit und originale Property Inspectors für ungeschützte Node-/Windows-Originalplugins direkt im Touch-Deck,
- klare Kennzeichnung fehlender oder geschützter Marketplace-Laufzeiten ohne DRM-Umgehung,
- gebündeltes `CrazyBatto-SOTF-DeathCounter-Module-v0.3.3` mit lokaler Verbindungsanzeige, Installation und OBS-Overlay,
- gemeinsamer Chat für Twitch, YouTube und lokale TikFinity-TikTok-Ereignisse mit Bot-Befehlen, Hologramm und Windows-Sprachausgabe,
- Herzfrequenz-Overlay über Pulsoid Cloud oder direktes Standard-Bluetooth-LE.

## Aufbau

Das Programm wird als **eine Electron-Anwendung und ein NSIS-Installer** ausgeliefert. Monitoring und Twitch-Hologramm sind lokale Module derselben Hauptanwendung; es entstehen keine zusätzlichen Programm-EXEs.

Enthalten:

- lokale Windows-Hardwarediagnose,
- bevorzugte Erkennung der dedizierten Grafikkarte,
- lokale OBS-WebSocket-Verbindung über `127.0.0.1:4455`,
- Erkennung des konfigurierten OBS-Encoders,
- manuell übertragbare Encoder-Empfehlungen,
- bestätigungspflichtige CPU- und OBS-Aufnahmetests,
- transparentes Hardware-/Encoder-Monitoring,
- persistente Twitch-/Multi-Chat-Hologrammfarben für Namen und Nachrichten mit Live-Vorschau,
- lokale OBS-Browserquellen für Chat, Hologramm und Herzfrequenz,
- variables Touch-Deck für Maus und Touch-Monitore.

## Branches

- `main`: stabiler Quellcode
- `release/windows-1.9.1-hotfix`: geprüfter Windows-Release-Stand 1.9.1

## Sicherheit und Verhalten

- kein automatischer Start einer zweiten App nach der Installation,
- Single-Instance-Sperre gegen doppelte Hauptfenster,
- OBS-Verbindung ausschließlich lokal,
- TikFinity wird ausschließlich über `ws://127.0.0.1:21213/` gelesen; ein nicht dokumentierter TikTok-Schreibzugriff wird nicht vorgetäuscht,
- Pulsoid-Tokens und Chat-Zugangsdaten werden über Electron `safeStorage` geschützt und nie in OBS-URLs geschrieben,
- keine veröffentlichte Testwerte-Schaltfläche und kein öffentliches Demo-API,
- alte Creator-Hub-Produktnamen und alte separate EXEs sind nicht Bestandteil des Releases.

Die statische Referenzanalyse des alten 1.8.6-Installers steht unter `docs/CREATOR-HUB-1.8.6-INSTALLER-REFERENCE.md`.
