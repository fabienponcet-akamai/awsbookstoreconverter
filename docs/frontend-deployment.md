# Frontend Deployment - Serverless sur Linode Object Storage + Akamai CDN

Le frontend React est déployé comme **site statique** sur Linode Object Storage, exactement comme l'approche AWS S3 + CloudFront originale.

## Architecture Frontend Serverless

```
User → Akamai CDN → Linode Object Storage (Static Files)
                            ↓
                    React SPA (HTML, JS, CSS)
                            ↓
                    API calls → Knative Services
```

## Avantages

✅ **100% Serverless** : Pas de pods Kubernetes pour le frontend
✅ **Coûts réduits** : ~$5/mois vs ~$20-30/mois (Deployment K8s)
✅ **Scaling automatique** : CDN gère tout le trafic
✅ **Performance** : Distribution globale via Akamai
✅ **Simplicité** : Juste des fichiers statiques

## Prérequis

- Linode CLI installé : `pip install linode-cli`
- Node.js 20+ pour builder le React
- Compte Linode avec Object Storage activé

## Étape 1 : Configuration Linode Object Storage

### Créer un Bucket

```bash
# Via Linode CLI
linode-cli object-storage buckets create \
  --cluster us-east-1 \
  --label bookstore-frontend

# Ou via interface web Linode
# Cloud Manager → Object Storage → Create Bucket
```

### Créer des Access Keys

```bash
# Créer une paire de clés pour accès programmatique
linode-cli object-storage keys-create \
  --label bookstore-frontend-deploy

# Sauvegarder ACCESS_KEY et SECRET_KEY
```

### Configurer le Bucket pour Website Hosting

```bash
# Installer s3cmd (compatible avec Linode Object Storage)
pip install s3cmd

# Configurer s3cmd
cat > ~/.s3cfg <<EOF
[default]
access_key = YOUR_ACCESS_KEY
secret_key = YOUR_SECRET_KEY
host_base = us-east-1.linodeobjects.com
host_bucket = %(bucket)s.us-east-1.linodeobjects.com
use_https = True
EOF

# Activer le website hosting
s3cmd ws-create --ws-index=index.html --ws-error=index.html s3://bookstore-frontend

# Rendre le bucket public (lecture seule)
s3cmd setacl --acl-public s3://bookstore-frontend
```

## Étape 2 : Builder le Frontend React

```bash
cd src/frontend

# Installer les dépendances
npm install

# Configurer les variables d'environnement pour production
cat > .env.production <<EOF
VITE_API_URL=https://api.bookstore.example.com
VITE_API_VERSION=v1
VITE_KEYCLOAK_URL=https://auth.bookstore.example.com
VITE_KEYCLOAK_REALM=bookstore
VITE_KEYCLOAK_CLIENT_ID=bookstore-frontend
VITE_APP_NAME=Bookstore
EOF

# Builder pour production
npm run build

# Le build est dans ./dist/
ls -la dist/
```

## Étape 3 : Déployer sur Object Storage

### Upload Manuel

```bash
# Upload tous les fichiers
s3cmd sync --delete-removed \
  --acl-public \
  --no-mime-magic \
  --guess-mime-type \
  dist/ s3://bookstore-frontend/

# Vérifier
s3cmd ls s3://bookstore-frontend/
```

### Script de Déploiement Automatisé

Créer `deploy-frontend.sh` :

```bash
#!/bin/bash
set -e

echo "🚀 Building React frontend..."
cd src/frontend
npm install
npm run build

echo "📤 Uploading to Linode Object Storage..."
s3cmd sync --delete-removed \
  --acl-public \
  --no-mime-magic \
  --guess-mime-type \
  --add-header="Cache-Control: public, max-age=31536000" \
  --exclude="*.html" \
  dist/ s3://bookstore-frontend/

# HTML files sans cache (pour les updates)
s3cmd sync --delete-removed \
  --acl-public \
  --no-mime-magic \
  --guess-mime-type \
  --add-header="Cache-Control: no-cache" \
  --include="*.html" \
  dist/ s3://bookstore-frontend/

echo "✅ Frontend deployed!"
echo "📍 URL: https://bookstore-frontend.us-east-1.linodeobjects.com"
```

```bash
chmod +x deploy-frontend.sh
./deploy-frontend.sh
```

## Étape 4 : Configuration Akamai CDN (Optionnel mais Recommandé)

### Option A : Via Linode CDN (plus simple)

Linode offre un CDN simple pour Object Storage :

```bash
# L'URL CDN est automatiquement disponible
# Format: https://BUCKET.CLUSTER.cdn.linode.com
# Exemple: https://bookstore-frontend.us-east-1.cdn.linode.com
```

### Option B : Via Akamai CDN Complet (meilleure performance)

Si vous avez accès à Akamai CDN :

1. **Créer une Property** dans Akamai Control Center
2. **Origin** : `bookstore-frontend.us-east-1.linodeobjects.com`
3. **Caching** :
   - Cache HTML : 0 (no-cache)
   - Cache JS/CSS/Images : 1 an
4. **Compression** : Gzip/Brotli activé
5. **HTTPS** : TLS 1.3
6. **Edge Hostname** : `bookstore.example.com`

## Étape 5 : Configuration DNS

```bash
# Pointer votre domaine vers le CDN
# DNS A ou CNAME record

# Option A : Linode CDN
bookstore.example.com CNAME bookstore-frontend.us-east-1.cdn.linode.com

# Option B : Akamai CDN
bookstore.example.com CNAME bookstore.example.com.edgekey.net
```

