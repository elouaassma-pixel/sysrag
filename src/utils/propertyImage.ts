/** Lien Google Maps (position), pas une image */
export function isGoogleMapsLink(raw: string): boolean {
  const url = (raw || "").trim();
  if (!url) return false;
  return /maps\.app\.goo\.gl|google\.com\/maps|maps\.google\.com|goo\.gl\/maps/i.test(url);
}

/** Normalise une URL d'image saisie par l'utilisateur */
export function normalizePropertyImageUrl(raw: string): string {
  let url = (raw || "").trim();
  if (!url) return "";
  if (isGoogleMapsLink(url)) return "";

  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  // Lien page Google Drive → lien direct
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
  if (driveMatch) {
    return `https://drive.google.com/uc?export=view&id=${driveMatch[1]}`;
  }

  return url;
}

export function imageUrlFieldHint(raw: string): string | null {
  if (!raw.trim()) return null;
  if (isGoogleMapsLink(raw)) {
    return "Ce lien est une carte Google Maps (emplacement), pas une photo. Utilisez le bouton ci-dessous pour placer le bien, ou collez l'URL directe d'un fichier .jpg / .png.";
  }
  return null;
}

/** URL affichée dans <img> (passe par l'API pour auth + CORS) */
export function propertyPhotoSrc(propertyId: string, token: string | null): string | null {
  if (!propertyId || !token) return null;
  return `/api/properties/${propertyId}/photo?token=${encodeURIComponent(token)}`;
}
