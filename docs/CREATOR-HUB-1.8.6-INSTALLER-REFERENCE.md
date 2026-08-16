# Referenzanalyse: Creator Hub Setup 1.8.6

Die vom Projektinhaber bereitgestellte Datei `Creator Hub Setup 1.8.6(2).exe` wurde ausschließlich statisch untersucht. Sie wird nicht als neuer Produktbestandteil verteilt.

## Prüfsumme

```text
SHA-256: 2bbab86656acaa14bc5999e641a2ec96ecfad32d2f3bf0ab8d69f5715261e618
```

## Erkannter Paketaufbau

Der alte Installer ist ein NSIS-Selbstentpacker. Sein installierter Kern besteht aus **einer Electron-Anwendung**:

```text
Creator Hub.exe
├── resources/app.asar
├── Electron-/Chromium-Laufzeitdateien
├── locales/
└── resources/
    ├── Lizenz und Datenschutz
    ├── gebündelte Icon-Pakete
    ├── gebündelte Plugins
    ├── gebündelte Widgets
    └── damalige Mobile-Webdateien
```

Die Anwendungsteile liefen damit nicht als mehrere eigenständige Programme. Touch-Deck, OBS-Verbindung, Overlay-Server und weitere Module wurden aus derselben Electron-Anwendung gestartet.

## Übernommene Architektur für Batto OBS Tool

Batto OBS Tool 1.9.1 verwendet denselben sinnvollen Grundsatz:

- eine Windows-x64-Anwendung,
- ein NSIS-Installer,
- ein `app.asar`,
- lokale Module innerhalb der Anwendung,
- keine zusätzliche Monitoring- oder Hologramm-EXE,
- keine automatisch gestartete zweite Programm-Instanz nach der Installation.

## Bewusste Änderungen

- Produktname ausschließlich **Batto OBS Tool**.
- Branding ausschließlich **Crazy_Batto / Team Alpha**.
- OBS-Verbindung ausschließlich lokal über `127.0.0.1` beziehungsweise `::1`.
- Single-Instance-Sperre verhindert doppelte Hauptfenster.
- Der Installer startet die Anwendung nicht automatisch.
- Interne Fake-Hardware-/Demotelemetrie wird nicht veröffentlicht.
- Monitoring und Twitch-Hologramm werden als lokale Module derselben Anwendung ausgeliefert.
- Plugins und die Handy-App bleiben bis nach dem stabilen Windows-Meilenstein getrennte Folgearbeiten.
