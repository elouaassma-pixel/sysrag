import dotenv from 'dotenv';
import { initializeDatabase, query, closeDatabase } from '../src/services/db.js';

dotenv.config();

async function runAlter() {
  try {
    initializeDatabase();

    console.log('🔧 Altering document_chunks.embedding to vector(3072) if needed...');

    // Alter column type (pgvector allows ALTER TYPE to a different dimension)
    try {
      await query(`ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(3072) USING embedding;`);
      console.log('✅ Column altered to vector(3072)');
    } catch (err: any) {
      console.warn('⚠️ Alter column may have failed or already applied:', err.message || err);
    }

    // Replace function definition to accept 3072-dim query embedding
    const fn = `
CREATE OR REPLACE FUNCTION match_chunks (
  query_embedding vector(3072),
  match_threshold float,
  match_count int,
  filter_tenant_id text,
  filter_project_id text
)
RETURNS TABLE (
  id uuid,
  document_name text,
  text text,
  score float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    d.name AS document_name,
    c.text,
    (1 - (c.embedding <=> query_embedding))::float AS score
  FROM document_chunks c
  JOIN documents d ON c.document_id = d.id
  WHERE c.tenant_id = filter_tenant_id 
    AND c.project_id = filter_project_id
    AND (1 - (c.embedding <=> query_embedding)) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;`;

    try {
      await query(fn);
      console.log('✅ SQL function match_chunks updated to vector(3072)');
    } catch (err: any) {
      console.error('❌ Failed to update function match_chunks:', err.message || err);
    }
  } catch (err: any) {
    console.error('❌ Alter script failed:', err.message || err);
  } finally {
    await closeDatabase();
  }
}

runAlter();
