/**
 * Synthetic models for the model-amendment tests (M6 S5c-2), written for
 * them (no customer data): a caller with a call activity without a target,
 * a call whose target names no process, a nameless message throw, two
 * receive tasks sharing one message and an unnamed start event; a callee
 * with a named message catch; a process without documentation; a Camunda 8
 * caller with a Zeebe call. The caller also comes without the camunda
 * namespace (`engineless`), a derived model under the trust rule (M6 S2c).
 */
const DEFS =
  'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://example.org/bpmn"';
const C7 = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';

export const AUFTRAG_KEY = 'vertrieb/auftrag';
export const RECHNUNG_KEY = 'finanzen/rechnung';
export const LAGER_KEY = 'lager/einlagerung';
export const VERSAND_KEY = 'versand/versand';

/**
 * The caller; `variant` changes bytes elsewhere (a task's name) or the
 * fields under test; `engineless` leaves out the camunda namespace (no
 * engine, a derived model).
 */
export function auftrag(
  variant: {
    taskName?: string;
    callRechnung?: string | null;
    zahlungName?: string;
    withoutBestaetigung?: boolean;
    startName?: string | null;
    engineless?: boolean;
  } = {},
): string {
  const call =
    variant.callRechnung === undefined || variant.callRechnung === null
      ? ''
      : ` calledElement="${variant.callRechnung}"`;
  const start =
    variant.startName === undefined || variant.startName === null
      ? ''
      : ` name="${variant.startName}"`;
  const bestaetigung = variant.withoutBestaetigung
    ? ''
    : `
    <bpmn:intermediateThrowEvent id="Event_Bestaetigung" name="Bestätigung senden">
      <bpmn:messageEventDefinition id="MED_Best" />
    </bpmn:intermediateThrowEvent>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS}${variant.engineless ? '' : ` ${C7}`} id="Defs_Auftrag">
  <bpmn:process id="Process_Auftrag" name="Auftragsabwicklung" isExecutable="true">
    <bpmn:documentation>Wickelt Aufträge ab.</bpmn:documentation>
    <bpmn:laneSet id="LaneSet_A">
      <bpmn:lane id="Lane_Buchhaltung" name="Buchhaltung">
        <bpmn:flowNodeRef>Call_Rechnung</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start_Auftrag"${start} />
    <bpmn:task id="Task_Pruefen" name="${variant.taskName ?? 'Auftrag prüfen'}" />
    <bpmn:callActivity id="Call_Rechnung" name="Rechnung stellen"${call} />
    <bpmn:callActivity id="Call_Versand" name="Versand beauftragen" calledElement="Process_Versand_Alt" />${bestaetigung}
    <bpmn:receiveTask id="Task_Zahlung" name="Zahlung abwarten" messageRef="Message_Zahlung" />
    <bpmn:receiveTask id="Task_Mahnung" name="Mahnung abwarten" messageRef="Message_Zahlung" />
    <bpmn:endEvent id="End_Auftrag" name="Auftrag erledigt" />
  </bpmn:process>
  <bpmn:message id="Message_Zahlung" name="${variant.zahlungName ?? 'Zahlung eingegangen'}" />
</bpmn:definitions>
`;
}

export function rechnung(variant: { taskName?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS} ${C7} id="Defs_Rechnung">
  <bpmn:process id="Process_Rechnung" name="Rechnungsstellung" isExecutable="true">
    <bpmn:documentation>Stellt Rechnungen.</bpmn:documentation>
    <bpmn:startEvent id="Start_Rechnung" name="Rechnung angefordert" />
    <bpmn:task id="Task_Buchen" name="${variant.taskName ?? 'Rechnung buchen'}" />
    <bpmn:receiveTask id="Task_Bestaetigung" name="Bestätigung empfangen" messageRef="Message_Best" />
    <bpmn:endEvent id="End_Rechnung" name="Rechnung gestellt" />
  </bpmn:process>
  <bpmn:message id="Message_Best" name="Auftrag bestätigt" />
</bpmn:definitions>
`;
}

export function lager(variant: { documentation?: string } = {}): string {
  const doc =
    variant.documentation === undefined
      ? ''
      : `
    <bpmn:documentation>${variant.documentation}</bpmn:documentation>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS} ${C7} id="Defs_Lager">
  <bpmn:process id="Process_Lager" name="Einlagerung" isExecutable="true">${doc}
    <bpmn:startEvent id="Start_Lager" name="Ware angekommen" />
    <bpmn:endEvent id="End_Lager" name="Ware eingelagert" />
  </bpmn:process>
</bpmn:definitions>
`;
}

export function versand(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS} ${C7} id="Defs_Versand">
  <bpmn:process id="Process_Versand" name="Versand" isExecutable="true">
    <bpmn:documentation>Versendet Ware.</bpmn:documentation>
    <bpmn:startEvent id="Start_Versand" name="Versand beauftragt" />
    <bpmn:endEvent id="End_Versand" name="Versendet" />
  </bpmn:process>
</bpmn:definitions>
`;
}

/** A process with an unnamed end event (the race test). */
export function bestellung(variant: { taskName?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS} ${C7} id="Defs_Bestellung">
  <bpmn:process id="Process_Bestellung" name="Bestellung" isExecutable="true">
    <bpmn:documentation>Bestellt Ware.</bpmn:documentation>
    <bpmn:startEvent id="Start_Bestellung" name="Bedarf gemeldet" />
    <bpmn:task id="Task_Bestellung" name="${variant.taskName ?? 'Bestellung prüfen'}" />
    <bpmn:endEvent id="End_Bestellung" />
  </bpmn:process>
</bpmn:definitions>
`;
}
