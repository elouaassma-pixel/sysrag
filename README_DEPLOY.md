# Déploiement simple (Render / Railway) — guide pas-à-pas

Objectif: déployer l'app complète sans Docker local en utilisant Render (ou Railway). Ce guide suppose que votre code est dans un repo GitHub.

Étapes rapides
1. Poussez ce dossier sur GitHub si ce n'est pas déjà fait.
2. Copiez `.env.example` en `.env` localement et remplissez les valeurs (ne commitez pas `.env`).
3. Créez un compte Render (https://render.com) et connectez votre repo GitHub.
4. Dans Render: "New" → "Web Service" → sélectionnez le repo et la branche.
   - Build command: `npm run build`
   - Start command: `npm start`
5. Ajoutez les variables d'environnement (Dashboard → Environment) en copiant depuis `.env.example`.
6. Provisionnez une base de données PostgreSQL managée et une instance Redis via Render (ou utilisez des services externes). Copiez leurs URLs dans `DATABASE_URL` et `REDIS_URL`.
7. Créez un bucket S3-compatible (Backblaze/DO/AWS) et mettez les identifiants dans `MINIO_*`.
8. Déployez et attendez que Render construise et lance l'app. Testez l'URL fournie.

Commandes locales utiles
```bash
npm install
npm run build
npm start
```

Notes importantes
- Si vous n'avez pas de clé `GEMINI_API_KEY`, l'app utilisera un fallback (embeddings mock) mais certaines fonctionnalités IA seront limitées.
- Pour les tâches en arrière-plan (BullMQ), vous pouvez créer un service "Worker" séparé sur Render connecté à la même `REDIS_URL`.
- Ne commitez jamais vos clés privées; utilisez la zone Environment du fournisseur pour stocker des secrets.

Besoin d'aide manuelle: si vous voulez, je peux:
- préparer un commit avec `.env.example`, `render.yaml` (déjà ajoutés), et un court `README_DEPLOY.md` (ce fichier),
- puis vous guider étape par étape sur Render (je vous dis quoi cliquer et quoi coller), ou
- générer un `render.yaml` plus complet si vous voulez provisionner tout via la CLI.
