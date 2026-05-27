/** Static Coral schema metadata for environments without the Coral CLI (e.g. Render). */

export const CORAL_SOURCES = [
  { name: 'github', version: '0.1.0' },
  { name: 'pagerduty', version: '0.1.0' },
  { name: 'sentry', version: '0.1.0' },
  { name: 'slack', version: '0.1.0' },
  { name: 'deployments', version: '0.1.0' },
  { name: 'enterprise', version: '0.1.0' }
] as const;

const TABLE_COLUMNS: Record<string, { column_name: string; data_type: string }[]> = {
  'github.builds': [
    'id', 'workflow_name', 'commit_sha', 'branch', 'status', 'trigger_time', 'duration_seconds', 'error_log', 'triggered_by'
  ].map((c) => ({ column_name: c, data_type: 'Utf8' })),
  'pagerduty.incidents': [
    'id', 'title', 'status', 'urgency', 'created_at', 'service_name', 'assignee'
  ].map((c) => ({ column_name: c, data_type: 'Utf8' })),
  'sentry.errors': [
    'id', 'issue_id', 'message', 'status', 'level', 'first_seen', 'last_seen', 'count', 'metadata__culprit', 'stack_trace'
  ].map((c) => ({ column_name: c, data_type: 'Utf8' })),
  'slack.threads': [
    'id', 'channel', 'ts', 'user', 'text', 'replies_count', 'replies'
  ].map((c) => ({ column_name: c, data_type: 'Utf8' })),
  'deployments.history': [
    'id', 'service', 'version', 'status', 'deployed_at', 'deployed_by', 'changelog'
  ].map((c) => ({ column_name: c, data_type: 'Utf8' })),
  'enterprise.tickets': [
    'id', 'board', 'title', 'status', 'priority', 'assignee', 'service', 'created_at'
  ].map((c) => ({ column_name: c, data_type: 'Utf8' })),
  'enterprise.change_requests': [
    'id', 'system', 'service', 'version', 'status', 'requester', 'scheduled_at', 'risk_level'
  ].map((c) => ({ column_name: c, data_type: 'Utf8' })),
  'enterprise.knowledge_base': [
    'id', 'platform', 'title', 'service', 'runbook_steps', 'last_updated_at'
  ].map((c) => ({ column_name: c, data_type: 'Utf8' }))
};

export function getStaticCoralTables() {
  return Object.keys(TABLE_COLUMNS).map((fullName) => {
    const [schema_name, table_name] = fullName.split('.');
    return { schema_name, table_name };
  });
}

export function getStaticCoralColumns() {
  return Object.entries(TABLE_COLUMNS).flatMap(([fullName, columns]) => {
    const [schema_name, table_name] = fullName.split('.');
    return columns.map((col) => ({
      schema_name,
      table_name,
      column_name: col.column_name,
      data_type: col.data_type
    }));
  });
}

export function getStaticCoralSourcesList(): string {
  const header = 'Source       Version  Origin\n-----------  -------  --------';
  const rows = CORAL_SOURCES.map(
    (s) => `${s.name.padEnd(13)}${s.version.padEnd(9)}imported`
  );
  return [header, ...rows].join('\n');
}
