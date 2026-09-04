# Batto OBS Tool 2.1.0 – verbindlicher Projektumfang

Stand: 04.09.2026

Dieses Dokument fasst die im Projektverlauf festgelegten Anforderungen zusammen. Es dient als Schutz davor, beim Einbau einer neuen Funktion andere vorhandene Bereiche zu löschen oder umzubauen.

## Grundregel

Neue Funktionen werden ergänzt. Vorhandene, weiterhin gewünschte Funktionen bleiben erhalten. Entfernt werden nur Funktionen, die ausdrücklich als entfernt festgelegt wurden.

## Hauptnavigation / Module

Die vollständige 2.1-Suite enthält mindestens:

- Übersicht
- OBS
- Multi-Chat
- Moderation
- Co-Host
- Touch-Deck
- Twitch-Hologramm
- Stream-/Chat-Overlay
- Plugins
- Handy verbinden
- Einstellungen

Weitere bestehende Creator-/Overlay-Werkzeuge dürfen erhalten bleiben, sofern sie nicht zu den ausdrücklich entfernten Hardware-/Encoder-Diagnosefunktionen gehören.

## Übersicht

- Das alte `bg.jpg` wird nicht mehr als hochskaliertes/verpixeltes Hintergrundbild verwendet.
- Stattdessen wird eine skalierbare Multi-Chat-Grafik verwendet.
- Die Übersicht zeigt OBS-, TikTok/TikFinity-, Multi-Chat- und Touch-Deck-Status.

## OBS

- OBS WebSocket 5.x lokal über `127.0.0.1:4455`.
- Passwort verschlüsselt speichern.
- Szenen, Stream, Aufnahme und virtuelle Kamera direkt steuern.
- Plattformfehler dürfen OBS nicht blockieren.

## Multi-Chat

Plattformen:

- TikTok / TikFinity
- Twitch
- YouTube
- CNG

Anforderungen:

- Ein gemeinsamer Chatverlauf.
- Plattformfilter.
- TTS optional.
- Chat-Overlay als OBS-Browserquelle.
- TikTok primär über lokalen TikFinity-WebSocket `ws://127.0.0.1:21213/`.
- Für den TikFinity-Weg darf kein Euler-Key Pflicht sein.
- Ein direkter TikTok-Connector darf nur optionaler Fallback sein.
- TikFinity darf nicht gleichzeitig doppelt durch Renderer und Backend verbunden werden; es gibt genau einen zuständigen Transportweg.
- Ist TikFinity nicht gestartet, wird ein verständlicher Offline-/Nicht-erreichbar-Status angezeigt statt eines Absturzes.

## Moderation

Getrennt für:

- TikTok
- Twitch
- YouTube
- CNG

Rechtsklick auf einen Chatnamen:

- Als Moderator hinzufügen
- Als Moderator entfernen
- Stummen
- Blockieren
- Entstummen
- Entblocken

Moderationsdaten:

- Benutzername
- Plattform
- Aktion
- ausführender Moderator/Akteur
- Grund
- letzte Chatnachricht
- Zeitpunkt
- Ergebnis/Scope: `Plattform` oder `Lokal`

Eine Aktion darf nicht als Plattform-Sperre dargestellt werden, wenn technisch nur lokal gefiltert wurde.

## Touch-Deck

Verwendet wird der Touch-Deck-Stand vom 02.08.2026:

`51be33d29c07f50323b19d58782804af391b8394`

Festgelegt:

- sichtbare 5×3-/15-Tasten-Oberfläche beibehalten
- kein Touch-Deck Pro als Produktionsersatz
- Original-WPF-Komponente `CreatorHub.TouchDeck.exe`
- OBS-Aktionen
- Profile / Seiten wie im 02.08.-Stand
- Plugin-Manifeste laden
- bekannte Creator-Hub-, Batto- und Elgato-Pluginpfade scannen
- Rechtsklick auf Taste mit:
  - Taste einstellen
  - Plugin / Aktion auswählen
  - Eigenes Bild wählen
  - Aktion testen
  - Plugins neu laden
  - Taste leeren

Drittanbieter-Plugins werden nur dann als tatsächlich ausführbar bezeichnet, wenn eine kompatible Laufzeit vorhanden und getestet ist.

