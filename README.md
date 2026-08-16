# Batto OBS Tool

Offizielles Windows-Projekt von **Crazy_Batto / Team Alpha**.

## Aktueller stabiler Release

**Batto OBS Tool 1.9.1**

- [Windows-Komplettpaket herunterladen](https://github.com/dannymeienbrock99-prog/Batto-OBS-Tool/releases/download/v1.9.1/Batto-OBS-Tool-1.9.1-Windows.zip)
- [Windows-Installer herunterladen](https://github.com/dannymeienbrock99-prog/Batto-OBS-Tool/releases/download/v1.9.1/Batto-OBS-Tool-Setup-1.9.1.exe)
- [Release und Prüfsummen öffnen](https://github.com/dannymeienbrock99-prog/Batto-OBS-Tool/releases/tag/v1.9.1)

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
- Twitch-Hologrammfarben für Namen und Nachrichten,
- variables Touch-Deck.

## Branches

- `main`: stabiler Quellcode
- `release/windows-1.9.1-hotfix`: geprüfter Windows-Release-Stand 1.9.1

## Sicherheit und Verhalten

- kein automatischer Start einer zweiten App nach der Installation,
- Single-Instance-Sperre gegen doppelte Hauptfenster,
- OBS-Verbindung ausschließlich lokal,
- keine veröffentlichte Testwerte-Schaltfläche und kein öffentliches Demo-API,
- alte Creator-Hub-Produktnamen und alte separate EXEs sind nicht Bestandteil des Releases.

Die statische Referenzanalyse des alten 1.8.6-Installers steht unter `docs/CREATOR-HUB-1.8.6-INSTALLER-REFERENCE.md`.
