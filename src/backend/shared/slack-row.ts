/**
 * JSONL / Coral specs use `user`; Postgres column is `username`.
 * Live Slack adapter rows may only include `username`.
 */
export function slackUsernameFromRow(row: {
  user?: string;
  username?: string;
}): string | null {
  const value = row.user ?? row.username;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
