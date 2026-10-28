# Interviewleitfaden: Organisationseinheit Lager; Lanes Lagerleitung

Nordwind Handel GmbH · offene Fragen aus analyzr vom 27.10.2026 · die ersten 5 von 7 Fragen in der Reihenfolge von „Offene Fragen“ (die mit der größten Wirkung zuerst)

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
- Ansprechpartner: Lager, Wareneingang
- Bisher notiert (21.10.2026): Laut Lagerleitung kommt das Avis über das Speditionsportal.
- In „Offene Fragen“ danach, je nach Antwort: „Liegt außerhalb der Landschaft“ oder „Verknüpfen mit …“
- Notizen:

### F2. Gilt die Übergabe an den Versand auch für Expressaufträge? Und wer gibt sie frei?

`q-8b1d0e2f4a6c9375` · Vorgemerkt · Modelle `lager/kommissionierung`, `versand/versand-vorbereiten`

- Betrifft: „Kommissionierung“ → „Versand vorbereiten“
- Ansprechpartner: Lager, Kommissionierung
- Notiz zur Vormerkung: Laut Workshop gibt es einen eigenen Express-Ablauf, siehe https\://wiki.nordwind.example/lager \[intern\] \*vorläufig\*
- Vormerkung: mit Lager klären
- Bisher notiert (22.10.2026): Express läuft über die Packstation 2.  
  Freigabe durch die Schichtleitung.
- In „Offene Fragen“ danach: „Vorschlag prüfen“
- Notizen:

### F3. Auf welchen Schritt der Wertschöpfungskette gehört „Bestandsüberwachung“?

`q-c47e2a9b05d1f863` · Einordnung unsicher · Modell `lager/bestandsueberwachung`

- Warum wir fragen: Laut Agent: Die Bestandsüberwachung passt zu „Lager“ und zu „Controlling“; das Modell sagt nicht, wer sie verantwortet.
- Betrifft: „Bestandsüberwachung“
- Ansprechpartner: Lagerleitung
- In „Offene Fragen“ danach: „Schritt wählen …“
- Notizen:

### F4. Was leistet „Wareneingang“?

`q-1e5f7a3c9d2b4086` · Prozess ohne Dokumentation · Modell `lager/wareneingang`

- Warum wir fragen: Der Prozess hat im Modell keine Dokumentation.
- Betrifft: „Wareneingang“
- Ansprechpartner: Lager, Wareneingang, Qualitätsprüfung
- In „Offene Fragen“ danach: „Dokumentation ergänzen …“
- Notizen:

### F5. Ist „Bestand prüfen“ derselbe Ablauf wie „Bestandsüberwachung“?

`q-5a9c3e7b1f0d2846` · Frage eines Agenten · Modelle `lager/bestandsueberwachung`, `lager/kommissionierung`

- Betrifft: „Bestand prüfen“ → „Bestandsüberwachung“
- Ansprechpartner: Lager, Kommissionierung
- In „Offene Fragen“ danach: „Vorschlag prüfen“
- Notizen:

## Abläufe ohne Modell

„Welche Abläufe in deinem Bereich haben wir noch nicht angesprochen? Wie beginnen sie, wer ist beteiligt, und wie enden sie?“

## Abschluss

„Dürfen wir uns melden, wenn beim Zusammenfassen noch etwas offen ist? Wir schicken dir die Zusammenfassung zum Gegenlesen.“

Nach dem Gespräch: Transkript (VTT oder Text) oder Mitschrift im Workspace unter `transcripts/` ablegen, ohne Namen im Dateinamen; die Aufnahme selbst bleibt in Teams, Zoom oder Webex. Solange Namen darin stehen, geht es an keinen KI-Assistenten.
