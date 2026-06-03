import { Request, Response, NextFunction } from 'express';
import { validateUserSession, validateAPIKey } from './auth.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        tenantId: string;
        role: string;
      };
      apiKey?: {
        id: string;
        tenantId: string;
        name: string;
        rateLimit: number;
      };
    }
  }
}

/**
 * Middleware d'authentification JWT
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header missing' });
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer') {
    return res.status(401).json({ error: 'Invalid authorization scheme' });
  }

  if (!token) {
    return res.status(401).json({ error: 'Token missing' });
  }

  try {
    const user = await validateUserSession(token);

    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = {
      userId: user.userId,
      tenantId: user.tenantId,
      role: user.role,
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Middleware pour API keys
 */
export async function apiKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'API key missing' });
  }

  try {
    const validatedKey = await validateAPIKey(apiKey as string);

    if (!validatedKey) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    req.apiKey = {
      id: validatedKey.id,
      tenantId: validatedKey.tenant_id,
      name: validatedKey.name,
      rateLimit: validatedKey.rate_limit,
    };

    next();
  } catch (error) {
    console.error('API key middleware error:', error);
    res.status(500).json({ error: 'API key validation failed' });
  }
}

/**
 * Middleware optionnel: accepte JWT ou API key
 */
export async function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const user = await validateUserSession(token);
      if (user) {
        req.user = {
          userId: user.userId,
          tenantId: user.tenantId,
          role: user.role,
        };
      }
    } catch (error) {
      console.error('JWT validation error:', error);
    }
  } else if (apiKey) {
    try {
      const validatedKey = await validateAPIKey(apiKey as string);
      if (validatedKey) {
        req.apiKey = {
          id: validatedKey.id,
          tenantId: validatedKey.tenant_id,
          name: validatedKey.name,
          rateLimit: validatedKey.rate_limit,
        };
      }
    } catch (error) {
      console.error('API key validation error:', error);
    }
  }

  next();
}

/**
 * Middleware de vérification de rôle
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
}

/**
 * Middleware pour extraire tenantId
 */
export function withTenant(req: Request, res: Response, next: NextFunction) {
  if (!req.user && !req.apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const tenantId = req.user?.tenantId || req.apiKey?.tenantId;

  if (!tenantId) {
    return res.status(400).json({ error: 'Tenant ID not found' });
  }

  (req as any).tenantId = tenantId;
  next();
}

/**
 * Middleware d'erreur global
 */
export function errorHandler(
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error('Error:', error);

  // Stripe errors
  if (error.type === 'StripeInvalidRequestError') {
    return res.status(400).json({
      error: 'Stripe error',
      message: error.message,
    });
  }

  // Database errors
  if (error.code && error.code.startsWith('P')) {
    return res.status(400).json({
      error: 'Database error',
      message: 'Operation failed',
    });
  }

  // Default error
  res.status(error.statusCode || 500).json({
    error: error.message || 'Internal server error',
  });
}
