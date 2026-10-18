import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDownIcon, FileDownIcon, ImageDownIcon, MessagesSquareIcon } from 'lucide-react';
import { lazy, Suspense, useId, useState, type ReactNode } from 'react';

import { LightPopover, MENU_ITEM_CLASS } from '@/components/light-popover';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage } from '@/lib/api';
import { downloadText } from '@/lib/download';
import { valueChainContentQuery } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { documentFileName } from '@/lib/value-chain';

type Format = 'markdown' | 'csv';

/**
 * The dialog „Für den Kunden exportieren“ of „Offene Fragen“ (UX2b), loaded
 * on first use with the open-questions modules, never with the entry.
 */
const CustomerExportDialog = lazy(
  () => import('@/components/open-questions/customer-export-dialog'),
);

/**
 * „Exportieren“, the project's export hub on „Übersicht“ (UX-SIMPLIFICATION.md
 * §3.2 item 2): what goes back to the customer and the source tool in one
 * place at the end of a workshop round, each entry only when it has content.
 * „Fragen für den Kunden (Markdown, CSV) …“ opens the dialog of „Offene
 * Fragen“ (UX2b: „Zu klären“ by default, Q11, „Auch Fragen der Agenten“ on
 * request), the change list the model amendments (decision 25.1), the chain
 * its file and its picture (drawn on the chain page). The dialog and the
 * downloads come from the modules that own them (the open-questions dialog
 * and the amendments module, loaded on first use); the menus on „Offene
 * Fragen“, the chain and the model view stay as shortcuts with the same
 * labels.
 */
export function ExportHub({
  project,
  questions,
  agentQuestions,
  changeList,
  chain,
}: {
  project: string;
  /** „Zu klären“ > 0, or the agents have open questions. */
  questions: boolean;
  /** The agents' open questions: the dialog's „Auch Fragen der Agenten (n)“. */
  agentQuestions: number;
  /** The project has model amendments. */
  changeList: boolean;
  /** The project has a value chain. */
  chain: boolean;
}) {
  const queryClient = useQueryClient();
  const triggerId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The customer dialog: mounted once asked for, so its chunk loads on first use. */
  const [customer, setCustomer] = useState<boolean | null>(null);
  if (!questions && !changeList && !chain) return null;

  const run = (task: () => Promise<void>) => {
    setOpen(false);
    setBusy(true);
    task()
      .catch((error: unknown) =>
        toast({
          tone: 'danger',
          title: 'Export fehlgeschlagen',
          description: errorMessage(error),
          error,
        }),
      )
      .finally(() => setBusy(false));
  };
  const changeListFile = (format: Format) =>
    run(async () =>
      (await import('@/components/amendments/model-amendments')).downloadChangeList(
        project,
        format,
      ),
    );
  const chainFile = () =>
    run(async () => {
      const content = await queryClient.fetchQuery(valueChainContentQuery(project));
      downloadText(documentFileName(project, content.rev, false), content.text, 'application/json');
    });

  const item = (label: string, onSelect: () => void, testId: string) => (
    <button
      type="button"
      role="menuitem"
      className={MENU_ITEM_CLASS}
      onClick={onSelect}
      data-testid={testId}
    >
      <FileDownIcon aria-hidden />
      {label}
    </button>
  );
  const group = (heading: string, children: ReactNode) => (
    <div role="group" aria-label={heading} className="py-1">
      <p aria-hidden className="px-2 pb-0.5 text-xs font-semibold text-muted-foreground">
        {heading}
      </p>
      {children}
    </div>
  );

  return (
    <>
      <LightPopover
        open={open}
        onOpenChange={setOpen}
        role="menu"
        label="Exportieren"
        testId="export-menu"
        className="min-w-72"
        trigger={(props) => (
          <Button
            id={triggerId}
            variant="outline"
            disabled={busy}
            data-testid="export-hub"
            {...props}
          >
            {busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <FileDownIcon data-icon="inline-start" />
            )}
            Exportieren
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        )}
      >
        {questions ? (
          <div className="py-1">
            <button
              type="button"
              role="menuitem"
              className={MENU_ITEM_CLASS}
              onClick={() => {
                setOpen(false);
                setCustomer(true);
              }}
              data-testid="export-questions"
            >
              <MessagesSquareIcon aria-hidden />
              Fragen für den Kunden (Markdown, CSV) …
            </button>
          </div>
        ) : null}
        {changeList
          ? group(
              'Änderungsliste fürs Quellsystem',
              <>
                {item('Markdown', () => changeListFile('markdown'), 'export-change-list-md')}
                {item('CSV', () => changeListFile('csv'), 'export-change-list-csv')}
              </>,
            )
          : null}
        {chain
          ? group(
              'Wertschöpfungskette',
              <>
                {item('Datei (.vc.json)', chainFile, 'export-chain-json')}
                <Link
                  role="menuitem"
                  to="/projects/$project/value-chain"
                  params={{ project }}
                  search={{ export: 'svg' }}
                  className={MENU_ITEM_CLASS}
                  data-testid="export-chain-svg"
                >
                  <ImageDownIcon aria-hidden />
                  Bild (SVG)
                </Link>
              </>,
            )
          : null}
      </LightPopover>
      {customer !== null ? (
        <Suspense fallback={null}>
          <CustomerExportDialog
            project={project}
            open={customer}
            onOpenChange={setCustomer}
            agentQuestions={agentQuestions}
            // The menu item that opened it is gone with the menu: back to „Exportieren“.
            returnFocus={() => document.getElementById(triggerId)}
          />
        </Suspense>
      ) : null}
    </>
  );
}
