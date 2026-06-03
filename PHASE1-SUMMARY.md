# PHASE 1: FONDATIONS - What's Been Built

## 📦 Summary

PHASE 1 a transformé le prototype en une base **production-ready** avec toutes les fondations nécessaires. Voici ce qui a été créé:

---

## 📁 Files Created

### Services (`src/services/`)

#### 1. **db.ts** - Database Connection & Pooling
- Pool PostgreSQL avec max 20 connexions
- Functions: `query()`, `queryOne()`, `queryAll()`, `transaction()`
- Connection pooling pour scalabilité
- Gestion automatique des erreurs

#### 2. **auth.ts** - Authentication Service
- **Password Hashing**: bcryptjs (10 salt rounds)
- **JWT Generation**: HS256 signing
- **Sessions**: JWT + DB persistence
- **OAuth2**: Structure pour Google, LinkedIn, etc.
- **2FA/TOTP**: Speakeasy intégration
- **API Keys**: Génération et validation

#### 3. **rate-limiter.ts** - Rate Limiting Middleware
- DB-based rate limiting (persistent)
- Per IP + Endpoint tracking
- 5 presets: `global`, `login`, `upload`, `chat`, `standard`
- Headers X-RateLimit-* standard
- Skip logic pour succès/erreurs

#### 4. **stripe.ts** - Stripe Billing Service
- Gestion des customers Stripe
- Création/Update/Annulation subscriptions
- Webhook handling
- Usage metrics tracking
- Invoice management
- Essai gratuit 14 jours

#### 5. **minio.ts** - File Storage Service
- Upload/Download/Delete fichiers
- Isolation multi-tenant (bucket par tenant)
- Métadonnées en DB (`file_storage` table)
- Presigned URLs (download temporaires)
- Virus scan structure (ClamAV compatible)
- Access logging

#### 6. **middleware.ts** - Express Middleware
- `authMiddleware`: Valide JWT et attache req.user
- `apiKeyMiddleware`: Valide API keys
- `optionalAuthMiddleware`: Accepte JWT ou API key
- `requireRole()`: Contrôle d'accès par rôle
- `withTenant`: Extrait et valide tenantId
- `errorHandler`: Gestion d'erreurs global

#### 7. **index.ts** - Service Exports
- Export centralisé de tous les services
- Import simplifié: `import { ... } from '@/services'`

### Database (`schema.sql`)

**Enrichissements ajoutés:**

#### Auth Tables
- `user_sessions`: Sessions JWT avec expiry
- `oauth_providers`: Configuration OAuth
- `oauth_accounts`: Liens utilisateurs ↔ comptes OAuth
- `two_factor_auth`: Secrets 2FA et backup codes

#### Rate Limiting Tables
- `rate_limit_records`: Tracking de requêtes par IP/endpoint
- `api_keys`: Gestion des clés API

#### Billing Tables
- `subscription_plans`: Plans (Starter, Pro, Enterprise)
- `subscriptions`: Subscriptions des tenants
- `usage_metrics`: Tracking mensuel
- `invoices`: Factures Stripe

#### File Storage Tables
- `file_storage`: Métadonnées fichiers (S3/MinIO)
- `file_access_logs`: Audit accès fichiers

### Configuration

#### `package.json`
- ✅ Dépendances ajoutées:
  - `pg` + `@types/pg`: PostgreSQL
  - `stripe`: Stripe integration
  - `@minio/minio`: MinIO client
  - `bcryptjs`: Password hashing
  - `jsonwebtoken`: JWT custom
  - `speakeasy`: 2FA/TOTP
  - `express-rate-limit`: Rate limiting
  - `uuid`: UUID generation
  - `redis`: Cache/Sessions (optionnel)

- ✅ Scripts ajoutés:
  - `npm run db:migrate`: Exécuter migrations
  - `npm run db:seed`: Seed données (TODO)
  - `npm run db:reset`: Reset DB (TODO)

#### `.env.example`
- Template de configuration complète
- Commentaires pour chaque variable

### Docker & Infrastructure

#### `docker-compose.yml`
- **PostgreSQL 16**: Base de données
- **MinIO**: S3-compatible storage
- **Redis**: Cache/Sessions (optionnel)
- Health checks sur tous les services
- Volumes persistants pour données

#### `setup-phase1.sh`
- Script d'installation automatisée
- Vérifie les dépendances
- Lance Docker Compose
- Exécute migrations
- Teste les connexions

### Documentation

#### `PHASE1-SETUP.md`
- Guide complet de setup
- Architecture détaillée
- Exemples d'utilisation
- Intégration points
- Testing guidelines
- Checklist

