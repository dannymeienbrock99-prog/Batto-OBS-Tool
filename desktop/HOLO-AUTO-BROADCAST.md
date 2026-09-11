# Holo-Chatdesign und Auto-Broadcast

## Chatdesign verwenden

1. **Chat-Design / Hologramm** in der linken Navigation öffnen.
2. Twitch, TikTok, YouTube oder CNG auswählen. Jede Plattform hat eigene Farben, Schriftgrößen, Hintergrunddeckkraft, Leuchten und Animationen.
3. Optional Rollenfarben und Namensregeln ergänzen. Die Priorität lautet: Name → Rolle → Plattform. Rollen müssen vom jeweiligen Chat-Adapter geliefert werden.
4. **Design speichern** übernimmt die Einstellungen in den Hauptchat, das separate Chatfenster und die lokale OBS-Chatquelle.

Die Vorschau versendet keine Nachricht. Einstellungen liegen in `chat-design.json` im Benutzerdatenordner und sind im bestehenden Backup enthalten. Die früheren Einstellungen des separaten Browser-Editors werden nicht automatisch importiert; die vier Plattformdesigns werden einmal im neuen Editor eingerichtet.

**OBS-Adresse kopieren** liefert die gemeinsame Ausgabe. `/overlay` und `/chat-overlay` zeigen denselben Nachrichtenstrom. Optional begrenzt `?platform=twitch` (entsprechend `tiktok`, `youtube` oder `cng`) die Ausgabe auf eine Plattform. Im Multi-Chat unter Einstellungen kann die Browserquelle direkt in der aktuellen OBS-Szene angelegt werden. Der Server läuft ausschließlich auf `127.0.0.1`, normalerweise Port 17823; bei einem Portkonflikt wird eine freie Adresse angezeigt.

Holo-Farbverläufe und eigene Schriftarten gelten in Batto und OBS. Der öffentliche Plattformchat bestimmt seine Darstellung selbst. **Eigene Twitch-Namensfarbe** ändert separat die native Farbe des angemeldeten Twitch-Kontos; dazu wird die zusätzliche Berechtigung `user:manage:chat_color` benötigt.

## Verbindungen

Die Anmeldung erfolgt in **Multi-Chat → Einstellungen**. Twitch- und YouTube-Tokens bleiben ausschließlich für die aktuelle Programmsitzung im Speicher. Nach Neustart oder Ablauf muss erneut verbunden werden. Sie werden weder im Chatdesign noch im Broadcastplan gespeichert.

| Ziel | Verbindung | Versand |
| --- | --- | --- |
| Twitch | Kanal + gültiger Benutzer-OAuth-Token; `chat:read` für den Reader | Offizielle Helix-API mit `user:write:chat`; maximal 500 Zeichen. Erfolg erst bei `is_sent: true`. |
| YouTube | Aktive Video-ID/URL oder Livechat-ID + OAuth-Token mit `youtube` oder `youtube.force-ssl` | Offizielle Livechat-API; maximal 200 Zeichen. Erfolg erst mit Nachrichten-ID. |
| TikTok | TikFinity Desktop auf demselben PC (`127.0.0.1:21213`), alternativ bisheriger direkter LIVE-Reader | Die angebundene Schnittstelle empfängt Ereignisse; kein Chatversand. |
| CNG | Bisherige persönliche OBS-Chat-/Alert-Konfiguration | Ohne verifizierte Transport-/Sendeschnittstelle kein Chatversand. Eine konfigurierte URL bestätigt keine Verbindung. |

YouTube ermittelt die aktive Livechat-ID aus dem Video und liest Nachrichten mit dem vom Server vorgegebenen Mindestabstand. Geladener Chatverlauf wird angezeigt, löst aber keine alten Commands oder Events erneut aus. Bei abgelaufener Anmeldung, gesperrtem Chat oder API-Fehler erscheint ein Fehler; es gibt keine zusätzlichen Retry-Anfragen außerhalb des nächsten geplanten Laufs.

