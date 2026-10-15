// Types for the part of lib/checks.mjs (the validator's checks) that the
// TypeScript part of eval/tools uses.

/** DI completeness and geometry of parsed BPMN (bpmn-moddle definitions); one message per problem. */
export declare function checkDi(definitions: unknown): string[];
