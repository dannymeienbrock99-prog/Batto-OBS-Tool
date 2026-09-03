# BATTO MULTI-CHAT – sauberes Test-Gerüst

Dieses Verzeichnis ist die neue technische Zielstruktur. Das bestehende BATTO-MULTI-CHAT-Fenster bleibt bestehen und wird später nur gepflegter an dieses Gerüst angebunden.

## Struktur

- `core/` – Message Bus, Normalisierung, Nutzer/Rollen, Verbindungsstatus
- `platforms/` – strikt getrennte Plattform-Connectoren
- `moderation/` – Mute, Ban, Moderatoren, Filter
- `storage/` – Settings, Accounts, Secrets
- `obs/` – Chat-/Alert-Overlay
- `tts/` – Vorlesefunktionen

## Regeln

1. Keine Plattformlogik direkt im Renderer.
2. Keine Secrets im Renderer oder in Klartext-JSON.
3. Renderer bekommt ausschließlich normalisierte Daten über IPC.
4. Jede Plattform meldet denselben Connection-State.
5. UI-Einstellungen und technische Diagnose bleiben getrennt.
6. Bestehendes Multi-Chat-Layout bleibt erhalten; nur Pflege und Konsistenz werden verbessert.

## Gemeinsames Nachrichtenmodell

```js
{
  platform,
  eventType,
  user: { id, username, displayName, avatar, roles, badges },
  text,
  timestamp,
  gift,
  metadata
}
```

## Geplante Plattformmodule

```text
platforms/
  tiktok/
    connector.cjs
    auth.cjs
    api.cjs
    events.cjs
    moderation.cjs
    gifts.cjs
  twitch/
  youtube/
  cng/
```

Der aktuelle Test ist absichtlich noch ohne echte OAuth-Logins und ohne Installer.