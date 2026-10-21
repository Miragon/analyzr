# Synthetic analyzr-spec/1 fixtures (golden renders)

The `*.spec.yaml` files are **hand-written, synthetic** specs of an invented company („Beispiel
GmbH“), written for the tests of `analyzr-spec` (M6 S3c, `tools/integrate/src/spec/`). No tool,
picture, PDF or interview produced them; nothing in them derives from a customer, from
`eval/corpus/**` or from the holdout landscape. Names, tool paths, tool ids
(`4f1c2a7e-0000-4000-8000-000000000001`, `PAGE-7`) and links (`*.beispiel.example`) are
invented; what they say about Visio or ARIS exports is unverified.

Each `<name>.bpmn` is the golden render of `<name>.spec.yaml` with the key `beispiel/<name>`.
`test/spec-render.test.ts` compares them byte for byte, rewrites them with
`ANALYZR_UPDATE_GOLDEN=1`, pins their sha256 per renderer version (`RENDER_OUTPUTS`) and the
facts analyzr extracts from each. `apps/web/e2e/spec-render-import.spec.ts` imports them into
bpmn-js in a browser.

| Fixture | Read as | Covers |
|---|---|---|
| `minimal` | written by the agent | A start, a task and an end; no lanes, no collaboration. |
| `lanes-gateways` | written by the agent | Exclusive, parallel, inclusive and event-based gateways, a back edge, three lanes in a non-alphabetical list order. |
| `collaboration` | converter output | Two processes, a black-box pool, message flows, send and receive tasks with named messages, message start and end events, a tool id and a link. |
| `unnamed-messages` | written by the agent | A send task, a receive task and a message catch event without a message name: their facts key on their labels. |
| `calls-and-stores` | written by the agent | Two calls (drawn as collapsed subprocesses), a collapsed subprocess, a data store read and written, signal throw and catch, a timer catch, a terminate end. |
| `long-texts` | written by the agent | A name of 250 and documentation of over 2500 characters, bidi and control characters, U+FFFE and a lone surrogate, umlauts in a source id, unsafe source ids and message names that come out alike, a flow source `t1_t2` next to the generated `Flow_t1_t2`, a source `t1_di`. |
| `converter-loose` | converter output | A start with an incoming flow and a node without a lane in a process with lanes (rendered as given, with warnings). |
| `reconstructed` | written by the agent | The picture example of the S3c plan: a send task without a message name, a call, notes. |
| `as-told` | written by the agent | `derived.kind: as-told` with opaque source ids: the validator accepts it, `bundle` refuses it until S6. |
