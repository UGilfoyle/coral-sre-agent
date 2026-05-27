import { queryControlPlanePostgres } from '../../shared/database.js';

export interface TenantConfig {
  id: string;
  name: string;
  slug: string;
  plan: string;
  settings: {
    serviceNames?: string[];
    slackAlertChannel?: string;
  };
}

/**
 * Retrieves the full context configuration for a specific tenant organization.
 */
export async function getTenantContext(tenantId: string): Promise<TenantConfig | null> {
  const rows = await queryControlPlanePostgres(
    "SELECT id, name, slug, plan, settings FROM tenants WHERE id = $1 AND status = 'active'",
    [tenantId]
  );

  if (rows.length === 0) return null;
  
  const tenant = rows[0];
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    plan: tenant.plan,
    settings: typeof tenant.settings === 'string' ? JSON.parse(tenant.settings) : (tenant.settings || {})
  };
}

/**
 * Updates tenant settings (e.g. customized microservice lists, Slack channels).
 */
export async function updateTenantSettings(tenantId: string, settings: any): Promise<TenantConfig> {
  // Load current settings
  const currentContext = await getTenantContext(tenantId);
  if (!currentContext) {
    throw new Error("Tenant organization does not exist.");
  }

  const mergedSettings = {
    ...currentContext.settings,
    ...settings
  };

  const rows = await queryControlPlanePostgres(
    "UPDATE tenants SET settings = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [JSON.stringify(mergedSettings), tenantId]
  );

  const updated = rows[0];
  return {
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    plan: updated.plan,
    settings: mergedSettings
  };
}

/**
 * Retrieve all registered active team members in an organization.
 */
export async function listTenantUsers(tenantId: string): Promise<any[]> {
  return queryControlPlanePostgres(
    "SELECT id, email, name, role, last_login_at, created_at FROM users WHERE tenant_id = $1 ORDER BY role = 'owner' DESC, created_at ASC",
    [tenantId]
  );
}

/**
 * Invite a new engineer to join a tenant workspace.
 */
export async function inviteUserToTenant(tenantId: string, email: string, name: string, role: string = 'member'): Promise<any> {
  // Check if already invited/registered
  const existing = await queryControlPlanePostgres(
    "SELECT id FROM users WHERE tenant_id = $1 AND email = $2",
    [tenantId, email]
  );

  if (existing.length > 0) {
    throw new Error("User has already been invited or registered in this organization.");
  }

  const rows = await queryControlPlanePostgres(
    `INSERT INTO users (tenant_id, email, name, role, auth_provider, last_login_at)
     VALUES ($1, $2, $3, $4, 'invited', NULL)
     RETURNING id, email, name, role, created_at`,
    [tenantId, email, name, role]
  );

  return rows[0];
}
