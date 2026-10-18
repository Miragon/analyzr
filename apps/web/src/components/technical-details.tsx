import { ChevronRightIcon } from 'lucide-react';

/**
 * „Technische Angaben“ (UX-SIMPLIFICATION.md §3.13 item 4, P2): ids, refs,
 * versions, client, procedure and model behind one closed disclosure, so the
 * visible text names things by name. Rows without a value are left out.
 */
export function TechnicalDetails({
  rows,
  testId,
}: {
  rows: readonly (readonly [label: string, value: string | null | undefined])[];
  testId?: string;
}) {
  const shown = rows.filter((r): r is readonly [string, string] => !!r[1]);
  if (shown.length === 0) return null;
  return (
    <details className="group text-xs text-muted-foreground" data-testid={testId}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 hover:text-foreground">
        <ChevronRightIcon
          className="size-3.5 transition-transform group-open:rotate-90"
          aria-hidden
        />
        Technische Angaben
      </summary>
      <dl className="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5">
        {shown.map(([label, value]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd className="font-mono break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
