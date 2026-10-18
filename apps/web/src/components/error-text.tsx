import { errorDetail, errorMessage } from '@/lib/api';

/**
 * The server's own words behind a closed „Technische Details“ (P3: the
 * German sentence first, the engineering detail one level down); nothing
 * without a detail.
 */
export function TechnicalDetails({ detail }: { detail: string | undefined }) {
  if (!detail) return null;
  return (
    <details className="text-xs text-muted-foreground" data-testid="technical-details">
      <summary className="cursor-pointer select-none">Technische Details</summary>
      <p className="mt-1 font-mono break-words">{detail}</p>
    </details>
  );
}

/** A failure in German, its technical detail behind a disclosure (alerts, inline errors). */
export function ErrorText({ error }: { error: unknown }) {
  return (
    <>
      <p>{errorMessage(error)}</p>
      <TechnicalDetails detail={errorDetail(error)} />
    </>
  );
}
