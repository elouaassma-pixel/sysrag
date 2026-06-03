# PHASE 1: FONDATIONS - Implementation Guide

## Overview

PHASE 1 transforme le prototype en une base **production-ready** avec:
- ✅ PostgreSQL multi-tenant
- ✅ Rate limiting robuste
- ✅ Authentication sécurisée (OAuth2, 2FA)
- ✅ Billing Stripe
- ✅ File storage S3/MinIO

**Timeline estimée**: 2-3 semaines

---

## 1. PostgreSQL Migration

### Setup Local Development

```bash
# Option A: Docker (recommandé)
docker-compose up -d

# Vérifie que PostgreSQL et MinIO sont up
docker-compose ps
```

### Exécuter les migrations

```bash
npm install
npm run db:migrate
```

Le script `migrate.ts` exécute le `schema.sql` complet, créant:
- Tables core (tenants, users, projects, documents)
- Tables auth (sessions, oauth_accounts, 2fa)
- Tables rate limiting
- Tables billing (subscriptions, invoices, usage_metrics)
- Tables file storage

### Connexion DB en Production

```env
DB_HOST=your-rds-host.aws.amazon.com
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your-secure-password
DB_NAME=associe_ai
```

---

## 2. Rate Limiting

### Architecture

- **DB-based**: Persiste les limites dans `rate_limit_records`
- **Per IP + Endpoint**: Limite chaque IP par endpoint
- **Configurable**: Différents presets (login, upload, chat)

### Utilisation

```typescript
import { createRateLimiter, RATE_LIMIT_PRESETS } from '@/services/rate-limiter';

// Dans Express
app.post('/login', 
  createRateLimiter(RATE_LIMIT_PRESETS.login),
  loginHandler
);

app.post('/chat',
  createRateLimiter(RATE_LIMIT_PRESETS.chat),
  chatHandler
);

app.post('/upload',
  createRateLimiter(RATE_LIMIT_PRESETS.upload),
  uploadHandler
);
```

### Preset disponibles

```typescript
- global: 100 req/15min
- login: 5 req/15min (pour empêcher brute-force)
- upload: 50 req/1h
- chat: 30 req/1min
- standard: 300 req/15min
```

---

## 3. Authentication Robuste

### Architecture

#### a) Sessions JWT + DB

```typescript
import { createUserSession, validateUserSession, invalidateUserSession } from '@/services/auth';

// Login
const token = await createUserSession(userId, tenantId, ipAddress, userAgent);

// Middleware
app.use(authMiddleware); // Valide le token et récupère user info

// Logout
await invalidateUserSession(token);
```

#### b) OAuth2 (Google, LinkedIn)

```typescript
// Setup providers en DB
INSERT INTO oauth_providers VALUES:
- ('google', 'Google', ...)
- ('linkedin', 'LinkedIn', ...)

// Flow:
1. Frontend -> Backend: GET /auth/google/login
2. Backend -> Google: Redirige vers consent screen
3. Google -> Backend: code
4. Backend: Échange code contre token
5. Backend -> Frontend: JWT token
```

#### c) 2FA (TOTP)

```typescript
import { setup2FA, enable2FA, get2FASecret } from '@/services/auth';

// Setup
const backupCodes = await setup2FA(userId, tenantId, secret);

// Verify
const twoFASecret = await get2FASecret(userId);
// Utiliser speakeasy pour valider le TOTP token

// Enable
await enable2FA(userId);
```

### Password Hashing

```typescript
import { hashPassword, verifyPassword } from '@/services/auth';

// Register
const hash = await hashPassword(password); // bcrypt

// Login
const valid = await verifyPassword(password, hash);
```

---

## 4. Stripe Billing

### Setup Stripe

1. **Créer un compte Stripe** → https://dashboard.stripe.com
2. **Créer les plans en Stripe Dashboard**:
   - Starter: $29.99/month
   - Pro: $99.99/month
   - Enterprise: Custom pricing
3. **Obtenir les IDs**:
   - Product ID
   - Price ID
4. **Ajouter à la DB**:

```sql
UPDATE subscription_plans 
SET stripe_product_id = 'prod_...', stripe_price_id = 'price_...'
WHERE id = 'starter';
```

### Création de subscription

```typescript
import { createSubscription, getTenantSubscription } from '@/services/stripe';

// Setup
const customer = await getOrCreateStripeCustomer(tenantId, email);

// Create subscription
const subscription = await createSubscription({
  tenantId,
  planId: 'pro',
  stripeCustomerId: customer.id,
});

// Récupérer status
const sub = await getTenantSubscription(tenantId);
// { plan_name, price_usd, status, current_period_end, ... }
```

