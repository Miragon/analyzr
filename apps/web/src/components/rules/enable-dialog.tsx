import type { AutoAcceptRule } from '@analyzr/client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { OPEN_PROPOSALS_HINT, openMatchesText } from '@/lib/auto-accept-rules';
import { handleName } from '@/lib/labels';

/** Why the „Aktiv“ switch asks before enabling a rule. */
export interface EnableRequest {
  rule: AutoAcceptRule;
  /** Open proposals the rule's dry run finds now (0: none). */
  count: number;
  /**
   * Another principal wrote the head revision: enabling writes a revision
   * authored by the caller, whose decisions the rule's acceptances then are.
   */
  takeOver: boolean;
  /** The caller is unknown (`GET /me` failed): asked anyway, the author may be the caller. */
  unsure?: boolean;
}

/**
 * The „Aktiv“ switch's confirmation (UX-SIMPLIFICATION.md §3.11 item 3):
 * enabling writes a rule revision, so the switch asks first when it would
 * make the caller the rule's deciding person (the head revision's author
 * decides, owner decision 19; HANDOFF §8 "Auto-accept: take-over"), or when
 * open proposals already match: then it offers the list to apply, as saving
 * an active rule does („Aktivieren und Liste ansehen…“; rules are never
 * retroactive).
 */
export function EnableDialog({
  request,
  onOpenChange,
  onEnable,
}: {
  request: EnableRequest | null;
  onOpenChange: (open: boolean) => void;
  /** Enable the rule; `review`: then open its apply dialog. */
  onEnable: (rule: AutoAcceptRule, review: boolean) => void;
}) {
  const rule = request?.rule;
  const author = rule ? handleName(rule.author.handle) : '';
  return (
    <AlertDialog open={request !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="enable-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>{rule ? `Regel „${rule.name}“ aktivieren?` : ''}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              {request?.takeOver ? (
                <p data-testid="enable-take-over">
                  {!rule?.authorIsOwner
                    ? `${author} ist kein Inhaber mehr, deshalb nimmt die Regel bisher nichts an. Du wirst`
                    : request.unsure
                      ? `Bisher entscheidet ${author}. Bist du das nicht, wirst du`
                      : `Bisher entscheidet ${author}. Du wirst`}{' '}
                  damit die entscheidende Person dieser Regel: Ihre Annahmen werden als deine
                  Entscheidungen vermerkt.
                </p>
              ) : null}
              {request && request.count > 0 ? (
                <p data-testid="enable-open">
                  {openMatchesText(request.count)} schon jetzt. {OPEN_PROPOSALS_HINT}
                </p>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          {request && request.count > 0 ? (
            <>
              <AlertDialogAction variant="outline" onClick={() => onEnable(request.rule, false)}>
                Nur aktivieren
              </AlertDialogAction>
              <AlertDialogAction onClick={() => onEnable(request.rule, true)}>
                Aktivieren und Liste ansehen…
              </AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction onClick={() => request && onEnable(request.rule, false)}>
              Aktivieren
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
