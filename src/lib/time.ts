export function toPositiveInt(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isoFromMtime(ms: number): string {
  return new Date(ms).toISOString();
}

export function formatElapsed(
  fromIso: string | undefined,
  now = Date.now(),
): string {
  if (!fromIso) {
    return "";
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((now - new Date(fromIso).getTime()) / 1000),
  );
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return `${hours}h${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m${seconds}s`;
  }

  return `${seconds}s`;
}

export function formatRelative(
  iso: string | undefined,
  now = Date.now(),
): string {
  if (!iso) {
    return "";
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((now - new Date(iso).getTime()) / 1000),
  );
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s前`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m前`;
  }

  return `${Math.floor(minutes / 60)}h前`;
}
