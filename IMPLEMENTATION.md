# PHASE 1 Implementation Checklist

## Status: Ready for Integration ✅

Tous les services PHASE 1 ont été créés et sont prêts à être intégrés dans `server.ts`.

---

## 📋 Files Created

### Services (`src/services/`)
- [x] `db.ts` - PostgreSQL connection pooling
- [x] `auth.ts` - Authentication & JWT
- [x] `rate-limiter.ts` - Rate limiting middleware
- [x] `stripe.ts` - Stripe integration
- [x] `minio.ts` - File storage
- [x] `middleware.ts` - Express middleware
- [x] `index.ts` - Service exports

### Infrastructure
- [x] `docker-compose.yml` - Postgres, MinIO, Redis
- [x] `schema.sql` - Database schema (enriched)
- [x] `package.json` - Dependencies updated

### Documentation
- [x] `PHASE1-SETUP.md` - Complete setup guide
- [x] `PHASE1-EXAMPLE.ts` - Integration examples
- [x] `PHASE1-SUMMARY.md` - What was built
- [x] `setup-phase1.sh` - Automated setup
- [x] `test-phase1.sh` - Testing suite
- [x] `IMPLEMENTATION.md` - This file

---

## 🔄 Next: Integration into server.ts

### Step 1: Add Imports

```typescript
import {
  initializeDatabase,
  initializeMinIO,
  getPool,
  authMiddleware,
  apiKeyMiddleware,
  withTenant,
  requireRole,
  errorHandler,
  createRateLimiter,
  RATE_LIMIT_PRESETS,
  generateJWT,
  createUserSession,
  validateUserSession,
  invalidateUserSession,
  verifyPassword,
  hashPassword,
  createSubscription,
  getTenantSubscription,
  getTenantInvoices,
  getTenantUsageMetrics,
  updateUsageMetrics,
  uploadFile,
  downloadFile,
  generatePresignedUrl,
  registerFileMetadata,
  getFileMetadata,
  logFileAccess,
} from './src/services/index.js';
```

### Step 2: Initialize Services (Before Express Server Start)

```typescript
// Initialize database
const pool = initializeDatabase();
console.log('✓ Database initialized');

// Initialize MinIO
const minioClient = initializeMinIO();
console.log('✓ MinIO initialized');

// Create Express app
const app = express();
```

### Step 3: Add Global Middleware

```typescript
// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global rate limiting
app.use(createRateLimiter(RATE_LIMIT_PRESETS.global));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});
```

### Step 4: Replace Public Routes

**BEFORE**: Using JSON files
```typescript
// OLD - using loadJSON
if (!users) users = loadJSON(USERS_FILE, []);
```

**AFTER**: Using PostgreSQL
```typescript
// NEW - using database
const users = await queryAll('SELECT * FROM users WHERE tenant_id = $1', [tenantId]);
```

Example: Login endpoint

```typescript
app.post('/auth/login', 
  createRateLimiter(RATE_LIMIT_PRESETS.login),
  async (req, res) => {
    const { username, password, tenantId } = req.body;
    
    const user = await queryOne(
      'SELECT * FROM users WHERE username = $1 AND tenant_id = $2',
      [username, tenantId]
    );
    
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = await createUserSession(username, tenantId, req.ip);
    res.json({ token, user: { username, role: user.role } });
  }
);
```

### Step 5: Apply Auth Middleware

```typescript
// After all public routes, apply auth middleware
app.use(authMiddleware);
app.use(withTenant);

// Protected routes now have req.user and req.tenantId
```

### Step 6: Migrate Protected Endpoints

**BEFORE**: JSON file persistence
```typescript
app.get('/documents', (req, res) => {
  const docs = loadJSON(DOCS_FILE, []);
  res.json(docs);
});
```

**AFTER**: Database queries
```typescript
app.get('/api/documents', async (req, res) => {
  const docs = await queryAll(
    'SELECT * FROM documents WHERE tenant_id = $1',
    [(req as any).tenantId]
  );
  res.json(docs);
});
```

### Step 7: Add Error Handler

```typescript
// Add at the end, before server.listen()
app.use(errorHandler);
```

### Step 8: Shutdown Hooks

```typescript
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing gracefully...');
  server.close();
  await closeDatabase(); // New function from db.ts
  process.exit(0);
});
```

---

## 🎯 Endpoints to Migrate

### Public (No Auth)

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| POST | `/auth/login` | ✅ Example | Use DB query |
| POST | `/auth/register` | ✅ Example | Hash password with bcrypt |
| POST | `/auth/logout` | ✅ Example | Invalidate session in DB |
| POST | `/auth/2fa/setup` | 🟡 TODO | Return QR code |
| POST | `/auth/2fa/verify` | 🟡 TODO | Verify TOTP token |
| POST | `/auth/google` | 🟡 TODO | OAuth flow |
| POST | `/auth/linkedin` | 🟡 TODO | OAuth flow |
| POST | `/webhooks/stripe` | ✅ Ready | Import handleStripeWebhook |

