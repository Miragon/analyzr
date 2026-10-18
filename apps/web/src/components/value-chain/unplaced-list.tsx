import { Link } from '@tanstack/react-router';
import { LocateIcon, MapPinIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import { PlainText } from '@/components/review/plain-text';
import { TechnicalDetails } from '@/components/technical-details';
import { Button } from '@/components/ui/button';
import { formatDateTime, handleName } from '@/lib/labels';
import { splitRef } from '@/lib/refs';
import type { StepOption, UnplacedItem } from '@/lib/value-chain';

import { ManualPlacementForm } from './manual-placement-form';

const FIRST = 8;

export interface UnplacedListProps {
  project: string;
  items: readonly UnplacedItem[];
  steps: readonly StepOption[];
  canReview: boolean;
  onSelectStep: (elementId: string) => void;
}

/**
 * „Ohne Schritt“ (M4 §4; UX6, UX-SIMPLIFICATION.md §3.8 item 2): processes
 * with no accepted, held or proposed placement, and those the placement
 * agent could not place, in one list: the name, the agent's reason as one
 * muted line („Agent unsicher: …“; plain text, an agent wrote it), up to
 * three `baseline-prefix/1` hints (a click selects the step), „Platzieren“
 * (a manual placement) and „Im Modell zeigen“; ref, agent and time behind
 * „Technische Angaben“. A doubted process whose input changed since is
 * judged again by the next placement task.
 */
export function UnplacedList({
  project,
  items,
  steps,
  canReview,
  onSelectStep,
}: UnplacedListProps) {
  const [all, setAll] = useState(false);
  const [placing, setPlacing] = useState<string | null>(null);
  /** The process whose "Platzieren" gets the focus back when its form closes. */
  const refocus = useRef<string | null>(null);
  const closeForm = () => {
    refocus.current = placing;
    setPlacing(null);
  };
  const shown = all ? items : items.slice(0, FIRST);
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2" aria-label="Prozesse ohne Schritt">
        {shown.map((u) => {
          const { elementId: processId } = splitRef(u.process);
          return (
            <li
              key={u.process}
              data-testid="unplaced-process"
              data-process={u.process}
              data-unsure={u.unsure ? 'true' : undefined}
              className="flex flex-col gap-1.5 rounded-lg border bg-card p-2.5 text-sm"
            >
              <div className="flex items-start gap-2">
                <PlainText as="span" className="min-w-0 flex-1 font-medium" text={u.name} />
                <Button variant="ghost" size="icon-xs" asChild>
                  <Link
                    to="/projects/$project/models/$"
                    params={{ project, _splat: u.modelKey }}
                    search={{ element: processId }}
                    aria-label={`„${u.name}“ im Modell zeigen`}
                    title="Im Modell zeigen"
                  >
                    <LocateIcon />
                  </Link>
                </Button>
              </div>
              {u.unsure ? (
                <p className="text-xs text-muted-foreground" data-testid="unsure-reason">
                  Agent unsicher: <PlainText as="span" text={u.unsure.reason} />
                  {u.unsure.current ? null : ' (Eingaben geändert, der Agent prüft erneut)'}
                </p>
              ) : null}
              {u.hints.length > 0 ? (
                <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <span>Passt vielleicht zu:</span>
                  {u.hints.map((h) => (
                    <button
                      key={h.step}
                      type="button"
                      className="rounded-sm bg-muted px-1.5 text-foreground hover:bg-accent"
                      onClick={() => onSelectStep(h.step)}
                      data-testid="unplaced-hint"
                    >
                      <PlainText as="span" text={h.name} />
                    </button>
                  ))}
                </p>
              ) : null}
              {canReview ? (
                placing === u.process ? (
                  <ManualPlacementForm
                    project={project}
                    target={{
                      kind: 'step',
                      process: u.process,
                      processName: u.name,
                      steps,
                      hints: u.hints.map((h) => h.step),
                    }}
                    onDone={closeForm}
                    onCancel={closeForm}
                  />
                ) : (
                  <div>
                    <Button
                      ref={(button) => {
                        if (button && refocus.current === u.process) {
                          refocus.current = null;
                          button.focus();
                        }
                      }}
                      variant="outline"
                      size="xs"
                      onClick={() => setPlacing(u.process)}
                    >
                      <MapPinIcon data-icon="inline-start" />
                      Platzieren
                    </Button>
                  </div>
                )
              ) : null}
              <TechnicalDetails
                rows={[
                  ['Prozess', u.process],
                  ['Agent', u.unsure ? handleName(u.unsure.by) : null],
                  ['Zeitpunkt', u.unsure ? formatDateTime(u.unsure.at) : null],
                ]}
              />
            </li>
          );
        })}
      </ul>
      {items.length > FIRST ? (
        <Button variant="ghost" size="sm" onClick={() => setAll((a) => !a)}>
          {all ? 'Weniger zeigen' : `Alle ${items.length} zeigen`}
        </Button>
      ) : null}
    </div>
  );
}
