/**
 * PHASE 1: Exemple d'intégration complète
 * Ce fichier montre comment intégrer tous les services
 */

import express from 'express';
import {
  initializeDatabase,
  initializeMinIO,
  authMiddleware,
  withTenant,
  createRateLimiter,
  RATE_LIMIT_PRESETS,
  query,
  queryOne,
  generateJWT,
  createUserSession,
  validateUserSession,
  verifyPassword,
  hashPassword,
  createSubscription,
  getTenantSubscription,
  uploadFile,
  downloadFile,
  generatePresignedUrl,
} from '@/services/index.js';

const app = express();

// ==================== INITIALIZATION ====================

const pool = initializeDatabase();
const minioClient = initializeMinIO();

// ==================== MIDDLEWARE ====================

app.use(express.json());
app.use(createRateLimiter(RATE_LIMIT_PRESETS.global));

// ==================== PUBLIC ROUTES ====================

/**
 * POST /auth/login
 * Login avec credentials
 */
app.post(
  '/auth/login',
  createRateLimiter(RATE_LIMIT_PRESETS.login),
  async (req, res) => {
    try {
      const { username, password, tenantId } = req.body;

      // Valider input
      if (!username || !password || !tenantId) {
        return res.status(400).json({ error: 'Missing credentials' });
      }

      // Récupérer l'utilisateur depuis DB
      const user = await queryOne(
        `SELECT * FROM users WHERE username = $1 AND tenant_id = $2`,
        [username, tenantId]
      );

      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Vérifier password
      const validPassword = await verifyPassword(password, user.password_hash);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Créer session
      const token = await createUserSession(
        username,
        tenantId,
        req.ip,
        req.get('user-agent')
      );

      res.json({
        token,
        user: {
          username: user.username,
          role: user.role,
          tenantId: user.tenant_id,
        },
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

/**
 * POST /auth/register
 * Créer un nouvel utilisateur
 */
app.post('/auth/register', async (req, res) => {
  try {
    const { username, password, email, tenantId } = req.body;

    // Hash password
    const passwordHash = await hashPassword(password);

    // Insérer l'utilisateur
    await query(
      `INSERT INTO users (username, tenant_id, password_hash, role)
       VALUES ($1, $2, $3, 'user')`,
      [username, tenantId, passwordHash]
    );

    res.json({ success: true, message: 'User created' });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ==================== PROTECTED ROUTES ====================

// Appliquer auth middleware
app.use(authMiddleware);
app.use(withTenant);

/**
 * GET /api/me
 * Récupérer les infos de l'utilisateur connecté
 */
app.get('/api/me', (req, res) => {
  res.json({
    user: req.user,
  });
});

/**
 * GET /api/subscription
 * Récupérer la subscription du tenant
 */
app.get('/api/subscription', async (req, res) => {
  try {
    const subscription = await getTenantSubscription((req as any).tenantId);

    if (!subscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    res.json(subscription);
  } catch (error) {
    console.error('Subscription fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

/**
 * POST /api/subscription/upgrade
 * Upgrade le plan d'un tenant
 */
app.post('/api/subscription/upgrade', async (req, res) => {
  try {
    const { planId } = req.body;
    const tenantId = (req as any).tenantId;

    // Vérifier que le plan existe
    const plan = await queryOne(
      `SELECT * FROM subscription_plans WHERE id = $1`,
      [planId]
    );

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Récupérer le customer Stripe
    const subscription = await queryOne(
      `SELECT stripe_customer_id FROM subscriptions WHERE tenant_id = $1`,
      [tenantId]
    );

    if (!subscription) {
      return res.status(400).json({ error: 'No active subscription' });
    }

    // Créer la nouvelle subscription
    const newSubscription = await createSubscription({
      tenantId,
      planId,
      stripeCustomerId: subscription.stripe_customer_id,
    });

    res.json({ success: true, subscription: newSubscription });
  } catch (error) {
    console.error('Subscription upgrade error:', error);
    res.status(500).json({ error: 'Upgrade failed' });
  }
});

/**
 * POST /api/documents/upload
 * Upload un document et le stocker dans MinIO
 */
app.post(
  '/api/documents/upload',
  createRateLimiter(RATE_LIMIT_PRESETS.upload),
  async (req, res) => {
    try {
      const { file, projectId } = req.body;
      const tenantId = (req as any).tenantId;
      const userId = req.user?.userId;

      if (!file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      // Créer une entrée document en DB
      const { rows } = await query(
        `INSERT INTO documents (tenant_id, project_id, name, size, status)
         VALUES ($1, $2, $3, $4, 'uploading')
         RETURNING id`,
        [tenantId, projectId, file.name, file.size]
      );

      const documentId = rows[0].id;

      // Upload vers MinIO
      const { s3Key, hash } = await uploadFile(
        documentId,
        tenantId,
        file.name,
        file.stream,
        file.size,
        file.mimeType
      );

      // Enregistrer métadonnées
      await query(
        `INSERT INTO file_storage 
         (document_id, tenant_id, s3_bucket, s3_key, file_name, file_size, file_hash, mime_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [documentId, tenantId, `tenant-${tenantId}`, s3Key, file.name, file.size, hash, file.mimeType]
      );

      // Mettre à jour usage_metrics
      const now = new Date();
      await query(
        `INSERT INTO usage_metrics (tenant_id, year, month, documents_uploaded, storage_used_bytes)
         VALUES ($1, $2, $3, 1, $4)
         ON CONFLICT (tenant_id, year, month) DO UPDATE SET
           documents_uploaded = documents_uploaded + 1,
           storage_used_bytes = storage_used_bytes + $4`,
        [tenantId, now.getFullYear(), now.getMonth() + 1, file.size]
      );

      // Lancer l'indexation en arrière-plan
      // TODO: Envoyer vers une job queue (Bull, RabbitMQ, etc.)

      res.json({
        success: true,
        documentId,
        s3Key,
        message: 'Document uploading...',
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);

/**
 * GET /api/documents/:documentId/download
 * Télécharger un document
 */
app.get('/api/documents/:documentId/download', async (req, res) => {
  try {
    const { documentId } = req.params;
    const tenantId = (req as any).tenantId;
    const userId = req.user?.userId;

    // Récupérer métadonnées
    const fileMetadata = await queryOne(
      `SELECT * FROM file_storage WHERE document_id = $1`,
      [documentId]
    );

    if (!fileMetadata) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Générer une URL présignée (valide 1h)
    const presignedUrl = await generatePresignedUrl(
      tenantId,
      fileMetadata.s3_key,
      3600
    );

    // Logger l'accès
    await query(
      `INSERT INTO file_access_logs (file_storage_id, user_id, tenant_id, action, ip_address, user_agent)
       VALUES ($1, $2, $3, 'download', $4, $5)`,
      [fileMetadata.id, userId, tenantId, req.ip, req.get('user-agent')]
    );

    res.json({ presignedUrl });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

/**
 * GET /api/stats
 * Récupérer les stats du tenant
 */
app.get('/api/stats', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const now = new Date();

    // Récupérer les stats du mois courant
    const usage = await queryOne(
      `SELECT * FROM usage_metrics 
       WHERE tenant_id = $1 AND year = $2 AND month = $3`,
      [tenantId, now.getFullYear(), now.getMonth() + 1]
    );

    // Récupérer les documents
    const { rowCount: totalDocs } = await query(
      `SELECT COUNT(*) FROM documents WHERE tenant_id = $1`,
      [tenantId]
    );

    // Récupérer les chunks
    const { rowCount: totalChunks } = await query(
      `SELECT COUNT(*) FROM document_chunks WHERE tenant_id = $1`,
      [tenantId]
    );

    res.json({
      totalDocs,
      totalChunks,
      usage,
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * POST /auth/logout
 * Logout
 */
app.post('/auth/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.substring(7);

    if (token) {
      await query(`DELETE FROM user_sessions WHERE token = $1`, [token]);
    }

    res.json({ success: true, message: 'Logged out' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ==================== ERROR HANDLING ====================

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Database: ${process.env.DB_HOST}:${process.env.DB_PORT}`);
  console.log(`📦 MinIO: ${process.env.MINIO_ENDPOINT}`);
  console.log(`💳 Stripe: ${process.env.STRIPE_SECRET_KEY ? '✓ Configured' : '✗ Not configured'}`);
});

export default app;