### Protected (Require Auth)

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/api/me` | ✅ Example | Return req.user |
| GET | `/api/stats` | ✅ Example | Query DB for stats |
| GET | `/api/documents` | ✅ Example | Query documents table |
| POST | `/api/documents/upload` | ✅ Example | Use uploadFile() |
| GET | `/api/documents/:id/download` | ✅ Example | Generate presigned URL |
| DELETE | `/api/documents/:id` | 🟡 TODO | Delete from MinIO + DB |
| GET | `/api/chat` | ✅ Ready | Add usage tracking |
| POST | `/api/chat` | ✅ Ready | Add usage tracking |
| GET | `/api/subscription` | ✅ Example | getTenantSubscription() |
| POST | `/api/subscription/upgrade` | ✅ Example | createSubscription() |
| GET | `/api/invoices` | ✅ Example | getTenantInvoices() |
| GET | `/api/usage` | ✅ Example | getTenantUsageMetrics() |
| POST | `/api/logout` | ✅ Example | invalidateUserSession() |

---

## 📝 Code Migration Pattern

### Pattern: Replace loadJSON with queryAll

```typescript
// OLD
const syncLogs = loadJSON(LOG_FILE, []);
const matches = syncLogs.filter(log => log.projectId === projectId);

// NEW
const matches = await queryAll(
  'SELECT * FROM sync_logs WHERE tenant_id = $1 AND project_id = $2',
  [(req as any).tenantId, projectId]
);
```

### Pattern: Replace in-memory caching with DB

```typescript
// OLD
let cachedVectors = [];
const matchedVectors = cachedVectors.filter(v => v.projectId === projectId);

// NEW
const matchedVectors = await queryAll(
  'SELECT * FROM document_chunks WHERE tenant_id = $1 AND project_id = $2 LIMIT 10',
  [(req as any).tenantId, projectId]
);
```

### Pattern: Handle file uploads

```typescript
// OLD
const targetDir = path.join(DOCS_DIR, `${tenantId}_${projectId}`);
fs.writeFileSync(targetDir + '/' + file.originalname, file.buffer);

// NEW
const { s3Key, hash } = await uploadFile(
  documentId,
  tenantId,
  file.originalname,
  file.stream,
  file.size,
  file.mimetype
);
await registerFileMetadata(
  documentId,
  tenantId,
  `tenant-${tenantId}`,
  s3Key,
  file.originalname,
  file.size,
  hash,
  file.mimetype
);
```

---

## 🧪 Testing After Migration

```bash
# Run automated tests
bash test-phase1.sh

# Or manual tests with curl
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"hassan","password":"password","tenantId":"hassan_agency"}' | jq -r .token)

curl http://localhost:3000/api/me -H "Authorization: Bearer $TOKEN"
```

---

## ⚠️ Important Migrations

### 1. Password Hashing

```typescript
// All existing passwords need to be re-hashed or reset
// Option A: Reset to temporary password sent via email
// Option B: On first login, ask for password change
const hash = await hashPassword(newPassword);
await query('UPDATE users SET password_hash = $1 WHERE username = $2', [hash, username]);
```

### 2. API Key Generation

```typescript
// Generate keys for existing API consumers
const apiKey = await generateAPIKey(
  'hassan_agency',
  'hassan',
  'Legacy API Key',
  1000
);
console.log('Generated API Key:', apiKey); // Show once!
```

### 3. Session Migration

```typescript
// Invalidate all old sessions
// Users need to login again
await query('DELETE FROM user_sessions'); // Or set expired_at to NOW()
```

---

## 🚀 Rollout Strategy

### Phase 1a: Development
- [ ] Update server.ts with new imports
- [ ] Run locally with Docker Compose
- [ ] Test all endpoints
- [ ] Fix any issues

### Phase 1b: Staging
- [ ] Deploy to staging environment
- [ ] Test with real data
- [ ] Load testing
- [ ] Security audit

### Phase 1c: Production
- [ ] Database backup
- [ ] Execute migrations
- [ ] Deploy new server
- [ ] Monitor for errors
- [ ] Gradual traffic shift

---

## 📞 Support & Troubleshooting

### PostgreSQL Connection Issues
```bash
# Test connection
psql -h localhost -U postgres -d associe_ai -c "SELECT 1"

# Check logs
docker logs document_agent-postgres-1
```

### MinIO Issues
```bash
# Check MinIO
curl http://localhost:9000/minio/health/live

# Access console
open http://localhost:9001 (minioadmin/minioadmin)
```

### JWT Issues
```bash
# Validate token format
jwt decode <token>

# Check expiry
jwt decode <token> | grep exp
```

---

## ✅ Final Checklist

- [ ] All imports added
- [ ] Database initialized
- [ ] MinIO initialized
- [ ] Public routes migrated
- [ ] Auth routes tested
- [ ] Protected routes migrated
- [ ] Rate limiting active
- [ ] Error handling working
- [ ] Graceful shutdown configured
- [ ] Tests passing
- [ ] Documentation updated
- [ ] Ready for PHASE 2

---

**Next**: Start server.ts migration! 🚀
