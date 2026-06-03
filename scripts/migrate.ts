import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Charger les variables d'environnement AVANT d'initialiser la DB
dotenv.config();

import { getPool, initializeDatabase, closeDatabase } from '../src/services/db.js';

const __dirname = join(fileURLToPath(import.meta.url), '..');

/**
 * Exécute les migrations SQL — envoie le schema.sql complet en une seule requête
 */
async function runMigrations() {
  console.log('🔄 Starting database migrations...');

  try {
    // Initialiser la DB
    initializeDatabase();
    const pool = getPool();

    // Lire le schema.sql
    const schemaPath = join(__dirname, '../schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    // Exécuter le schema complet en une seule requête
    // PostgreSQL supporte l'exécution de multiples statements dans un seul appel
    await pool.query(schema);

    console.log('✅ Migration complete! All tables and seed data created successfully.');
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message || error);
    
    // Si l'erreur concerne l'extension vector, donner un conseil
    if (error.message?.includes('vector')) {
      console.log('\n💡 Conseil: Activez l\'extension pgvector dans votre dashboard Neon:');
      console.log('   Dashboard → SQL Editor → Exécutez: CREATE EXTENSION IF NOT EXISTS vector;');
    }
    
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

// Exécuter
runMigrations();
