# Restauration de la version précédente

Sauvegarde créée le **2026-06-02** avant l’onglet carte Leaflet complet.

## Si quelque chose ne va pas

1. Arrêtez le serveur (`Ctrl+C` dans le terminal `npm run dev`).
2. Copiez les fichiers de sauvegarde vers la racine du projet :

```powershell
$root = "c:\Users\PREDATOR\Desktop\Document agent"
$bak  = "$root\backups\pre-leaflet-map-2026-06-02"
Copy-Item "$bak\App.tsx"       "$root\src\App.tsx"       -Force
Copy-Item "$bak\package.json"  "$root\package.json"      -Force
Copy-Item "$bak\index.html"    "$root\index.html"        -Force
Copy-Item "$bak\server.ts"     "$root\server.ts"         -Force
```

3. Supprimez le module carte (ajouté après la sauvegarde) si présent :

```powershell
Remove-Item "$root\src\components\PropertyMapPanel.tsx" -ErrorAction SilentlyContinue
```

4. Relancez : `npm run dev`

## Contenu de la sauvegarde

| Fichier | Rôle |
|---------|------|
| `App.tsx` | Interface React complète (état avant carte) |
| `package.json` | Dépendances npm |
| `index.html` | Page HTML / scripts Leaflet CDN |
| `server.ts` | API Express |

Votre base PostgreSQL, `company_docs/` et `memory/` ne sont **pas** modifiés par cette mise à jour UI.
