import { useState, useEffect, useRef, FormEvent, DragEvent, ChangeEvent } from "react";
import { 
  BarChart3, 
  MessageSquare, 
  FileText, 
  Activity, 
  Settings2, 
  Upload, 
  Trash2, 
  RefreshCw, 
  AlertTriangle, 
  HelpCircle, 
  Sparkles, 
  CornerDownRight, 
  ShieldCheck, 
  Database, 
  Send, 
  ChevronRight, 
  FileCheck, 
  CloudRain, 
  Download,
  Terminal,
  Clock,
  Briefcase,
  CircleAlert,
  FolderPlus,
  Folder,
  Plus,
  Link,
  Globe,
  Paperclip,
  Map,
  MapPin
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { DocInfo, SyncLog, ChatMessage, AppStats, Project, Property } from "./types";
import PropertyMapPanel from "./components/PropertyMapPanel";
import {
  normalizePropertyImageUrl,
  isGoogleMapsLink,
  imageUrlFieldHint,
} from "./utils/propertyImage";

export default function App() {
  const [user, setUser] = useState<any>(() => {
    const saved = localStorage.getItem("associe_user");
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("associe_token"));
  
  // Login input states
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState<"home" | "chat" | "docs" | "logs" | "admin" | "map">("home");
  const [stats, setStats] = useState<AppStats>({
    totalDocs: 0,
    totalChunks: 0,
    lastSync: null,
    watcherStatus: "idle",
    geminiActive: false,
  });
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Vision Image State
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Property Map State
  const [properties, setProperties] = useState<Property[]>([]);
  const [isFetchingProperties, setIsFetchingProperties] = useState(false);
  const [newPropName, setNewPropName] = useState("");
  const [newPropAddress, setNewPropAddress] = useState("");
  const [newPropLat, setNewPropLat] = useState("");
  const [newPropLng, setNewPropLng] = useState("");
  const [newPropPrice, setNewPropPrice] = useState("");
  const [newPropSurface, setNewPropSurface] = useState("");
  const [newPropDesc, setNewPropDesc] = useState("");
  const [newPropImgUrl, setNewPropImgUrl] = useState("");
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isSavingProperty, setIsSavingProperty] = useState(false);
  const [showNewPropertyModal, setShowNewPropertyModal] = useState(false);
  const [geocodingError, setGeocodingError] = useState("");
  const [isResolvingMapsLink, setIsResolvingMapsLink] = useState(false);
  
  // Projects State
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<string>("default");
  const [newProjectName, setNewProjectName] = useState("");
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  // Widget state
  const [widgetToken, setWidgetToken] = useState<string | null>(null);
  const [widgetEmbedCode, setWidgetEmbedCode] = useState<string | null>(null);
  const [widgetAgentName, setWidgetAgentName] = useState("Assistant IA");
  const [widgetAgentColor, setWidgetAgentColor] = useState("#6366f1");
  const [isGeneratingWidget, setIsGeneratingWidget] = useState(false);
  const [widgetCopied, setWidgetCopied] = useState(false);
  const [widgetLoaded, setWidgetLoaded] = useState(false);

  // Watchdog Diagnostic Alerts state
  const [diagnosticAlerts, setDiagnosticAlerts] = useState<any[]>([]);
  const [serverMode, setServerMode] = useState<"local" | "cloud">("local");

  // Input states
  const [inputValue, setInputValue] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ status: 'idle' | 'uploading' | 'success' | 'failed', message?: string }>({ status: 'idle' });
  const [dragActive, setDragActive] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<File[]>([]);
  
  // Web Scraper states
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [isScraping, setIsScraping] = useState(false);
  
  // Selection states for context viewer
  const [selectedSources, setSelectedSources] = useState<{ filename: string; text: string; score: number }[] | null>(null);

  // Refs for scrolling and files
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("associe_user");
    localStorage.removeItem("associe_token");
  };

  const handleImageSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 5 * 1024 * 1024) {
        alert("L'image est trop volumineuse (max 5 Mo)");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setAttachedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGeocodeAddress = async () => {
    if (!newPropAddress.trim()) {
      setGeocodingError("Veuillez saisir une adresse ou une ville.");
      return;
    }
    setIsGeocoding(true);
    setGeocodingError("");
    try {
      const queryStr = encodeURIComponent(newPropAddress.trim());
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${queryStr}&limit=1`, {
        headers: {
          'Accept-Language': 'fr'
        }
      });
      const data = await response.json();
      if (data && data.length > 0) {
        const place = data[0];
        setNewPropLat(parseFloat(place.lat).toFixed(6));
        setNewPropLng(parseFloat(place.lon).toFixed(6));
        setGeocodingError("");
      } else {
        setGeocodingError("Aucun résultat trouvé pour cette adresse. Veuillez affiner la recherche.");
      }
    } catch (err) {
      console.error(err);
      setGeocodingError("Erreur de connexion au service de géocodage.");
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleResolveMapsLink = async () => {
    if (!token || !newPropImgUrl.trim() || !isGoogleMapsLink(newPropImgUrl)) return;
    setIsResolvingMapsLink(true);
    setGeocodingError("");
    try {
      const response = await fetch("/api/resolve-maps-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url: newPropImgUrl.trim() }),
      });
      const data = await response.json();
      if (response.ok) {
        setNewPropLat(String(data.latitude));
        setNewPropLng(String(data.longitude));
        if (!newPropAddress.trim() && data.resolvedUrl) {
          setNewPropAddress(newPropImgUrl.trim());
        }
        setNewPropImgUrl("");
        alert(
          "Position extraite du lien Google Maps.\n\nCe lien n'est pas une photo : le champ image a été vidé. Ajoutez une URL .jpg/.png si vous voulez une photo du bien."
        );
      } else {
        setGeocodingError(data.error || "Impossible d'utiliser ce lien Maps.");
      }
    } catch {
      setGeocodingError("Erreur de connexion lors de la lecture du lien Google Maps.");
    } finally {
      setIsResolvingMapsLink(false);
    }
  };

  const handleSaveProperty = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !newPropName.trim() || !newPropLat || !newPropLng) {
      alert("Nom, latitude et longitude sont requis.");
      return;
    }
    setIsSavingProperty(true);
    try {
      const payload = {
        name: newPropName.trim(),
        address: newPropAddress.trim(),
        latitude: parseFloat(newPropLat),
        longitude: parseFloat(newPropLng),
        price: parseFloat(newPropPrice) || 0,
        surface: parseFloat(newPropSurface) || 0,
        description: newPropDesc.trim(),
        imageUrl: normalizePropertyImageUrl(newPropImgUrl),
        projectId: activeProject
      };
      const response = await fetch("/api/properties", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        setNewPropName("");
        setNewPropAddress("");
        setNewPropLat("");
        setNewPropLng("");
        setNewPropPrice("");
        setNewPropSurface("");
        setNewPropDesc("");
        setNewPropImgUrl("");
        setShowNewPropertyModal(false);
        fetchAllData(activeProject);
      } else {
        const errorData = await response.json();
        alert(errorData.error || "L'enregistrement a échoué.");
      }
    } catch (err) {
      console.error(err);
      alert("Erreur de connexion au serveur.");
    } finally {
      setIsSavingProperty(false);
    }
  };

  const handleDeleteProperty = async (id: string) => {
    if (!token) return;
    if (!confirm("Voulez-vous vraiment supprimer ce bien de la carte ?")) return;
    try {
      const response = await fetch(`/api/properties/${id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (response.ok) {
        fetchAllData(activeProject);
      } else {
        alert("La suppression a échoué.");
      }
    } catch (err) {
      console.error(err);
      alert("Erreur de connexion au serveur.");
    }
  };

  // Trigger manual incremental reload/sync on backend and refresh UI
  const handleReload = async () => {
    if (!token || isReloading) return;
    setIsReloading(true);
    setUploadProgress({ status: 'uploading', message: "Recherche de nouveaux documents..." });
    try {
      const start = Date.now();
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { 
          "Authorization": `Bearer ${token}` 
        }
      });
      
      if (response.status === 401) {
        handleLogout();
        return;
      }
      
      await fetchAllData(activeProject);
      
      const elapsed = Date.now() - start;
      if (elapsed < 800) {
        await new Promise(resolve => setTimeout(resolve, 800 - elapsed));
      }

      if (response.ok) {
        setUploadProgress({ status: 'success', message: "Dossiers synchronisés avec succès." });
      } else {
        setUploadProgress({ status: 'failed', message: "La synchronisation a retourné une erreur." });
      }
    } catch (error) {
      console.error("Failed to reload data:", error);
      setUploadProgress({ status: 'failed', message: "Erreur lors du rechargement de l'API." });
    } finally {
      setIsReloading(false);
      setTimeout(() => setUploadProgress({ status: 'idle' }), 3000);
    }
  };

  // Update API Key
  const handleUpdateApiKey = async () => {
    if (!token) return;
    const newKey = window.prompt("Veuillez entrer votre nouvelle clé API Gemini :");
    if (!newKey || !newKey.trim()) return;

    try {
      setUploadProgress({ status: 'uploading', message: "Mise à jour de la clé API..." });
      const response = await fetch("/api/settings/apikey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ apiKey: newKey.trim() })
      });

      const data = await response.json();
      if (response.ok) {
        setUploadProgress({ status: 'success', message: "Clé API mise à jour avec succès !" });
        fetchAllData(activeProject);
      } else {
        setUploadProgress({ status: 'failed', message: data.error || "Échec de la mise à jour." });
      }
      setTimeout(() => setUploadProgress({ status: 'idle' }), 3000);
    } catch (error) {
      setUploadProgress({ status: 'failed', message: "Erreur de connexion au serveur." });
      setTimeout(() => setUploadProgress({ status: 'idle' }), 3000);
    }
  };

  // Load stats, docs, logs, messages, projects list, alerts, and server status
  const fetchAllData = async (projId = activeProject) => {
    if (!token) return;
    try {
      const headers = { "Authorization": `Bearer ${token}` };
      const [statsRes, docsRes, logsRes, chatRes, projectsRes, alertsRes, statusRes, propertiesRes] = await Promise.all([
        fetch(`/api/stats?projectId=${projId}`, { headers }),
        fetch(`/api/documents?projectId=${projId}`, { headers }),
        fetch(`/api/logs?projectId=${projId}`, { headers }),
        fetch(`/api/chat?projectId=${projId}`, { headers }),
        fetch("/api/projects", { headers }),
        fetch("/api/alerts", { headers }),
        fetch("/api/status", { headers }),
        fetch(`/api/properties?projectId=${projId}`, { headers }),
      ]);

      if (statsRes.status === 401 || docsRes.status === 401) {
        handleLogout();
        return;
      }

      if (statsRes.ok) setStats(await statsRes.json());
      if (docsRes.ok) setDocs(await docsRes.json());
      if (logsRes.ok) setLogs(await logsRes.json());
      if (chatRes.ok) setMessages(await chatRes.json());
      if (projectsRes.ok) setProjects(await projectsRes.json());
      if (alertsRes.ok) setDiagnosticAlerts(await alertsRes.json());
      if (propertiesRes.ok) {
        const raw = await propertiesRes.json();
        setProperties(
          raw.map((p: Record<string, unknown>) => ({
            id: String(p.id),
            tenantId: String(p.tenant_id ?? p.tenantId ?? ""),
            projectId: String(p.project_id ?? p.projectId ?? projId),
            name: String(p.name ?? ""),
            address: String(p.address ?? ""),
            latitude: Number(p.latitude),
            longitude: Number(p.longitude),
            price: Number(p.price ?? 0),
            surface: Number(p.surface ?? 0),
            description: String(p.description ?? ""),
            imageUrl: String(p.image_url ?? p.imageUrl ?? ""),
            createdAt: String(p.created_at ?? p.createdAt ?? ""),
          }))
        );
      }
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setServerMode(statusData.mode || "local");
      }
    } catch (error) {
      console.error("Failed to sync backend state:", error);
    }
  };

  // Poll for live watcher updates
  useEffect(() => {
    if (token) {
      fetchAllData(activeProject);
      fetchWidgetToken(activeProject);
      setWidgetLoaded(false);
      const interval = setInterval(() => fetchAllData(activeProject), 3000);
      return () => clearInterval(interval);
    }
  }, [activeProject, token]);

  // Scroll chat on change (only when messages length increases, project changes, or during asking state)
  const prevMessagesLength = useRef(messages.length);
  const prevActiveProject = useRef(activeProject);
  useEffect(() => {
    const projectChanged = activeProject !== prevActiveProject.current;
    if (messages.length > prevMessagesLength.current || projectChanged || isAsking) {
      if (chatEndRef.current) {
        chatEndRef.current.scrollIntoView({ behavior: "smooth" });
      }
    }
    prevMessagesLength.current = messages.length;
    prevActiveProject.current = activeProject;
  }, [messages.length, activeProject, isAsking]);

  // Login handler
  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!loginUsername.trim() || !loginPassword.trim() || isLoggingIn) return;

    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginUsername, password: loginPassword })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setUser(data.user);
        setToken(data.token);
        localStorage.setItem("associe_user", JSON.stringify(data.user));
        localStorage.setItem("associe_token", data.token);
        
        // Clear fields
        setLoginUsername("");
        setLoginPassword("");
      } else {
        setLoginError(data.error || "Identifiants incorrects.");
      }
    } catch (err) {
      console.error("Login failed:", err);
      setLoginError("Serveur de connexion inaccessible.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Handle Ask Submit
  const handleAsk = async (e: FormEvent) => {
    e.preventDefault();
    if ((!inputValue.trim() && !attachedImage) || isAsking || !token) return;

    const userQuery = inputValue;
    const base64Image = attachedImage;
    setInputValue("");
    setAttachedImage(null);
    setIsAsking(true);

    // Optimized Optimistic UI update before server response
    setMessages(prev => [
      ...prev,
      {
        id: `chat-temp-user-${Date.now()}`,
        projectId: activeProject,
        sender: "user",
        text: userQuery,
        image: base64Image || undefined,
        timestamp: new Date().toISOString()
      }
    ]);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ question: userQuery, projectId: activeProject, image: base64Image }),
      });
      
      if (response.status === 401) {
        handleLogout();
        return;
      }
      
      const data = await response.json();
      
      if (response.ok) {
        // Refresh chat messages logs
        const chatRes = await fetch(`/api/chat?projectId=${activeProject}`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (chatRes.ok) {
          setMessages(await chatRes.json());
        }
      } else {
        setMessages(prev => [
          ...prev,
          {
            id: `chat-temp-error-${Date.now()}`,
            projectId: activeProject,
            sender: "ai",
            text: `Error parsing query: ${data.error || "System error during retrieval."}`,
            timestamp: new Date().toISOString()
          }
        ]);
      }
    } catch (err) {
      console.error(err);
      setMessages(prev => [
        ...prev,
        {
          id: `chat-temp-error-${Date.now()}`,
          projectId: activeProject,
          sender: "ai",
          text: "Lost network connection to ASSOCIE.AI backend service.",
          timestamp: new Date().toISOString()
        }
      ]);
    } finally {
      setIsAsking(false);
      fetchAllData(activeProject);
    }
  };

  // Drag and drop handlers
  const handleDrag = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const files = Array.from(e.dataTransfer.files) as File[];
      uploadFilesToServer(files);
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const files = Array.from(e.target.files) as File[];
      uploadFilesToServer(files);
    }
  };

  // Process Web Scraping
  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scrapeUrl || !token) return;
    
    setIsScraping(true);
    setUploadProgress({ status: 'uploading', message: "Scraping de l'URL en cours..." });
    
    try {
      const response = await fetch("/api/import-web", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ url: scrapeUrl, projectId: activeProject })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setUploadProgress({ status: 'success', message: data.message || "Site importé avec succès." });
        setScrapeUrl(""); // clear input
        // Wait a bit for the watcher to pick it up, then refresh
        setTimeout(() => fetchAllData(activeProject), 2000);
      } else {
        setUploadProgress({ status: 'failed', message: data.error || "Erreur lors du scraping." });
      }
    } catch (error) {
      console.error("Scraping failed:", error);
      setUploadProgress({ status: 'failed', message: "Impossible de contacter le serveur pour le scraping." });
    } finally {
      setIsScraping(false);
      setTimeout(() => setUploadProgress({ status: 'idle' }), 5000);
    }
  };

  // Process files upload
  const uploadFilesToServer = async (files: File[]) => {
    if (!token) return;
    setUploadProgress({ status: 'uploading' });
    const formData = new FormData();
    files.forEach(file => {
      formData.append("files", file);
    });

    try {
      const response = await fetch(`/api/upload?projectId=${activeProject}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: formData,
      });
      
      if (response.status === 401) {
        handleLogout();
        return;
      }
      
      const result = await response.json();

      if (response.ok) {
        setUploadProgress({ 
          status: 'success', 
          message: `${files.length} fichier(s) téléversé(s) et indexé(s) dans la mémoire de contexte.` 
        });
        fetchAllData(activeProject);
        setTimeout(() => setUploadProgress({ status: 'idle' }), 5000);
      } else {
        setUploadProgress({ 
          status: 'failed', 
          message: result.error || "Impossible d'indexer les documents." 
        });
      }
    } catch (error) {
      setUploadProgress({ status: 'failed', message: "Délai d'attente Express Gateway dépassé." });
    }
  };

  // Delete document file
  const handleDeleteDoc = async (filename: string) => {
    if (!token) return;
    if (!confirm(`Voulez-vous vraiment supprimer et désindexer '${filename}' ?`)) return;

    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(filename)}?projectId=${activeProject}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      
      if (response.status === 401) {
        handleLogout();
        return;
      }
      
      if (response.ok) {
        fetchAllData(activeProject);
      } else {
        alert("La suppression a échoué sur le serveur.");
      }
    } catch (error) {
      console.error(error);
    }
  };

  // Download document file securely with auth headers
  const handleDownloadDoc = async (filename: string) => {
    if (!token) return;
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(filename)}/download?projectId=${activeProject}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      
      if (response.status === 401) {
        handleLogout();
        return;
      }
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      } else {
        alert("Échec du téléchargement du fichier.");
      }
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  // Force reindex
  const handleForceReindex = async () => {
    if (!token) return;
    if (!confirm("Cette opération va recalculer tous les index de mémoire du projet actuel. Continuer ?")) return;
    
    setUploadProgress({ status: 'uploading', message: "Réindexation des dossiers du Watcher..." });
    try {
      const response = await fetch(`/api/reindex?projectId=${activeProject}`, { 
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      
      if (response.status === 401) {
        handleLogout();
        return;
      }
      
      if (response.ok) {
        setUploadProgress({ status: 'success', message: "Tous les index de documents sont synchronisés." });
        fetchAllData(activeProject);
        setTimeout(() => setUploadProgress({ status: 'idle' }), 3000);
      } else {
        setUploadProgress({ status: 'failed', message: "La réindexation forcée a été annulée." });
      }
    } catch (error) {
      setUploadProgress({ status: 'failed', message: "Erreur de communication de l'API." });
    }
  };

  // Database Wipe — SECURED with double confirmation
  const handleWipeData = async (clearAll: boolean) => {
    if (!token) return;
    if (clearAll) {
      const first = confirm("⚠️ OPÉRATION CRITIQUE\n\nCette action va définitivement supprimer :\n• Tous les fichiers de TOUS vos projets\n• Tous les vecteurs et index\n• Tout l'historique du chat\n• Tous les logs d'activité\n\nVoulez-vous continuer ?");
      if (!first) return;
      const code = window.prompt("🔐 CONFIRMATION DE SÉCURITÉ\n\nPour confirmer la suppression totale, tapez exactement :\n\nSUPPRIMER");
      if (code !== "SUPPRIMER") {
        alert("❌ Opération annulée : le code de sécurité ne correspond pas.");
        return;
      }
    } else {
      if (!confirm("Êtes-vous sûr de vouloir effacer l'historique de chat pour ce projet ?")) return;
    }

    try {
      const response = await fetch("/api/memory", {
        method: "DELETE",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ clearAll, projectId: activeProject })
      });
      
      if (response.status === 401) {
        handleLogout();
        return;
      }
      
      if (response.ok) {
        if (clearAll) {
          setMessages([]);
          setActiveProject("default");
        } else {
          setMessages([]);
        }
        fetchAllData(clearAll ? "default" : activeProject);
        alert(clearAll ? "Réinitialisation complète terminée." : "Mémoire de discussion effacée.");
      }
    } catch (error) {
      console.error(error);
    }
  };

  // Create Project API Call
  const handleCreateProject = async (e: FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || isCreatingProject || !token) return;

    setIsCreatingProject(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ name: newProjectName }),
      });
      
      if (response.status === 401) {
        handleLogout();
        return;
      }
      
      const data = await response.json();

      if (response.ok) {
        setNewProjectName("");
        setShowNewProjectModal(false);
        setActiveProject(data.project.id);
        fetchAllData(data.project.id);
      } else {
        alert(data.error || "La création du projet a échoué.");
      }
    } catch (err) {
      console.error(err);
      alert("Erreur de connexion au serveur.");
    } finally {
      setIsCreatingProject(false);
    }
  };

  // Delete Project API Call
  const handleDeleteProject = async (projId: string) => {
    if (projId === "default" || !token) return;
    const project = projects.find(p => p.id === projId);
    if (!project) return;

    const first = confirm(`⚠️ DANGER : Suppression du projet "${project.name}"\n\nCette action va définitivement supprimer :\n• Le dossier physique sous company_docs/${projId}/\n• Tous les documents de ce projet\n• Tous ses vecteurs et index de mémoire\n• Tout l'historique des conversations de ce projet\n\nVoulez-vous continuer ?`);
    if (!first) return;

    const code = window.prompt("🔐 SÉCURITÉ\n\nPour confirmer la suppression définitive du projet, tapez exactement :\n\nSUPPRIMER");
    if (code !== "SUPPRIMER") {
      alert("❌ Suppression annulée.");
      return;
    }

    try {
      const response = await fetch(`/api/projects/${projId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      
      if (response.status === 401) {
        handleLogout();
        return;
      }
      
      const data = await response.json();

      if (response.ok) {
        setActiveProject("default");
        fetchAllData("default");
        alert("Projet supprimé avec succès.");
      } else {
        alert(data.error || "La suppression du projet a échoué.");
      }
    } catch (err) {
      console.error(err);
      alert("Erreur de connexion au serveur.");
    }
  };

  // Fetch existing widget token configuration
  const fetchWidgetToken = async (projId = activeProject) => {
    if (!token) return;
    try {
      const response = await fetch(`/api/widget/token?projectId=${projId}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setWidgetToken(data.token);
        setWidgetEmbedCode(data.embedCode);
        if (data.agentName) setWidgetAgentName(data.agentName);
        if (data.agentColor) setWidgetAgentColor(data.agentColor);
      }
    } catch (err) {
      console.error("Error fetching widget token:", err);
    } finally {
      setWidgetLoaded(true);
    }
  };

  // Generate widget token (updates customization if token exists)
  const handleGenerateWidgetToken = async () => {
    if (!token) return;
    setIsGeneratingWidget(true);
    try {
      const response = await fetch("/api/widget/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          projectId: activeProject,
          agentName: widgetAgentName,
          agentColor: widgetAgentColor
        })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setWidgetToken(data.token);
        setWidgetEmbedCode(data.embedCode);
        alert("Widget configuré et généré avec succès !");
      } else {
        alert(data.error || "Échec de génération du widget.");
      }
    } catch (err) {
      console.error(err);
      alert("Erreur de connexion au serveur.");
    } finally {
      setIsGeneratingWidget(false);
    }
  };

  // Revoke widget token
  const handleRevokeWidgetToken = async () => {
    if (!token) return;
    if (!confirm("⚠️ ATTENTION : Cela désactivera immédiatement le chat sur tous les sites utilisant ce widget. Continuer ?")) return;

    try {
      const response = await fetch(`/api/widget/token?projectId=${activeProject}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok) {
        setWidgetToken(null);
        setWidgetEmbedCode(null);
        alert(data.message || "Widget révoqué.");
      } else {
        alert(data.error || "Échec de la révocation.");
      }
    } catch (err) {
      console.error(err);
      alert("Erreur de connexion au serveur.");
    }
  };

  // Copy embed code to clipboard
  const handleCopyEmbedCode = () => {
    if (!widgetEmbedCode) return;
    navigator.clipboard.writeText(widgetEmbedCode);
    setWidgetCopied(true);
    setTimeout(() => setWidgetCopied(false), 2000);
  };

  // Context formatting
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDate = (mtime: number) => {
    return new Date(mtime).toLocaleString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      day: "2-digit",
      month: "2-digit"
    });
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-[#050507] text-[#F3F4F6] font-sans flex items-center justify-center p-4 relative overflow-hidden antialiased select-none">
        {/* Soft background glows */}
        <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-white/[0.01] rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-white/[0.02] rounded-full blur-[120px] pointer-events-none" />
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-md bg-[#0C0C0E]/80 backdrop-blur-xl border border-white/10 rounded-3xl p-8 flex flex-col gap-6 shadow-2xl relative z-10"
        >
          {/* Logo / Header */}
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center p-3.5 shadow-xl">
              <span className="text-black font-extrabold text-xl tracking-widest font-mono">A.I</span>
            </div>
            <div className="mt-2">
              <h1 className="text-2xl font-bold tracking-tight text-white font-mono uppercase">ASSOCIE.AI</h1>
              <p className="text-xs text-white/40 mt-1 uppercase font-semibold tracking-wider font-mono">
                Portail RAG Multi-Tenant
              </p>
            </div>
          </div>
          
          {/* Form */}
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-mono uppercase text-white/40 tracking-wider">Identifiant</label>
              <input 
                type="text" 
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="Ex : hassan"
                className="bg-white/[0.02] hover:bg-white/[0.04] border border-white/10 focus:border-white/20 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 outline-none transition duration-150"
                required
                autoFocus
              />
            </div>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-mono uppercase text-white/40 tracking-wider">Mot de passe</label>
              <input 
                type="password" 
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Saisissez votre mot de passe"
                className="bg-white/[0.02] hover:bg-white/[0.04] border border-white/10 focus:border-white/20 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 outline-none transition duration-150"
                required
              />
            </div>

            {loginError && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl flex items-center gap-2"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{loginError}</span>
              </motion.div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="mt-2 w-full py-3.5 rounded-xl bg-white text-black hover:bg-slate-200 disabled:bg-white/40 disabled:cursor-not-allowed font-bold text-xs uppercase tracking-wider transition duration-200 flex items-center justify-center gap-2 shadow-lg shadow-white/5"
            >
              {isLoggingIn ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Connexion en cours...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Se connecter</span>
                </>
              )}
            </button>
          </form>
          
          {/* Footer specifications */}
          <div className="text-center text-[10px] text-white/20 font-mono border-t border-white/5 pt-4">
            ASSOCIE.AI Engine v2.0 • Premium Real Estate RAG
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F3F4F6] font-sans flex flex-col antialiased selection:bg-white selection:text-black">
      
      {/* Premium Header Bar */}
      <header className="border-b border-white/5 bg-[#0f0f11]/80 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-[100] gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center p-2.5">
            <span className="text-black font-extrabold text-base tracking-widest font-mono">A.I</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg tracking-tight text-white uppercase font-mono">ASSOCIE.AI Agent</span>
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 font-mono border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1.5 uppercase font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Watcher Live
              </span>
            </div>
            <p className="text-xs text-white/40">
              Agence : <span className="text-white font-semibold">{user?.tenantName || "Hassan Luxury Real Estate"}</span> • Dossier : <span className="text-white font-semibold">{projects.find(p => p.id === activeProject)?.name || "Dossier Général"}</span>
            </p>
          </div>
        </div>

        {/* Global Stats Badge */}
        <div className="flex items-center gap-4 text-xs font-mono max-xl:hidden">
          <div className="flex flex-col items-end">
            <span className="text-white/30 text-[10px] uppercase">Synced Documents</span>
            <span className="text-white font-semibold flex items-center gap-1">
              <FileCheck className="w-3.5 h-3.5 text-white/50" />
              {stats.totalDocs} files
            </span>
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex flex-col items-end">
            <span className="text-white/30 text-[10px] uppercase">Memory Vectors</span>
            <span className="text-white font-semibold flex items-center gap-1">
              <Database className="w-3.5 h-3.5 text-white/50" />
              {stats.totalChunks} chunks
            </span>
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex flex-col items-end">
            <span className="text-white/30 text-[10px] uppercase">Engine Sync API</span>
            <span className={stats.geminiActive ? "text-emerald-400 font-semibold" : "text-amber-400"}>
              {stats.geminiActive ? "Gemini Active ✓" : "Local Preview"}
            </span>
          </div>
        </div>

        {/* Actions container always visible */}
        <div className="flex items-center gap-2">
          {/* Change API Key Button */}
          <button
            onClick={handleUpdateApiKey}
            title="Mettre à jour la clé API Gemini"
            className="px-3 py-2 border border-amber-500/20 text-amber-400 hover:text-white bg-amber-500/10 hover:bg-amber-500/20 rounded-xl transition flex items-center gap-1.5 text-xs font-mono uppercase font-semibold"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span className="max-sm:hidden">Clé API</span>
          </button>

          {/* Reload API Button */}
          <button
            onClick={handleReload}
            disabled={isReloading}
            title="Recharger les données de l'API (recherche de nouveaux fichiers)"
            className={`px-3 py-2 border rounded-xl transition flex items-center gap-1.5 text-xs font-mono uppercase font-medium ${
              isReloading 
                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20 cursor-wait" 
                : "text-white/60 hover:text-white bg-white/5 border-white/10"
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReloading ? "animate-spin text-emerald-400" : ""}`} />
            <span className="max-sm:hidden">{isReloading ? "Rechargement..." : "Recharger"}</span>
          </button>

          {/* Logout button */}
          <button
            onClick={handleLogout}
            title="Se déconnecter de votre session"
            className="px-3 py-2 text-rose-400 hover:text-white bg-rose-500/10 border border-rose-500/20 hover:bg-rose-600 rounded-xl transition flex items-center gap-1.5 text-xs font-mono uppercase font-semibold"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span className="max-sm:hidden">Déconnexion</span>
          </button>
        </div>
      </header>

      {/* Main Structural Area */}
      <div className="flex-1 flex max-md:flex-col">

        {/* Left Side Applet Navigator */}
        <aside className="w-64 max-md:w-full border-r max-md:border-r-0 max-md:border-b border-white/5 bg-[#0C0C0E] p-4 flex flex-col gap-1 shrink-0">
          
          {/* Project Selector Section */}
          <div className="flex flex-col gap-2 px-3 py-2 mb-4 border-b border-white/5 pb-4">
            <div className="text-[10px] font-mono tracking-widest font-bold uppercase text-white/30 flex items-center justify-between">
              <span>Projet Actif</span>
              <button 
                onClick={() => setShowNewProjectModal(true)}
                className="text-white/40 hover:text-white hover:bg-white/5 p-1 rounded transition"
                title="Créer un nouveau projet"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex gap-1.5 items-center">
              <select
                value={activeProject}
                onChange={(e) => setActiveProject(e.target.value)}
                className="flex-1 bg-white/[0.03] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none cursor-pointer hover:border-white/20 transition font-medium"
              >
                {projects.map((proj) => (
                  <option key={proj.id} value={proj.id} className="bg-[#0C0C0E] text-white">
                    {proj.name} ({proj.docsCount || 0} doc{proj.docsCount !== 1 ? 's' : ''})
                  </option>
                ))}
              </select>

              <button
                onClick={handleReload}
                disabled={isReloading}
                title="Recharger l'API (recherche de nouveaux fichiers)"
                className={`p-1.5 border rounded-lg transition shrink-0 ${
                  isReloading 
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 cursor-wait" 
                    : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isReloading ? "animate-spin text-emerald-400" : ""}`} />
              </button>
              
              {activeProject !== "default" && (
                <button
                  onClick={() => handleDeleteProject(activeProject)}
                  className="p-1.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white rounded-lg transition shrink-0"
                  title="Supprimer ce projet"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="text-[10px] font-mono tracking-widest font-bold uppercase text-white/30 px-3 py-2 mb-2">
            Navigation Rails
          </div>

          <button 
            onClick={() => setActiveTab("home")}
            className={`w-full text-left px-3.5 py-3 rounded-lg flex items-center gap-3 text-sm font-medium transition duration-200 group ${
              activeTab === "home" 
                ? "bg-white text-black" 
                : "text-white/60 hover:bg-white/5 hover:text-white"
            }`}
          >
            <BarChart3 className="w-4 h-4 shrink-0" />
            <span>Dashboard Overview</span>
            <ChevronRight className={`w-3.5 h-3.5 ml-auto opacity-0 group-hover:opacity-100 transition ${activeTab === "home" ? "text-black" : "text-white/40"}`} />
          </button>

          <button 
            onClick={() => setActiveTab("chat")}
            className={`w-full text-left px-3.5 py-3 rounded-lg flex items-center gap-3 text-sm font-medium transition duration-200 group ${
              activeTab === "chat" 
                ? "bg-white text-black" 
                : "text-white/60 hover:bg-white/5 hover:text-white"
            }`}
          >
            <MessageSquare className="w-4 h-4 shrink-0" />
            <span>Smart AI Chat</span>
            {messages.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md ml-2 font-mono ${
                activeTab === "chat" ? "bg-black/15 text-black" : "bg-white/10 text-white"
              }`}>
                {messages.filter(m => m.sender === 'user').length}
              </span>
            )}
            <ChevronRight className={`w-3.5 h-3.5 ml-auto opacity-0 group-hover:opacity-100 transition ${activeTab === "chat" ? "text-black" : "text-white/40"}`} />
          </button>

          <button 
            onClick={() => setActiveTab("docs")}
            className={`w-full text-left px-3.5 py-3 rounded-lg flex items-center gap-3 text-sm font-medium transition duration-200 group ${
              activeTab === "docs" 
                ? "bg-white text-black" 
                : "text-white/60 hover:bg-white/5 hover:text-white"
            }`}
          >
            <FileText className="w-4 h-4 shrink-0" />
            <span>Documents Manager</span>
            <ChevronRight className={`w-3.5 h-3.5 ml-auto opacity-0 group-hover:opacity-100 transition ${activeTab === "docs" ? "text-black" : "text-white/40"}`} />
          </button>

          <button 
            onClick={() => setActiveTab("logs")}
            className={`w-full text-left px-3.5 py-3 rounded-lg flex items-center gap-3 text-sm font-medium transition duration-200 group ${
              activeTab === "logs" 
                ? "bg-white text-black" 
                : "text-white/60 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Activity className="w-4 h-4 shrink-0" />
            <span>Logs Monitor</span>
            <ChevronRight className={`w-3.5 h-3.5 ml-auto opacity-0 group-hover:opacity-100 transition ${activeTab === "logs" ? "text-black" : "text-white/40"}`} />
          </button>

          <button 
            onClick={() => setActiveTab("map")}
            className={`w-full text-left px-3.5 py-3 rounded-lg flex items-center gap-3 text-sm font-medium transition duration-200 group ${
              activeTab === "map" 
                ? "bg-white text-black" 
                : "text-white/60 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Map className="w-4 h-4 shrink-0" />
            <span>Carte Interactive</span>
            {properties.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md ml-2 font-mono ${
                activeTab === "map" ? "bg-black/15 text-black" : "bg-white/10 text-white"
              }`}>
                {properties.length}
              </span>
            )}
            <ChevronRight className={`w-3.5 h-3.5 ml-auto opacity-0 group-hover:opacity-100 transition ${activeTab === "map" ? "text-black" : "text-white/40"}`} />
          </button>

          <button 
            onClick={() => setActiveTab("admin")}
            className={`w-full text-left px-3.5 py-3 rounded-lg flex items-center gap-3 text-sm font-medium transition duration-200 group ${
              activeTab === "admin" 
                ? "bg-white text-black" 
                : "text-white/60 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Settings2 className="w-4 h-4 shrink-0" />
            <span>Admin Controls</span>
            <ChevronRight className={`w-3.5 h-3.5 ml-auto opacity-0 group-hover:opacity-100 transition ${activeTab === "admin" ? "text-black" : "text-white/40"}`} />
          </button>

          {/* Quick Support Badge */}
          <div className="mt-auto pt-6 border-t border-white/5 p-3 hidden md:block">
            <div className="rounded-xl bg-white/[0.02] border border-white/5 p-3 text-xs flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-white/70 font-semibold font-mono uppercase text-[10px]">
                <Sparkles className="w-3.5 h-3.5 text-white" />
                Folder Watcher
              </div>
              <p className="text-[11px] text-white/40 leading-relaxed">
                Add, modify or delete documents inside <code className="text-white font-mono bg-white/5 px-1 py-0.5 rounded text-[9px] break-all">company_docs/</code>. Watcher updates live vector similarity search context!
              </p>
            </div>
          </div>
        </aside>

        {/* Dynamic Display Area */}
        <main className="flex-1 bg-[#09090C] p-6 md:p-8 flex flex-col gap-6 overflow-x-hidden">
          
          {/* Notification Progress Overlay */}
          {uploadProgress.status !== 'idle' && (
            <div className={`p-4 rounded-xl border flex items-center gap-3 animate-fade-in ${
              uploadProgress.status === 'uploading' 
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' 
                : uploadProgress.status === 'success'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}>
              <RefreshCw className={`w-4 h-4 shrink-0 ${uploadProgress.status === 'uploading' ? 'animate-spin' : ''}`} />
              <div className="text-xs">
                <span className="font-bold underline uppercase mr-1">{uploadProgress.status}:</span>
                {uploadProgress.message || "File watch sync in progress..."}
              </div>
            </div>
          )}

          {/* Tab 1: Home Dashboard */}
          {activeTab === "home" && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-6"
            >
              {/* Cover card header */}
              <div className="glass-panel rounded-2xl p-6 md:p-8 border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden">
                <div className="absolute right-0 top-0 -mr-16 -mt-16 w-64 h-64 bg-radial from-white/[0.03] to-transparent pointer-events-none rounded-full" />
                
                <div className="flex flex-col gap-2 max-w-xl">
                  <span className="text-[10px] font-mono uppercase bg-white/10 text-white/80 px-2.5 py-1 rounded-full w-max flex items-center gap-1.5 font-bold">
                    <Briefcase className="w-3 h-3" /> ASSOCIE.AI Core Console
                  </span>
                  <h1 className="text-3xl font-extrabold tracking-tight text-white mt-2 font-mono">
                    Real estate & Enterprise Assistant
                  </h1>
                  <p className="text-sm text-white/50 leading-relaxed mt-1">
                    This intelligent multi-document assistant automatically parses, chunks, and indexes all business PDFs, xlsx, docx, txt and CSV documents mapped in your storage directory.
                  </p>
                </div>

                <button 
                  onClick={() => setActiveTab("chat")}
                  className="px-5 py-3 rounded-lg bg-white text-black font-semibold text-sm hover:bg-slate-200 transition duration-200 shadow-md shadow-white/5 shrink-0 flex items-center gap-2"
                >
                  <MessageSquare className="w-4 h-4" />
                  Ask My Fles
                </button>
              </div>

              {/* Grid System Stat Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="glass-card rounded-xl p-5 border border-white/5 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 text-white leading-none">
                    <FileText className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <span className="text-white/40 text-xs font-mono uppercase block">Active Documents</span>
                    <span className="text-2xl font-bold font-mono text-white leading-tight">{stats.totalDocs} files</span>
                  </div>
                </div>

                <div className="glass-card rounded-xl p-5 border border-white/5 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 text-white leading-none">
                    <Database className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <span className="text-white/40 text-xs font-mono uppercase block">Vector Dimensions</span>
                    <span className="text-2xl font-bold font-mono text-white leading-tight">{stats.totalChunks} chunks</span>
                  </div>
                </div>

                <div className="glass-card rounded-xl p-5 border border-white/5 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 text-white leading-none">
                    <Clock className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <span className="text-white/40 text-xs font-mono uppercase block">Last Folder Sync</span>
                    <span className="text-sm font-semibold font-mono text-white/80 leading-tight block truncate max-w-[200px]">
                      {stats.lastSync ? formatDate(new Date(stats.lastSync).getTime()) : "Never"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Secondary Layout Columns */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                
                {/* Visualizer and Walkthrough steps */}
                <div className="glass-panel rounded-xl p-6 border border-white/5 flex flex-col gap-4">
                  <h3 className="text-md font-bold tracking-tight text-white flex items-center gap-2 border-b border-white/5 pb-3">
                    <HelpCircle className="w-4 h-4 text-white/75" />
                    How It Learns Live
                  </h3>

                  <div className="flex flex-col gap-4 text-xs font-mono">
                    <div className="flex gap-3">
                      <div className="w-6 h-6 rounded bg-white/5 text-white/80 flex items-center justify-center shrink-0 border border-white/10">1</div>
                      <div>
                        <div className="text-white font-semibold mb-1">Watcher Directory Monitoring</div>
                        <p className="text-white/40">The background thread scans the local directory <code className="bg-white/5 text-white px-1 rounded">company_docs/</code>. When you add/update/delete any file, it immediately intercepts the changes.</p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="w-6 h-6 rounded bg-white/5 text-white/80 flex items-center justify-center shrink-0 border border-white/10">2</div>
                      <div>
                        <div className="text-white font-semibold mb-1">Multimodal Parsing & Chunking</div>
                        <p className="text-white/40">Parsed PDFs, Excel columns, DOCX formats and plan texts are cleaned, split into 800-character segments with 150-char overlap to protect context boundaries.</p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="w-6 h-6 rounded bg-white/5 text-white/80 flex items-center justify-center shrink-0 border border-white/10">3</div>
                      <div>
                        <div className="text-white font-semibold mb-1">Vector Storage Embedding</div>
                        <p className="text-white/40">Saves mathematical coordinate files with cosine mapping. No third-party network vector indices are used, everything persists securely in the cloud sandbox environment!</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Directory Preview and Quick Upload shortcut */}
                <div className="glass-panel rounded-xl p-6 border border-white/5 flex flex-col gap-4">
                  <div className="flex items-center justify-between border-b border-white/5 pb-3">
                    <h3 className="text-md font-bold tracking-tight text-white flex items-center gap-2">
                      <FileCheck className="w-4 h-4 text-white/75" />
                      Wacthed Catalog Preview
                    </h3>
                    <button 
                      onClick={() => setActiveTab("docs")}
                      className="text-[11px] text-white hover:underline uppercase font-semibold font-mono"
                    >
                      Manage
                    </button>
                  </div>

                  <div className="flex-1 flex flex-col gap-3">
                    {docs.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center py-6 text-center text-white/30 text-xs">
                        <AlertTriangle className="w-6 h-6 mb-2 stroke-1" />
                        No watched files detected.<br />Upload first files under "Documents Manager".
                      </div>
                    ) : (
                      docs.slice(0, 4).map((d, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/5 text-xs">
                          <div className="flex items-center gap-2 overflow-hidden mr-4">
                            <div className="w-2 h-2 rounded-full bg-emerald-400" />
                            <span className="font-mono font-medium truncate text-white/80">{d.name}</span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 font-mono text-[11px] text-white/40">
                            <span>{formatBytes(d.size)}</span>
                            <span>•</span>
                            <span>{d.chunksCount} chunks</span>
                          </div>
                        </div>
                      ))
                    )}
                    {docs.length > 4 && (
                      <div className="text-center text-[10px] text-white/40 font-mono">
                        + {docs.length - 4} more files indexed. Run full list inside manager.
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </motion.div>
          )}

          {/* Tab 2: AI Chat Hub */}
          {activeTab === "chat" && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex gap-6 overflow-hidden max-xl:flex-col h-[calc(100vh-140px)]"
            >
              
              {/* Chat thread columns */}
              <div className="flex-1 flex flex-col bg-white/[0.01] border border-white/5 rounded-2xl overflow-hidden h-full">
                
                {/* Chat Top Banner */}
                <div className="border-b border-white/5 bg-[#0A0A0C] px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-white" />
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-white">Interactive Advisor</h4>
                      <p className="text-[10px] text-white/40 font-mono">Uses system context memory matching</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleWipeData(false)}
                    className="text-[10px] bg-white/5 text-white hover:bg-white/10 px-2.5 py-1 rounded-md border border-white/5 uppercase font-mono font-bold font-semibold transition"
                  >
                    Clear History
                  </button>
                </div>

                {/* Chat messages Area */}
                <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5 bg-gradient-to-b from-transparent to-black/[0.15]">
                  {messages.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto text-center py-12">
                      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center border border-white/10 mb-4 animate-bounce">
                        <Sparkles className="w-5 h-5 text-white" />
                      </div>
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">Enterprise Conversational Intelligence</h3>
                      <p className="text-xs text-white/40 mt-1 leading-relaxed">
                        Input pricing, contracts or policies questions. The system computes similarity matrices and parses matching passages back to Gemini to craft high fidelity responses.
                      </p>

                      <div className="grid grid-cols-1 gap-2 mt-6 w-full text-xs">
                        <button 
                          onClick={() => setInputValue("Quelles sont les villas disponibles et quels sont leurs prix de vente ?")}
                          className="text-left p-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-white/75 hover:text-white transition group flex items-center gap-2 font-mono"
                        >
                          <CornerDownRight className="w-3.5 h-3.5 text-white/40 group-hover:text-white" />
                          <span>Disponibilité et prix des villas</span>
                        </button>
                        <button 
                          onClick={() => setInputValue("Quelle est notre politique RH concernant le télétravail et les lundis ?")}
                          className="text-left p-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-white/75 hover:text-white transition group flex items-center gap-2 font-mono"
                        >
                          <CornerDownRight className="w-3.5 h-3.5 text-white/40 group-hover:text-white" />
                          <span>Politique RH et Télétravail</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    messages.map((m, idx) => (
                      <div key={idx} className={`flex flex-col max-w-[85%] ${m.sender === "user" ? "ml-auto items-end" : "mr-auto items-start"}`}>
                        <div className="flex items-center gap-2 mb-1 text-[10px] text-white/40 font-mono">
                          <span>{m.sender === "user" ? "You" : "ASSOCIE.AI Agent"}</span>
                          <span>•</span>
                          <span>{formatDate(new Date(m.timestamp).getTime())}</span>
                        </div>

                        <div className={`p-4 rounded-2xl text-xs leading-relaxed border ${
                          m.sender === "user" 
                            ? "bg-white text-black font-medium border-white/10 rounded-tr-none shadow-md"
                            : "bg-[#141416]/90 text-white/90 border-white/5 rounded-tl-none whitespace-pre-wrap"
                        }`}>
                          {m.image && (
                            <div className="mb-2 max-w-[200px] overflow-hidden rounded-lg border border-black/10">
                              <img src={m.image} alt="Visual attachments" className="w-full h-auto object-cover max-h-36" />
                            </div>
                          )}
                          {m.text}
                        </div>

                        {/* Document Citations Badge list */}
                        {m.sources && m.sources.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5 items-center justify-start">
                            <span className="text-[9px] font-mono uppercase text-white/30 mr-1 flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3 text-emerald-400" /> Grounded sources:
                            </span>
                            {m.sources.map((src, sIdx) => (
                              <button
                                key={sIdx}
                                onClick={() => setSelectedSources(m.sources || null)}
                                className="text-[9px] font-mono bg-white/5 hover:bg-white/15 text-white/60 hover:text-white px-2 py-0.5 rounded border border-white/5 transition flex items-center gap-1.5"
                              >
                                <FileText className="w-2.5 h-2.5 text-white/55" />
                                <span>{src.filename}</span>
                                <span className="text-emerald-400 font-bold">{(src.score * 100).toFixed(0)}% Match</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}

                  {/* Typing Indicator */}
                  {isAsking && (
                    <div className="flex flex-col max-w-[85%] mr-auto items-start">
                      <div className="flex items-center gap-2 mb-1 text-[10px] text-white/40 font-mono">
                        <span>ASSOCIE.AI Agent</span>
                        <span>•</span>
                        <span>generating answer...</span>
                      </div>
                      <div className="p-4 rounded-xl bg-[#141416]/90 border border-white/5 rounded-tl-none flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce" />
                        <span className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce [animation-delay:0.2s]" />
                        <span className="w-1.5 h-1.5 bg-[#4c1d95] rounded-full animate-bounce [animation-delay:0.4s]" />
                      </div>
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </div>

                {/* Chat Input Box */}
                <form onSubmit={handleAsk} className="border-t border-white/5 p-4 bg-[#0A0A0C] flex flex-col gap-3">
                  {attachedImage && (
                    <div className="flex items-center gap-2 bg-white/5 border border-white/10 p-2 rounded-xl w-max animate-fade-in">
                      <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-white/10">
                        <img src={attachedImage} alt="Attachment preview" className="w-full h-full object-cover" />
                        <button 
                          type="button"
                          onClick={() => setAttachedImage(null)}
                          className="absolute inset-0 bg-black/50 hover:bg-black/75 flex items-center justify-center text-white text-xs font-semibold transition"
                          title="Supprimer l'image"
                        >
                          ✕
                        </button>
                      </div>
                      <span className="text-[10px] text-white/40 font-mono">Image attachée</span>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <input 
                      type="file"
                      accept="image/*"
                      ref={imageInputRef}
                      onChange={handleImageSelect}
                      className="hidden"
                    />

                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      className="px-3.5 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition flex items-center justify-center shrink-0"
                      title="Attacher une image"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>

                    <input 
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      placeholder="Posez une question ou attachez une image..."
                      className="flex-1 glass-input px-4 py-3 rounded-xl text-xs placeholder:text-white/30"
                    />
                    <button
                      type="submit"
                      disabled={(!inputValue.trim() && !attachedImage) || isAsking}
                      className="px-5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-slate-200 transition duration-200 flex items-center justify-center gap-2 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Send</span>
                    </button>
                  </div>
                </form>

              </div>

              {/* Collateral References & Citation Inspector sidebar */}
              <div className="w-80 max-xl:w-full shrink-0 flex flex-col h-full gap-4">
                
                {/* Selection Inspector */}
                <div className="flex-1 glass-panel border border-white/5 rounded-2xl p-4 flex flex-col h-full overflow-hidden">
                  <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      Memory Inspector
                    </h4>
                    {selectedSources && (
                      <button 
                        onClick={() => setSelectedSources(null)}
                        className="text-[9px] text-[#ef4444] hover:underline uppercase font-mono font-bold"
                      >
                        Reset Inspect
                      </button>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto flex flex-col gap-3.5 pr-1">
                    {!selectedSources ? (
                      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-white/30 text-xs">
                        <Terminal className="w-6 h-6 mb-2 stroke-1" />
                        Awaiting citation inspection.<br />Click on source badges in chat bubbles to inspect matching context passages.
                      </div>
                    ) : (
                      selectedSources.map((s, idx) => (
                        <div key={idx} className="p-3.5 rounded-lg bg-white/[0.02] border border-white/5 flex flex-col gap-2 animate-fade-in text-[11px] leading-relaxed">
                          <div className="flex items-center justify-between border-b border-white/5 pb-1 w-full text-[10px] font-mono">
                            <span className="font-bold text-white/80 shrink truncate mr-2">{s.filename}</span>
                            <span className="text-emerald-400 shrink-0 uppercase font-extrabold text-[9px] font-bold">{(s.score * 100).toFixed(1)}% match</span>
                          </div>
                          
                          <p className="text-white/40 italic break-words">
                            "{s.text}"
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Grounding Model Details */}
                <div className="glass-panel border border-white/5 rounded-2xl p-4 text-xs font-mono">
                  <div className="flex items-center gap-2 border-b border-white/5 pb-2 mb-2 uppercase text-[10px] font-bold text-white/50">
                    <Database className="w-3.5 h-3.5 text-white/70" />
                    RAG Knowledge Stats
                  </div>
                  <div className="flex flex-col gap-1.5 text-white/40 text-[10px]">
                    <div className="flex justify-between"><span>Indexing Model:</span><span className="text-white">gemini-embedding-2</span></div>
                    <div className="flex justify-between"><span>Answering Model:</span><span className="text-white">gemini-3.5-flash</span></div>
                    <div className="flex justify-between"><span>Similarity Metric:</span><span className="text-white">Cosine similarity</span></div>
                  </div>
                </div>

              </div>
            </motion.div>
          )}

          {/* Tab 3: Documents Directory Manager */}
          {activeTab === "docs" && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-6"
            >
              
              {/* Header section */}
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white uppercase font-mono">Documents Directory Manager</h2>
                <p className="text-xs text-white/40 capitalize leading-relaxed">
                  Upload PDF, DOCX, XLSX, TXT, CSV files to place them in the watches directory. Watcher will index them synchronously.
                </p>
              </div>

              {/* Web Scraper Widget */}
              <div className="glass-panel rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <h3 className="text-xs font-bold tracking-wider text-emerald-400 uppercase font-mono flex items-center gap-2">
                      <Globe className="w-4 h-4" /> Web Scraper Import
                    </h3>
                    <p className="text-[10px] text-white/40 font-mono mt-1">Extraire le texte d'un site web et l'ajouter à la base de connaissance (Format Markdown).</p>
                  </div>
                </div>
                
                <form onSubmit={handleScrape} className="flex gap-3">
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                      <Link className="w-4 h-4 text-white/30" />
                    </div>
                    <input 
                      type="url"
                      value={scrapeUrl}
                      onChange={(e) => setScrapeUrl(e.target.value)}
                      placeholder="https://example.com/pricing"
                      className="w-full bg-white/[0.03] border border-white/10 rounded-xl py-3 pl-10 pr-4 text-xs text-white placeholder:text-white/30 outline-none focus:border-emerald-500/50 transition"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isScraping || !scrapeUrl}
                    className="px-5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 text-xs font-bold font-mono uppercase transition flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                  >
                    {isScraping ? (
                      <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Scraping...</>
                    ) : (
                      <><Download className="w-3.5 h-3.5" /> Scraper & Enregistrer</>
                    )}
                  </button>
                </form>
              </div>

              {/* Upload Dropzone Widget */}
              <div 
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition duration-300 ${
                  dragActive 
                    ? 'border-white bg-white/5 text-white' 
                    : 'border-white/10 hover:border-white/20 bg-white/[0.01]/80 hover:bg-white/[0.02]/80 text-white/60'
                }`}
              >
                <input 
                  type="file"
                  multiple
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                  accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.json"
                />
                
                <Upload className="w-10 h-10 mb-4 text-white/60 animate-pulse stroke-1" />
                <h3 className="text-sm font-bold text-white uppercase font-mono mb-1">Drag and Drop Files Here</h3>
                <p className="text-xs text-white/40 max-w-sm mb-4 leading-relaxed">
                  Or click anywhere to trigger local explorer. Supports PDF, spreadsheet CSV/XLS, text, and docx up to 10MB.
                </p>
                <span className="text-[10px] font-mono bg-white/5 text-white px-2.5 py-1 rounded-md border border-white/5 font-semibold">
                  CHOOSE DOCUMENTS
                </span>
              </div>

              {/* Active directory catalog with dynamic checkboxes */}
              <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
                <div className="border-b border-white/5 bg-[#0B0B0D] px-5 py-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">enterprise database document list</h3>
                    <p className="text-[10px] text-white/40 font-mono">Current real files located in <code className="bg-white/5 text-white/80 px-1 rounded text-[9px]">/company_docs</code></p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={handleForceReindex}
                      className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-[10px] font-mono font-bold uppercase flex items-center gap-1.5 text-white font-semibold transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Force Reindex
                    </button>
                    <button 
                      onClick={() => handleWipeData(true)}
                      className="px-3 py-1.5 rounded-lg bg-[#ef4444]/10 hover:bg-[#ef4444]/20 border border-[#ef4444]/20 text-[10px] font-mono font-bold uppercase flex items-center gap-1.5 text-[#ef4444] font-semibold transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Wipe All Files
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-white/5 bg-white/[0.01]/40 text-white/40 uppercase font-mono text-[10px] tracking-widest">
                        <th className="px-5 py-3">Document Name</th>
                        <th className="px-5 py-3">File Size</th>
                        <th className="px-5 py-3 text-center">Status</th>
                        <th className="px-5 py-3 text-center">Vectors Generated</th>
                        <th className="px-5 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {docs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-5 py-12 text-center text-white/30">
                            <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-white/20 stroke-1" />
                            No documents in catalog directory yet.
                          </td>
                        </tr>
                      ) : (
                        docs.map((d, index) => (
                          <tr key={index} className="hover:bg-white/[0.01]/40 transition duration-150">
                            <td className="px-5 py-4 font-mono font-medium text-white flex items-center gap-2.5 overflow-hidden max-w-sm">
                              <div className={`w-2 h-2 rounded-full shrink-0 ${
                                d.status === 'indexed' ? 'bg-emerald-400' : d.status === 'processing' ? 'bg-amber-400 animate-ping' : 'bg-rose-500'
                              }`} />
                              <span className="truncate">{d.name}</span>
                            </td>
                            <td className="px-5 py-4 font-mono text-white/50">{formatBytes(d.size)}</td>
                            <td className="px-5 py-4 text-center">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wider font-mono font-semibold ${
                                d.status === 'indexed' 
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                  : d.status === 'processing'
                                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                              }`}>
                                {d.status === 'indexed' ? 'Success' : d.status === 'processing' ? 'Indexing...' : 'Failed'}
                              </span>
                            </td>
                            <td className="px-5 py-4 text-center font-mono font-semibold text-white/80">{d.chunksCount} chunks</td>
                            <td className="px-5 py-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button 
                                  onClick={() => handleDownloadDoc(d.name)}
                                  className="p-2 text-white/40 hover:text-white transition-colors rounded-lg bg-white/5 hover:bg-white/10 border border-white/5"
                                  title="Download file"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                                <button 
                                  onClick={() => handleDeleteDoc(d.name)}
                                  className="p-2 text-white/40 hover:text-[#ef4444] transition-colors rounded-lg bg-white/5 hover:bg-white/10 border border-white/5"
                                  title="Unindex & delete file physically"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

              </div>

            </motion.div>
          )}

          {/* Tab 4: Logs Syncing Monitor */}
          {activeTab === "logs" && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-6"
            >
              
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white uppercase font-mono">File Watcher system logs</h2>
                <p className="text-xs text-white/40 leading-relaxed capitalize">
                  Full real-time system synchronization monitor. Track folder change callbacks, chunk boundaries, errors, and embeddings latency.
                </p>
              </div>

              {/* Logs visualizer layout terminal-like */}
              <div className="glass-panel border border-white/5 rounded-2xl overflow-hidden flex flex-col">
                <div className="border-b border-white/5 bg-[#0A0A0C] px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs uppercase font-mono font-bold text-white/70">
                    <Terminal className="w-4 h-4 text-white/50" />
                    Sync Operations Console
                  </div>
                  <span className="text-[10px] font-mono text-white/30 flex items-center gap-1">
                    <CircleAlert className="w-3 h-3 text-emerald-400" /> Auto-Refreshing logs every 3 seconds
                  </span>
                </div>

                <div className="bg-[#040405] p-5 font-mono text-[11px] leading-relaxed max-h-[500px] overflow-y-auto flex flex-col gap-2.5">
                  {logs.length === 0 ? (
                    <div className="text-center py-12 text-white/30">
                      No logs mapped. Start adding files to generate event histories.
                    </div>
                  ) : (
                    logs.map((log, index) => (
                      <div key={index} className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-white/[0.02] pb-2 text-white/80">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[9px] text-white/30 font-bold bg-white/5 px-1.5 py-0.5 rounded uppercase">
                            {formatDate(new Date(log.timestamp).getTime())}
                          </span>
                          
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase shrink-0 ${
                            log.action === "create" 
                              ? "bg-blue-500/10 text-blue-400 border-blue-500/20" 
                              : log.action === "update"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/10"
                              : log.action === "delete"
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                              : "bg-purple-500/10 text-purple-400 border-purple-500/20"
                          }`}>
                            {log.action}
                          </span>

                          <span className="text-white font-medium break-all max-w-sm md:max-w-md">
                            [{log.filename}]
                          </span>
                        </div>

                        <div className="flex items-center gap-3 ml-2 md:ml-auto">
                          {log.status === "success" ? (
                            <span className="text-emerald-400 font-bold text-[10px] flex items-center gap-1 uppercase">
                              <ShieldCheck className="w-3.5 h-3.5" /> Indexed ({log.chunksCount || 0} chunks)
                            </span>
                          ) : (
                            <span className="text-rose-400 font-bold text-[10px] flex flex-col items-end gap-1 uppercase text-right">
                              <div className="flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5" /> Sync Error
                              </div>
                              {log.error && <span className="text-[9px] text-rose-400/60 lowercase normal-case">{log.error}</span>}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </motion.div>
          )}

          {/* Tab: Interactive Property Map */}
          {activeTab === "map" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col flex-1 min-h-0"
            >
              <PropertyMapPanel
                properties={properties}
                isActive={activeTab === "map"}
                authToken={token}
                onAddProperty={() => setShowNewPropertyModal(true)}
                onDeleteProperty={handleDeleteProperty}
              />
            </motion.div>
          )}

          {/* Tab 5: Admin Panel Controls */}
          {activeTab === "admin" && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-6"
            >
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white uppercase font-mono">System Admin Controls</h2>
                <p className="text-xs text-white/40 leading-relaxed capitalize">
                  Manage index directories caches, reset chat states, and view system orchestrator statistics.
                </p>
              </div>

              {/* Box systems admin utilities */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                
                {/* Clean systems card */}
                <div className="glass-panel rounded-2xl border border-white/5 p-6 flex flex-col gap-4">
                  <h3 className="text-xs uppercase font-mono font-bold tracking-wider text-white border-b border-white/5 pb-3">
                    Database caches cleanups
                  </h3>
                  <p className="text-xs text-white/40 leading-relaxed">
                    Clear the entire local database files cache, and delete conversation history memories instantly.
                  </p>

                  <div className="flex flex-col gap-3 mt-2">
                    <button 
                      onClick={() => handleWipeData(false)}
                      className="px-4 py-3 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 text-xs font-semibold uppercase font-mono text-white transition duration-150 text-left flex items-center justify-between"
                    >
                      <span>Clear Chat History Only</span>
                      <CornerDownRight className="w-4 h-4 text-white/40" />
                    </button>
                    
                    <button 
                      onClick={() => handleWipeData(true)}
                      className="px-4 py-3 rounded-xl border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-xs font-semibold uppercase font-mono text-rose-400 transition duration-150 text-left flex items-center justify-between"
                    >
                      <span className="font-bold">Hard Factory Reset (All Files & Logs)</span>
                      <AlertTriangle className="w-4 h-4 text-rose-400/60" />
                    </button>
                  </div>
                </div>

                {/* System Settings Specs */}
                <div className="glass-panel rounded-2xl border border-white/5 p-6 flex flex-col gap-4 font-mono text-xs">
                  <h3 className="text-xs uppercase font-bold tracking-wider text-white border-b border-white/5 pb-3 font-mono">
                    System Parameters specifications
                  </h3>

                  <div className="flex flex-col gap-2 text-white/45 text-[11px]">
                    <div className="flex justify-between border-b border-white/[0.02] pb-1.5">
                      <span>Express Endpoint:</span>
                      <span className="text-white">Active (Port 3000)</span>
                    </div>
                    <div className="flex justify-between border-b border-white/[0.02] pb-1.5">
                      <span>Fs Watcher Status:</span>
                      <span className="text-emerald-400 font-bold flex items-center gap-1.5 uppercase text-[10px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span> Watching
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-white/[0.02] pb-1.5">
                      <span>Embedding Dimension:</span>
                      <span className="text-white">1536 (768 params)</span>
                    </div>
                    <div className="flex justify-between border-b border-white/[0.02] pb-1.5">
                      <span>Watch Path:</span>
                      <span className="text-white">/company_docs</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Memory Path:</span>
                      <span className="text-white">/memory</span>
                    </div>
                  </div>
                </div>

              {/* Widget Integration Card */}
              <div className="glass-panel rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.03] p-6 flex flex-col gap-4 col-span-1 md:col-span-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs uppercase font-mono font-bold tracking-wider text-indigo-300">Widget de Chat Public</h3>
                    <p className="text-[11px] text-white/40 mt-1">Intégrez un chatbot IA sur n'importe quel site web de vos clients en une seule ligne de code.</p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-xl">💬</div>
                </div>

                {/* Customization */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-mono uppercase text-white/30">Nom de l'assistant</label>
                    <input
                      type="text"
                      value={widgetAgentName}
                      onChange={e => setWidgetAgentName(e.target.value)}
                      placeholder="Assistant IA"
                      className="bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-indigo-400/40 transition"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-mono uppercase text-white/30">Couleur principale</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={widgetAgentColor}
                        onChange={e => setWidgetAgentColor(e.target.value)}
                        className="w-9 h-9 rounded-lg border border-white/10 bg-transparent cursor-pointer"
                      />
                      <span className="text-xs text-white/40 font-mono">{widgetAgentColor}</span>
                    </div>
                  </div>
                </div>

                {/* Generate / Revoke */}
                <div className="flex gap-3 flex-wrap">
                  <button
                    onClick={handleGenerateWidgetToken}
                    disabled={isGeneratingWidget}
                    className="px-4 py-2.5 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30 text-xs font-bold font-mono uppercase transition flex items-center gap-2"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingWidget ? 'animate-spin' : ''}`} />
                    {widgetToken ? 'Mettre à jour' : 'Générer le Widget'}
                  </button>
                  {widgetToken && (
                    <button
                      onClick={handleRevokeWidgetToken}
                      className="px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 text-xs font-bold font-mono uppercase transition flex items-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Révoquer le Token
                    </button>
                  )}
                </div>

                {/* Embed Code */}
                {widgetEmbedCode && (
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-mono uppercase text-white/30">Code d'intégration — Copiez ce code dans votre site web</label>
                    <div className="relative">
                      <pre className="bg-black/40 border border-white/10 rounded-xl p-4 text-xs text-emerald-400 font-mono overflow-x-auto whitespace-pre-wrap break-all">{widgetEmbedCode}</pre>
                      <button
                        onClick={handleCopyEmbedCode}
                        className={`absolute top-3 right-3 px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase font-bold transition ${
                          widgetCopied
                            ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
                            : 'bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {widgetCopied ? '✓ Copié !' : 'Copier'}
                      </button>
                    </div>
                    <div className="flex gap-2 items-center mt-1">
                      <a
                        href={`/test_widget.html?token=${widgetToken}&name=${encodeURIComponent(widgetAgentName)}&color=${encodeURIComponent(widgetAgentColor)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase font-semibold bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 hover:bg-indigo-500/20 transition flex items-center gap-1.5"
                      >
                        👁️ Prévisualiser / Tester le Widget
                      </a>
                    </div>
                    <p className="text-[10px] text-white/25 font-mono">💡 Collez ce code avant la balise &lt;/body&gt; de votre site. Le widget apparaîtra automatiquement.</p>
                  </div>
                )}

                {/* Preview status */}
                {widgetLoaded && !widgetToken && (
                  <p className="text-[11px] text-white/30 italic">Aucun widget actif pour ce projet. Cliquez sur "Générer le Widget" pour commencer.</p>
                )}
              </div>

            </div>

            </motion.div>
          )}

        </main>
      </div>

      {/* Footer System Specs */}
      <footer className="bg-[#050506] border-t border-white/5 px-6 py-4 flex items-center justify-between text-xs font-mono text-white/35 max-md:flex-col gap-3">
        <div className="flex items-center gap-2">
          <span>ASSOCIE.AI Agent Server Engine v2.0</span>
          <span>•</span>
          <span className="text-white/20">Enterprise Grade RAG Pipeline</span>
        </div>
        <div>
          <span>Local Sync Sandbox Monitor</span>
        </div>
      </footer>

      {/* New Property Modal */}
      {showNewPropertyModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg bg-[#0F0F12] border border-white/10 rounded-2xl p-6 flex flex-col gap-4 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                <MapPin className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white uppercase font-mono">Nouveau bien immobilier</h3>
                <p className="text-[11px] text-white/40">Géocodez l&apos;adresse puis ajustez lat/lng si besoin.</p>
              </div>
            </div>

            <form onSubmit={handleSaveProperty} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-mono uppercase text-white/30">Nom du bien *</label>
                <input
                  type="text"
                  value={newPropName}
                  onChange={(e) => setNewPropName(e.target.value)}
                  className="bg-white/[0.02] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-white/20"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-mono uppercase text-white/30">Adresse / ville</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newPropAddress}
                    onChange={(e) => setNewPropAddress(e.target.value)}
                    placeholder="ex: Anfa, Casablanca"
                    className="flex-1 bg-white/[0.02] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-white/20"
                  />
                  <button
                    type="button"
                    onClick={handleGeocodeAddress}
                    disabled={isGeocoding}
                    className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-[10px] font-bold uppercase hover:bg-white/15 disabled:opacity-50"
                  >
                    {isGeocoding ? "…" : "Géocoder"}
                  </button>
                </div>
                {geocodingError && <p className="text-[10px] text-rose-400">{geocodingError}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-mono uppercase text-white/30">Latitude *</label>
                  <input
                    type="text"
                    value={newPropLat}
                    onChange={(e) => setNewPropLat(e.target.value)}
                    className="bg-white/[0.02] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white font-mono outline-none focus:border-white/20"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-mono uppercase text-white/30">Longitude *</label>
                  <input
                    type="text"
                    value={newPropLng}
                    onChange={(e) => setNewPropLng(e.target.value)}
                    className="bg-white/[0.02] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white font-mono outline-none focus:border-white/20"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-mono uppercase text-white/30">Prix (€)</label>
                  <input
                    type="number"
                    value={newPropPrice}
                    onChange={(e) => setNewPropPrice(e.target.value)}
                    className="bg-white/[0.02] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-white/20"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-mono uppercase text-white/30">Surface (m²)</label>
                  <input
                    type="number"
                    value={newPropSurface}
                    onChange={(e) => setNewPropSurface(e.target.value)}
                    className="bg-white/[0.02] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-white/20"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-mono uppercase text-white/30">Description</label>
                <textarea
                  value={newPropDesc}
                  onChange={(e) => setNewPropDesc(e.target.value)}
                  rows={2}
                  className="bg-white/[0.02] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-white/20 resize-none"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-mono uppercase text-white/30">URL photo (optionnel)</label>
                <input
                  type="url"
                  value={newPropImgUrl}
                  onChange={(e) => setNewPropImgUrl(e.target.value)}
                  placeholder="https://exemple.com/photo-villa.jpg"
                  className="bg-white/[0.02] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-white/20"
                />
                <p className="text-[10px] text-white/40 leading-relaxed">
                  Photo : lien direct .jpg / .png / .webp uniquement. Un lien Google Maps (ex.{" "}
                  <span className="text-white/55">maps.app.goo.gl</span>) sert à la position, pas à la photo.
                </p>
                {imageUrlFieldHint(newPropImgUrl) && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 flex flex-col gap-2 mt-1">
                    <p className="text-[11px] text-amber-200 leading-relaxed">{imageUrlFieldHint(newPropImgUrl)}</p>
                    <button
                      type="button"
                      onClick={handleResolveMapsLink}
                      disabled={isResolvingMapsLink}
                      className="px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-[10px] font-bold uppercase text-amber-100 hover:bg-amber-500/30 disabled:opacity-50"
                    >
                      {isResolvingMapsLink ? "Lecture du lien…" : "Utiliser ce lien Maps pour la position GPS"}
                    </button>
                  </div>
                )}
                {newPropImgUrl.trim() && !isGoogleMapsLink(newPropImgUrl) && (
                  <div className="rounded-xl border border-white/10 overflow-hidden bg-black/30 mt-1">
                    <img
                      src={normalizePropertyImageUrl(newPropImgUrl)}
                      alt="Aperçu"
                      className="w-full max-h-40 object-cover"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        const el = e.target as HTMLImageElement;
                        el.style.display = "none";
                        const parent = el.parentElement;
                        if (parent && !parent.querySelector(".img-preview-err")) {
                          const msg = document.createElement("p");
                          msg.className = "img-preview-err text-[10px] text-amber-400 p-3";
                          msg.textContent =
                            "Aperçu impossible : utilisez un lien direct vers le fichier image (.jpg, .png).";
                          parent.appendChild(msg);
                        }
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setShowNewPropertyModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-white/5 bg-white/5 text-xs font-semibold text-white/70 hover:text-white"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSavingProperty}
                  className="px-4 py-2.5 rounded-xl bg-white text-black text-xs font-bold flex items-center gap-2 disabled:opacity-50"
                >
                  {isSavingProperty ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Enregistrer
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* New Project Modal */}
      {showNewProjectModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-md bg-[#0F0F12] border border-white/10 rounded-2xl p-6 flex flex-col gap-4 shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center border border-white/10">
                <Folder className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white uppercase font-mono">Nouveau Projet / Dossier</h3>
                <p className="text-[11px] text-white/40">Créez un espace documentaire isolé pour un bien immobilier.</p>
              </div>
            </div>

            <form onSubmit={handleCreateProject} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-mono uppercase text-white/30">Nom du projet</label>
                <input 
                  type="text" 
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="ex: Villa Serena, Casablanca"
                  className="bg-white/[0.02] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 outline-none focus:border-white/20 transition"
                  autoFocus
                  required
                />
              </div>

              <div className="flex justify-end gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewProjectModal(false);
                    setNewProjectName("");
                  }}
                  className="px-4 py-2.5 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 text-xs font-semibold text-white/70 hover:text-white transition"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isCreatingProject}
                  className="px-4 py-2.5 rounded-xl bg-white text-black hover:bg-slate-200 text-xs font-bold transition flex items-center gap-2"
                >
                  {isCreatingProject ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Création...
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      Créer le Projet
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

    </div>
  );
}
