-- Active l'extension pgvector pour la recherche de similarité vectorielle
CREATE EXTENSION IF NOT EXISTS vector;

-- Table des agences (Tenants)
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, -- ex: 'hassan_agency'
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des utilisateurs
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des projets
CREATE TABLE IF NOT EXISTS projects (
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  id TEXT NOT NULL, -- displayProjectId
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tenant_id, id)
);

-- Table des documents
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  size BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  chunks_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, name)
);

-- Table des segments de documents avec leurs embeddings vectoriels
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding vector(3072), -- Taille des vecteurs (ex: gemini-embedding-2-preview large = 3072)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des messages de discussion
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  sender TEXT NOT NULL CHECK (sender IN ('user', 'ai')),
  text TEXT NOT NULL,
  sources JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des logs de synchronisation
CREATE TABLE IF NOT EXISTS sync_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  chunks_count INT DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des tokens du widget de chat public
CREATE TABLE IF NOT EXISTS widget_tokens (
  token TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  agent_name TEXT DEFAULT 'Assistant IA',
  agent_color TEXT DEFAULT '#6366f1',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insère les tenants et utilisateurs de démonstration par défaut
INSERT INTO tenants (id, name) 
VALUES 
  ('hassan_agency', 'Hassan Luxury Real Estate'),
  ('villa_serena_agency', 'Serena Properties')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (username, tenant_id, password_hash, role) 
VALUES 
  ('hassan', 'hassan_agency', '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8', 'admin'),
  ('serena', 'villa_serena_agency', '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8', 'admin')
ON CONFLICT (username) DO NOTHING;

INSERT INTO projects (tenant_id, id, name)
VALUES 
  ('hassan_agency', 'default', 'Dossier Général'),
  ('villa_serena_agency', 'default', 'Dossier Général')
ON CONFLICT (tenant_id, id) DO NOTHING;

-- ==================== PHASE 1: AUTH ROBUSTE ====================

-- Table des sessions utilisateur
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(token);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);

-- Table OAuth2 providers (Google, LinkedIn, etc.)
CREATE TABLE IF NOT EXISTS oauth_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  authorize_url TEXT NOT NULL,
  token_url TEXT NOT NULL,
  userinfo_url TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Liens utilisateurs -> comptes OAuth
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES oauth_providers(id) ON DELETE CASCADE,
  provider_user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  profile_picture_url TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (provider_id, provider_user_id)
);

CREATE INDEX idx_oauth_accounts_user_id ON oauth_accounts(user_id);
CREATE INDEX idx_oauth_accounts_provider ON oauth_accounts(provider_id, provider_user_id);

-- 2FA secrets and backup codes
CREATE TABLE IF NOT EXISTS two_factor_auth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  secret_key TEXT NOT NULL,
  backup_codes TEXT[] NOT NULL, -- Array de codes de secours
  enabled BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_two_factor_auth_user_id ON two_factor_auth(user_id);

-- ==================== PHASE 1: RATE LIMITING ====================

-- Rate limiting per IP/API key
CREATE TABLE IF NOT EXISTS rate_limit_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL, -- IP or API key
  endpoint TEXT NOT NULL,
  request_count INT DEFAULT 1,
  window_start TIMESTAMPTZ DEFAULT NOW(),
  window_end TIMESTAMPTZ NOT NULL,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rate_limit_identifier ON rate_limit_records(identifier, endpoint);
CREATE INDEX idx_rate_limit_window_end ON rate_limit_records(window_end);

-- API keys for webhook/programmatic access
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(username),
  rate_limit INT DEFAULT 1000, -- requests per hour
  allowed_endpoints TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_keys_tenant_id ON api_keys(tenant_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);

-- ==================== PHASE 1: STRIPE BILLING ====================

-- Tenant subscription plans
CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY, -- 'starter', 'pro', 'enterprise'
  name TEXT NOT NULL,
  description TEXT,
  price_usd INT NOT NULL, -- cents
  monthly_doc_limit INT NOT NULL,
  monthly_api_calls INT NOT NULL,
  storage_gb INT NOT NULL,
  features JSONB DEFAULT '{}',
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tenant subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id TEXT UNIQUE,
  status TEXT NOT NULL, -- 'active', 'past_due', 'canceled', 'unpaid'
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN DEFAULT false,
  canceled_at TIMESTAMPTZ,
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_tenant_id ON subscriptions(tenant_id);
CREATE INDEX idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- Usage tracking per tenant per month
CREATE TABLE IF NOT EXISTS usage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL,
  documents_uploaded INT DEFAULT 0,
  documents_processed INT DEFAULT 0,
  api_calls INT DEFAULT 0,
  storage_used_bytes BIGINT DEFAULT 0,
  embeddings_generated INT DEFAULT 0,
  cost_usd NUMERIC(10, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, year, month)
);

CREATE INDEX idx_usage_metrics_tenant_id ON usage_metrics(tenant_id, year, month);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT UNIQUE,
  amount_usd NUMERIC(10, 2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT NOT NULL, -- 'draft', 'open', 'paid', 'void', 'uncollectible'
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  due_date TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  invoice_url TEXT,
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoices_tenant_id ON invoices(tenant_id);
CREATE INDEX idx_invoices_status ON invoices(status);

-- ==================== PHASE 1: FILE STORAGE (MinIO/S3) ====================

-- S3/MinIO file metadata
CREATE TABLE IF NOT EXISTS file_storage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  s3_bucket TEXT NOT NULL,
  s3_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  file_hash TEXT, -- SHA256 for integrity
  mime_type TEXT,
  storage_class TEXT DEFAULT 'STANDARD', -- 'STANDARD', 'INFREQUENT_ACCESS', 'ARCHIVE'
  is_encrypted BOOLEAN DEFAULT true,
  virus_scan_status TEXT DEFAULT 'pending', -- 'pending', 'clean', 'infected'
  virus_scan_result TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_file_storage_document_id ON file_storage(document_id);
CREATE INDEX idx_file_storage_tenant_id ON file_storage(tenant_id);
CREATE INDEX idx_file_storage_s3_key ON file_storage(s3_key);

-- S3 access logs
CREATE TABLE IF NOT EXISTS file_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_storage_id UUID NOT NULL REFERENCES file_storage(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(username),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- 'download', 'view', 'delete'
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_file_access_logs_file_storage_id ON file_access_logs(file_storage_id);
CREATE INDEX idx_file_access_logs_user_id ON file_access_logs(user_id);

-- ==================== SEED DATA FOR PHASE 1 ====================

INSERT INTO subscription_plans (id, name, description, price_usd, monthly_doc_limit, monthly_api_calls, storage_gb, features, is_active)
VALUES 
  ('starter', 'Starter', 'Pour petites équipes', 2999, 50, 10000, 10, '{"users": 2, "projects": 1}', true),
  ('pro', 'Professional', 'Pour entreprises', 9999, 500, 100000, 100, '{"users": 10, "projects": 10, "api_access": true}', true),
  ('enterprise', 'Enterprise', 'Solution custom', 0, 5000, 1000000, 1000, '{"users": -1, "projects": -1, "api_access": true, "sso": true, "webhooks": true}', true)
ON CONFLICT (id) DO NOTHING;

-- Fonction SQL de recherche de similarité cosinus (RAG)
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
$$;
