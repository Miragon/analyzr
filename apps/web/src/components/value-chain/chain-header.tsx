import {
  ChevronDownIcon,
  FileDownIcon,
  FileUpIcon,
  ImageDownIcon,
  PencilIcon,
  Redo2Icon,
  SaveIcon,
  Undo2Icon,
} from 'lucide-react';
import { useState } from 'react';

import { CanvasHeader } from '@/components/canvas-header';
import { LightPopover, MENU_ITEM_CLASS } from '@/components/light-popover';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/lib/labels';

/** „Exportieren“ (UX6): the chain's file and picture, with the labels of the hub on „Übersicht“. */
function ExportMenu({
  onFile,
  onSvg,
  size,
}: {
  onFile: () => void;
  onSvg: () => void;
  size: 'sm' | 'xs';
}) {
  const [open, setOpen] = useState(false);
  const item = (label: string, Icon: typeof FileDownIcon, run: () => void, testId: string) => (
    <button
      type="button"
      role="menuitem"
      className={MENU_ITEM_CLASS}
      onClick={() => {
        setOpen(false);
        run();
      }}
      data-testid={testId}
    >
      <Icon aria-hidden />
      {label}
    </button>
  );
  return (
    <LightPopover
      open={open}
      onOpenChange={setOpen}
      role="menu"
      label="Exportieren"
      testId="chain-export-menu"
      trigger={(props) => (
        <Button variant="outline" size={size} data-testid="chain-export" {...props}>
          <FileDownIcon data-icon="inline-start" />
          Exportieren
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      )}
    >
      <div className="flex flex-col p-1">
        {item('Datei (.vc.json)', FileDownIcon, onFile, 'export-chain-json')}
        {item('Bild (SVG)', ImageDownIcon, onSvg, 'export-chain-svg')}
      </div>
    </LightPopover>
  );
}

/** The revision behind the chain's name (UX6): who saved it and when. */
function RevisionDisclosure({
  revision,
}: {
  revision: { rev: number; handle: string; at: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <LightPopover
      open={open}
      onOpenChange={setOpen}
      label="Stand der Kette"
      align="start"
      trigger={(props) => (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Stand der Kette"
          title="Stand der Kette"
          data-testid="chain-revision"
          {...props}
        >
          <ChevronDownIcon />
        </Button>
      )}
    >
      <p className="p-2 text-sm whitespace-nowrap" data-testid="chain-revision-text">
        Revision {revision.rev} · gespeichert von{' '}
        <span className="font-mono">{revision.handle}</span> · {formatDateTime(revision.at)}
      </p>
    </LightPopover>
  );
}

export interface ChainHeaderProps {
  wide: boolean;
  project: string;
  projectName: string;
  mode: 'view' | 'edit';
  /** The chain's name (in edit mode the one on the canvas). */
  name: string;
  /** View mode: the head revision, who saved it and when. */
  revision: { rev: number; handle: string; at: string } | null;
  /** Edit mode: the revision the edit started from; 0 for a new chain. */
  editRev: number | null;
  dirty: boolean;
  /** „3 Prozesse ohne Schritt“; scrolls the panel to „Ohne Schritt“. */
  unplacedCount: number | null;
  onUnplaced: () => void;
  canReview: boolean;
  exists: boolean;
  /** „Bearbeiten“ waits for the head content. */
  canEdit: boolean;
  onEdit: () => void;
  onFile: () => void;
  onSvg: () => void;
  /** Edit mode. */
  saving: boolean;
  history: { undo: boolean; redo: boolean };
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onImport: () => void;
  onFinish: () => void;
}

/**
 * The chain page's header (UX6, UX-SIMPLIFICATION.md §3.8 item 5) on the
 * shared canvas header: „‹ <Projekt>“ as the way back, the chain's name with
 * its revision behind a disclosure, the chip „3 Prozesse ohne Schritt“,
 * „Bearbeiten“ and „Exportieren“ („Datei (.vc.json)“, „Bild (SVG)“). In edit
 * mode the revision and „Ungespeichert“ sit beside the name and the toolbar
 * below: „Speichern“, undo, redo, „Exportieren“, „Importieren“, „Fertig“.
 */
export function ChainHeader(props: ChainHeaderProps) {
  const { wide, mode, canReview, exists } = props;
  const size = wide ? 'sm' : 'xs';
  const titleExtra =
    mode === 'edit' ? (
      <span className="flex shrink-0 items-center gap-1.5">
        {props.editRev !== null ? (
          <Badge variant="outline" data-testid="chain-rev">
            {props.editRev > 0 ? `r${props.editRev}` : 'neu'}
          </Badge>
        ) : null}
        {props.dirty ? (
          <Badge
            variant="outline"
            className="border-warning bg-warning-soft text-warning"
            data-testid="unsaved"
          >
            Ungespeichert
          </Badge>
        ) : null}
      </span>
    ) : props.revision ? (
      <RevisionDisclosure revision={props.revision} />
    ) : null;
  const chip =
    mode === 'view' && props.unplacedCount !== null && props.unplacedCount > 0 ? (
      <button
        key="unplaced"
        type="button"
        onClick={props.onUnplaced}
        className="rounded-sm bg-warning-soft px-1.5 text-xs text-warning hover:underline"
        data-testid="unplaced-chip"
      >
        {props.unplacedCount === 1
          ? '1 Prozess ohne Schritt'
          : `${props.unplacedCount} Prozesse ohne Schritt`}
      </button>
    ) : null;
  const more =
    mode === 'view' && exists ? (
      <span className="flex items-center gap-1">
        {canReview ? (
          <Button
            size={size}
            onClick={props.onEdit}
            disabled={!props.canEdit}
            data-testid="edit-chain"
          >
            <PencilIcon data-icon="inline-start" />
            Bearbeiten
          </Button>
        ) : null}
        <ExportMenu onFile={props.onFile} onSvg={props.onSvg} size={size} />
      </span>
    ) : null;
  const toolbar =
    mode === 'edit' ? (
      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" onClick={props.onSave} disabled={props.saving} data-testid="save-chain">
          {props.saving ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <SaveIcon data-icon="inline-start" />
          )}
          Speichern
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Rückgängig"
          title="Rückgängig (Strg+Z)"
          disabled={!props.history.undo}
          onClick={props.onUndo}
        >
          <Undo2Icon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Wiederholen"
          title="Wiederholen (Strg+Y)"
          disabled={!props.history.redo}
          onClick={props.onRedo}
        >
          <Redo2Icon />
        </Button>
        <ExportMenu onFile={props.onFile} onSvg={props.onSvg} size="sm" />
        {canReview ? (
          <Button variant="ghost" size="sm" onClick={props.onImport} data-testid="import-chain">
            <FileUpIcon data-icon="inline-start" />
            Importieren
          </Button>
        ) : null}
        <Button variant="outline" size="sm" data-testid="finish-edit" onClick={props.onFinish}>
          Fertig
        </Button>
      </div>
    ) : null;
  return (
    <CanvasHeader
      wide={wide}
      project={props.project}
      projectName={props.projectName}
      title={<span data-testid="chain-name">{props.name}</span>}
      titleExtra={titleExtra}
      chips={chip ? [chip] : []}
      more={more}
      below={toolbar}
      size="wide"
      testId="chain-header"
    />
  );
}
