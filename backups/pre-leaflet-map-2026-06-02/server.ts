import express from "express";
import path from "path";
import fs from "fs";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import multer from "multer";
import crypto from "crypto";
import { createClient } from "redis";

// Parsing utilities
import mammoth from "mammoth";
import * as xlsx from "xlsx";

// Database & MinIO services
import {
  initializeDatabase,
  initializeMinIO,
  query,
  queryOne,
  queryAll,
  createUserSession,
  validateUserSession,
  invalidateUserSession,
  uploadFile,
  downloadFile,
  deleteFile,
  registerFileMetadata,
  generatePresignedUrl,
  logFileAccess,
  verifyPassword
} from "./src/services/index.js";
import { taskQueue } from "./src/services/taskQueue.js";

// Global error handlers to prevent silent crashes and log details
process.on("unhandledRejection", (reason, promise) => {
  console.error("⚠️ UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("⚠️ UNCAUGHT EXCEPTION:", error);
});

// Load environment variables
dotenv.config();

const PORT = 3000;
const app = express();

// Security & performance middlewares
// In development we disable Helmet's CSP so Vite's injected inline scripts
// and HMR websocket connections are not blocked by a strict CSP.
if (process.env.NODE_ENV !== 'production') {
  app.use(helmet({ contentSecurityPolicy: false }));
} else {
  app.use(helmet());
}
app.use(compression());
app.use(cors({ origin: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Basic rate limiting for API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV !== 'production' ? 5000 : 100, // limit each IP to 5000 requests per windowMs in dev, 100 in prod
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// Initialize Google GenAI
let ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Redis client for caching (embeddings, responses)
// Disabled by default in development to avoid noisy ECONNREFUSED logs.
// To enable Redis locally set environment variable: ENABLE_REDIS=true
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
let redisClient: any = null;
let redisAvailable = false;
const redisEnabled = process.env.ENABLE_REDIS === 'true';

if (redisEnabled) {
  redisClient = createClient({ url: redisUrl });
  redisClient.on('error', (err: any) => {
    redisAvailable = false;
    console.error('Redis Client Error', err);
  });
  redisClient.connect().then(() => {
    redisAvailable = true;
    console.log('Redis connected');
    // Initialize BullMQ when Redis is available
    (async () => {
      try {
        const IORedisModule = await import('ioredis');
        const IORedis: any = (IORedisModule.default || IORedisModule) as any;
        const bullmqModule: any = await import('bullmq');
        const Queue: any = bullmqModule.Queue;
        const Worker: any = bullmqModule.Worker;
        const QueueScheduler: any = bullmqModule.QueueScheduler;
        const conn = new IORedis(redisUrl);
        const queueName = process.env.BULL_QUEUE_NAME || 'document-processing';
        // Queue scheduler and worker
        new QueueScheduler(queueName, { connection: conn } as any);
        bullQueue = new Queue(queueName, { connection: conn } as any);
        new Worker(queueName, async (job: any) => {
          try {
            await processDocument(job.data);
          } catch (e) {
            console.error('Bull worker job failed:', e);
            throw e;
          }
        }, { connection: conn, concurrency: Number(process.env.WORKER_CONCURRENCY || 2) });
        useBull = true;
        console.log('BullMQ initialized and worker started');
      } catch (e) {
        console.warn('BullMQ init failed, will use in-process task queue:', e && e.message ? e.message : e);
        useBull = false;
      }
    })();
  }).catch((err: any) => {
    redisAvailable = false;
    console.warn('Failed to connect to Redis, continuing with in-memory cache:', err && err.message ? err.message : err);
  });
} else {
  console.log('Redis disabled (development). To enable set ENABLE_REDIS=true');
}

// Simple in-memory cache fallback with TTL
type CacheEntry = { value: string; expiresAt: number };
const inMemoryCache = new Map<string, CacheEntry>();
function inMemoryGet(key: string): string | null {
  const e = inMemoryCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    inMemoryCache.delete(key);
    return null;
  }
  return e.value;
}
function inMemorySet(key: string, value: string, ttlSeconds: number) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  inMemoryCache.set(key, { value, expiresAt });
  // simple size limit
  if (inMemoryCache.size > 5000) {
    // remove oldest
    const firstKey = inMemoryCache.keys().next().value;
    inMemoryCache.delete(firstKey);
  }
}

async function cacheGet(key: string): Promise<string | null> {
  if (redisAvailable) {
    try {
      return await redisClient.get(key);
    } catch (err) {
      console.warn('Redis get failed, falling back to memory cache', err && err.message ? err.message : err);
      return inMemoryGet(key);
    }
  }
  return inMemoryGet(key);
}

async function cacheSet(key: string, value: string, ttlSeconds: number) {
  if (redisAvailable) {
    try {
      await redisClient.set(key, value, { EX: ttlSeconds });
      return;
    } catch (err) {
      console.warn('Redis set failed, falling back to memory cache', err && err.message ? err.message : err);
      inMemorySet(key, value, ttlSeconds);
      return;
    }
  }
  inMemorySet(key, value, ttlSeconds);
}

// Paths configuration
const DOCS_DIR = path.join(process.cwd(), "company_docs");
const MEMORY_DIR = path.join(process.cwd(), "memory");

// Ensure directories exist
if (!fs.existsSync(DOCS_DIR)) {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
}
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

// Initialize PostgreSQL and MinIO immediately
initializeDatabase();
initializeMinIO();

// Authentication middleware
async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentification requise." });
  }
  
  const token = authHeader.substring(7);
  try {
    const decoded = await validateUserSession(token);
    if (!decoded) {
      return res.status(401).json({ error: "Session expirée ou invalide. Veuillez vous reconnecter." });
    }
    const tenant = await queryOne(`SELECT name FROM tenants WHERE id = $1`, [decoded.tenantId]);
    (req as any).user = {
      username: decoded.userId,
      tenantId: decoded.tenantId,
      tenantName: tenant ? tenant.name : '',
      role: decoded.role
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Session expirée ou invalide. Veuillez vous reconnecter." });
  }
}

// Multer setup for handling uploads to company_docs with project routing and multi-tenant isolation
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const user = (req as any).user;
    const tenantId = user ? user.tenantId : "hassan_agency";
    const requestedProjId = (req.query.projectId as string) || "default";
    
    // Physical isolation: folder name is tenantId + "_" + projectID
    const realProjectId = `${tenantId}_${requestedProjId}`;
    const targetDir = path.join(DOCS_DIR, realProjectId);
      
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage: storage });

let isSyncing = false;
let fileMetaCache: Record<string, { lastModified: number; size: number }> = {};
let useBull = false;
let bullQueue: any = null;

// ==========================================
// WATCHDOG DIAGNOSTIC — Analyse intelligente des erreurs
// ==========================================

interface DiagnosticAlert {
  id: string;
  filename: string;
  projectId: string;
  error: string;
  diagnosis: string;
  solution: string;
  severity: "critical" | "warning" | "info";
  timestamp: string;
  resolved: boolean;
}

let diagnosticAlerts: DiagnosticAlert[] = [];
const ALERTS_FILE = path.join(MEMORY_DIR, "diagnostic_alerts.json");

// Helper to load JSON
function loadJSON<T>(filePath: string, defaultValue: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as T;
    }
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
  }
  return defaultValue;
}

// Helper to save JSON
function saveJSON<T>(filePath: string, data: T) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
  }
}

// Load persisted alerts
diagnosticAlerts = loadJSON<DiagnosticAlert[]>(ALERTS_FILE, []);

