import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import { MapPin, Trash2, Plus, ExternalLink } from "lucide-react";
import { Property } from "../types";
import { propertyPhotoSrc } from "../utils/propertyImage";

const DEFAULT_CENTER: [number, number] = [33.5731, -7.5898];

const defaultMarkerIcon = L.icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function formatPrice(price: number) {
  if (!price) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(price);
}

function buildPopupHtml(p: Property, token: string | null) {
  const rawImg = p.imageUrl || (p as { image_url?: string }).image_url;
  const photoSrc = rawImg ? propertyPhotoSrc(p.id, token) : null;
  return `
    <div class="property-popup-card">
      <div class="property-popup-title">${escapeHtml(p.name)}</div>
      ${p.address ? `<div class="property-popup-address">${escapeHtml(p.address)}</div>` : ""}
      <div class="property-popup-stats">
        <div class="property-popup-stat">
          <span class="property-popup-label">Prix</span>
          <span class="property-popup-value property-popup-price">${formatPrice(p.price)}</span>
        </div>
        <div class="property-popup-stat">
          <span class="property-popup-label">Surface</span>
          <span class="property-popup-value">${p.surface ? `${p.surface} m²` : "—"}</span>
        </div>
      </div>
      ${p.description ? `<p class="property-popup-desc">${escapeHtml(p.description.slice(0, 280))}${p.description.length > 280 ? "…" : ""}</p>` : ""}
      ${photoSrc ? `<img class="property-popup-img" src="${escapeHtml(photoSrc)}" alt="Photo du bien" loading="lazy" referrerpolicy="no-referrer" />` : ""}
      <div class="property-popup-coords">${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}</div>
    </div>
  `;
}

interface PropertyMapPanelProps {
  properties: Property[];
  isActive: boolean;
  authToken: string | null;
  onAddProperty: () => void;
  onDeleteProperty: (id: string) => void;
}

