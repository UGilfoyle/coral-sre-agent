import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { verifyJwt } from './auth.service.js';
import { queryControlPlanePostgres } from '../../shared/database.js';

// Extend Express Request interface to hold auth contexts
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        tenantId: string;
        email: string;
        role: string;
      };
      tenantId?: string;
    }
  }
}

/**
 * Authentication Middleware
 * Resolves tenant scope by verifying JWT (Authorization bearer) or static X-API-Key headers.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  // 1. Check API Key Header (first priority for integrations/CLIs)
  const apiKeyHeader = req.headers['x-api-key'] || req.headers['x-api-token'];
  if (apiKeyHeader && typeof apiKeyHeader === 'string') {
    try {
      const keyHash = crypto.createHash('sha256').update(apiKeyHeader).digest('hex');
      
      const keyRecord = await queryControlPlanePostgres(
        `SELECT k.*, t.status as tenant_status 
         FROM api_keys k 
         JOIN tenants t ON k.tenant_id = t.id 
         WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > NOW())`,
        [keyHash]
      );

      if (keyRecord.length === 0) {
        return res.status(401).json({ error: "Invalid, expired, or revoked API Key." });
      }

      const key = keyRecord[0];
      if (key.tenant_status !== 'active') {
        return res.status(403).json({ error: "Organization account is suspended or suspended." });
      }

      // Track usage time (asynchronous fire-and-forget update)
      queryControlPlanePostgres("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [key.id]).catch(() => {});

      req.user = {
        userId: key.created_by || 'api-key-agent',
        tenantId: key.tenant_id,
        email: 'agent@coralai.dev',
        role: 'member' // API Keys inherit member access rights
      };
      req.tenantId = key.tenant_id;
      return next();
    } catch (e: any) {
      return res.status(500).json({ error: `API Key authentication failed: ${e.message}` });
    }
  }

  // 2. Check Bearer Authorization Token (for Dashboard React app sessions)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyJwt(token);
    
    if (!decoded) {
      return res.status(401).json({ error: "Expired, malformed, or invalid session token." });
    }

    req.user = decoded;
    req.tenantId = decoded.tenantId;
    return next();
  }

  // Allow unauthenticated bypass for health, login, and stripe webhooks
  const bypassPaths = ['/api/health', '/api/auth/login', '/webhooks/stripe'];
  const isBypass = bypassPaths.some(p => req.path.startsWith(p));
  
  if (isBypass) {
    return next();
  }

  return res.status(401).json({ error: "Authentication credentials required. Please provide a valid JWT or X-API-Key header." });
}

/**
 * Role-Based Access Control (RBAC) authorization middleware
 */
export function requireRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized. Authentication is required." });
    }

    const { role } = req.user;
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: "Forbidden. Insufficient permissions to access this resource." });
    }

    next();
  };
}