// Analyze an error and return a human-readable diagnosis and solution
function analyzeSyncError(errorMsg: string, filename: string): { diagnosis: string; solution: string; severity: "critical" | "warning" | "info" } {
  const e = (errorMsg || "").toLowerCase();

  if (e.includes("enospc") || e.includes("no space left")) {
    return {
      severity: "critical",
      diagnosis: "Espace disque insuffisant sur le serveur.",
      solution: "Libérez de l'espace sur votre disque dur (vider la corbeille, supprimer des fichiers temporaires). Ensuite, cliquez sur « Recharger » pour relancer l'indexation."
    };
  }

  if (e.includes("api_key") || e.includes("api key") || e.includes("403") || e.includes("invalid api") || e.includes("permission denied")) {
    return {
      severity: "critical",
      diagnosis: "Clé API Gemini manquante ou invalide.",
      solution: "Cliquez sur le bouton « Clé API » en haut à droite de l'interface pour mettre à jour votre clé. Assurez-vous qu'elle est active dans la console Google AI Studio."
    };
  }

  if (e.includes("rate limit") || e.includes("quota") || e.includes("429") || e.includes("resource_exhausted")) {
    return {
      severity: "warning",
      diagnosis: "Limite d'utilisation de l'API Gemini atteinte (quota mensuel).",
      solution: "Votre quota gratuit mensuel de l'API Gemini est épuisé. Attendez le prochain cycle de facturation ou mettez à niveau votre plan Google AI Studio."
    };
  }

  if (e.includes("empty") || e.includes("extracted text is empty") || e.includes("parse")) {
    return {
      severity: "warning",
      diagnosis: `Le fichier « ${filename} » est vide, corrompu ou protégé par mot de passe.`,
      solution: "Vérifiez que le fichier n'est pas verrouillé ou protégé. Essayez de le ré-exporter depuis son application d'origine. Le format .txt est le plus fiable."
    };
  }

  if (e.includes("unsupported") || e.includes("file type") || e.includes("extension")) {
    return {
      severity: "warning",
      diagnosis: `Le type de fichier « ${filename} » n'est pas pris en charge.`,
      solution: "ASSOCIE.AI supporte les formats : PDF, DOCX, XLSX, CSV, TXT, MD. Convertissez votre document dans un de ces formats."
    };
  }

  if (e.includes("econnrefused") || e.includes("network") || e.includes("fetch")) {
    return {
      severity: "critical",
      diagnosis: "Erreur de connexion réseau au serveur d'IA.",
      solution: "Vérifiez que votre connexion internet est active. Si le problème persiste, redémarrez le serveur avec « npm run dev »."
    };
  }

  if (e.includes("timeout") || e.includes("etimedout")) {
    return {
      severity: "warning",
      diagnosis: `L'indexation du fichier « ${filename} » a expiré (délai dépassé).`,
      solution: "Le fichier est peut-être trop volumineux. Essayez de le diviser en plusieurs parties plus petites (max 5 MB recommandé)."
    };
  }

  return {
    severity: "info",
    diagnosis: `Erreur inconnue lors de l'indexation de « ${filename} ».`,
    solution: `Détails techniques : ${errorMsg}. Essayez de supprimer puis de re-uploader le fichier. Si l'erreur persiste, contactez le support technique.`
  };
}

// Create a new diagnostic alert
function createAlert(filename: string, projectId: string, error: string): DiagnosticAlert {
  const { diagnosis, solution, severity } = analyzeSyncError(error, filename);
  const alert: DiagnosticAlert = {
    id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    filename,
    projectId,
    error,
    diagnosis,
    solution,
    severity,
    timestamp: new Date().toISOString(),
    resolved: false
  };
  // Keep only the 20 most recent unresolved alerts
  diagnosticAlerts = [alert, ...diagnosticAlerts.filter(a => !a.resolved)].slice(0, 20);
  saveJSON(ALERTS_FILE, diagnosticAlerts);
  console.warn(`🚨 WATCHDOG ALERTE [${severity.toUpperCase()}]: ${filename} — ${diagnosis}`);
  return alert;
}

// File Parsing Helper
async function extractTextFromFile(filePath: string, extension: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  
  switch (extension.toLowerCase()) {
    case '.txt':
    case '.md':
    case '.json':
      return buffer.toString("utf-8");
      
    case '.csv':
      return buffer.toString("utf-8");

    case '.pdf': {
      const pdfModule: any = await import("pdf-parse");
      if (pdfModule.PDFParse) {
        const parser = new pdfModule.PDFParse({ data: buffer });
        const result = await parser.getText();
        return result.text || "";
      } else {
        const pdfParser = pdfModule.default || pdfModule;
        const data = await pdfParser(buffer);
        return data.text || "";
      }
    }

    case '.docx': {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || "";
    }

    case '.xlsx':
    case '.xls': {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      let fullText = "";
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        fullText += `Sheet: ${sheetName}\n`;
        fullText += xlsx.utils.sheet_to_txt(sheet) + "\n\n";
      }
      return fullText;
    }

    default:
      throw new Error(`Unsupported file type: ${extension}`);
  }
}

// Simple text chunker with overlap
function chunkText(text: string, chunkSize = 800, overlap = 150): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= chunkSize) {
    return [cleaned];
  }

  const chunks: string[] = [];
  let index = 0;
  
  while (index < cleaned.length) {
    let end = index + chunkSize;
    if (end > cleaned.length) {
      end = cleaned.length;
    } else {
      const nextSpace = cleaned.indexOf(" ", end - 20);
      if (nextSpace !== -1 && nextSpace < end + 20) {
        end = nextSpace;
      }
    }
    
    chunks.push(cleaned.substring(index, end).trim());
    index = end - overlap;
    
    if (index >= cleaned.length - overlap) {
      break;
    }
  }

  return chunks.filter(c => c.length > 10);
}

// Gemini Embedding Gen
async function getEmbedding(text: string): Promise<number[] | null> {
  if (!process.env.GEMINI_API_KEY) {
    console.warn("No GEMINI_API_KEY found, skipping embedding generation (using mock 3072-dimension vector)");
    return Array.from({ length: 3072 }, () => Math.random() - 0.5);
  }
  
  try {
    // Check Redis cache first
    try {
      const hash = crypto.createHash('sha256').update(text).digest('hex');
      const cacheKey = `embed:${hash}`;
      const cached = await cacheGet(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as number[];
        return parsed;
      }
    } catch (cacheErr) {
      console.warn('Cache check failed:', cacheErr && cacheErr.message ? cacheErr.message : cacheErr);
    }

    const result: any = await ai.models.embedContent({
      model: 'generative-language-api', // use default standard fallback or preview model
      contents: text,
      config: {
        outputDimensionality: 3072
      }
    } as any).catch(async () => {
      // Retry with default params if model structure differs
      return await ai.models.embedContent({
        model: 'gemini-embedding-2-preview',
        contents: text,
      });
    });
    
    if (result.embedding?.values) {
      const values = result.embedding.values;
      // store in cache
      try {
        const hash = crypto.createHash('sha256').update(text).digest('hex');
        const cacheKey = `embed:${hash}`;
        await cacheSet(cacheKey, JSON.stringify(values), 60 * 60 * 24 * 7); // 7 days
      } catch (cacheSetErr) {
        console.warn('Cache set failed:', cacheSetErr && cacheSetErr.message ? cacheSetErr.message : cacheSetErr);
      }
      return values;
    } else if (result.embeddings?.[0]?.values) {
      const values = result.embeddings[0].values;
      try {
        const hash = crypto.createHash('sha256').update(text).digest('hex');
        const cacheKey = `embed:${hash}`;
        await cacheSet(cacheKey, JSON.stringify(values), 60 * 60 * 24 * 7);
      } catch (cacheSetErr) {
        console.warn('Cache set failed:', cacheSetErr && cacheSetErr.message ? cacheSetErr.message : cacheSetErr);
      }
      return values;
    }
  } catch (error: any) {
    const isOffline = error.message?.includes('fetch failed') || error.message?.includes('timeout') || error.code === 'UND_ERR_CONNECT_TIMEOUT';
    if (isOffline) {
      console.warn("⏳ [Embedding] Gemini API offline (timeout/fetch failed) - using mock 3072-dimension embeddings fallback");
    } else {
      console.error("Embedding generation failed:", error);
    }
    // Return mock 3072-dimension embedding to keep indexing functional offline
    return Array.from({ length: 3072 }, () => Math.random() - 0.5);
  }
  return Array.from({ length: 3072 }, () => Math.random() - 0.5);
}

// Helpers for Mime Type & Logs
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.pdf': return 'application/pdf';
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls': return 'application/vnd.ms-excel';
    case '.csv': return 'text/csv';
    case '.txt': return 'text/plain';
    case '.md': return 'text/markdown';
    case '.json': return 'application/json';
    default: return 'application/octet-stream';
  }
}