export default function PropertyMapPanel({
  properties,
  isActive,
  authToken,
  onAddProperty,
  onDeleteProperty,
}: PropertyMapPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tilesOk, setTilesOk] = useState(true);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const markersByIdRef = useRef<Map<string, L.Marker>>(new Map());

  const focusProperty = useCallback((p: Property) => {
    const map = mapRef.current;
    const marker = markersByIdRef.current.get(p.id);
    if (!map || !marker) return;
    setSelectedId(p.id);
    map.setView([p.latitude, p.longitude], 16, { animate: true });
    window.setTimeout(() => marker.openPopup(), 350);
  }, []);

  // Créer / détruire la carte à chaque visite de l’onglet (Leaflet casse si l’onglet était caché)
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!isActive || !container) {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markersLayerRef.current = null;
        markersByIdRef.current.clear();
      }
      return;
    }

    setTilesOk(true);

    const map = L.map(container, {
      scrollWheelZoom: true,
      zoomControl: true,
    }).setView(DEFAULT_CENTER, 12);

    const osmProxy = L.tileLayer("/tiles/osm/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    });

    const esriFallback = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "Tiles &copy; Esri",
        maxZoom: 19,
      }
    );

    let errorCount = 0;
    osmProxy.on("tileerror", () => {
      errorCount += 1;
      if (errorCount === 3 && !map.hasLayer(esriFallback)) {
        map.removeLayer(osmProxy);
        esriFallback.addTo(map);
        setTilesOk(false);
      }
    });

    osmProxy.addTo(map);
    markersLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const fixSize = () => map.invalidateSize(true);
    fixSize();
    const t1 = window.setTimeout(fixSize, 100);
    const t2 = window.setTimeout(fixSize, 400);
    const t3 = window.setTimeout(fixSize, 900);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      markersByIdRef.current.clear();
    };
  }, [isActive]);

  // Marqueurs
  useEffect(() => {
    const map = mapRef.current;
    const markersLayer = markersLayerRef.current;
    if (!isActive || !map || !markersLayer) return;

    markersLayer.clearLayers();
    markersByIdRef.current.clear();

    const valid = properties.filter(
      (p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
    );

    valid.forEach((p) => {
      const marker = L.marker([p.latitude, p.longitude], { icon: defaultMarkerIcon });
      marker.bindPopup(buildPopupHtml(p, authToken), {
        maxWidth: 340,
        minWidth: 280,
        className: "property-leaflet-popup",
      });
      marker.on("click", () => setSelectedId(p.id));
      markersByIdRef.current.set(p.id, marker);
      markersLayer.addLayer(marker);
    });

    if (valid.length === 1) {
      map.setView([valid[0].latitude, valid[0].longitude], 15);
      window.setTimeout(() => {
        markersByIdRef.current.get(valid[0].id)?.openPopup();
        setSelectedId(valid[0].id);
      }, 500);
    } else if (valid.length > 1) {
      const bounds = L.latLngBounds(valid.map((p) => [p.latitude, p.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    } else {
      map.setView(DEFAULT_CENTER, 12);
    }

    window.setTimeout(() => map.invalidateSize(true), 200);
  }, [properties, isActive, authToken]);

  return (
    <div className="flex flex-col gap-6 h-full min-h-[70vh]">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white uppercase font-mono flex items-center gap-2">
            <MapPin className="w-5 h-5 text-emerald-400" />
            Carte Interactive
          </h2>
          <p className="text-sm text-white/55 mt-1">
            Cliquez sur un bien dans la liste ou sur un marqueur pour voir les détails.
          </p>
        </div>
        <button
          type="button"
          onClick={onAddProperty}
          className="px-4 py-2.5 rounded-xl bg-white text-black text-xs font-bold uppercase flex items-center gap-2 hover:bg-slate-200 transition shrink-0"
        >
          <Plus className="w-4 h-4" />
          Ajouter un bien
        </button>
      </div>

      {!tilesOk && (
        <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          Fond de carte de secours (Esri). Si la carte reste grise, rechargez avec Ctrl+F5.
        </p>
      )}

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 map-panel-shell relative h-[min(56vh,560px)] w-full">
          <div ref={mapContainerRef} className="absolute inset-0 z-0" />
        </div>

        <div className="property-list-panel rounded-2xl p-4 flex flex-col gap-3 overflow-hidden min-h-[320px] max-h-[min(56vh,560px)]">
          <h3 className="text-sm font-mono uppercase font-bold text-white border-b border-white/10 pb-2">
            Vos biens ({properties.length})
          </h3>
          <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
            {properties.length === 0 ? (
              <p className="text-sm text-white/50 text-center py-8">
                Aucun bien sur la carte. Cliquez sur « Ajouter un bien » pour commencer.
              </p>
            ) : (
              properties.map((p) => (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => focusProperty(p)}
                  onKeyDown={(e) => e.key === "Enter" && focusProperty(p)}
                  className={`property-list-card w-full text-left p-4 rounded-xl border flex flex-col gap-2 transition cursor-pointer ${
                    selectedId === p.id
                      ? "border-emerald-400/50 bg-emerald-500/10 ring-1 ring-emerald-400/30"
                      : "border-white/10 bg-white/[0.06] hover:bg-white/[0.1] hover:border-white/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold text-white text-base leading-tight flex-1">
                      {p.name}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteProperty(p.id);
                      }}
                      className="text-rose-400 hover:text-rose-300 shrink-0 p-1"
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  {p.address && (
                    <span className="text-sm text-white/80 leading-snug">{p.address}</span>
                  )}
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-1">
                    <span className="text-lg font-bold text-emerald-300">{formatPrice(p.price)}</span>
                    {p.surface > 0 && (
                      <span className="text-sm font-semibold text-white/90">{p.surface} m²</span>
                    )}
                  </div>
                  {p.description && (
                    <p className="text-sm text-white/65 line-clamp-3 leading-relaxed">{p.description}</p>
                  )}
                  {(p.imageUrl || (p as { image_url?: string }).image_url) && authToken && (
                    <img
                      src={propertyPhotoSrc(p.id, authToken) || ""}
                      alt=""
                      className="w-full h-28 object-cover rounded-lg border border-white/10 mt-1"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                  <span className="text-xs text-emerald-400 font-medium flex items-center gap-1 pt-1">
                    <ExternalLink className="w-3.5 h-3.5" />
                    Cliquez pour ouvrir la fiche sur la carte
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
