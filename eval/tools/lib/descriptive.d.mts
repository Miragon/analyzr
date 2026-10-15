// Types for lib/descriptive.mjs (eval:descriptive's model transforms), for the
// TypeScript part of eval/tools.

export type Variant = 'engine-stripped' | 'descriptive' | 'pools' | 'tasks' | 'no-docs';

/** The variants, in the order they apply (each on top of the previous one). */
export declare const VARIANTS: readonly Variant[];
export declare const ENGINE_NAMESPACES: readonly string[];

/** An inter-model message endpoint: its direction and the pools of its partners. */
export interface MessagePartners {
  direction: 'out' | 'in';
  /** Black-box pool names, sorted, at least one. */
  partners: string[];
}

/** What the transforms of one model need from the landscape (by element id). */
export interface TransformContext {
  /** Every call activity: the callee's name, or `null` to keep its own name. */
  callees: Record<string, string | null>;
  /** Message endpoints that talk to another model (no message flow inside the file). */
  messages: Record<string, MessagePartners>;
}

/** Applies the variants cumulatively; the XML after each variant. */
export declare function transformModel(xml: string, ctx: TransformContext): Promise<Record<Variant, string>>;
/** Parses and writes `xml` with the transforms' bpmn-moddle setup, changing nothing. */
export declare function roundTrip(xml: string): Promise<string>;
