{{> _shared/connector.de}}

Erstelle für das analyzr-Projekt {{PROJEKT}} einen Interviewleitfaden als Markdown.

Ich hänge die offenen Fragen an, exportiert in analyzr unter {{text:web-markdown-export}}.

{{> _shared/rules.de}}

1. Gruppiere die Fragen nach den Überschriften „## …“ der Datei; „Ohne Ansprechpartner“ kommt zuletzt. Lass Fragen mit {{text:md-informational}} weg, ebenso solche mit {{text:md-outside-mark}} ohne {{text:md-withdrawn}} und die Arten {{text:technical-kinds}} (Arbeit für mich in analyzr, nichts fürs Gespräch). Frag mich, für welche Gruppe der Leitfaden ist, und warte.
2. Behalte die Reihenfolge der Datei: Die Fragen mit der größten Wirkung stehen vorn. Kommen mehr als 20 Fragen zusammen, nimm die ersten 15, außer ich schreibe „alle“.
3. Übernimm jede Frage wörtlich mit ihrer ID (der Kommentar „<!-- q-… -->“ unter ihrer Überschrift), sichtbar als `q-…`. Ändere keine ID, lass keine weg und erfinde keine.
4. Ergänze je Frage höchstens zwei Sätze „Was die Landkarte schon sagt“ (nur, was die Werkzeuge liefern) und bis zu drei Nachfragen, und unter „Abläufe ohne Modell“ die Prozesse, die list_processes in diesem Bereich nennt; fehlt dir etwas, lass die Zeile weg.
5. Sprich die Gesprächspartner mit „du“ an, auch in den Nachfragen.
6. Aufbau genau so, mit der Checkliste zum Einverständnis vorn:

````markdown
{{text:guide-skeleton}}
````

Gib den Leitfaden als einen Markdown-Codeblock aus. Ich speichere ihn selbst unter `interviews/guides/` im Workspace.
