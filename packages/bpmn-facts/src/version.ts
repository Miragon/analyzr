/**
 * Version of the fact format. Stored with every revision
 * (`model_revision.facts_version`) and part of `factsHash`; bump it whenever
 * extraction, normalization or fingerprinting changes. A bump reaches the
 * revisions ingested afterwards: there is no reindex of stored facts yet (a
 * reindex with judgement carry-over is a later candidate, M6 §6), and a new
 * `facts_hash` re-judges every pair of its model. The corpus snapshots in
 * `test/__snapshots__` change with every such change and are the reminder.
 */
export const FACTS_VERSION = '1';
