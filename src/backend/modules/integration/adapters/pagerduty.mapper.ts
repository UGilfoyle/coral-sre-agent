export function mapPagerDutyIncidents(incidents: any[], tenantId: string) {
  return incidents.map((inc: any) => ({
    id: inc.id,
    tenant_id: tenantId,
    title: inc.title || inc.summary,
    status: inc.status,
    urgency: inc.urgency,
    created_at: inc.created_at,
    service_name: inc.service?.summary || 'unknown-service',
    assignee: inc.assignments?.[0]?.assignee?.summary || 'unassigned'
  }));
}