#### `PHASE1-EXAMPLE.ts`
- Exemple d'intégration complet
- 8 endpoints exemple:
  - `POST /auth/login`
  - `POST /auth/register`
  - `GET /api/me`
  - `GET /api/subscription`
  - `POST /api/subscription/upgrade`
  - `POST /api/documents/upload`
  - `GET /api/documents/:id/download`
  - `GET /api/stats`

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│            Express Server (server.ts)               │
├─────────────────────────────────────────────────────┤
│  Global Middleware                                  │
│  ├─ express.json()                                  │
│  ├─ createRateLimiter() → DB rate limits           │
│  └─ errorHandler()                                  │
├─────────────────────────────────────────────────────┤
│  Public Routes                                      │
│  ├─ POST /auth/login      (rate limited)            │
│  ├─ POST /auth/register   (rate limited)            │
│  └─ POST /webhooks/stripe (for billing)             │
├─────────────────────────────────────────────────────┤
│  Auth Middleware (authMiddleware)                   │
│  ├─ Validates JWT token                             │
│  ├─ Checks session in DB                            │
│  └─ Attaches req.user                               │
├─────────────────────────────────────────────────────┤
│  Protected Routes                                   │
│  ├─ GET  /api/*          (requires user)            │
│  ├─ POST /api/documents/upload                      │
│  └─ GET  /api/statistics                            │
├─────────────────────────────────────────────────────┤
│  Services Layer                                     │
│  ├─ Database (pg pool)                              │
│  ├─ Auth (JWT, bcrypt, 2FA)                         │
│  ├─ Rate Limiter (DB tracking)                      │
│  ├─ Stripe (subscriptions, billing)                 │
│  └─ MinIO (file storage)                            │
├─────────────────────────────────────────────────────┤
│  External Services                                  │
│  ├─ PostgreSQL (DB)                                 │
│  ├─ MinIO (S3-compatible)                           │
│  ├─ Stripe (billing)                                │
│  ├─ Gemini (embeddings)                             │
│  └─ Optional: Redis, SendGrid, Sentry              │
└─────────────────────────────────────────────────────┘
```

---

## 🔒 Security Features

✅ **Password Security**
- Bcrypt hashing (10 rounds)
- Never store plaintext

✅ **Session Management**
- JWT + DB persistence
- Expiry tracking
- Single sign-out support

✅ **Rate Limiting**
- Per-IP + per-endpoint
- DB-backed (survit aux redémarrages)
- Configurable presets

✅ **2FA**
- TOTP support (Google Authenticator)
- Backup codes (8 codes)
- Recoverable accounts

✅ **API Security**
- API key hashing
- Per-request rate limits
- Audit logging

✅ **File Security**
- Virus scanning structure
- File integrity (SHA256)
- Access logging

---

## 💳 Billing Features

✅ **Subscription Management**
- 3 tiers: Starter ($29.99), Pro ($99.99), Enterprise (custom)
- Trial period (14 days)
- Automatic renewal

✅ **Usage Tracking**
- Documents uploaded
- API calls
- Storage used
- Embeddings generated

✅ **Invoicing**
- Automatic invoices
- Status tracking (draft, open, paid)
- PDF generation by Stripe

✅ **Webhook Support**
- Subscription events
- Payment success/failure
- Usage notifications

---

## 📊 Database Schema Highlights

### Multi-Tenancy
- Chaque action filtée par `tenant_id`
- Isolation au niveau DB
- Row-level security support (future)

### Audit Trail
- `file_access_logs`: Qui a accédé à quoi
- Timestamps sur toutes les actions
- IP tracking

### Usage Metrics
- Mensuelle par tenant
- Tracking coûts (future)
- Quota enforcement

---

## ⚙️ Configuration Matrix

| Variable | Local Dev | Staging | Production |
|----------|-----------|---------|------------|
| DB_HOST | localhost | rds.aws | prod.db.aws |
| MINIO_* | localhost:9000 | s3.staging | s3.prod |
| STRIPE_* | sk_test_ | sk_test_ | sk_live_ |
| JWT_EXPIRY | 24h | 24h | 12h |
| LOG_LEVEL | debug | info | warn |

---

## 🚀 Getting Started

### 1. Setup Local Environment

```bash
# Clone et install
npm install

# Démarrer services
docker-compose up -d

# Migrer DB
npm run db:migrate

# Démarrer dev server
npm run dev
```

### 2. Test Basic Flow

```bash
# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"hassan","password":"password","tenantId":"hassan_agency"}'

# Récupérer token du response
TOKEN="<token-from-response>"

# Accéder à l'API protégée
curl http://localhost:3000/api/me \
  -H "Authorization: Bearer $TOKEN"
```

### 3. Configure Stripe

- Créer compte Stripe
- Ajouter plans en Dashboard
- Récupérer IDs (product_id, price_id)
- Ajouter à .env.local
- Créer webhook endpoint

### 4. Configure OAuth (Optionnel)

- Google: Console cloud → Create OAuth app
- LinkedIn: LinkedIn app center → Create app
- Ajouter credentials à .env.local

---

## ✅ Validation Checklist

- [x] Schema.sql enrichi avec tables auth/billing/storage
- [x] Services PostgreSQL avec pooling
- [x] Auth robuste (JWT + 2FA)
- [x] Rate limiting DB-backed
- [x] Stripe integration
- [x] MinIO integration
- [x] Docker Compose setup
- [x] Documentation complète
- [ ] Server.ts migration (TODO)
- [ ] E2E tests (TODO)

---

## 📝 Next Steps (PHASE 2)

1. **Migration server.ts** - Intégrer tous les services
2. **Logging** - Sentry + Winston
3. **Monitoring** - Prometheus + Grafana
4. **Admin Dashboard** - Gestion tenants
5. **Email** - Notifications & Transactional
6. **API Docs** - Swagger/OpenAPI
7. **CI/CD** - GitHub Actions
8. **Testing** - Unit + Integration + E2E

---

## 🎓 Key Concepts

### Multi-Tenancy Pattern
```
company_docs/
  ├─ tenant-hassan_agency_default/    ← Physical isolation
  └─ tenant-villa_serena_agency_/

Database:
  ├─ users (tenant_id filter)         ← Logical isolation
  ├─ documents (tenant_id)
  └─ subscriptions (unique tenant_id)
```

### Rate Limiting Strategy
```
Window-based, per IP + endpoint
e.g., Max 5 login attempts / 15 minutes
e.g., Max 30 chat requests / 1 minute
```

### Billing Model
```
Subscriptions (Stripe) ← Main source of truth
  ├─ Usage Metrics (DB) ← Overflow tracking
  ├─ Invoices (Stripe + DB) ← Record keeping
  └─ Payment Status ← Webhook updated
```

---

**Questions?** Consultez les fichiers individuels ou la documentation PHASE1-SETUP.md
