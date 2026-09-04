# Batto OBS Tool

Windows-Projekt von **Crazy_Batto / Team Alpha**.

## Aktueller Entwicklungsstand

**Batto OBS Tool 2.0.0 – V4**

Die produktive Anwendung wird als eine Electron-App mit NSIS-Installer gebaut. Der aktuelle V4-Stand enthält Multi-Chat, lokale Moderationsverwaltung, Chat-Filter, Chat Bot, OBS-Steuerung, Chat-Design/Hologramm, Co-Host-Layout, Medienbibliothek, Medien-Pools, TTS, OBS-/HTTP-Overlays, Discord-Webhooks, kompakte Stream-Statusleiste, Logs sowie Backup/Import/Export.

## Multi-Chat

Unterstützte Plattform-Adapter:

- Twitch
- TikTok LIVE
- CNG
- YouTube

Welche Funktionen tatsächlich verfügbar sind, wird pro Adapter ausgewiesen. Eine Funktion wird nicht als Plattform-Funktion dargestellt, wenn die jeweilige Schnittstelle sie nicht unterstützt.

Die Moderationsverwaltung speichert Moderatoren, stummgeschaltete und blockierte Nutzer sowie den Verlauf plattformgetrennt. Aktionen werden im Verlauf nur dann als **Plattform** markiert, wenn eine Plattform-Schnittstelle die Aktion tatsächlich bestätigt. Andernfalls bleibt die Aktion **Lokal**.

## Chat Bot und Events

Der Chat Bot unterstützt frei definierbare Commands, Berechtigungen, Cooldowns, Hotkeys, Multi-Actions, Medien, TTS, OBS-Aktionen, Discord-Webhooks, Auto-Broadcast und lokale OBS-Browser-Overlays.

TikTok-Ereignisse wie Gift, Like, Member, Social/Share und Subscribe werden aus dem vorhandenen Reader in das Event-System übernommen. Andere Plattform-Ereignisse werden nur verarbeitet, wenn der jeweilige Adapter sie tatsächlich liefert.

## Co-Host

Der lokale Co-Host-Dienst stellt Layouts auf `127.0.0.1` bereit:

- TikTok: 1080 × 1920
- Twitch: 1920 × 1080
- 1 bis 8 Plätze
- konfigurierbare Abstände, Rahmen und Ecken

Bei TikTok ist keine Gast-URL Pflicht. Dort kann eine OBS-/Capture-Quelle hinterlegt werden. Der lokale HTTP-Dienst erzeugt das Layout; er erfindet oder umgeht keine nicht vorhandene Plattform-API.

## OBS

OBS WebSocket 5 wird ausschließlich lokal über `127.0.0.1` bzw. `::1` verwendet. Unterstützt werden unter anderem Verbinden/Trennen, Szenenwechsel, Stream- und Aufnahme-Steuerung sowie die lokalen Browser-Overlays.

## Statusleiste

Die kleine Stream-Statusleiste zeigt nur tatsächlich verfügbare Laufzeitwerte wie CPU, RAM, Upload, Framedrops, Bitrate und FPS. Sie ist keine Hardware-Vollanalyse und führt keinen Belastungs- oder Aufnahmetest aus.

## Entfernte Bereiche

Nicht Bestandteil des produktiven V4-Standes sind:

- Hardware-Vollanalyse
- Encoder-Empfehlung
- Encoder-/Hardware-Monitoring
- automatischer CPU-Belastungstest
- automatischer OBS-Aufnahme-Belastungstest
- Deck-Funktionen oder Deck-Produktbereiche

Die Release-Prüfung blockiert diese Bereiche, falls sie wieder in den produktiven Stand geraten.

## Sicherheit und Speicherung

- Single-Instance-Sperre gegen doppelte Hauptfenster
- OBS nur lokal
- lokale HTTP-/WebSocket-Dienste auf Loopback-Adressen
- sensible CNG-Daten über Electron `safeStorage`, soweit vorgesehen
- V4-Konfiguration und Moderationsdaten im lokalen Benutzerprofil
- Backup/Import/Export mit begrenzter Medienmitnahme
- keine erfundenen Plattform-Erfolgsmeldungen

## Windows-Build

Der Release-Workflow prüft V4-Quellvertrag, Tests, Branding, entfernte Altbereiche und baut anschließend den Windows-x64-NSIS-Installer `Batto-OBS-Tool-Setup-2.0.0.exe` samt SHA-256-Prüfsumme.