// Process a queued document job (can be executed by BullMQ worker or in-process)
async function processDocument(jobData: { lf: any; dbDoc: any; actionType: 'create' | 'update'; relPath?: string }) {
  const { lf, dbDoc, actionType } = jobData;
  const relPath = jobData.relPath || `${lf.realProjectId}/${lf.filename}`;
  let docId: string | null = null;
  try {
    const ext = path.extname(lf.filename);
    const text = await extractTextFromFile(lf.filePath, ext);
    if (!text.trim()) throw new Error('Extracted text is empty or failed to parse');

    const chunks = chunkText(text);
    console.log(`Processor: Document split into ${chunks.length} chunks for ${relPath}`);

    if (dbDoc) {
      const oldFileMeta = await queryOne('SELECT s3_key FROM file_storage WHERE document_id = $1', [dbDoc.id]);
      if (oldFileMeta) {
        try { await deleteFile(lf.tenantId, oldFileMeta.s3_key); } catch (e) { console.error('Failed to delete old file:', e); }
      }
      await query('DELETE FROM documents WHERE id = $1', [dbDoc.id]);
    }

    const insertDoc = await queryOne(
      `INSERT INTO documents (tenant_id, project_id, name, size, status, chunks_count)
       VALUES ($1, $2, $3, $4, 'processing', $5) RETURNING id`,
      [lf.tenantId, lf.displayProjectId, lf.filename, lf.size, chunks.length]
    );
    docId = insertDoc.id;

    let chunksIndexed = 0;
    for (const chunkTextContent of chunks) {
      const embedding = await getEmbedding(chunkTextContent);
      if (embedding) {
        const vectorStr = `[${embedding.join(',')}]`;
        await query(
          `INSERT INTO document_chunks (document_id, tenant_id, project_id, text, embedding)
           VALUES ($1, $2, $3, $4, $5::vector)`,
          [docId, lf.tenantId, lf.displayProjectId, chunkTextContent, vectorStr]
        );
        chunksIndexed++;
      }
    }

    const fileStream = fs.createReadStream(lf.filePath);
    const mimeType = getMimeType(lf.filename);
    const { s3Key, hash } = await uploadFile(docId, lf.tenantId, lf.filename, fileStream, lf.size, mimeType);

    await registerFileMetadata(docId, lf.tenantId, `tenant-${lf.tenantId}`, s3Key, lf.filename, lf.size, hash, mimeType);

    await query(`UPDATE documents SET status = 'indexed', chunks_count = $1 WHERE id = $2`, [chunksIndexed, docId]);

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    await query(
      `INSERT INTO usage_metrics (tenant_id, year, month, documents_uploaded, documents_processed, storage_used_bytes, embeddings_generated)
       VALUES ($1, $2, $3, 1, 1, $4, $5)
       ON CONFLICT (tenant_id, year, month)
       DO UPDATE SET
         documents_uploaded = usage_metrics.documents_uploaded + 1,
         documents_processed = usage_metrics.documents_processed + 1,
         storage_used_bytes = usage_metrics.storage_used_bytes + $4,
         embeddings_generated = usage_metrics.embeddings_generated + $5`,
      [lf.tenantId, year, month, lf.size, chunksIndexed]
    );

    await logAction(lf.tenantId, lf.realProjectId, lf.filename, actionType, 'success', chunksIndexed);
  } catch (err: any) {
    console.error(`Processor error for ${relPath}:`, err);
    const errMsg = err.message || 'Unknown error during parser execution';
    if (docId) {
      try {
        await query(`UPDATE documents SET status = 'failed' WHERE id = $1`, [docId]);
      } catch (dbErr) {
        console.error('Failed to update document status to failed:', dbErr);
      }
    }
    try {
      await logAction(lf.tenantId, lf.realProjectId, lf.filename, actionType, 'failed', 0, errMsg);
    } catch (logErr) {
      console.error('Failed to log action failure:', logErr);
    }
    createAlert(lf.filename, lf.realProjectId, errMsg);
  }
}

async function logAction(
  tenantId: string,
  projectId: string,
  filename: string,
  action: 'create' | 'update' | 'delete' | 'manual',
  status: 'success' | 'failed' | 'processing',
  chunksCount = 0,
  error?: string
) {
  const id = `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  await query(
    `INSERT INTO sync_logs (id, tenant_id, project_id, filename, action, status, chunks_count, error, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [id, tenantId, projectId, filename, action, status, chunksCount, error || null]
  );
}

async function wipeDocumentsForReindex(tenantId: string, projectId?: string) {
  let queryText = 'SELECT id, tenant_id, project_id, name FROM documents WHERE tenant_id = $1';
  let params: any[] = [tenantId];
  if (projectId) {
    queryText += ' AND project_id = $2';
    params.push(projectId);
  }
  
  const docs = await queryAll(queryText, params);
  for (const doc of docs) {
    const fileMeta = await queryOne('SELECT s3_key FROM file_storage WHERE document_id = $1', [doc.id]);
    if (fileMeta) {
      try {
        await deleteFile(doc.tenant_id, fileMeta.s3_key);
      } catch (e) {
        console.error(`Failed to delete file from MinIO during reindex:`, e);
      }
    }
    await query('DELETE FROM documents WHERE id = $1', [doc.id]);
    await logAction(doc.tenant_id, `${doc.tenant_id}_${doc.project_id}`, doc.name, 'delete', 'success');
  }
}

// Automatic Migration for Multi-Tenant Directories
function runMultiTenantMigration() {
  const defaultTenantPrefix = "hassan_agency_";
  const defaultProjDir = path.join(DOCS_DIR, `${defaultTenantPrefix}default`);
  
  if (!fs.existsSync(defaultProjDir)) {
    fs.mkdirSync(defaultProjDir, { recursive: true });
  }
  
  try {
    if (fs.existsSync(DOCS_DIR)) {
      const items = fs.readdirSync(DOCS_DIR);
      for (const item of items) {
        const fullPath = path.join(DOCS_DIR, item);
        
        if (item.startsWith("hassan_agency_") || item.startsWith("villa_serena_agency_") || item === "storage") {
          continue;
        }
        
        if (fs.statSync(fullPath).isFile() && !item.startsWith('.')) {
          const destPath = path.join(defaultProjDir, item);
          fs.renameSync(fullPath, destPath);
          console.log(`Migration: Moved root file ${item} to ${defaultProjDir}`);
        } else if (fs.statSync(fullPath).isDirectory()) {
          const newDirName = `${defaultTenantPrefix}${item}`;
          const destDir = path.join(DOCS_DIR, newDirName);
          
          if (fs.existsSync(destDir)) {
            const files = fs.readdirSync(fullPath);
            for (const f of files) {
              const srcF = path.join(fullPath, f);
              const destF = path.join(destDir, f);
              fs.renameSync(srcF, destF);
            }
            fs.rmdirSync(fullPath);
          } else {
            fs.renameSync(fullPath, destDir);
          }
          console.log(`Migration: Renamed folder ${item} to ${newDirName}`);
        }
      }
    }
  } catch (err) {
    console.error("Error during multi-tenant migration:", err);
  }
}

// Run migration
runMultiTenantMigration();

// High-Performance Sync Task (Multi-Project & PostgreSQL/MinIO Support)
let dbHealthy = true;
let consecutiveDbFailures = 0;
const MAX_DB_FAILURES_BEFORE_BACKOFF = 3;
const processingFiles = new Set<string>(); // Lock to prevent concurrent processing of same file