## Auto-Broadcast verwenden

1. **Chat Bot → Auto-Broadcast** öffnen und eine oder mehrere Nachrichten eingeben, jeweils eine pro Zeile.
2. Ziele, festen oder zufälligen Abstand, Startverzögerung und Textreihenfolge wählen.
3. Optional nur bei aktivem **OBS-Stream** senden und aktuelle Chat-Aktivität je Ziel verlangen. Das Zeitfenster und die erforderliche Anzahl sind einstellbar; alte Nachrichten und reine Plattformereignisse zählen nicht als aktuelle Chat-Aktivität.
4. **Speichern & planen** speichert den Zeitplan. Bei aktivem Bot, aktivem Zeitplan und eingeschaltetem globalen Schalter beginnt er nach der Startverzögerung (mindestens eine Sekunde).
5. **Zeitplan aktiv** pausiert alle automatischen Broadcasts. **Jetzt senden** ist ein ausdrücklich manueller Einzelversand des gespeicherten Eintrags, auch während der Zeitplan pausiert ist; LIVE- und Aktivitätsbedingungen gelten weiterhin.

Jedes Ziel wird unabhängig ausgewertet. Ein Fehler oder Timeout bei Twitch verhindert beispielsweise kein Ergebnis von YouTube. Gleichzeitiger Versand desselben Eintrags wird blockiert. Pausieren, Bearbeiten und Stoppen brechen noch laufende Anfragen ab und verhindern, dass alte Timer erneut anlaufen. Bereits übertragene Nachrichten lassen sich dadurch nicht zurückrufen.

| Ergebnis | Bedeutung |
| --- | --- |
| Gesendet | Plattform hat den Versand ausdrücklich bestätigt. |
| Unbestätigt | An einen Adapter übergeben, ohne ausdrückliche Plattformbestätigung. |
| Übersprungen | Verbindung/Fähigkeit fehlt, Bedingung ist nicht erfüllt oder Lauf wurde abgebrochen. Details beachten. |
| Fehler | Ablehnung, Netzwerkfehler oder Timeout. Bei Timeout kann die Zustellung unbekannt sein; kein sofortiger automatischer Wiederholungsversuch. |

Die zusätzliche lokale OBS-Anzeige ist separat gekennzeichnet und bestätigt keinen Plattformversand. Sie berücksichtigt ebenfalls LIVE- und Aktivitätsbedingungen. Zustellberichte bleiben für die aktuelle Sitzung erhalten; Zeitpläne werden dauerhaft in `chat-bot.json` gespeichert.

## Entwicklung

`npm test` führt die bestehenden Prüfungen und `test/holo-broadcast.test.cjs` aus. Die neuen Tests decken Design-Persistenz, gemeinsame OBS-Ausgabe, Wiederverbindung, getrennte Ergebnisse, Abbruch, Timer-Lebenszyklus, Aktivitätsfenster und API-Antworten mit kontrollierten Testdaten ab. Es werden dabei keine echten Chatnachrichten versendet.

Der Windows-Workflow prüft auch Pull Requests gegen `release/windows-2.0.0-integrated` und baut ein NSIS-Testartefakt. Dies veröffentlicht keine neue Release-Version. Ein echter Kontotest mit gültigen Tokens sowie die visuelle Abnahme in Electron/OBS bleiben vor der Veröffentlichung erforderlich.

Verwendete Schnittstellen: [Twitch-Tokenvalidierung](https://dev.twitch.tv/docs/authentication/validate-tokens/), [Twitch Chat API](https://dev.twitch.tv/docs/api/reference/#send-chat-message), [Twitch-Namensfarbe](https://dev.twitch.tv/docs/api/reference/#update-user-chat-color), [YouTube-Versand](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert), [YouTube-Chatlesen](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list), [TikFinity Event API](https://tikfinity.zerody.one/tiktok/dapi).
