#!/bin/bash
#
# Script pour extraire opennext-akamai vers un nouveau repository GitHub
#
# Usage:
#   ./EXTRACT_TO_NEW_REPO.sh <github-username>
#
# Exemple:
#   ./EXTRACT_TO_NEW_REPO.sh fabienponcet-akamai
#

set -e

GITHUB_USER="${1:-fabienponcet-akamai}"
REPO_NAME="opennextjs-akamai"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="/tmp/${REPO_NAME}"

echo "🚀 Extraction de OpenNext Akamai vers un nouveau repository"
echo ""
echo "  GitHub User: ${GITHUB_USER}"
echo "  Repo Name:   ${REPO_NAME}"
echo ""

# Nettoyer le répertoire cible
rm -rf "${TARGET_DIR}"
mkdir -p "${TARGET_DIR}"

# Copier les fichiers (exclure ce script)
echo "📦 Copie des fichiers..."
cp -r "${SCRIPT_DIR}/README.md" "${TARGET_DIR}/"
cp -r "${SCRIPT_DIR}/docs" "${TARGET_DIR}/"
cp -r "${SCRIPT_DIR}/packages" "${TARGET_DIR}/"

# Créer les fichiers manquants
echo "📝 Création des fichiers de configuration..."

cat > "${TARGET_DIR}/.gitignore" << 'GITIGNORE'
node_modules/
dist/
.next/
.open-next/
*.log
.env
.env.local
.env.*.local
.DS_Store
*.tgz
coverage/
.nyc_output/
GITIGNORE

cat > "${TARGET_DIR}/LICENSE" << 'LICENSE'
MIT License

Copyright (c) 2025 OpenNext Community

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
LICENSE

# Initialiser git
echo "🔧 Initialisation du repository Git..."
cd "${TARGET_DIR}"
git init
git branch -M main
git add .
git commit -m "Initial commit: OpenNext adapter for Akamai ecosystem

A comprehensive adapter for deploying Next.js applications to Akamai:

Features:
- Akamai CDN integration (4200+ PoPs globally)
- EdgeWorkers for middleware execution (< 5ms cold start)
- EdgeKV for distributed incremental cache
- LKE (Linode Kubernetes Engine) for server functions
- Fermyon Spin for WebAssembly serverless (< 1ms cold start)
- Linode Object Storage for static assets (S3-compatible)
- Redis Streams for ISR revalidation queue"

echo ""
echo "✅ Repository créé dans: ${TARGET_DIR}"
echo ""
echo "📋 Prochaines étapes:"
echo ""
echo "1. Créez le repository sur GitHub:"
echo "   https://github.com/new"
echo "   - Name: ${REPO_NAME}"
echo "   - Description: OpenNext adapter for Akamai ecosystem (CDN, EdgeWorkers, LKE, Fermyon)"
echo "   - Public"
echo "   - Ne pas initialiser avec README/LICENSE (déjà inclus)"
echo ""
echo "2. Puis exécutez:"
echo "   cd ${TARGET_DIR}"
echo "   git remote add origin git@github.com:${GITHUB_USER}/${REPO_NAME}.git"
echo "   git push -u origin main"
echo ""
echo "3. Ou avec HTTPS:"
echo "   git remote add origin https://github.com/${GITHUB_USER}/${REPO_NAME}.git"
echo "   git push -u origin main"
echo ""
