import dotenv from 'dotenv';
import { initializeDatabase, query, closeDatabase } from '../src/services/db.js';

dotenv.config();

async function runRepair() {
  try {
    initializeDatabase();
    console.log('🔎 Removing orphan document_chunks (no parent document)...');

    const res = await query(`DELETE FROM document_chunks WHERE document_id NOT IN (SELECT id FROM documents) RETURNING id;`);
    console.log(`✅ Removed ${res.rowCount} orphan chunks.`);

    console.log('ℹ️ Marking all documents as processing to allow reindex if needed.');
    await query(`UPDATE documents SET status = 'processing' WHERE status <> 'processing';`);
    console.log('✅ Documents set to processing.');
  } catch (err: any) {
    console.error('❌ Repair failed:', err.message || err);
  } finally {
    await closeDatabase();
  }
}

runRepair();
