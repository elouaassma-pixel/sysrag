devjhjkhk#!/bin/bash

# PHASE 1 QUICKSTART - Setup script pour démarrer rapidement

set -e

echo "🚀 PHASE 1 Quick Setup"
echo "======================="
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}Step 1: Installer les dépendances${NC}"
npm install
echo -e "${GREEN}✓ Dependencies installed${NC}\n"

echo -e "${BLUE}Step 2: Lancer PostgreSQL + MinIO + Redis${NC}"
if command -v docker &> /dev/null; then
    docker-compose up -d
    echo -e "${GREEN}✓ Containers started${NC}"
    echo "   PostgreSQL: localhost:5432"
    echo "   MinIO: localhost:9000 (UI: 9001)"
    echo "   Redis: localhost:6379"
else
    echo -e "${YELLOW}⚠ Docker not found. Install PostgreSQL manually.${NC}"
fi
echo ""

echo -e "${BLUE}Step 3: Attendre que les services soient prêts${NC}"
sleep 5
echo -e "${GREEN}✓ Services ready${NC}\n"

echo -e "${BLUE}Step 4: Exécuter les migrations DB${NC}"
npm run db:migrate
echo -e "${GREEN}✓ Database migrated${NC}\n"

echo -e "${BLUE}Step 5: Configuration${NC}"
if [ ! -f .env.local ]; then
    cp .env.example .env.local
    echo -e "${GREEN}✓ .env.local created${NC}"
    echo -e "${YELLOW}⚠ Update .env.local with your credentials:${NC}"
    echo "   - STRIPE_SECRET_KEY (obtenir depuis https://dashboard.stripe.com)"
    echo "   - GEMINI_API_KEY (obtenir depuis https://ai.google.dev)"
    echo "   - OAuth credentials si nécessaire"
else
    echo -e "${GREEN}✓ .env.local already exists${NC}"
fi
echo ""

echo -e "${BLUE}Step 6: Vérifications${NC}"

# Check PostgreSQL
if psql -h localhost -U postgres -d associe_ai -c "SELECT 1" &> /dev/null; then
    echo -e "${GREEN}✓ PostgreSQL connected${NC}"
else
    echo -e "${YELLOW}⚠ PostgreSQL not accessible${NC}"
fi

# Check MinIO
if curl -s http://localhost:9000/minio/health/live &> /dev/null; then
    echo -e "${GREEN}✓ MinIO accessible${NC}"
else
    echo -e "${YELLOW}⚠ MinIO not accessible${NC}"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ PHASE 1 Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "📚 Next steps:"
echo "   1. Lire PHASE1-SETUP.md pour la documentation"
echo "   2. Consulter PHASE1-EXAMPLE.ts pour les exemples"
echo "   3. Lancer: npm run dev"
echo ""
echo "🔗 Utiles:"
echo "   - MinIO UI: http://localhost:9001"
echo "   - Stripe Dashboard: https://dashboard.stripe.com"
echo "   - Gemini API: https://ai.google.dev"
echo ""