## Étape 6 : Configuration CORS sur l'API

L'API doit accepter les requêtes du frontend :

```typescript
// src/api/src/server.ts
app.use(cors({
  origin: [
    'https://bookstore.example.com',
    'https://bookstore-frontend.us-east-1.linodeobjects.com',
    'https://bookstore-frontend.us-east-1.cdn.linode.com'
  ],
  credentials: true
}));
```

## CI/CD avec Tekton

Pipeline Tekton pour déploiement automatique :

```yaml
apiVersion: tekton.dev/v1beta1
kind: Pipeline
metadata:
  name: bookstore-frontend-deploy
  namespace: bookstore
spec:
  params:
  - name: git-url
  - name: git-revision
  workspaces:
  - name: source
  tasks:
  - name: clone
    taskRef:
      name: git-clone
    params:
    - name: url
      value: $(params.git-url)
    - name: revision
      value: $(params.git-revision)
    workspaces:
    - name: output
      workspace: source

  - name: build
    runAfter: [clone]
    taskSpec:
      workspaces:
      - name: source
      steps:
      - name: install-and-build
        image: node:20-alpine
        workingDir: $(workspaces.source.path)/src/frontend
        script: |
          #!/bin/sh
          npm ci
          npm run build
    workspaces:
    - name: source
      workspace: source

  - name: deploy
    runAfter: [build]
    taskSpec:
      workspaces:
      - name: source
      steps:
      - name: upload-to-object-storage
        image: python:3.11-alpine
        workingDir: $(workspaces.source.path)
        env:
        - name: S3_ACCESS_KEY
          valueFrom:
            secretKeyRef:
              name: object-storage-credentials
              key: access-key
        - name: S3_SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: object-storage-credentials
              key: secret-key
        script: |
          #!/bin/sh
          pip install s3cmd

          cat > ~/.s3cfg <<EOF
          [default]
          access_key = $S3_ACCESS_KEY
          secret_key = $S3_SECRET_KEY
          host_base = us-east-1.linodeobjects.com
          host_bucket = %(bucket)s.us-east-1.linodeobjects.com
          use_https = True
          EOF

          s3cmd sync --delete-removed --acl-public \
            src/frontend/dist/ s3://bookstore-frontend/
    workspaces:
    - name: source
      workspace: source
```

## Invalidation du Cache CDN

Après chaque déploiement, invalider le cache :

### Linode CDN

```bash
# Pas d'invalidation nécessaire - TTL court sur HTML
# Le CDN respecte les headers Cache-Control
```

### Akamai CDN

```bash
# Via Akamai API
curl -X POST "https://api.akamai.com/ccu/v3/invalidate/url/production" \
  -H "Authorization: Bearer $AKAMAI_TOKEN" \
  -d '{
    "objects": [
      "https://bookstore.example.com/",
      "https://bookstore.example.com/index.html"
    ]
  }'
```

## Monitoring

### Logs d'Accès

Object Storage logs (si activé) :

```bash
# Activer les logs d'accès
s3cmd logging --enable \
  --log-target-prefix "logs/" \
  s3://bookstore-frontend

# Télécharger les logs
s3cmd get --recursive s3://bookstore-frontend/logs/
```

### Métriques CDN

- **Linode** : Cloud Manager → Object Storage → Analytics
- **Akamai** : Control Center → Reports

## Coûts Estimés

| Composant | Coût Mensuel |
|-----------|--------------|
| Linode Object Storage (10GB) | ~$5 |
| Bandwidth (100GB/mois) | Inclus |
| Linode CDN | Inclus |
| **Total** | **~$5/mois** |

**vs Kubernetes Deployment** :
- 2 pods × $10 = $20/mois minimum
- **Économies : $15/mois**

## Comparaison AWS vs Linode

| Feature | AWS | Linode + Akamai |
|---------|-----|-----------------|
| Storage | S3 | Object Storage (compatible S3) |
| CDN | CloudFront | Akamai CDN / Linode CDN |
| Prix Storage | $0.023/GB | $0.02/GB |
| Prix Bandwidth | $0.085/GB | Inclus (1ère TB) |
| API | Compatible S3 | Compatible S3 |
| CLI | aws-cli | s3cmd, linode-cli |

## Rollback

En cas de problème :

```bash
# Lister les versions (si versioning activé)
s3cmd ls s3://bookstore-frontend/

# Restaurer une version précédente
# (garder une copie locale ou utiliser git tags)
git checkout v1.0.0
npm run build
s3cmd sync dist/ s3://bookstore-frontend/
```

## Sécurité

### Headers de Sécurité

Configurer via CDN ou Object Storage metadata :

```bash
s3cmd modify --add-header="Content-Security-Policy: default-src 'self'" \
  --recursive s3://bookstore-frontend/

s3cmd modify --add-header="X-Frame-Options: DENY" \
  --recursive s3://bookstore-frontend/
```

### HTTPS

- **Obligatoire** : Object Storage et CDN supportent HTTPS par défaut
- Certificat SSL géré automatiquement

## Résumé

✅ Frontend 100% serverless comme AWS S3 + CloudFront
✅ Pas de Kubernetes pour le frontend
✅ Déploiement simple : build + upload
✅ Coûts minimes : ~$5/mois
✅ Performance globale via CDN
✅ Compatible avec approche AWS originale

Le frontend est maintenant aussi serverless que le backend (Knative) ! 🚀
