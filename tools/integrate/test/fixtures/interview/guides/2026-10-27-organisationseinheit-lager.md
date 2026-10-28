# Interviewleitfaden: Organisationseinheit Lager

Nordwind Handel GmbH · offene Fragen aus analyzr vom 27.10.2026 · 4 Fragen in der Reihenfolge von „Offene Fragen“ (die mit der größten Wirkung zuerst)

## Vor dem Gespräch

- [ ] Einverständnis eingeholt: Aufzeichnung oder Mitschrift, Auswertung mit einem KI-Assistenten (Namen vorher ersetzt), Ergebnis in analyzr ohne Namen
- [ ] Gesprächspartner nur mit ihrer Rolle notiert, ohne Namen

Ohne Einverständnis zur Aufzeichnung: nur eine Mitschrift. Ohne Einverständnis zur Auswertung mit einem KI-Assistenten: Transkript und Mitschrift nicht unter `transcripts/` ablegen und keinem KI-Assistenten geben; die Antworten dann von Hand in analyzr eintragen.

## Einstieg

„Danke, dass du dir die Zeit nimmst. Wir möchten verstehen, wie die Abläufe in deinem Bereich heute tatsächlich laufen, auch dort, wo noch nichts aufgeschrieben ist. Es gibt keine falschen Antworten.“

## Fragen

### F1. Externer Partner oder fehlendes Modell? Nachrichten: „Lieferavis“.

`q-3f2a9c41d07be815` · Pool ohne Prozess · Modell `lager/wareneingang`

- Warum wir fragen: Der Pool hat im Modell keinen Prozess: ein externer Partner, oder ein Prozess, dessen Modell fehlt. Nachrichtenflüsse: „Lieferavis“ an „Ware angekündigt“.
- Betrifft: Pool in „Nordwind Handel – Wareneingang“
- Was die Landkarte schon sagt: Der Pool „Spedition“ schickt dem Wareneingang das Lieferavis; einen Prozess dafür hat die Landkarte nicht.
- Bisher notiert (21.10.2026): Laut Lagerleitung kommt das Avis über das Speditionsportal.
- In „Offene Fragen“ danach, je nach Antwort: „Liegt außerhalb der Landschaft“ oder „Verknüpfen mit …“
- Nachfragen:
  - Wer im Lager bekommt das Lieferavis, und was passiert danach?
  - Kommt jede Lieferung mit einem Avis an?
- Notizen:

### F2. Gilt die Übergabe an den Versand auch für Expressaufträge? Und wer gibt sie frei?

`q-8b1d0e2f4a6c9375` · Vorgemerkt · Modelle `lager/kommissionierung`, `versand/versand-vorbereiten`

- Betrifft: „Kommissionierung“ → „Versand vorbereiten“
- Notiz zur Vormerkung: Laut Workshop gibt es einen eigenen Express-Ablauf, siehe https\://wiki.nordwind.example/lager \[intern\] \*vorläufig\*
- Vormerkung: mit Lager klären
- Was die Landkarte schon sagt: „Kommissionierung“ endet mit „Kommissioniert“; „Versand vorbereiten“ beginnt mit einer Nachricht ohne Namen.
- Bisher notiert (22.10.2026): Express läuft über die Packstation 2.  
  Freigabe durch die Schichtleitung.
- In „Offene Fragen“ danach: „Vorschlag prüfen“
- Notizen:

### F3. Was leistet „Wareneingang“?

`q-1e5f7a3c9d2b4086` · Prozess ohne Dokumentation · Modell `lager/wareneingang`

- Warum wir fragen: Der Prozess hat im Modell keine Dokumentation.
- Betrifft: „Wareneingang“
- In „Offene Fragen“ danach: „Dokumentation ergänzen …“
- Notizen:

### F4. Welchen Prozess ruft „Nachschub anfordern“ auf?

`q-9d3b6f1a8e2c7054` · Aufrufziel unbekannt · Modell `lager/kommissionierung`

- Warum wir fragen: Der Aufruf nennt kein Ziel, das ein Modell der Landschaft definiert.
- Betrifft: „Nachschub anfordern“
- In „Offene Fragen“ danach, je nach Antwort: „Ziel im Modell eintragen …“, „Nur verknüpfen …“ oder „Liegt außerhalb der Landschaft“
- Nachfragen:
  - Wer stößt den Nachschub an, und wo kommt die Ware her?
- Notizen:

## Abläufe ohne Modell

„Welche Abläufe in deinem Bereich haben wir noch nicht angesprochen? Wie beginnen sie, wer ist beteiligt, und wie enden sie?“

Die Landkarte kennt in diesem Bereich: „Wareneingang“, „Kommissionierung“, „Bestandsüberwachung“, „Inventur“, „Packstation“

## Abschluss

„Dürfen wir uns melden, wenn beim Zusammenfassen noch etwas offen ist? Wir schicken dir die Zusammenfassung zum Gegenlesen.“

Nach dem Gespräch: Transkript (VTT oder Text) oder Mitschrift im Workspace unter `transcripts/` ablegen, ohne Namen im Dateinamen; die Aufnahme selbst bleibt in Teams, Zoom oder Webex. Solange Namen darin stehen, geht es an keinen KI-Assistenten.
