# Gym Log

Web-App (PWA) zum Tracken deiner Trainingspläne: Sätze, Gewichte, Wiederholungen,
Pausentimer, Vorschläge fürs nächste Training, Verlauf, Rekorde und Körpergewicht.
Läuft auf iPhone, iPad und PC, funktioniert offline und gleicht sich über ein
privates GitHub-Repository zwischen den Geräten ab.

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html`, `css/app.css` | Oberfläche (hell/dunkel, fürs Handy optimiert) |
| `js/app.js` | Ansichten und Bedienung |
| `js/store.js` | lokaler Speicher, Zusammenführen von Änderungen |
| `js/sync.js` | Sync mit einer JSON-Datei in einem privaten GitHub-Repo |
| `js/progression.js` | Verlauf, Rekorde, Vorschläge (Doppel-Progression) |
| `js/timer.js`, `js/charts.js` | Pausentimer, Diagramme |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline-Betrieb und Installation als App |

Keine Abhängigkeiten, kein Build-Schritt – die Dateien werden so, wie sie sind, ausgeliefert.
Im Code stehen **keine persönlichen Daten**: Die App startet leer und zeigt eine Willkommensseite.

## 1. Online stellen (GitHub Pages, kostenlos)

1. Auf github.com ein **öffentliches** Repository `gym-log` anlegen.
2. „Add file → Upload files“ und den **Inhalt** dieses Ordners hochladen (Ordner `css`, `js`, `icons` mit).
3. Settings → Pages → Source: *Deploy from a branch* → Branch `main`, Ordner `/ (root)` → Save.
4. Nach ca. einer Minute läuft die App unter `https://<benutzername>.github.io/gym-log/`.

Die App ist unter diesem Link für jeden erreichbar, aber jeder Besucher bekommt nur eine eigene,
leere Version. Deine Daten stehen nur auf deinen Geräten und im privaten Daten-Repo.

## 2. Sync einrichten

1. Zweites Repository `gym-daten` anlegen, **Private**, mit README.
2. Token erstellen: <https://github.com/settings/personal-access-tokens/new>
   - Repository access: *Only select repositories* → `gym-daten`
   - Repository permissions → *Contents*: **Read and write**
   - Ablaufdatum möglichst lang
3. In der App unter **Mehr → Synchronisierung** `benutzername/gym-daten` und den Token eintragen.
4. Auf jedem weiteren Gerät genauso eintragen.

**Deine Startdaten** (Trainingspläne + letzte Werte) liegen separat in
`startdaten/gym-log-startdaten.json` – diese Datei **nicht** mit hochladen. Am einfachsten
am PC: App öffnen → „Daten importieren“ → Datei wählen → Sync einrichten. Auf iPhone und iPad
dann nur noch den Sync einrichten, die Daten kommen automatisch.

Die App speichert immer zuerst lokal. Mit Netz wird automatisch abgeglichen (beim Öffnen,
beim Schließen, nach dem Training und kurz nach Änderungen). Pro Eintrag gewinnt die
neuere Version, gelöschte Einträge werden auch auf den anderen Geräten gelöscht.
Jeder Sync ist ein Commit – das Daten-Repo ist damit gleichzeitig ein Backup mit Verlauf.

## 3. Als App installieren

- **iPhone / iPad:** Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“.
- **PC:** In Chrome oder Edge auf das Installieren-Symbol in der Adressleiste klicken.

## Vorschläge – wie sie entstehen

Pro Übung wird das letzte Training mit deinem Zielbereich verglichen (Sätze mit gleichem
Bereich und gleichem Gewicht zusammen, z. B. bei `2x 5-8 + 1x 8-12`):

- alle Sätze am oberen Ende → Gewicht + Schritt (Standard 2,5 kg, pro Übung einstellbar), Ziel wieder unten
- im Zielbereich → Gewicht halten, je Satz +1 Wdh
- unter dem Bereich → Gewicht halten; im Schnitt 2+ Wdh drunter → etwas leichter
- zweimal in Folge drunter → Hinweis, ggf. leichter zu gehen

## Updates

Nach Änderungen an den Dateien in `sw.js` die `VERSION` erhöhen und neu hochladen.
Die App lädt die neue Version im Hintergrund und nutzt sie ab dem nächsten Start.

## Lokal testen

```bash
py -m http.server 8123 --directory gym-log
```

Dann <http://localhost:8123> öffnen (der Offline-Cache ist lokal nur mit `?sw=1` aktiv).
