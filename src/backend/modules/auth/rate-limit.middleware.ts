import { Request, Response, NextFunction } from 'express';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateLimitBucket>();

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '100', 10);

function getBucketKey(tenantId: string, route: string): string {
  return `${tenantId}:${route}`;
}

function getLimitForRequest(req: Request): number {
  if (req.headers['x-api-key']) {
    return DEFAULT_LIMIT;
  }
  return DEFAULT_LIMIT;
}

/**
 * Per-tenant token bucket rate limiter (in-memory MVP).
 * Production: swap backing store for Redis without changing middleware signature.
 */
export function rateLimit(routeLabel: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return next();
    }

    const limit = getLimitForRequest(req);
    const key = getBucketKey(tenantId, routeLabel);
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > limit) {
      return res.status(429).json({
        error: `Rate limit exceeded. Maximum ${limit} requests per minute for this tenant.`,
        retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000)
      });
    }

    next();
  };
}

/** @internal Test helper */
export function resetRateLimitBuckets() {
  buckets.clear();
}
