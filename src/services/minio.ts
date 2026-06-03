import { createHash } from 'crypto';
import { join, dirname } from 'path';
import * as fs from 'fs';
import { query, queryOne } from './db.js';

const STORAGE_ROOT = join(process.cwd(), 'company_docs', 'storage');

/**
 * Initialise le client MinIO (Mocké pour utiliser le disque local)
 */
export function initializeMinIO(): any {
  console.log("📂 Local Storage Driver initialized (MinIO bypassed)");
  
  if (!fs.existsSync(STORAGE_ROOT)) {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  }
  
  return {};
}

/**
 * Retourne le client MinIO (Mocké)
 */
export function getMinIOClient(): any {
  return {};
}

/**
 * Crée un bucket s'il n'existe pas (Création de dossier en local)
 */
export async function ensureBucket(bucketName: string, region = 'us-east-1'): Promise<void> {
  const bucketPath = join(STORAGE_ROOT, bucketName);
  if (!fs.existsSync(bucketPath)) {
    fs.mkdirSync(bucketPath, { recursive: true });
  }
}

/**
 * Upload un fichier vers le stockage local (Bypasse MinIO)
 */
export async function uploadFile(
  documentId: string,
  tenantId: string,
  fileName: string,
  fileStream: any,
  fileSize: number,
  mimeType: string
): Promise<{ s3Key: string; hash: string }> {
  const bucketName = `tenant-${tenantId}`;
  
  // Générer une clé unique
  const timestamp = Date.now();
  const s3Key = `documents/${documentId}/${timestamp}-${fileName}`;
  
  const targetPath = join(STORAGE_ROOT, bucketName, s3Key);
  const targetDir = dirname(targetPath);
  
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const hash = createHash('sha256');
  const writeStream = fs.createWriteStream(targetPath);

  return new Promise((resolve, reject) => {
    fileStream.on('data', (chunk: any) => {
      hash.update(chunk);
      writeStream.write(chunk);
    });

    fileStream.on('end', () => {
      writeStream.end();
      resolve({ s3Key, hash: hash.digest('hex') });
    });

    fileStream.on('error', (err: any) => {
      writeStream.end();
      reject(err);
    });
    
    writeStream.on('error', (err: any) => {
      reject(err);
    });
  });
}

/**
 * Télécharge un fichier depuis le stockage local (Bypasse MinIO)
 */
export async function downloadFile(
  tenantId: string,
  s3Key: string
): Promise<Buffer> {
  const bucketName = `tenant-${tenantId}`;
  const filePath = join(STORAGE_ROOT, bucketName, s3Key);

  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    console.error(`Error downloading file from ${s3Key}:`, error);
    throw error;
  }
}

/**
 * Supprime un fichier du stockage local (Bypasse MinIO)
 */
export async function deleteFile(tenantId: string, s3Key: string): Promise<void> {
  const bucketName = `tenant-${tenantId}`;
  const filePath = join(STORAGE_ROOT, bucketName, s3Key);

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error(`Error deleting file ${s3Key}:`, error);
    throw error;
  }
}

/**
 * Enregistre les métadonnées du fichier en DB
 */
export async function registerFileMetadata(
  documentId: string,
  tenantId: string,
  s3Bucket: string,
  s3Key: string,
  fileName: string,
  fileSize: number,
  fileHash: string,
  mimeType: string
): Promise<void> {
  await query(
    `INSERT INTO file_storage 
     (document_id, tenant_id, s3_bucket, s3_key, file_name, file_size, file_hash, mime_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [documentId, tenantId, s3Bucket, s3Key, fileName, fileSize, fileHash, mimeType]
  );
}

/**
 * Récupère les métadonnées d'un fichier
 */
export async function getFileMetadata(documentId: string): Promise<any> {
  return queryOne(
    `SELECT * FROM file_storage WHERE document_id = $1`,
    [documentId]
  );
}

/**
 * Scanne un fichier pour les virus (Simulé)
 */
export async function scanFileForVirus(
  tenantId: string,
  s3Key: string
): Promise<{ status: string; result?: string }> {
  await query(
    `UPDATE file_storage 
     SET virus_scan_status = 'clean', virus_scan_result = 'Not infected'
     WHERE s3_key = $1`,
    [s3Key]
  );

  return { status: 'clean', result: 'Not infected' };
}

/**
 * Enregistre un accès à un fichier
 */
export async function logFileAccess(
  fileStorageId: string,
  userId: string,
  tenantId: string,
  action: 'download' | 'view' | 'delete',
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await query(
    `INSERT INTO file_access_logs (file_storage_id, user_id, tenant_id, action, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [fileStorageId, userId, tenantId, action, ipAddress, userAgent]
  );
}

/**
 * Récupère l'historique d'accès aux fichiers
 */
export async function getFileAccessLogs(
  fileStorageId: string,
  limit = 50
): Promise<any[]> {
  return query(
    `SELECT * FROM file_access_logs 
     WHERE file_storage_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [fileStorageId, limit]
  );
}

/**
 * Génère une URL présignée (Mocké pour rediriger vers notre route locale)
 */
export async function generatePresignedUrl(
  tenantId: string,
  s3Key: string,
  expirySeconds = 3600
): Promise<string> {
  return `/api/documents/${s3Key.split('/').pop()}/download`;
}

/**
 * Récupère les stats d'usage du stockage
 */
export async function getStorageUsage(tenantId: string): Promise<{ totalBytes: number; fileCount: number }> {
  const result = await query(
    `SELECT COUNT(*) as file_count, COALESCE(SUM(file_size), 0) as total_bytes
     FROM file_storage
     WHERE tenant_id = $1`,
    [tenantId]
  );

  return {
    fileCount: parseInt(result.rows[0].file_count, 10),
    totalBytes: parseInt(result.rows[0].total_bytes, 10),
  };
}
