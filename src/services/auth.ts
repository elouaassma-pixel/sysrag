import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto, { randomBytes } from 'crypto';
import { query, queryOne, transaction } from './db.js';

interface TokenPayload {
  userId: string;
  tenantId: string;
  role: string;
  iat?: number;
  exp?: number;
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-change-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';

/**
 * Hash password avec bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

/**
 * Vérifie password
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.length === 64 && !hash.startsWith('$')) {
    const sha256 = crypto.createHash("sha256").update(password).digest("hex");
    return sha256 === hash;
  }
  return bcrypt.compare(password, hash);
}

/**
 * Génère JWT token
 */
export function generateJWT(payload: TokenPayload, expiresIn = JWT_EXPIRY): string {
  return jwt.sign(payload as any, JWT_SECRET as any, {
    expiresIn,
    algorithm: 'HS256',
  } as any) as string;
}

/**
 * Vérifie JWT token
 */
export function verifyJWT(token: string): TokenPayload | null {
  try {
    return jwt.verify(token as any, JWT_SECRET as any, {
      algorithms: ['HS256'],
    } as any) as TokenPayload;
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
}

/**
 * Crée une session utilisateur en DB
 */
export async function createUserSession(
  userId: string,
  tenantId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<string> {
  const token = generateJWT(
    { userId, tenantId, role: 'user' },
    JWT_EXPIRY
  );

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  await query(
    `INSERT INTO user_sessions (user_id, tenant_id, token, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, tenantId, token, ipAddress, userAgent, expiresAt]
  );

  return token;
}

/**
 * Valide une session
 */
export async function validateUserSession(token: string): Promise<TokenPayload | null> {
  const decoded = verifyJWT(token);
  if (!decoded) return null;

  // Vérifier que la session existe en DB
  const session = await queryOne(
    `SELECT * FROM user_sessions 
     WHERE token = $1 AND expires_at > NOW()`,
    [token]
  );

  if (!session) return null;

  // Update last_activity
  await query(
    `UPDATE user_sessions SET last_activity = NOW() WHERE token = $1`,
    [token]
  );

  return decoded;
}

/**
 * Invalide une session (logout)
 */
export async function invalidateUserSession(token: string): Promise<void> {
  await query(
    `DELETE FROM user_sessions WHERE token = $1`,
    [token]
  );
}

/**
 * Génère une API key
 */
export async function generateAPIKey(
  tenantId: string,
  createdBy: string,
  name: string,
  rateLimit = 1000
): Promise<string> {
  const key = randomBytes(32).toString('hex');
  const keyHash = await hashPassword(key);

  await query(
    `INSERT INTO api_keys (key_hash, name, tenant_id, created_by, rate_limit)
     VALUES ($1, $2, $3, $4, $5)`,
    [keyHash, name, tenantId, createdBy, rateLimit]
  );

  return key; // Return only once
}

/**
 * Valide une API key
 */
export async function validateAPIKey(key: string): Promise<any | null> {
  // Récupère tous les hashes et compare (coûteux mais sûr)
  const apiKeys = await query(
    `SELECT * FROM api_keys WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW())`
  );

  for (const apiKey of apiKeys.rows) {
    const match = await bcrypt.compare(key, apiKey.key_hash);
    if (match) {
      // Update last_used_at
      await query(
        `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
        [apiKey.id]
      );
      return apiKey;
    }
  }

  return null;
}

/**
 * Enregistre un compte OAuth
 */
export async function registerOAuthAccount(
  userId: string,
  providerId: string,
  providerUserId: string,
  email: string,
  name?: string,
  profilePictureUrl?: string,
  accessToken?: string,
  refreshToken?: string
): Promise<void> {
  await query(
    `INSERT INTO oauth_accounts 
     (user_id, provider_id, provider_user_id, email, name, profile_picture_url, access_token, refresh_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (provider_id, provider_user_id) DO UPDATE SET
       access_token = $7, refresh_token = $8, updated_at = NOW()`,
    [userId, providerId, providerUserId, email, name, profilePictureUrl, accessToken, refreshToken]
  );
}

/**
 * Récupère un compte OAuth par provider
 */
export async function getOAuthAccount(providerId: string, providerUserId: string): Promise<any | null> {
  return queryOne(
    `SELECT * FROM oauth_accounts WHERE provider_id = $1 AND provider_user_id = $2`,
    [providerId, providerUserId]
  );
}

/**
 * Setup 2FA pour un utilisateur
 */
export async function setup2FA(userId: string, tenantId: string, secret: string): Promise<string[]> {
  // Génère des backup codes
  const backupCodes = Array.from({ length: 8 }, () =>
    randomBytes(4).toString('hex').toUpperCase()
  );

  await query(
    `INSERT INTO two_factor_auth (user_id, tenant_id, secret_key, backup_codes, enabled)
     VALUES ($1, $2, $3, $4, false)
     ON CONFLICT (user_id) DO UPDATE SET
       secret_key = $3, backup_codes = $4, enabled = false, verified_at = NULL`,
    [userId, tenantId, secret, backupCodes]
  );

  return backupCodes;
}

/**
 * Active 2FA pour un utilisateur
 */
export async function enable2FA(userId: string): Promise<void> {
  await query(
    `UPDATE two_factor_auth 
     SET enabled = true, verified_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Désactive 2FA
 */
export async function disable2FA(userId: string): Promise<void> {
  await query(
    `UPDATE two_factor_auth 
     SET enabled = false, verified_at = NULL
     WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Récupère le secret 2FA d'un utilisateur
 */
export async function get2FASecret(userId: string): Promise<any | null> {
  return queryOne(
    `SELECT * FROM two_factor_auth WHERE user_id = $1`,
    [userId]
  );
}
