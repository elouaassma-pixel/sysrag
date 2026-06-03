export interface DocInfo {
  name: string;
  size: number;
  lastModified: number;
  status: 'indexed' | 'processing' | 'failed';
  chunksCount: number;
}

export interface SyncLog {
  id: string;
  filename: string;
  projectId: string;
  action: 'create' | 'update' | 'delete' | 'manual';
  status: 'success' | 'failed' | 'processing';
  chunksCount?: number;
  timestamp: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  projectId: string;
  timestamp: string;
  image?: string; // base64 image data for vision
  sources?: { filename: string; text: string; score: number }[];
}

export interface AppStats {
  totalDocs: number;
  totalChunks: number;
  lastSync: string | null;
  watcherStatus: 'watching' | 'idle' | 'error';
  geminiActive?: boolean;
}

export interface Project {
  id: string;
  name: string;
  docsCount?: number;
}

export interface Property {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  price: number;
  surface: number;
  description: string;
  imageUrl?: string;
  createdAt: string;
}

