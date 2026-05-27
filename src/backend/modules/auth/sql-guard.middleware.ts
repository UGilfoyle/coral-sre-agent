import { Request, Response, NextFunction } from 'express';

const BLOCKED_PATTERNS = [
  /\bdrop\s+(table|database|schema)\b/i,
  /\btruncate\s+table\b/i,
  /\bdelete\s+from\b/i,
  /\bupdate\s+\w+\s+set\b/i,
  /\binsert\s+into\b/i,
  /\balter\s+table\b/i,
  /\bgrant\s+/i,
  /\brevoke\s+/i
];

/**
 * Blocks mutating SQL on the public query endpoint.
 * Investigations and agent queries use parameterized internal SQL only.
 */
export function sqlGuard(req: Request, res: Response, next: NextFunction) {
  const sql = req.body?.sql;
  if (typeof sql !== 'string') {
    return next();
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(sql)) {
      return res.status(403).json({
        error: 'Mutating SQL statements are not permitted on this endpoint. Only read-only SELECT queries are allowed.'
      });
    }
  }

  if (!/^\s*(select|with)\b/i.test(sql)) {
    return res.status(403).json({
      error: 'Only SELECT (read-only) queries are permitted.'
    });
  }

  next();
}