async function syncDocumentsFolder() {
  if (isSyncing) return;
  isSyncing = true;
  
  // Backoff: if DB has failed too many times in a row, skip this cycle silently
  if (consecutiveDbFailures >= MAX_DB_FAILURES_BEFORE_BACKOFF) {
    // Only try a health check every 5th failure (i.e., every ~20 seconds)
    if (consecutiveDbFailures % 5 !== 0) {
      isSyncing = false;
      return;
    }
    // Try a quick health check
    try {
      await query('SELECT 1');
      consecutiveDbFailures = 0;
      dbHealthy = true;
      console.log('✅ Database connection restored.');
    } catch {
      consecutiveDbFailures++;
      if (consecutiveDbFailures === MAX_DB_FAILURES_BEFORE_BACKOFF) {
        console.warn('⚠️ Database unreachable — watcher entering silent backoff mode (retrying every ~20s)');
      }
      isSyncing = false;
      return;
    }
  }

  try {
    const tenants = await queryAll('SELECT id FROM tenants');
    const localFiles: { filename: string; tenantId: string; displayProjectId: string; realProjectId: string; filePath: string; size: number; mtimeMs: number }[] = [];
    
    if (fs.existsSync(DOCS_DIR)) {
      const items = fs.readdirSync(DOCS_DIR);
      for (const item of items) {
        const fullPath = path.join(DOCS_DIR, item);
        if (fs.statSync(fullPath).isDirectory()) {
          const tenant = tenants.find(t => item.startsWith(t.id + '_'));
          if (tenant) {
            const tenantId = tenant.id;
            const displayProjectId = item.substring(tenantId.length + 1);
            const subItems = fs.readdirSync(fullPath);
            for (const subItem of subItems) {
              const subPath = path.join(fullPath, subItem);
              if (fs.statSync(subPath).isFile() && !subItem.startsWith('.')) {
                const stat = fs.statSync(subPath);
                localFiles.push({
                  filename: subItem,
                  tenantId,
                  displayProjectId,
                  realProjectId: item,
                  filePath: subPath,
                  size: stat.size,
                  mtimeMs: stat.mtimeMs
                });
              }
            }
          }
        }
      }
    }

    // 1. Detect deleted files
    const dbDocs = await queryAll('SELECT id, tenant_id, project_id, name FROM documents');
    for (const dbDoc of dbDocs) {
      const stillExists = localFiles.some(
        lf => lf.tenantId === dbDoc.tenant_id && lf.displayProjectId === dbDoc.project_id && lf.filename === dbDoc.name
      );
      if (!stillExists) {
        const realProjectId = `${dbDoc.tenant_id}_${dbDoc.project_id}`;
        console.log(`Watcher: File deleted -> ${realProjectId}/${dbDoc.name}`);
        
        // Find S3 key to delete from MinIO
        const fileMeta = await queryOne('SELECT s3_key FROM file_storage WHERE document_id = $1', [dbDoc.id]);
        if (fileMeta) {
          try {
            await deleteFile(dbDoc.tenant_id, fileMeta.s3_key);
          } catch (e) {
            console.error(`Failed to delete file from MinIO for doc ${dbDoc.name}:`, e);
          }
        }
        
        // Delete from database
        await query('DELETE FROM documents WHERE id = $1', [dbDoc.id]);
        
        // Log action
        await logAction(dbDoc.tenant_id, realProjectId, dbDoc.name, 'delete', 'success');
        
        // Clean cache
        const relPath = `${realProjectId}/${dbDoc.name}`;
        delete fileMetaCache[relPath];
        processingFiles.delete(relPath);
      }
    }

    const activeRelPaths = new Set(localFiles.map(lf => `${lf.realProjectId}/${lf.filename}`));
    for (const cacheKey of Object.keys(fileMetaCache)) {
      if (!activeRelPaths.has(cacheKey)) {
        delete fileMetaCache[cacheKey];
      }
    }

    // 2. Detect created or modified files
    for (const lf of localFiles) {
      const relPath = `${lf.realProjectId}/${lf.filename}`;
      
      // Skip if this file is already being processed by a previous cycle
      if (processingFiles.has(relPath)) continue;
      
      const isKnown = fileMetaCache[relPath] !== undefined;
      const mtimeChanged = isKnown && fileMetaCache[relPath].lastModified !== lf.mtimeMs;
      
      const dbDoc = await queryOne(
        `SELECT id, status FROM documents WHERE tenant_id = $1 AND project_id = $2 AND name = $3`,
        [lf.tenantId, lf.displayProjectId, lf.filename]
      );
      const isActuallyIndexed = dbDoc !== null && dbDoc.status === 'indexed';
      const isProcessing = dbDoc !== null && dbDoc.status === 'processing';
      const isFailed = dbDoc !== null && dbDoc.status === 'failed';
      
      // Skip if already processing
      if (isProcessing) continue;
      
      // Skip failed files unless the file was actually modified on disk
      if (isFailed && !mtimeChanged) {
        // Mark as known so we don't keep re-checking
        if (!isKnown) {
          fileMetaCache[relPath] = { lastModified: lf.mtimeMs, size: lf.size };
        }
        continue;
      }
      
      if (!isKnown || mtimeChanged || !isActuallyIndexed) {
        const actionType: 'create' | 'update' = (!isKnown && !isActuallyIndexed) ? 'create' : 'update';
        console.log(`Watcher: File ${actionType}d -> ${relPath}`);
        
        // Update mtime cache
        fileMetaCache[relPath] = { lastModified: lf.mtimeMs, size: lf.size };
        
        // Mark as being processed (lock)
        processingFiles.add(relPath);
        
        // Prepare job data
        const jobData = { lf, dbDoc, actionType, relPath };

        if (useBull && bullQueue) {
          try {
            await bullQueue.add('process', jobData, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
          } catch (e) {
            console.warn('Failed to enqueue to Bull, falling back to in-process queue:', e);
            taskQueue.add(() => processDocument(jobData).finally(() => processingFiles.delete(relPath))).catch(err => console.error('Task queue job failed:', err));
          }
        } else {
          taskQueue.add(() => processDocument(jobData).finally(() => processingFiles.delete(relPath))).catch(err => console.error('Task queue job failed:', err));
        }
      }
    }
    
    // DB was healthy this cycle
    consecutiveDbFailures = 0;
    dbHealthy = true;
  } catch (error: any) {
    consecutiveDbFailures++;
    dbHealthy = false;
    if (consecutiveDbFailures <= MAX_DB_FAILURES_BEFORE_BACKOFF) {
      console.error("Error in folders watcher:", error.message || error);
    }
    if (consecutiveDbFailures === MAX_DB_FAILURES_BEFORE_BACKOFF) {
      console.warn('⚠️ Database unreachable — watcher entering silent backoff mode (retrying every ~20s)');
    }
  } finally {
    isSyncing = false;
  }
}

// ==========================================
// API REST ENDPOINTS & AUTHENTICATION
// ==========================================

// Get all unresolved diagnostic alerts (filtered by tenant)
app.get("/api/alerts", requireAuth, (req, res) => {
  const user = (req as any).user;
  const tenantId = user.tenantId;
  const tenantPrefix = `${tenantId}_`;
  const alerts = diagnosticAlerts.filter(a => !a.resolved && a.projectId.startsWith(tenantPrefix));
  res.json(alerts);
});

// Resolve/dismiss a diagnostic alert
app.delete("/api/alerts/:alertId", requireAuth, (req, res) => {
  const { alertId } = req.params;
  const alert = diagnosticAlerts.find(a => a.id === alertId);
  if (!alert) return res.status(404).json({ error: "Alerte introuvable." });

  alert.resolved = true;
  saveJSON(ALERTS_FILE, diagnosticAlerts);
  res.json({ success: true, message: "Alerte marquée comme résolue." });
});

// Endpoint de diagnostic de base de données et réseau
app.get("/api/debug-db", async (req, res) => {
  const dns = await import("dns");
  const report: any = {
    timestamp: new Date().toISOString(),
    env: {
      hasDbUrl: !!process.env.DATABASE_URL,
      dbUrlStart: process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 30) + "..." : null,
    },
    dns: {},
    db: {}
  };

  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      const hostname = url.hostname;
      report.dns.hostname = hostname;
      
      try {
        const addresses = await dns.promises.lookup(hostname);
        report.dns.lookup = { success: true, addresses };
      } catch (dnsErr: any) {
        report.dns.lookup = { success: false, error: dnsErr.message || String(dnsErr), code: dnsErr.code };
      }
    } catch (urlErr: any) {
      report.env.urlParseError = urlErr.message || String(urlErr);
    }
  }

  try {
    const start = Date.now();
    const result = await query("SELECT 1 as connected");
    const duration = Date.now() - start;
    report.db.connection = { success: true, durationMs: duration, result: result.rows };
    
    try {
      const vectorExt = await query("SELECT extname FROM pg_extension WHERE extname = 'vector'");
      report.db.pgvector = { installed: vectorExt.rows.length > 0 };
    } catch (extErr: any) {
      report.db.pgvector = { error: extErr.message || String(extErr) };
    }
  } catch (dbErr: any) {
    report.db.connection = { success: false, error: dbErr.message || String(dbErr), code: dbErr.code };
  }

  res.json(report);
});

// Server status endpoint (Supabase/PostgreSQL active)
app.get("/api/status", requireAuth, (req, res) => {
  res.json({
    supabaseEnabled: true,
    mode: "cloud",
    version: "4.0.0",
    uptime: process.uptime()
  });
});

// Authenticate and Login endpoint
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: "Identifiant et mot de passe requis." });
  }
  
  try {
    const user = await queryOne(
      `SELECT u.*, t.name as tenant_name FROM users u 
       JOIN tenants t ON u.tenant_id = t.id 
       WHERE LOWER(u.username) = LOWER($1)`,
      [username]
    );

    if (user) {
      const match = await verifyPassword(password, user.password_hash);
      if (match) {
        const token = await createUserSession(
          user.username,
          user.tenant_id,
          req.ip || undefined,
          req.headers["user-agent"] || undefined
        );
        return res.json({
          success: true,
          token,
          user: {
            username: user.username,
            tenantId: user.tenant_id,
            tenantName: user.tenant_name,
            role: user.role
          }
        });
      }
    }
    
    res.status(401).json({ error: "Identifiants incorrects. Veuillez réessayer." });
  } catch (error: any) {
    console.error("Login failed:", error);
    // In development, return error details to help debugging
    if (process.env.NODE_ENV !== 'production') {
      return res.status(500).json({ error: "Authentication failed", detail: error?.message || String(error), stack: error?.stack });
    }
    res.status(500).json({ error: "Authentication failed" });
  }
});

