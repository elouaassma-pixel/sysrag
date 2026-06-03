import { Pool, PoolClient, QueryResult } from 'pg';

let pool: Pool | null = null;

/**
 * Initialise la connexion PostgreSQL avec connection pooling
 */
export function initializeDatabase() {
  if (pool) return pool;

  const dbConfig: any = {
    max: 20, // max connections
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  };

  if (process.env.DATABASE_URL) {
    dbConfig.connectionString = process.env.DATABASE_URL;
    // Enable SSL automatically for Neon or Supabase, or if explicitly requested
    if (
      process.env.DATABASE_URL.includes('neon.tech') || 
      process.env.DATABASE_URL.includes('supabase') || 
      process.env.DB_SSL === 'true'
    ) {
      dbConfig.ssl = { rejectUnauthorized: false };
    }
  } else {
    dbConfig.user = process.env.DB_USER || 'postgres';
    dbConfig.password = process.env.DB_PASSWORD || 'password';
    dbConfig.host = process.env.DB_HOST || 'localhost';
    dbConfig.port = parseInt(process.env.DB_PORT || '5432', 10);
    dbConfig.database = process.env.DB_NAME || 'associe_ai';
    if (process.env.DB_SSL === 'true') {
      dbConfig.ssl = { rejectUnauthorized: false };
    }
  }

  pool = new Pool(dbConfig);

  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
  });

  return pool;
}

/**
 * Retourne le pool de connexion (initialized)
 */
export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return pool;
}

/**
 * Exécute une query
 */
export async function query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const pool = getPool();
  return pool.query<T>(text, params);
}

/**
 * Exécute une query et retourne une seule ligne
 */
export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] || null;
}

/**
 * Exécute une query et retourne toutes les lignes
 */
export async function queryAll<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await query<T>(text, params);
  return result.rows;
}

/**
 * Transactions avec client
 */
export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Ferme le pool de connexion
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