### Webhooks Stripe

```typescript
// Endpoint
app.post('/webhooks/stripe', 
  express.raw({type: 'application/json'}),
  stripeWebhookHandler
);

// Événements gérés
- customer.subscription.created/updated/deleted
- invoice.payment_succeeded/failed
```

### Usage Tracking

```typescript
import { updateUsageMetrics } from '@/services/stripe';

// Enregistrer une action
await updateUsageMetrics(tenantId, 2026, 5, {
  documents_uploaded: 1,
  api_calls: 5,
  storage_used_bytes: 1024000,
});
```

---

## 5. MinIO / S3 File Storage

### Setup Local

MinIO démarre automatiquement avec `docker-compose up -d`

**Console UI**: http://localhost:9001
- Username: `minioadmin`
- Password: `minioadmin`

### Setup Production

```env
# Option: AWS S3
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_BUCKET=associe-ai-prod
```

### Utilisation

```typescript
import { uploadFile, downloadFile, deleteFile, generatePresignedUrl } from '@/services/minio';

// Upload
const { s3Key, hash } = await uploadFile(
  documentId,
  tenantId,
  fileName,
  fileStream,
  fileSize,
  mimeType
);

// Télécharger
const buffer = await downloadFile(tenantId, s3Key);

// URL temporaire (download link)
const presignedUrl = await generatePresignedUrl(tenantId, s3Key, 3600);

// Delete
await deleteFile(tenantId, s3Key);
```

### Isolation Multi-tenant

Chaque tenant a son bucket:
```
tenant-hassan_agency/
  documents/
    {docId}/timestamp-filename.pdf
    
tenant-villa_serena_agency/
  documents/
    {docId}/timestamp-filename.pdf
```

---

## 6. Environment Configuration

Créer `.env.local` ou `.env.production`:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=associe_ai

# Auth
JWT_SECRET=your-super-secret-key-prod-123456
JWT_EXPIRY=24h

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# MinIO/S3
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_USE_SSL=false

# OAuth (optionnel)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Gemini
GEMINI_API_KEY=...
```

---

## 7. Integration Points (TODO)

### Update `server.ts`

```typescript
import { 
  initializeDatabase,
  initializeMinIO,
  authMiddleware,
  withTenant,
  createRateLimiter,
  RATE_LIMIT_PRESETS
} from '@/services';

// Initialisation
const pool = initializeDatabase();
const minioClient = initializeMinIO();

// Middleware global
app.use(express.json());
app.use(createRateLimiter(RATE_LIMIT_PRESETS.global));

// Routes protected
app.use(authMiddleware);
app.use(withTenant);

// Routes publiques (avant authMiddleware)
app.post('/auth/login', createRateLimiter(RATE_LIMIT_PRESETS.login), loginHandler);
app.post('/auth/register', registerHandler);
```

### Endpoints à migrer

- ❌ `/login` (remplacer loadJSON par DB query)
- ❌ `/stats` (récupérer de subscriptions table)
- ❌ `/documents` (récupérer de documents table)
- ❌ `/upload` (utiliser MinIO + file_storage table)
- ❌ `/chat` (mettre à jour usage_metrics)

---

## 8. Testing

### Vérifier PostgreSQL

```bash
psql -h localhost -U postgres -d associe_ai
SELECT * FROM subscription_plans;
SELECT * FROM users;
```

### Vérifier MinIO

```bash
# Créer un bucket de test
mc mb minio/test-bucket
```

### Vérifier Stripe

```bash
# Tester une création de subscription
curl -X POST http://localhost:3000/api/subscriptions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"planId": "starter"}'
```

---

## 9. Next Steps (PHASE 2)

- [ ] Logging centralisé (Sentry)
- [ ] Monitoring (Prometheus)
- [ ] Admin Dashboard
- [ ] API Documentation (Swagger)
- [ ] Email notifications
- [ ] Audit logs

---

## 🎯 Checklist PHASE 1

- [x] Enrichir schema.sql
- [x] Créer services PostgreSQL
- [x] Implémenter auth robuste
- [x] Rate limiting middleware
- [x] Stripe integration
- [x] MinIO file storage
- [ ] Migrer server.ts
- [ ] Tester en local
- [ ] Deploy sur staging
- [ ] Activer webhooks Stripe

---

**Questions?** Consultez les fichiers services individuels pour les détails.
