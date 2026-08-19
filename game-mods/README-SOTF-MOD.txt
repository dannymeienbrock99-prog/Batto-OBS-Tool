CRAZY_BATTO SOTF INTEGRATION 0.3.0
==================================

In diesem Ordner befinden sich:

1. CrazyBatto-SOTF-Mod-Installer.exe
   Eine grafische Windows-Anwendung. Sie erkennt beziehungsweise fragt den
   Sons-of-the-Forest-Spielordner ab, baut die Mod gegen die dort vorhandenen
   RedLoader-/Spiel-Assemblies und installiert die erzeugten DLLs in "Mods".

2. CrazyBatto-SOTF-DeathCounter-Module-v0.3.0-source.zip
   Das vollständige MIT-lizenzierte Quellmodul.

Warum wird nicht einfach eine beliebige vorgebaute DLL mitgeliefert?
Der RedLoader-Adapter muss gegen die RedLoader- und Spiel-Assemblies der
installierten Sons-of-the-Forest-Version gebaut werden. Der grafische Installer
verwendet dafür ausschließlich die Dateien auf deinem Computer und meldet einen
Fehler, wenn RedLoader, das Spiel oder das .NET-SDK fehlt.

VORAUSSETZUNGEN
---------------
- Sons of the Forest für Windows
- RedLoader installiert und das Spiel mindestens einmal gestartet
- aktuelles .NET SDK mit .NET-6-Unterstützung

INSTALLATION
------------
1. CrazyBatto-SOTF-Mod-Installer.exe öffnen.
2. Den Spielordner prüfen oder über "Ordner wählen" auswählen.
3. "Mod bauen und installieren" anklicken.
4. Sons of the Forest anschließend über RedLoader starten.

Nach erfolgreichem Spielstart:
Death-Counter-Overlay: http://127.0.0.1:19447/overlay

Der Installer meldet niemals Erfolg, wenn Build, DLL oder manifest.json fehlen.
