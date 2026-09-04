# Batto OBS Tool 2.1.0 – Hybrid-Architektur

## Produktprinzip

Batto OBS Tool trennt Produktionsfunktionen, TikTok-spezifische Funktionen und externe Plattformdaten. Eine nicht erreichbare Plattform darf niemals die komplette Anwendung blockieren.

## OBS Studio

OBS ist der Produktionskern für:

- Szenen und Quellen
- Audio
- Aufnahme und Streaming
- virtuelle Kamera
- Browserquellen und Overlays
- Touch-Deck-Aktionen
- Telemetrie und Status

OBS WebSocket verwendet standardmäßig `127.0.0.1:4455`. Das Passwort wird nicht in `settings.json` gespeichert, sondern im verschlüsselten SecretStore.

## TikTok LIVE Studio

TikTok LIVE Studio ist die bevorzugte lokale Ebene für TikTok-spezifische Funktionen. Batto OBS Tool erkennt die Installation automatisch oder verwendet einen manuell eingetragenen EXE-Pfad.

Die Integration besitzt eigene Zustände:

- nicht installiert
- installiert
- läuft
- nicht verfügbar

Ein fehlendes LIVE Studio schaltet die App nicht ab. Falls konfiguriert, bleibt die TikTok-LIVE-API als Fallback verfügbar.

## TikTok LIVE API / Euler

Die Event-Ebene ist getrennt von LIVE Studio und kann Chat, Gifts, Follows, Shares, Likes, Joins, Subscriptions und Moderationsereignisse liefern.

Euler Sign API Keys werden ausschließlich im SecretStore gespeichert. Reconnect verwendet konfigurierbare Unter- und Obergrenzen; Rate-Limit-Schutz kann separat aktiviert werden.

## Twitch

Twitch ist als eigener Plattformadapter vorgesehen. Der Zieltransport ist EventSub WebSocket. OAuth-Tokens werden im SecretStore gespeichert.

## YouTube

YouTube ist als eigener Plattformadapter vorgesehen. Für LiveChat ist `streamList` als Transportmodell konfiguriert. OAuth-Tokens werden im SecretStore gespeichert.

## CNG

CNG bleibt ein optionaler Adapter mit Plattform-, Profil-, API- und WebSocket-Adresse. Nicht konfigurierte API-/WebSocket-Adressen sind kein Programmfehler.

## Connection Manager

Alle Verbindungen besitzen eigene Zustände und Fehlerdaten. Der Start verwendet `Promise.allSettled`, sodass beispielsweise ein Twitch-OAuth-Fehler OBS, TikTok oder CNG nicht beendet.

Mögliche Zustände:

- `idle`
- `disabled`
- `connecting`
- `connected`
- `ready`
- `unavailable`
- `error`

## Health Check

Der Systemcheck prüft:

- Settings Store
- OBS-Konfiguration
- TikTok LIVE Studio
- TikTok API/Sign-Key
- Twitch OAuth
- YouTube OAuth/LiveChat-ID
- CNG-Konfiguration

Das Ergebnis unterscheidet zwischen vollständig bereit und betriebsbereit mit optionalen Hinweisen.

## Build-System

`desktop/src` ist die einzige Produktionsquelle. Produktionsdateien werden nicht mehr bei jedem Build aus `bootstrap-2.0` überkopiert.

Empfohlene Reihenfolge:

1. `npm ci`
2. `npm test`
3. `npm run pack:win`
4. ungepackte Anwendung testen
5. `npm run dist:win`
6. Installer testen

GitHub Actions führt Tests und den ungepackten Windows-Build automatisch aus.