## Plugins

- Eigenständiger Plugin-Bereich im Batto OBS Tool bleibt vorhanden.
- Scan bekannter Batto-/Creator-Hub-/Elgato-Verzeichnisse.
- Manifest, Name, Version, Icon und Aktionen anzeigen, soweit vorhanden.
- Native Batto-Aktionen und externe erkannte Plugins unterscheiden.
- Keine nicht vorhandene Plugin-Laufzeit vortäuschen.

## Twitch-Hologramm

Der Editor wird als eigener Bereich beibehalten und umfasst:

- Hologramm ein/aus
- Benutzername gestalten
- Chatnachricht gestalten
- Schriftart
- Farben
- Anzahl Farben
- Farbwinkel
- Animationsgeschwindigkeit
- Glow
- Helligkeit
- Sättigung
- Rollen-/Benutzerstile
- OBS-Live-Vorschau
- OBS-Browserquellen-URL

Keine Font-Dateien werden mitgeliefert; verwendet werden System-/Websafe-Schriften.

## Co-Host

- Anzahl der Plätze konfigurierbar.
- TikTok-Preset: Hochformat 1080×1920.
- Twitch-Preset: Querformat 1920×1080.
- Lokale HTTP-Browserquelle für OBS.
- Pro Platz konfigurierbare Gast-/Browserquelle.
- Dies ist ein Batto-OBS-Layout; ohne echte Plattform-Guest-API wird es nicht als native TikTok-Gaststeuerung bezeichnet.

## Stream-/Chat-Overlay

- eigener Bereich bleibt vorhanden
- lokale Browserquelle
- URL kopieren/öffnen
- in OBS anlegen/entfernen
- Chat und Live-Ereignisse an Overlay weiterreichen

## Handy verbinden

- lokaler Server
- WLAN / LAN / USB-Tethering
- PIN
- QR-Code
- optionale Freigabe am PC
- verbundene Geräte anzeigen/trennen
- keine Cloud-Pflicht

## Einstellungen

Einstellungen für:

- Allgemein
- OBS
- TikTok / TikFinity
- Twitch
- YouTube
- CNG
- Multi-Chat
- Moderation
- Overlays
- Twitch-Hologramm
- Plugin-/Touch-Deck-Verknüpfung soweit erforderlich
- Systemstatus

Euler darf nicht als Pflicht für den lokalen TikFinity-Weg dargestellt werden.

## Ausdrücklich entfernt

Folgende Funktionen bleiben aus dem 2.1-Produktionspfad entfernt:

- Hardwarediagnose
- PC-Hardware-Scan
- CPU-Belastungstest
- Encoder- und Hardware-Monitoring
- hardwarebasierte Encoder-Empfehlung
- zugehörige Hardware-/Telemetry-Runtime
- Touch-Deck-Pro-Produktionsoberfläche

## Testregeln

Vor einem Testbuild:

1. `prepare:integrated` erfolgreich.
2. Source-Validator erfolgreich.
3. Keine entfernten Hardware-/Monitoring-Bereiche im Produktionsrenderer.
4. Kein `Touch-Deck Pro` im Produktionsrenderer.
5. Vollständige Hauptnavigation vorhanden.
6. Multi-Chat-/TikFinity-Parser- und Adaptertests erfolgreich.
7. Plugin-IPC und Plugin-Scan geprüft.
8. Moderations-Rechtsklick und Audit-Daten geprüft.
9. Hologramm-Editor und Schriftart geprüft.
10. Co-Host-URLs und Layouts geprüft.
11. gepackte Windows-EXE Self-Test erfolgreich.
12. UI-Smoke-Test erfolgreich.
13. Installer erfolgreich gebaut.

## Aussage über Funktionsfähigkeit

Automatisierte CI kann Build, Syntax, Unit-/Integrationstests und UI-Smoke-Test bestätigen. Echte Plattformfunktionen mit realen Accounts, OBS-Installation, TikFinity-LIVE und Drittanbieter-Plugins werden nur dann als live getestet bezeichnet, wenn sie auf einem entsprechenden Windows-System tatsächlich ausgeführt wurden.
