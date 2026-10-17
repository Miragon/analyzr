import { cn } from 'cn';
import { SearchIcon } from 'lucide-react';
import { RadioGroup } from 'radix-ui';
import { Fragment, useId, type ReactNode } from 'react';

import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { nameWords } from '@/lib/generic-names';

/** How many options the list shows at once; the search narrows the rest. */
export const PICKER_SHOWN = 60;
const SHOWN = PICKER_SHOWN;

/** Said under a list that shows only the first {@link PICKER_SHOWN} of its matches. */
export function PickerTruncated({ total }: { total: number }) {
  if (total <= SHOWN) return null;
  return (
    <p className="text-xs text-muted-foreground" data-testid="picker-truncated">
      {SHOWN} von {total} gezeigt; die Suche grenzt weiter ein.
    </p>
  );
}

export interface PickerListProps<T> {
  items: readonly T[];
  /** The value of an item (unique). */
  valueOf: (item: T) => string;
  /** Text the search matches (lowercased words, umlauts folded like the names). */
  searchText: (item: T) => string;
  render: (item: T) => ReactNode;
  value: string | null;
  onChange: (value: string) => void;
  search: string;
  onSearch: (search: string) => void;
  searchLabel: string;
  placeholder: string;
  /** Accessible name of the list. */
  label: string;
  /** Shown when there is nothing to pick at all. */
  emptyText: string;
  testId?: string;
  /** Data attribute that carries an option's value (`data-<name>`). */
  valueAttribute?: string;
  /** Focus the search field on mount (a form that replaced the button that opened it). */
  autoFocus?: boolean;
  /** Without a search field (a handful of options, e.g. the copies of a process id). */
  searchable?: boolean;
  /**
   * The heading of an item's section, e.g. „Vorgeschlagen“ (M6 S5c-1): items
   * come sorted by section, and a heading row opens each one (the item
   * itself should say it too, for screen readers).
   */
  sectionOf?: (item: T) => string | null;
  className?: string;
}

/**
 * A search field and one radio group (a single tab stop; the arrow keys move
 * the choice, Radix roving focus): the correction candidates of the review
 * screen, and the step and process pickers of the value chain page.
 */
export function PickerList<T>({
  items,
  valueOf,
  searchText,
  render,
  value,
  onChange,
  search,
  onSearch,
  searchLabel,
  placeholder,
  label,
  emptyText,
  testId = 'picker-option',
  valueAttribute = 'value',
  autoFocus = false,
  searchable = true,
  sectionOf,
  className,
}: PickerListProps<T>) {
  const id = useId();
  const words = nameWords(search);
  const visible =
    words.length === 0
      ? items
      : items.filter((item) => {
          const hay = nameWords(searchText(item)).join(' ');
          return words.every((w) => hay.includes(w));
        });
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {searchable ? (
        <Field>
          <FieldLabel htmlFor={`${id}-search`}>{searchLabel}</FieldLabel>
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              id={`${id}-search`}
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={placeholder}
              className="pl-8"
              autoComplete="off"
              autoFocus={autoFocus}
            />
          </div>
        </Field>
      ) : null}
      {visible.length === 0 ? (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          {items.length === 0 ? emptyText : 'Nichts passt zur Suche.'}
        </p>
      ) : (
        <RadioGroup.Root
          value={value ?? ''}
          onValueChange={onChange}
          aria-label={label}
          className="max-h-64 overflow-y-auto rounded-lg border"
        >
          {visible.slice(0, SHOWN).map((item, i, shown) => {
            const v = valueOf(item);
            const checked = value === v;
            const section = sectionOf?.(item) ?? null;
            const heading =
              section !== null && (i === 0 || sectionOf?.(shown[i - 1] as T) !== section) ? (
                <div
                  aria-hidden
                  className="border-b bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground"
                  data-testid="picker-section"
                >
                  {section}
                </div>
              ) : null;
            return (
              <Fragment key={v}>
                {heading}
                <RadioGroup.Item
                  value={v}
                  data-testid={testId}
                  {...{ [`data-${valueAttribute}`]: v }}
                  className={cn(
                    'flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                    checked ? 'bg-accent' : 'hover:bg-muted',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-3.5 shrink-0 rounded-full border',
                      checked ? 'border-4 border-primary' : 'border-contour',
                    )}
                  />
                  {render(item)}
                </RadioGroup.Item>
              </Fragment>
            );
          })}
        </RadioGroup.Root>
      )}
      <PickerTruncated total={visible.length} />
    </div>
  );
}
