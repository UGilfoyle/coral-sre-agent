/** Safe microservice identifier: letters, digits, dots, hyphens, underscores. */
const SERVICE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/** ISO-8601 UTC timestamps produced by extractEntities (e.g. 2026-05-26T16:00:00Z). */
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const ALLOWED_LEVELS = new Set(['fatal', 'error', 'warning']);

/** Escape a value for use inside a single-quoted SQL string literal. */
export function escapeSqlStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** Escape a value for use inside a SQL LIKE pattern (also escapes % and _). */
export function escapeSqlLikePattern(value: string): string {
  return escapeSqlStringLiteral(value).replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

export function toSqlLiteral(value: string): string {
  return `'${escapeSqlStringLiteral(value)}'`;
}

export function toSqlLikeLiteral(value: string): string {
  return `'${escapeSqlLikePattern(value)}'`;
}

/** Drop service names that do not match the expected identifier pattern. */
export function sanitizeServiceNames(services: string[]): string[] {
  return services.filter((s) => SERVICE_NAME_PATTERN.test(s));
}

export function sanitizeTimestamp(ts: string | undefined): string | null {
  if (!ts || !ISO_TIMESTAMP_PATTERN.test(ts)) return null;
  return ts;
}

export function sanitizeLevels(levels: string[]): string[] {
  return levels.filter((l) => ALLOWED_LEVELS.has(l));
}
