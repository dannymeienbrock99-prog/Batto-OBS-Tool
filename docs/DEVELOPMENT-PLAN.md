# Batto OBS Tool 2.0.0 – V4 Abnahme

## Produktziel

Die Windows-Anwendung wird als eine Electron-Anwendung mit NSIS-Installer ausgeliefert. Der V4-Stand bündelt OBS-Steuerung, Multi-Chat, Moderation, Chat-Filter, Chat Bot, Chat-Design, Co-Host, Medien, TTS, Overlays, Discord, kompakte Stream-Statusleiste, Logs und Backup.

## Verbindliche V4-Bereiche

- einheitliche Navigation und vollflächiger Programm-Hintergrund
- Multi-Chat für Twitch, TikTok, CNG und YouTube
- abtrennbares Chatfenster ohne doppeltes eingebettetes Chatfenster
- plattformgetrennte Moderationslisten und Moderationsverlauf
- klare Kennzeichnung **Plattform** oder **Lokal** bei Moderationsaktionen
- Chat-Filter vor Chat Bot und OBS-Ausgabe
- frei erstellbare Commands, Hotkeys und Multi-Actions
- Auto-Broadcast
- Event-System mit den Ereignissen, die der jeweilige Adapter tatsächlich liefert
- Medienbibliothek und Medien-Pools ohne verpflichtende Roh-Konfiguration
- TTS
- lokale OBS-/HTTP-Browser-Overlays
- Discord-Webhooks
- Co-Host-Layout 1080 × 1920 für TikTok und 1920 × 1080 für Twitch
- lokale Co-Host-HTTP-Anzeige
- kompakte Stream-Statusleiste
- filterbare Logs
- Backup/Import/Export
- CRAZY_BATTO / Team Alpha Programm- und Desktop-Branding

## Plattform-Regel

Eine plattformspezifische Funktion darf nur als verfügbar gelten, wenn der aktive Adapter oder die offizielle/verifizierte Schnittstelle sie tatsächlich unterstützt. Nicht unterstützte Funktionen bleiben deaktiviert oder werden als lokal ausgeführt. Es gibt keine erfundenen Remote-Erfolgsmeldungen.

## Entfernte Bereiche

Folgende Bereiche dürfen im produktiven V4-Stand nicht wieder erscheinen:

- Hardware-Vollanalyse
- Encoder-Empfehlung
- Encoder-/Hardware-Monitoring
- CPU-Belastungstest
- automatischer OBS-Aufnahme-Belastungstest
- Deck-Funktionen und Deck-Produktbereiche

## Abnahmeregeln

- keine alten Produktnamen in der produktiven Oberfläche
- ausschließlich Batto OBS Tool / Crazy_Batto / Team Alpha als Produktbranding
- keine falschen Erfolgsmeldungen
- keine erfundenen Sensor- oder Plattformwerte
- Einstellungen bleiben nach Neustart erhalten
- lokale Dienste bleiben auf Loopback-Adressen
- sensible Daten werden nicht in UI-Logs ausgegeben
- V4-Kompletttests müssen vor dem Windows-Build erfolgreich sein
- Installer, Branding, Hintergrund und entfernte Altbereiche werden im Release-Workflow geprüft
