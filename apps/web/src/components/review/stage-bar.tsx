import type { ModelStage } from '@analyzr/client';
import { cn } from 'cn';

import { STAGES } from '@/lib/labels';
import { PIPELINE_ORDER } from '@/lib/review';

/**
 * The phase chips of the models table on „Übersicht“ (UX-SIMPLIFICATION.md
 * §2.3; until UX1 the phase bar of „Prüfen“): „Modelle nach Phase: Alle 31 ·
 * Wartet auf Prüfung 25 · …“, left to right as a model moves through the
 * pipeline (CONCEPT §3), only stages with models. They count models and
 * filter the table, so they read as its filter, not as a second status block
 * (stages and labels unchanged, decision 8).
 */
export function StageChips({
  counts,
  total,
  selected,
  onSelect,
}: {
  counts: Readonly<Record<ModelStage, number>>;
  total: number;
  selected: ModelStage | undefined;
  onSelect: (stage: ModelStage | undefined) => void;
}) {
  const chip = (active: boolean) =>
    cn(
      'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
      active
        ? 'border-primary bg-accent text-foreground'
        : 'border-border bg-card text-muted-foreground hover:text-foreground',
    );
  return (
    <div
      role="group"
      aria-label="Modelle nach Phase"
      className="flex min-w-0 items-center gap-1.5 overflow-x-auto py-0.5 whitespace-nowrap [scrollbar-width:none]"
    >
      <span aria-hidden className="shrink-0 text-xs text-muted-foreground">
        Modelle nach Phase:
      </span>
      <button
        type="button"
        aria-pressed={selected === undefined}
        className={chip(selected === undefined)}
        onClick={() => onSelect(undefined)}
      >
        Alle <span className="tabular-nums">{total}</span>
      </button>
      {PIPELINE_ORDER.filter((stage) => counts[stage] > 0 || stage === selected).map((stage) => {
        const active = selected === stage;
        return (
          <button
            key={stage}
            type="button"
            aria-pressed={active}
            data-testid="stage-filter"
            data-stage={stage}
            data-count={counts[stage]}
            title={STAGES[stage].hint}
            className={chip(active)}
            onClick={() => onSelect(active ? undefined : stage)}
          >
            {STAGES[stage].label} <span className="tabular-nums">{counts[stage]}</span>
          </button>
        );
      })}
    </div>
  );
}
