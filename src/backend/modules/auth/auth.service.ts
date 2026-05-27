import crypto from 'crypto';
import { queryControlPlanePostgres } from '../../shared/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'coral-ai-bot-super-secret-key-change-in-prod';

export interface UserSession {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
}

/**
 * High-performance, self-contained JWT generator using Node.js native crypto module (HS256).
 */
export function signJwt(payload: any, expiresInSeconds: number = 3600 * 24): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload = { ...payload, exp };

  const sHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const sPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');

  const hmac = crypto.createHmac('sha256', JWT_SECRET);
  hmac.update(`${sHeader}.${sPayload}`);
  const signature = hmac.digest('base64url');

  return `${sHeader}.${sPayload}.${signature}`;
}

/**
 * Validates HS256 JWT and returns the parsed payload if valid.
 */
export function verifyJwt(token: string): any {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [sHeader, sPayload, signature] = parts;
    const hmac = crypto.createHmac('sha256', JWT_SECRET);
    hmac.update(`${sHeader}.${sPayload}`);
    const expectedSignature = hmac.digest('base64url');

    if (signature !== expectedSignature) return null;

    const payload = JSON.parse(Buffer.from(sPayload, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Generates a unique, cryptographically secure API key.
 * Format: coral_sk_<32-chars-random-hex>
 */
export function generateApiKey(): { rawKey: string; keyPrefix: string; keyHash: string } {
  const bytes = crypto.randomBytes(16).toString('hex');
  const rawKey = `coral_sk_${bytes}`;
  const keyPrefix = rawKey.substring(0, 12); // "coral_sk_abc..."
  
  // SHA-256 hash for database comparison (fast, safe, static-length)
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  return { rawKey, keyPrefix, keyHash };
}

/**
 * Create a new user session upon SSO authentication
 */
export async function authenticateSsoUser(email: string, name: string, provider: string, providerId: string): Promise<{ token: string; user: any }> {
  // 1. Check if user already exists
  const existingUsers = await queryControlPlanePostgres(
    "SELECT u.*, t.slug as tenant_slug, t.plan as tenant_plan FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = $1",
    [email]
  );

  let user: any = null;

  if (existingUsers.length > 0) {
    user = existingUsers[0];
    await queryControlPlanePostgres(
      "UPDATE users SET last_login_at = NOW() WHERE id = $1",
      [user.id]
    );
  } else {
    // Implicit signup: Create a default tenant and primary owner user
    const tenantSlug = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '-') + '-org';
    const tenantName = `${name}'s Workspace`;
    
    // Create Tenant
    const tenantRows = await queryControlPlanePostgres(
      "INSERT INTO tenants (name, slug, plan) VALUES ($1, $2, 'starter') RETURNING *",
      [tenantName, tenantSlug]
    );
    const tenant = tenantRows[0];

    // Create User as Owner
    const userRows = await queryControlPlanePostgres(
      "INSERT INTO users (tenant_id, email, name, role, auth_provider, auth_provider_id, last_login_at) VALUES ($1, $2, $3, 'owner', $4, $5, NOW()) RETURNING *",
      [tenant.id, email, name, provider, providerId]
    );
    
    user = {
      ...userRows[0],
      tenant_slug: tenant.slug,
      tenant_plan: tenant.plan
    };
  }

  // Issue session token
  const token = signJwt({
    userId: user.id,
    tenantId: user.tenant_id,
    email: user.email,
    role: user.role
  });

  return { token, user };
}
