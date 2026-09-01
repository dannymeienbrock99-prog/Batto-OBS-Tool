# Batto Unified Multi-Chat

## UI

Der Multi-Chat ist eine gemeinsame Ansicht für Twitch, CNG, TikTok und YouTube. Jede Nachricht trägt Plattform, Farbe, Rollen/Badges und optionale Metadaten. Der Verlauf ist auf 500 Nachrichten begrenzt und UI-Updates werden gebündelt.

Der Chat wird in das Hauptfenster eingebettet und zusätzlich als eigenes `BrowserWindow` geöffnet. Mit dem Pfeil wird abgedockt; beim Abdocken wird die eingebettete Ansicht ausgeblendet. Beim Schließen/Docken kehrt die Ansicht ins Hauptfenster zurück. Fenstergröße und Position werden lokal gespeichert; beim ersten Öffnen wird ein externer Monitor bevorzugt.

`Ctrl+Shift+C` öffnet bzw. schließt den separaten Chat.

## Twitch

Der Reader verwendet Twitch IRC über WebSocket. Der Nutzer gibt Kanal, OAuth-Token und Reader-Username ein. Der Token wird nur an den Main-Prozess weitergegeben.

## CNG

Die persönliche CNG-Chat-URL und persönliche Alert-URL werden über das bestehende CNG-Konfigurationsmodell validiert. Das `obsChatToken` wird separat über Electron `safeStorage` gespeichert; die JSON-Konfiguration enthält keinen Token.

Der konkrete CNG-Realtime-Transport ist absichtlich nicht geraten. Ohne eine verifizierte Schnittstelle bleibt der Adapter bei `configured` und meldet keine erfundenen Live-Nachrichten.

## TikTok LIVE

Das Projekt nutzt `tiktok-live-connector` als optionalen Reader für öffentliche LIVE-Streams. Chat sowie Gift, Like, Member, Social und Subscribe werden in den gemeinsamen Feed normalisiert. Es werden keine Login-Credentials für das Lesen eines öffentlichen LIVE-Streams verlangt.

## YouTube

Die Adapter-Grenze ist vorbereitet. Ein echter YouTube-Live-Chat-Transport kann später über eine verifizierte YouTube-API/Live-Chat-ID angeschlossen werden, ohne die UI oder den MessageStore zu ändern.

## TTS

Batto TTS ist plattformunabhängig. Die Konfiguration unterstützt Systemstimmen, Sprache/Accent, Geschwindigkeit, Pitch, Lautstärke, Queue-Limit, Cooldown, maximale Kommentarlänge sowie Allow-/Block-Listen. Die Voice-Auswahl nutzt die auf dem System verfügbaren Speech-Synthesis-Stimmen; keine proprietären TikFinity-Stimmen oder deren Code werden kopiert.

## Performance

`ChatCore` -> `ChatStore` -> 60-ms-Batch -> Renderer. Es gibt keinen vollständigen DOM-Rebuild im Main-Prozess pro einzelner Nachricht. Der Store ist begrenzt, Listener werden über Preload-Wrapper registriert und der separate BrowserWindow verwendet denselben Core statt eigene Plattformverbindungen zu öffnen.