// List all projects (Filtered by Tenant)
app.get("/api/projects", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const tenantId = user.tenantId;
  
  try {
    const dbProjects = await queryAll(
      `SELECT id, name FROM projects WHERE tenant_id = $1 ORDER BY created_at ASC`,
      [tenantId]
    );
    
    const docCounts = await queryAll(
      `SELECT project_id, COUNT(*) as count FROM documents WHERE tenant_id = $1 AND status = 'indexed' GROUP BY project_id`,
      [tenantId]
    );
    const countMap: Record<string, number> = {};
    for (const row of docCounts) {
      countMap[row.project_id] = parseInt(row.count, 10);
    }

    const projectsList = dbProjects.map(p => ({
      id: p.id,
      name: p.name,
      docsCount: countMap[p.id] || 0
    }));
    
    if (!projectsList.some(p => p.id === "default")) {
      await query(
        `INSERT INTO projects (tenant_id, id, name) VALUES ($1, 'default', 'Dossier Général') ON CONFLICT DO NOTHING`,
        [tenantId]
      );
      projectsList.unshift({
        id: "default",
        name: "Dossier Général",
        docsCount: 0
      });
    } else {
      const defIndex = projectsList.findIndex(p => p.id === "default");
      if (defIndex > 0) {
        const [defProj] = projectsList.splice(defIndex, 1);
        projectsList.unshift(defProj);
      }
    }
    
    res.json(projectsList);
  } catch (error: any) {
    console.error("Error fetching projects:", error);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// Create new project (Multi-tenant isolated)
app.post("/api/projects", requireAuth, async (req, res) => {
  const { name } = req.body;
  const user = (req as any).user;
  const tenantId = user.tenantId;
  
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Nom de projet obligatoire" });
  }
  
  const displayProjId = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
    
  if (displayProjId === "default" || displayProjId === "company_docs" || displayProjId === "memory") {
    return res.status(400).json({ error: "Ce nom de projet est réservé." });
  }
  
  if (!displayProjId) {
    return res.status(400).json({ error: "Le nom du projet contient des caractères invalides." });
  }
  
  const realProjectId = `${tenantId}_${displayProjId}`;
  const targetDir = path.join(DOCS_DIR, realProjectId);
  
  try {
    const existing = await queryOne(
      `SELECT id FROM projects WHERE tenant_id = $1 AND id = $2`,
      [tenantId, displayProjId]
    );
    if (existing || fs.existsSync(targetDir)) {
      return res.status(400).json({ error: "Un projet avec ce nom existe déjà." });
    }
    
    await query(
      `INSERT INTO projects (tenant_id, id, name) VALUES ($1, $2, $3)`,
      [tenantId, displayProjId, name.trim()]
    );
    
    fs.mkdirSync(targetDir, { recursive: true });
    
    await logAction(tenantId, realProjectId, "Création de projet", "manual", "success", 0);
    
    res.json({
      success: true,
      project: {
        id: displayProjId,
        name: name.trim(),
        docsCount: 0
      }
    });
  } catch (err: any) {
    console.error("Project creation failed:", err);
    res.status(500).json({ error: err.message || "La création du dossier projet a échoué" });
  }
});

// Delete project (Multi-tenant isolated)
app.delete("/api/projects/:id", requireAuth, async (req, res) => {
  const displayProjId = req.params.id;
  const user = (req as any).user;
  const tenantId = user.tenantId;
  
  if (displayProjId === "default") {
    return res.status(400).json({ error: "Impossible de supprimer le dossier général." });
  }
  
  const realProjectId = `${tenantId}_${displayProjId}`;
  const targetDir = path.join(DOCS_DIR, realProjectId);
  
  try {
    const projectDocs = await queryAll(
      `SELECT id, name FROM documents WHERE tenant_id = $1 AND project_id = $2`,
      [tenantId, displayProjId]
    );
    
    for (const doc of projectDocs) {
      const fileMeta = await queryOne(
        `SELECT s3_key FROM file_storage WHERE document_id = $1`,
        [doc.id]
      );
      if (fileMeta) {
        await deleteFile(tenantId, fileMeta.s3_key);
      }
    }
    
    await query(`DELETE FROM document_chunks WHERE tenant_id = $1 AND project_id = $2`, [tenantId, displayProjId]);
    await query(`DELETE FROM file_storage WHERE tenant_id = $1 AND document_id IN (SELECT id FROM documents WHERE tenant_id = $1 AND project_id = $2)`, [tenantId, displayProjId]);
    await query(`DELETE FROM documents WHERE tenant_id = $1 AND project_id = $2`, [tenantId, displayProjId]);
    await query(`DELETE FROM chat_messages WHERE tenant_id = $1 AND project_id = $2`, [tenantId, displayProjId]);
    await query(`DELETE FROM sync_logs WHERE tenant_id = $1 AND project_id = $2`, [tenantId, displayProjId]);
    await query(`DELETE FROM widget_tokens WHERE tenant_id = $1 AND project_id = $2`, [tenantId, displayProjId]);
    await query(`DELETE FROM projects WHERE tenant_id = $1 AND id = $2`, [tenantId, displayProjId]);
    
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    
    for (const key of Object.keys(fileMetaCache)) {
      if (key.startsWith(`${realProjectId}/`)) {
        delete fileMetaCache[key];
      }
    }
    
    res.json({ success: true, message: `Projet '${displayProjId}' supprimé avec succès.` });
  } catch (err: any) {
    console.error("Project deletion failed:", err);
    res.status(500).json({ error: err.message || "La suppression du projet a échoué" });
  }
});

// Get system statistics (Filtered by Tenant & Project)
app.get("/api/stats", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const tenantId = user.tenantId;
  const reqProjId = (req.query.projectId as string) || "default";
  
  const realProjectId = `${tenantId}_${reqProjId}`;
  
  try {
    const docCountResult = await queryOne(
      `SELECT COUNT(*) as count FROM documents WHERE tenant_id = $1 AND project_id = $2 AND status = 'indexed'`,
      [tenantId, reqProjId]
    );
    
    const chunkCountResult = await queryOne(
      `SELECT COUNT(*) as count FROM document_chunks WHERE tenant_id = $1 AND project_id = $2`,
      [tenantId, reqProjId]
    );
    
    const lastSyncLog = await queryOne(
      `SELECT created_at FROM sync_logs WHERE tenant_id = $1 AND project_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [tenantId, realProjectId]
    );
    
    res.json({
      totalDocs: docCountResult ? parseInt(docCountResult.count, 10) : 0,
      totalChunks: chunkCountResult ? parseInt(chunkCountResult.count, 10) : 0,
      lastSync: lastSyncLog ? lastSyncLog.created_at : null,
      watcherStatus: isSyncing ? 'processing' : 'watching',
      geminiActive: !!process.env.GEMINI_API_KEY
    });
  } catch (error: any) {
    console.error("Stats fetching failed:", error);
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

// Logs endpoint (Filtered by Tenant & optional Project)
app.get("/api/logs", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const tenantId = user.tenantId;
  const reqProjId = req.query.projectId as string;
  
  try {
    if (reqProjId) {
      const realProjectId = `${tenantId}_${reqProjId}`;
      const logs = await queryAll(
        `SELECT id, filename, project_id as "projectId", action, status, chunks_count as "chunksCount", error, created_at as timestamp 
         FROM sync_logs 
         WHERE tenant_id = $1 AND project_id = $2 
         ORDER BY created_at DESC`,
        [tenantId, realProjectId]
      );
      res.json(logs);
    } else {
      const logs = await queryAll(
        `SELECT id, filename, project_id as "projectId", action, status, chunks_count as "chunksCount", error, created_at as timestamp 
         FROM sync_logs 
         WHERE tenant_id = $1 
         ORDER BY created_at DESC`,
        [tenantId]
      );
      res.json(logs);
    }
  } catch (error: any) {
    console.error("Logs fetching failed:", error);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

// Get loaded documents info (Filtered by Tenant & Project)
app.get("/api/documents", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const tenantId = user.tenantId;
  const reqProjId = (req.query.projectId as string) || "default";
  
  try {
    const docs = await queryAll(
      `SELECT name, size, status, chunks_count as "chunksCount", created_at FROM documents 
       WHERE tenant_id = $1 AND project_id = $2
       ORDER BY created_at DESC`,
      [tenantId, reqProjId]
    );
    
    const docsList = docs.map(d => ({
      name: d.name,
      size: parseInt(d.size, 10),
      lastModified: new Date(d.created_at).getTime(),
      status: d.status,
      chunksCount: d.chunksCount
    }));
    
    res.json(docsList);
  } catch (error: any) {
    console.error("Documents fetching failed:", error);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

// Add/upload files (Filtered by Tenant & Project)
app.post("/api/upload", requireAuth, upload.array("files"), async (req, res) => {
  try {
    console.log("Documents uploaded manually, triggering filesystem sync");
    await syncDocumentsFolder();
    res.json({
      success: true,
      message: "Files saved and indexing triggered successfully."
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Upload and sync failed" });
  }
});

// Force reindex of documents manually (Tenant isolated)
app.post("/api/reindex", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const tenantId = user.tenantId;
  const reqProjId = (req.body.projectId || req.query.projectId) as string;
  
  try {
    if (reqProjId) {
      const realProjectId = `${tenantId}_${reqProjId}`;
      console.log(`Forcing reindex for project '${realProjectId}' manually`);
      for (const key of Object.keys(fileMetaCache)) {
        if (key.startsWith(`${realProjectId}/`)) {
          delete fileMetaCache[key];
        }
      }
      await wipeDocumentsForReindex(tenantId, reqProjId);
    } else {
      console.log(`Forcing reindex for tenant '${tenantId}' manually`);
      const tenantPrefix = `${tenantId}_`;
      for (const key of Object.keys(fileMetaCache)) {
        if (key.startsWith(tenantPrefix)) {
          delete fileMetaCache[key];
        }
      }
      await wipeDocumentsForReindex(tenantId);
    }
    
    await syncDocumentsFolder();
    
    res.json({
      success: true,
      message: reqProjId ? `Project '${reqProjId}' reindexing executed.` : "Hard reindexing executed successfully."
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Manual reindex failed" });
  }
});

// Soft sync documents folder manually (incremental scan)
app.post("/api/sync", requireAuth, async (req, res) => {
  try {
    console.log("Manual sync requested, running incremental filesystem scan");
    await syncDocumentsFolder();
    res.json({
      success: true,
      message: "Synchronisation incrémentale terminée avec succès."
    });
  } catch (err: any) {
    console.error("Incremental sync failed:", err);
    res.status(500).json({ error: err.message || "Manual sync failed" });
  }
});

// Update API Key Endpoint
app.post("/api/settings/apikey", requireAuth, (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || typeof apiKey !== 'string') {
    return res.status(400).json({ error: "Clé API invalide" });
  }

  try {
    process.env.GEMINI_API_KEY = apiKey.trim();
    ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const envPath = path.join(process.cwd(), ".env");
    let envContent = "";
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, "utf-8");
    }
    
    if (envContent.includes("GEMINI_API_KEY=")) {
      envContent = envContent.replace(/GEMINI_API_KEY=.*/g, `GEMINI_API_KEY=${process.env.GEMINI_API_KEY}`);
    } else {
      envContent += `\nGEMINI_API_KEY=${process.env.GEMINI_API_KEY}\n`;
    }
    fs.writeFileSync(envPath, envContent.trim() + "\n");

    res.json({ success: true, message: "Clé API mise à jour avec succès" });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Erreur lors de la mise à jour de la clé" });
  }
});

// ==========================================
// WIDGET PUBLIC — Chatbot intégrable
// ==========================================

// Get or create widget token for a project
app.post("/api/widget/token", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const tenantId = user.tenantId;
  const { projectId = "default", agentName, agentColor } = req.body;

  try {
    let existing = await queryOne(
      `SELECT * FROM widget_tokens WHERE tenant_id = $1 AND project_id = $2`,
      [tenantId, projectId]
    );
    
    let token: string;
    let name = agentName || "Assistant IA";
    let color = agentColor || "#6366f1";
    
    if (!existing) {
      token = crypto.randomBytes(32).toString("hex");
      await query(
        `INSERT INTO widget_tokens (token, tenant_id, project_id, agent_name, agent_color) 
         VALUES ($1, $2, $3, $4, $5)`,
        [token, tenantId, projectId, name, color]
      );
    } else {
      token = existing.token;
      if (agentName) name = agentName;
      if (agentColor) color = agentColor;
      await query(
        `UPDATE widget_tokens SET agent_name = $1, agent_color = $2 WHERE tenant_id = $3 AND project_id = $4`,
        [name, color, tenantId, projectId]
      );
    }
    
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const embedCode = `<script src="${baseUrl}/widget.js" data-token="${token}" data-name="${name}" data-color="${color}"></script>`;
    
    res.json({
      success: true,
      token,
      agentName: name,
      agentColor: color,
      embedCode
    });
  } catch (error: any) {
    console.error("Widget token creation failed:", error);
    res.status(500).json({ error: "Failed to manage widget token" });
  }
});

// Get existing widget token info (no regeneration)
app.get("/api/widget/token", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const tenantId = user.tenantId;
  const projectId = (req.query.projectId as string) || "default";

  try {
    const existing = await queryOne(
      `SELECT * FROM widget_tokens WHERE tenant_id = $1 AND project_id = $2`,
      [tenantId, projectId]
    );
    
    if (!existing) {
      return res.json({ token: null, embedCode: null });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const embedCode = `<script src="${baseUrl}/widget.js" data-token="${existing.token}" data-name="${existing.agent_name}" data-color="${existing.agent_color}"></script>`;

    res.json({
      token: existing.token,
      agentName: existing.agent_name,
      agentColor: existing.agent_color,
      embedCode
    });
  } catch (error: any) {
    console.error("Widget token fetch failed:", error);
    res.status(500).json({ error: "Failed to fetch widget token" });
  }
});

// Regenerate widget token (revokes previous)
app.delete("/api/widget/token", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const tenantId = user.tenantId;
  const projectId = (req.query.projectId as string) || "default";

  try {
    await query(
      `DELETE FROM widget_tokens WHERE tenant_id = $1 AND project_id = $2`,
      [tenantId, projectId]
    );
    res.json({ success: true, message: "Token révoqué. Générez un nouveau token pour continuer." });
  } catch (error: any) {
    console.error("Widget token revocation failed:", error);
    res.status(500).json({ error: "Failed to revoke widget token" });
  }
});

// CORS OPTIONS preflight for public widget endpoint
app.options("/api/widget/ask", (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Widget-Token');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.sendStatus(204);
});

// PUBLIC widget endpoint — No JWT required, secured by widget token
app.post("/api/widget/ask", async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Widget-Token');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  const { question } = req.body;
  const widgetToken = req.headers['x-widget-token'] as string || req.body.token;

  if (!widgetToken) {
    return res.status(401).json({ error: "Widget token manquant." });
  }

  try {
    const tokenRecord = await queryOne(
      `SELECT * FROM widget_tokens WHERE token = $1`,
      [widgetToken]
    );
    if (!tokenRecord) {
      return res.status(401).json({ error: "Widget token invalide ou révoqué." });
    }

    if (!question || typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ error: "Question manquante." });
    }

    let topChunks: { filename: string; text: string; score: number }[] = [];
    const queryEmbedding = await getEmbedding(question);
    if (queryEmbedding) {
      const vectorStr = `[${queryEmbedding.join(",")}]`;
      const matches = await queryAll(
        `SELECT * FROM match_chunks($1::vector, $2::float, $3::int, $4::text, $5::text)`,
        [vectorStr, 0.15, 4, tokenRecord.tenant_id, tokenRecord.project_id]
      );
      topChunks = matches.map(m => ({
        filename: m.document_name,
        text: m.text,
        score: m.score
      }));
    }

    const contextText = topChunks.length > 0
      ? topChunks.map((c, i) => `[Source ${i+1}: ${c.filename}]\n${c.text}`).join("\n\n")
      : "Aucun contexte trouvé dans les documents.";

    const systemInstruction = `You are ${tokenRecord.agent_name || "ASSOCIE.AI"}, a professional AI assistant powered by ASSOCIE.AI.
Answer questions using ONLY information from the company documents provided below.
Be concise, professional, and friendly. Use markdown when helpful.
If you don't find the answer in the context, say so politely and invite the visitor to contact support.

COMPANY DOCUMENTS CONTEXT:
${contextText}`;

    let aiAnswer = "Je suis désolé, l'IA n'est pas disponible pour le moment. Contactez notre support.";

    if (process.env.GEMINI_API_KEY) {
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: [{ role: "user", parts: [{ text: question }] }],
          config: { systemInstruction }
        });
        aiAnswer = response.text || "Aucune réponse générée.";
      } catch (gemErr: any) {
        console.error("Widget Gemini error:", gemErr);
        aiAnswer = "Erreur temporaire du moteur IA. Réessayez dans quelques instants.";
      }
    }

    // Save public widget messages to the chat_messages table
    const userMsgId = crypto.randomUUID();
    const aiMsgId = crypto.randomUUID();
    
    await query(
      `INSERT INTO chat_messages (id, tenant_id, project_id, sender, text, sources, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userMsgId, tokenRecord.tenant_id, tokenRecord.project_id, 'user', question, '[]']
    );
    
    await query(
      `INSERT INTO chat_messages (id, tenant_id, project_id, sender, text, sources, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [aiMsgId, tokenRecord.tenant_id, tokenRecord.project_id, 'ai', aiAnswer, JSON.stringify(topChunks.map(c => ({ filename: c.filename, text: c.text, score: c.score })))]
    );

    res.json({
      answer: aiAnswer,
      sources: topChunks.map(c => ({ filename: c.filename, score: Math.round(c.score * 100) }))
    });
  } catch (error: any) {
    console.error("Widget ask error:", error);
    res.status(500).json({ error: "Erreur serveur du widget." });
  }
});

// Download specific document (Tenant isolated)
app.get("/api/documents/:name/download", requireAuth, async (req, res) => {
  const filename = req.params.name;
  const user = (req as any).user;
  const tenantId = user.tenantId;
  const reqProjId = (req.query.projectId as string) || "default";
  
  try {
    const doc = await queryOne(
      `SELECT id FROM documents WHERE tenant_id = $1 AND project_id = $2 AND name = $3`,
      [tenantId, reqProjId, filename]
    );
    if (!doc) {
      return res.status(404).json({ error: "File not found" });
    }
    
    const fileMeta = await queryOne(
      `SELECT id, s3_key, mime_type, file_size FROM file_storage WHERE document_id = $1`,
      [doc.id]
    );
    if (!fileMeta) {
      return res.status(404).json({ error: "File metadata not found" });
    }
    
    const fileBuffer = await downloadFile(tenantId, fileMeta.s3_key);
    
    await logFileAccess(
      fileMeta.id,
      user.username,
      tenantId,
      'download',
      req.ip || undefined,
      req.headers['user-agent'] || undefined
    );
    
    res.setHeader('Content-Type', fileMeta.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(fileBuffer);
  } catch (error: any) {
    console.error("Download failed:", error);
    res.status(500).json({ error: error.message || "Download failed" });
  }
});

// Delete specific document (Tenant isolated)
app.delete("/api/documents/:name", requireAuth, async (req, res) => {
  const filename = req.params.name;
  const user = (req as any).user;
  const tenantId = user.tenantId;
  const reqProjId = (req.query.projectId as string) || "default";
  
  const realProjectId = `${tenantId}_${reqProjId}`;
  const targetDir = path.join(DOCS_DIR, realProjectId);
  const filePath = path.join(targetDir, filename);
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    const doc = await queryOne(
      `SELECT id FROM documents WHERE tenant_id = $1 AND project_id = $2 AND name = $3`,
      [tenantId, reqProjId, filename]
    );
    
    if (doc) {
      const fileMeta = await queryOne(
        `SELECT s3_key FROM file_storage WHERE document_id = $1`,
        [doc.id]
      );
      if (fileMeta) {
        await deleteFile(tenantId, fileMeta.s3_key);
      }
      
      await query(`DELETE FROM documents WHERE id = $1`, [doc.id]);
    }
    
    const relPath = `${realProjectId}/${filename}`;
    delete fileMetaCache[relPath];
    
    await logAction(tenantId, realProjectId, filename, 'delete', 'success');

    res.json({ success: true, message: `Document '${filename}' deleted successfully.` });
  } catch (err: any) {
    console.error("Document deletion failed:", err);
    res.status(500).json({ error: err.message || "Deletion failed" });
  }
});

// Clear memory endpoints (Tenant isolated)
app.delete("/api/memory", requireAuth, async (req, res) => {
  const { clearAll, projectId = "default" } = req.body;
  const user = (req as any).user;
  const tenantId = user.tenantId;
  const realProjectId = `${tenantId}_${projectId}`;
  const tenantPrefix = `${tenantId}_`;
  
  try {
    if (clearAll) {
      const tenantDocs = await queryAll(
        `SELECT id FROM documents WHERE tenant_id = $1`,
        [tenantId]
      );
      for (const doc of tenantDocs) {
        const fileMeta = await queryOne(
          `SELECT s3_key FROM file_storage WHERE document_id = $1`,
          [doc.id]
        );
        if (fileMeta) {
          try {
            await deleteFile(tenantId, fileMeta.s3_key);
          } catch (e) {
            console.error(`Failed to delete file from MinIO during memory clear:`, e);
          }
        }
      }
      
      await query(`DELETE FROM document_chunks WHERE tenant_id = $1`, [tenantId]);
      await query(`DELETE FROM file_storage WHERE tenant_id = $1`, [tenantId]);
      await query(`DELETE FROM documents WHERE tenant_id = $1`, [tenantId]);
      await query(`DELETE FROM chat_messages WHERE tenant_id = $1`, [tenantId]);
      await query(`DELETE FROM sync_logs WHERE tenant_id = $1`, [tenantId]);
      await query(`DELETE FROM widget_tokens WHERE tenant_id = $1`, [tenantId]);
      await query(`DELETE FROM projects WHERE tenant_id = $1 AND id != 'default'`, [tenantId]);
      
      for (const key of Object.keys(fileMetaCache)) {
        if (key.startsWith(tenantPrefix)) {
          delete fileMetaCache[key];
        }
      }
      
      if (fs.existsSync(DOCS_DIR)) {
        const files = fs.readdirSync(DOCS_DIR);
        for (const f of files) {
          if (f.startsWith(tenantPrefix) && f !== `${tenantId}_default`) {
            const fullPath = path.join(DOCS_DIR, f);
            if (fs.statSync(fullPath).isDirectory()) {
              fs.rmSync(fullPath, { recursive: true, force: true });
            }
          } else if (f === `${tenantId}_default`) {
            const fullPath = path.join(DOCS_DIR, f);
            const subFiles = fs.readdirSync(fullPath);
            for (const sf of subFiles) {
              fs.rmSync(path.join(fullPath, sf), { recursive: true, force: true });
            }
          }
        }
      }
      
      await logAction(tenantId, `${tenantId}_default`, 'Factory Reset', 'manual', 'success');
    } else {
      await query(
        `DELETE FROM chat_messages WHERE tenant_id = $1 AND project_id = $2`,
        [tenantId, projectId]
      );
    }

    res.json({ success: true, message: clearAll ? "Entire indexes and logs wiped back to factory defaults" : "Chat conversation memory cleared." });
  } catch (err: any) {
    console.error("Memory reset failed:", err);
    res.status(500).json({ error: err.message || "Clean failed" });
  }
});

// Web Scraper API: Fetch a URL and save its text as a .md file in company_docs
const scrapeHandler = async (req: express.Request, res: express.Response) => {
  const { url, projectId = "default" } = req.body;
  const user = (req as any).user;
  const tenantId = user.tenantId;

  if (!url) {
    return res.status(400).json({ error: "URL manquante." });
  }

  try {
    let cheerioModule;
    try {
      cheerioModule = await import("cheerio");
    } catch (e) {
      return res.status(500).json({ error: "Veuillez exécuter 'npm install cheerio' dans votre terminal." });
    }

    // Force http:// if missing
    let finalUrl = url;
    if (!finalUrl.startsWith('http')) {
      finalUrl = 'https://' + finalUrl;
    }

    const response = await fetch(finalUrl);
    if (!response.ok) {
      throw new Error(`Erreur HTTP: ${response.status}`);
    }
    const html = await response.text();
    const loadHtml = cheerioModule.load || (cheerioModule.default && cheerioModule.default.load);
    if (!loadHtml) {
      throw new Error("Erreur d'importation de cheerio.");
    }
    const $ = loadHtml(html);

    // Remove scripts, styles, noscript, nav, footer to get clean text
    $('script, style, noscript, nav, footer, header').remove();
    
    // Extract text and replace multiple spaces/newlines
    const textContent = $('body').text().replace(/\s\s+/g, '\n\n').trim();

    if (!textContent) {
      throw new Error("Aucun texte trouvé sur cette page.");
    }

    // Format content as Markdown
    const markdownContent = `# Contenu extrait de ${finalUrl}\n\nDate d'extraction: ${new Date().toLocaleString()}\n\n---\n\n${textContent}`;

    // Create file name based on URL domain
    const urlObj = new URL(finalUrl);
    let domain = urlObj.hostname.replace(/[^a-z0-9]/gi, '_');
    const filename = `Scraped_${domain}.md`;

    // Save to target directory
    const realProjectId = `${tenantId}_${projectId}`;
    const targetDir = path.join(DOCS_DIR, realProjectId);
      
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const targetPath = path.join(targetDir, filename);
    fs.writeFileSync(targetPath, markdownContent, 'utf-8');

    res.json({ success: true, message: `Page scrapée avec succès et enregistrée sous ${filename}` });
  } catch (error: any) {
    console.error("Scraping failed:", error);
    res.status(500).json({ error: error.message || "Impossible de scraper cette URL." });
  }
};

app.post("/api/import-web", requireAuth, scrapeHandler);
app.post("/api/scrape", requireAuth, scrapeHandler);

// ==========================================
// PROPERTIES API (Carte Interactive)
// ==========================================

// Auto-create properties table if it doesn't exist
(async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS properties (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT 'default',
        name TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        price NUMERIC(12, 2) DEFAULT 0,
        surface NUMERIC(10, 2) DEFAULT 0,
        description TEXT DEFAULT '',
        image_url TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch (e) {
    // Table may already exist, ignore
  }
})();

// Get all properties for a tenant
app.get("/api/properties", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const tenantId = user.tenantId;
  const projectId = (req.query.projectId as string) || 'default';

  try {
    const properties = await queryAll(
      `SELECT id, tenant_id, project_id, name, address, latitude, longitude, price, surface, description, image_url, created_at 
       FROM properties WHERE tenant_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
      [tenantId, projectId]
    );
    res.json(properties);
  } catch (err: any) {
    console.error('Failed to fetch properties:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch properties' });
  }
});

// Add a new property
app.post("/api/properties", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const tenantId = user.tenantId;
  const { name, address, latitude, longitude, price, surface, description, imageUrl, projectId = 'default' } = req.body;

  if (!name || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'Nom, latitude et longitude sont obligatoires.' });
  }

  try {
    const result = await queryOne(
      `INSERT INTO properties (tenant_id, project_id, name, address, latitude, longitude, price, surface, description, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [tenantId, projectId, name, address || '', latitude, longitude, price || 0, surface || 0, description || '', imageUrl || '']
    );
    res.json(result);
  } catch (err: any) {
    console.error('Failed to create property:', err);
    res.status(500).json({ error: err.message || 'Failed to create property' });
  }
});

// Delete a property
app.delete("/api/properties/:id", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const tenantId = user.tenantId;
  const propertyId = req.params.id;

  try {
    await query('DELETE FROM properties WHERE id = $1 AND tenant_id = $2', [propertyId, tenantId]);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to delete property:', err);
    res.status(500).json({ error: err.message || 'Failed to delete property' });
  }
});

// Ask API with RAG retrieval (Filtered by Tenant & Project)
app.post("/api/ask", requireAuth, async (req, res) => {
  const { question, projectId = "default", image } = req.body;
  const user = (req as any).user;
  const tenantId = user.tenantId;
  const realProjectId = `${tenantId}_${projectId}`;
  
  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "question property is mandated" });
  }

  try {
    let topChunks: { filename: string; text: string; score: number }[] = [];
    const queryEmbedding = await getEmbedding(question);
    
    if (queryEmbedding) {
      const vectorStr = `[${queryEmbedding.join(",")}]`;
      const matches = await queryAll(
        `SELECT * FROM match_chunks($1::vector, $2::float, $3::int, $4::text, $5::text)`,
        [vectorStr, 0.15, 5, tenantId, projectId]
      );
      topChunks = matches.map(m => ({
        filename: m.document_name,
        text: m.text,
        score: m.score
      }));
    }

    const contextText = topChunks.length > 0
      ? topChunks.map((c, i) => `[Source ${i+1}: ${c.filename}]\n${c.text}`).join("\n\n")
      : "No matching context from enterprise documents was found.";

    const systemInstruction = `You are ASSOCIE.AI, an ultra-premium Enterprise custom support agent.
Analyze the user request and provide responses using ONLY the supporting context from company documents provided below.
If the user provides an image, describe it in detail and analyze it in the context of the company documents.

INSTRUCTIONS:
1. Always be professional, transparent, and direct.
2. If the context contains details about pricing, contracts, or procedures, explain them accurately.
3. Be fully faithful to the context. Avoid speculating on items not directly mentioned.
4. If you rely on sources, mention which document you got the information from (e.g., "According to the Prix.xlsx document...").
5. If the context does not contain enough information to answer, politely state that the company documents do not provide this info, but invite them to contact support.
6. Support markdown formatting (bold, tables, lists, etc.) to look gorgeous.
7. If the user sends an image, analyze the image thoroughly and respond in context.

SUPPORTING CONTEXT FROM COMPANY DOCUMENTS:
${contextText}`;

    const recentHistory = await queryAll(
      `SELECT sender, text FROM chat_messages 
       WHERE tenant_id = $1 AND project_id = $2 
       ORDER BY created_at ASC LIMIT 8`,
      [tenantId, projectId]
    );
    
    const contents: any[] = recentHistory.map(msg => ({
      role: msg.sender === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }));
    
    // Build user message parts with optional image
    const userParts: any[] = [{ text: question }];
    if (image) {
      // Extract mime type and base64 data from data URI
      const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        userParts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2]
          }
        });
      }
    }
    contents.push({
      role: 'user',
      parts: userParts
    });

    let aiAnswer = "I'm sorry, I cannot process your request because Gemini API has not been initialized. Please check that GEMINI_API_KEY is mapped inside your Secrets Settings.";

    if (process.env.GEMINI_API_KEY) {
      const MAX_RETRIES = 3;
      let lastError: any = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents,
            config: {
              systemInstruction
            }
          });
          aiAnswer = response.text || "No output returned from Gemini.";
          lastError = null;
          break; // Success — exit retry loop
        } catch (gemError: any) {
          lastError = gemError;
          const errorMsg = typeof gemError.message === 'string' ? gemError.message : JSON.stringify(gemError);
          const is503 = errorMsg.includes('503') || errorMsg.includes('UNAVAILABLE') || errorMsg.includes('high demand');
          const is429 = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('quota');

          if ((is503 || is429) && attempt < MAX_RETRIES) {
            const waitMs = attempt * 2000; // 2s, 4s
            console.warn(`⏳ Gemini API surchargée (tentative ${attempt}/${MAX_RETRIES}). Nouvelle tentative dans ${waitMs / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, waitMs));
            continue;
          }
          break; // Non-retryable error or max retries reached
        }
      }

      if (lastError) {
        console.error("Gemini text generation failed after retries:", lastError);
        const errorMsg = typeof lastError.message === 'string' ? lastError.message : JSON.stringify(lastError);
        const is503 = errorMsg.includes('503') || errorMsg.includes('UNAVAILABLE') || errorMsg.includes('high demand');
        const is429 = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('quota');

        if (is503) {
          aiAnswer = `⏳ **L'IA est temporairement surchargée.**\n\nLes serveurs Gemini de Google reçoivent beaucoup de demandes en ce moment. C'est un problème temporaire qui se résout généralement en quelques secondes.\n\n**👉 Veuillez reformuler votre question ou réessayer dans un instant.**`;
        } else if (is429) {
          aiAnswer = `⚠️ **Quota API atteint.**\n\nVotre quota d'utilisation de l'API Gemini est temporairement épuisé. Cela peut être dû à un grand nombre de requêtes récentes.\n\n**👉 Patientez quelques minutes avant de réessayer.**`;
        } else {
          aiAnswer = `❌ **Erreur de l'IA.**\n\nUne erreur inattendue s'est produite lors de la génération de la réponse. Détails techniques : ${errorMsg}\n\n**👉 Veuillez réessayer. Si le problème persiste, vérifiez votre clé API dans les paramètres.**`;
        }
      }
    } else {
      aiAnswer = `[PREVIEW MODE - Configure your GEMINI_API_KEY in Settings > Secrets to enable live Gemini answers]
Based on your matching context:
${topChunks.length > 0 ? `I found relevant documents: ${topChunks.map(c => c.filename).join(', ')}. Here is the closest match:\n${topChunks[0].text}` : "No matching documents found in watch folder."}`;
    }

    const userMsgId = crypto.randomUUID();
    const aiMsgId = crypto.randomUUID();
    
    await query(
      `INSERT INTO chat_messages (id, tenant_id, project_id, sender, text, sources, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userMsgId, tenantId, projectId, 'user', question, '[]']
    );
    
    await query(
      `INSERT INTO chat_messages (id, tenant_id, project_id, sender, text, sources, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [aiMsgId, tenantId, projectId, 'ai', aiAnswer, JSON.stringify(topChunks.map(c => ({ filename: c.filename, text: c.text, score: c.score })))]
    );

    res.json({
      answer: aiAnswer,
      sources: topChunks.map(c => ({ filename: c.filename, text: c.text, score: c.score }))
    });

  } catch (error: any) {
    console.error("Ask endpoint failed code error:", error);
    res.status(500).json({ error: error.message || "RAG answering cycle failed" });
  }
});

// Fetch full message logs (Filtered by Tenant & Project)
app.get("/api/chat", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const tenantId = user.tenantId;
  const reqProjId = (req.query.projectId as string) || "default";
  
  try {
    const messages = await queryAll(
      `SELECT id, project_id as "projectId", sender, text, sources, created_at as timestamp 
       FROM chat_messages 
       WHERE tenant_id = $1 AND project_id = $2 
       ORDER BY created_at ASC`,
      [tenantId, reqProjId]
    );
    
    res.json(messages.map(msg => ({
      id: msg.id,
      projectId: msg.projectId,
      sender: msg.sender,
      text: msg.text,
      timestamp: msg.timestamp,
      sources: msg.sources || []
    })));
  } catch (error: any) {
    console.error("Chat history fetch failed:", error);
    res.status(500).json({ error: "Failed to fetch chat history" });
  }
});

// ==========================================
// STATIC FRONTEND SETUP & DEV ENGINE
// ==========================================

async function startServer() {
  try {
    const logCount = await queryOne('SELECT COUNT(*) as count FROM sync_logs');
    if (logCount && parseInt(logCount.count, 10) === 0) {
      await logAction(
        'hassan_agency',
        'hassan_agency_default',
        'System Initializer',
        'manual',
        'success'
      );
    }
  } catch (dbErr: any) {
    console.error("⚠️ Warning: Failed to query database during startup initialization:", dbErr.message || dbErr);
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("Vite dev middleware initializing on top of Express server");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`===============================================`);
    console.log(`🚀 ASSOCIE.AI Backend Running on http://localhost:${PORT}`);
    console.log(`📂 Document Watcher monitoring: /company_docs`);
    console.log(`⚙️ Build Platform active`);
    console.log(`===============================================`);
  });
}

// Launch watcher interval to run checking every 4 seconds in background
setInterval(syncDocumentsFolder, 4000);

// Run an initial file sync immediately on startup
setTimeout(syncDocumentsFolder, 1000);

startServer();
