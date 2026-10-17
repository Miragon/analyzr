import { useQuery } from '@tanstack/react-query';
import { ChevronDownIcon, InboxIcon, SaveIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  collectedByModel,
  collectedKey,
  discardCollected,
  fieldLabel,
  savedToast,
  useAmendSave,
  useCollected,
  useCollectedLeaveGuard,
  type CollectedAmendment,
} from '@/lib/amendments';
import { modelsQuery } from '@/lib/queries';
import { toast } from '@/lib/toast';

import { AmendSaveProblem, AmendSummary } from './amend-summary';

/**
 * The bar of collected amendments (M6 §4.8 c "Web", „Sammeln“): one per
 * model, „3 Ergänzungen für „…“ gesammelt – Speichern“, which saves them
 * with one dry run (its summary first) and one request, so working through
 * a model's questions costs one re-judgement. The amendments stay in the
 * page until saved or discarded (leaving the page asks first); the tab and
 * the model view show the same collection. The bar is opaque (it sticks
 * above the list in the tab) and its lists scroll, so its buttons stay in
 * view; it checks against the model's current head, so a save elsewhere
 * needs no second round.
 */

function CollectGroup({
  project,
  modelId,
  modelName,
  items,
}: {
  project: string;
  modelId: string;
  modelName: string;
  items: CollectedAmendment[];
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const save = useAmendSave({
    project,
    modelId,
    onSaved: (result) => {
      toast(savedToast(result, modelName));
      discardCollected(modelId);
    },
    onUnchanged: () => {
      toast({
        tone: 'info',
        title: 'Schon so ergänzt',
        description: 'Die gesammelten Werte stehen schon so im Modell; nichts geändert.',
      });
      discardCollected(modelId);
    },
  });
  // The model's current head: a save elsewhere (also the human's own, in this page) moves it,
  // and the dry run's summary is the human's check; If-Match still guards the confirm.
  const models = useQuery(modelsQuery(project));
  const rev =
    models.data?.find((m) => m.id === modelId)?.headRev ?? Math.max(...items.map((i) => i.rev));
  const state = save.state;
  const n = items.length;

  const check = (at: number) =>
    save.check(
      items.map((i) => i.item),
      at,
    );

  return (
    <section
      aria-label={`Gesammelte Ergänzungen für „${modelName}“`}
      className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-accent p-3 shadow-md"
      data-testid="collect-bar"
      data-model-id={modelId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <InboxIcon className="size-4 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 flex-1 text-sm font-medium" data-testid="collect-bar-text">
          {n === 1 ? '1 Ergänzung' : `${n} Ergänzungen`} für „{modelName}“ gesammelt
        </p>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
          data-testid="collect-bar-toggle"
        >
          Anzeigen
          <ChevronDownIcon data-icon="inline-end" className={open ? 'rotate-180' : undefined} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => discardCollected(modelId)}
          disabled={save.busy}
          data-testid="collect-bar-discard"
        >
          <Trash2Icon data-icon="inline-start" />
          Verwerfen
        </Button>
        {state.phase !== 'confirm' && state.phase !== 'saving' ? (
          <Button
            size="sm"
            onClick={() => check(state.phase === 'conflict' && state.headRev ? state.headRev : rev)}
            disabled={save.busy}
            data-testid="collect-bar-save"
          >
            {state.phase === 'checking' ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SaveIcon data-icon="inline-start" />
            )}
            {state.phase === 'conflict' ? 'Mit neuem Stand prüfen' : 'Speichern'}
          </Button>
        ) : null}
      </div>
      {/* The summary lists the same amendments: one list at a time keeps the bar short. */}
      {open && state.phase !== 'confirm' && state.phase !== 'saving' ? (
        <ul
          id={listId}
          className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto text-sm"
          aria-label="Gesammelt"
        >
          {items.map((c) => (
            <li
              key={collectedKey(c.item)}
              className="flex items-start gap-2"
              data-testid="collect-bar-item"
            >
              <span className="min-w-0 flex-1 break-words">
                {c.label}{' '}
                <span className="text-muted-foreground">· {c.field ?? fieldLabel(c.item.op)}:</span>{' '}
                „{c.display}“
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${c.label} aus der Sammlung entfernen`}
                onClick={() => discardCollected(modelId, collectedKey(c.item))}
                disabled={save.busy}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {state.phase === 'confirm' || state.phase === 'saving' ? (
        <AmendSummary
          project={project}
          state={state}
          pending={items}
          onConfirm={save.confirm}
          onBack={save.reset}
          compact
        />
      ) : (
        <AmendSaveProblem
          state={state}
          pending={items}
          conflictText={`Das Modell hat sich geändert${state.phase === 'conflict' && state.headRev !== null ? ` (jetzt r${state.headRev})` : ''}; prüf die gesammelten Ergänzungen noch einmal („Mit neuem Stand prüfen“).`}
        />
      )}
    </section>
  );
}

/** Every model's collection, or one model's (the model view). */
export default function CollectBar({ project, modelId }: { project: string; modelId?: string }) {
  // The collection lives in the page: leaving it (reload, closed tab) asks first.
  useCollectedLeaveGuard();
  const groups = collectedByModel(useCollected(), project).filter(
    (g) => modelId === undefined || g.modelId === modelId,
  );
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="collect-bars">
      {groups.map((g) => (
        <CollectGroup
          key={g.modelId}
          project={project}
          modelId={g.modelId}
          modelName={g.modelName}
          items={g.items}
        />
      ))}
    </div>
  );
}
