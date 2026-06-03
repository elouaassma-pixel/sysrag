import { Request, Response, NextFunction } from 'express';
import { query, queryOne } from './db.js';

interface RateLimitConfig {
  windowMs: number; // Fenêtre en ms
  maxRequests: number; // Nombre max de requêtes par fenêtre
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

/**
 * Crée un middleware de rate limiting basé sur DB
 */
export function createRateLimiter(config: RateLimitConfig) {
  const { windowMs, maxRequests, skipSuccessfulRequests = false, skipFailedRequests = false } = config;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Identifier: IP ou API key
    const identifier = (req as any).apiKey?.id || req.ip || req.socket.remoteAddress || 'unknown';
    const endpoint = `${req.method} ${req.path}`;

    try {
      // Vérifier et incrémenter le compteur
      const now = new Date();
      const windowEnd = new Date(now.getTime() + windowMs);

      // Nettoyer les vieilles entrées
      await query(
        `DELETE FROM rate_limit_records WHERE window_end < NOW()`
      );

      // Vérifier le compte actuel
      const record = await queryOne(
        `SELECT request_count, window_end FROM rate_limit_records 
         WHERE identifier = $1 AND endpoint = $2 AND window_end > NOW()
         ORDER BY window_end DESC LIMIT 1`,
        [identifier, endpoint]
      );

      if (record && record.request_count >= maxRequests) {
        const retryAfter = Math.ceil((new Date(record.window_end).getTime() - now.getTime()) / 1000);
        
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', 0);
        res.setHeader('Retry-After', retryAfter);

        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter,
          message: `Too many requests. Try again in ${retryAfter} seconds.`
        });
      }

      // Incrémenter ou créer une entrée
      if (record) {
        await query(
          `UPDATE rate_limit_records 
           SET request_count = request_count + 1
           WHERE identifier = $1 AND endpoint = $2 AND window_end = $3`,
          [identifier, endpoint, record.window_end]
        );
      } else {
        await query(
          `INSERT INTO rate_limit_records (identifier, endpoint, request_count, window_end)
           VALUES ($1, $2, 1, $3)`,
          [identifier, endpoint, windowEnd]
        );
      }

      // Mettre à jour les headers de rate limiting
      const remaining = Math.max(0, maxRequests - (record?.request_count || 0) - 1);
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', windowEnd.toISOString());

      // Optionnel: sauter pour les requêtes réussies/échouées
      if (skipSuccessfulRequests || skipFailedRequests) {
        const originalSend = res.send;
        res.send = function (data: any) {
          const statusCode = res.statusCode;
          const skip = (statusCode < 400 && skipSuccessfulRequests) ||
                      (statusCode >= 400 && skipFailedRequests);
          
          if (!skip) {
            // Décrémenter le compteur puisque nous skipons
            query(
              `UPDATE rate_limit_records 
               SET request_count = request_count - 1
               WHERE identifier = $1 AND endpoint = $2`,
              [identifier, endpoint]
            ).catch(err => console.error('Failed to update rate limit:', err));
          }
          
          return originalSend.call(this, data);
        };
      }

      next();
    } catch (error) {
      console.error('Rate limit middleware error:', error);
      // Ne pas bloquer en cas d'erreur DB
      next();
    }
  };
}

/**
 * Réinitialise le rate limit pour un identifier
 */
export async function resetRateLimit(identifier: string, endpoint?: string): Promise<void> {
  if (endpoint) {
    await query(
      `DELETE FROM rate_limit_records WHERE identifier = $1 AND endpoint = $2`,
      [identifier, endpoint]
    );
  } else {
    await query(
      `DELETE FROM rate_limit_records WHERE identifier = $1`,
      [identifier]
    );
  }
}

/**
 * Obtient les stats de rate limiting
 */
export async function getRateLimitStats(identifier: string): Promise<any> {
  return query(
    `SELECT endpoint, request_count, window_end FROM rate_limit_records 
     WHERE identifier = $1 AND window_end > NOW()
     ORDER BY endpoint`,
    [identifier]
  );
}

/**
 * Présets de rate limiting courants
 */
export const RATE_LIMIT_PRESETS = {
  // Global API
  global: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100,
  },
  // Login attempts
  login: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
  },
  // Upload de fichiers
  upload: {
    windowMs: 60 * 60 * 1000, // 1 heure
    maxRequests: 50,
  },
  // Chat/API
  chat: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30,
  },
  // Endpoint standard
  standard: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 300,
  },
};
