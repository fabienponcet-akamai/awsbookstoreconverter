# 📋 Workflow Complet de Déploiement Frontend - Tous les Outils

## Vue d'Ensemble

Ce document détaille **le workflow complet** pour déployer le frontend Bookstore React sur Akamai App Platform, avec **tous les outils CNCF/APL Core** utilisés à chaque étape.

---

## 🎯 Trois Options de Déploiement

### Option 1️⃣ : Déploiement Manuel (Développement)
**Outils** : Git, npm, Vite, s3cmd, Bash
**Temps** : ~5 minutes
**Usage** : Tests rapides, développement local

### Option 2️⃣ : Pipeline Tekton (Semi-Automatique)
**Outils** : Gitea, Tekton, Kubernetes, s3cmd
**Temps** : ~10 minutes (après setup)
**Usage** : CI/CD cloud-native, déploiements réguliers

### Option 3️⃣ : GitOps Complet (Production)
**Outils** : Gitea, Tekton Triggers, ArgoCD, Kubernetes
**Temps** : Automatique sur git push
**Usage** : Production, équipes multiples

---

## 🔄 Option 1: Déploiement Manuel

### Workflow Complet

```
┌─────────────────────────────────────────────────────────┐
│                 DÉPLOIEMENT MANUEL                      │
└─────────────────────────────────────────────────────────┘

Étape 1: Code Source
├─ Outil: Git
├─ Action: Clone/Pull du repository
└─ Commande: git clone <repo-url>

Étape 2: Installation Dépendances
├─ Outil: npm (Node Package Manager)
├─ Action: Installation packages React
└─ Commande: npm ci

Étape 3: Build Production
├─ Outil: Vite (Build Tool)
├─ Action: Compile React → dist/
├─ Optimisations:
│  ├─ Tree shaking
│  ├─ Code splitting
│  ├─ Minification
│  └─ Asset optimization
└─ Commande: npm run build

Étape 4: Upload Object Storage
├─ Outil: s3cmd (S3-compatible CLI)
├─ Destination: Linode Object Storage
├─ Configuration:
│  ├─ Assets (JS/CSS): Cache 1 an
│  └─ HTML: No cache
└─ Commande: s3cmd sync dist/ s3://bucket/

Étape 5: Distribution CDN
├─ Outil: Akamai/Linode CDN
├─ Action: Cache et distribution globale
└─ URL: https://bucket.region.cdn.linode.com

Étape 6: Accès Utilisateur
└─ Navigateur → CDN → Object Storage → Fichiers statiques
```

### Commandes Détaillées

```bash
#──────────────────────────────────────────────────────
# ÉTAPE 1: Clone Repository
#──────────────────────────────────────────────────────
# Outil: Git
git clone http://gitea.gitea.svc.cluster.local:3000/gitea_admin/awsbookstoreconverter.git
cd awsbookstoreconverter/src/frontend

#──────────────────────────────────────────────────────
# ÉTAPE 2: Installation Dépendances
#──────────────────────────────────────────────────────
# Outil: npm (via Node.js)
npm ci --prefer-offline --no-audit
# Packages installés: React, Redux, Vite, TypeScript, etc.

#──────────────────────────────────────────────────────
# ÉTAPE 3: Build Production
#──────────────────────────────────────────────────────
# Outil: Vite
# Configuration: vite.config.ts
export NODE_ENV=production
export VITE_API_URL=https://api.bookstore.example.com
export VITE_KEYCLOAK_URL=https://auth.bookstore.example.com

npm run build
# Output: dist/
#   ├── index.html
#   ├── assets/
#   │   ├── index-abc123.js
#   │   ├── index-def456.css
#   │   └── logo-xyz789.svg
#   └── favicon.svg

#──────────────────────────────────────────────────────
# ÉTAPE 4: Upload Object Storage
#──────────────────────────────────────────────────────
# Outil: s3cmd (Python CLI)
# Configuration: ~/.s3cfg

# 4a. Upload assets avec cache long
s3cmd sync \
  --acl-public \
  --no-mime-magic \
  --guess-mime-type \
  --delete-removed \
  --add-header="Cache-Control: public, max-age=31536000, immutable" \
  --exclude="*.html" \
  dist/ s3://bookstore-frontend/

# 4b. Upload HTML sans cache
s3cmd sync \
  --acl-public \
  --no-mime-magic \
  --guess-mime-type \
  --delete-removed \
  --add-header="Cache-Control: no-cache, no-store, must-revalidate" \
  --include="*.html" \
  --exclude="*" \
  dist/ s3://bookstore-frontend/

#──────────────────────────────────────────────────────
# ÉTAPE 5: Vérification
#──────────────────────────────────────────────────────
# Outil: s3cmd
s3cmd ls -r s3://bookstore-frontend/

# URLs générées:
# Direct: https://bookstore-frontend.us-east-1.linodeobjects.com/
# CDN: https://bookstore-frontend.us-east-1.cdn.linode.com/

#──────────────────────────────────────────────────────
# OU UTILISER LE SCRIPT TOUT-EN-UN
#──────────────────────────────────────────────────────
# Outil: Bash script (deploy-frontend.sh)
./deploy-frontend.sh
```

### Outils Impliqués (Option 1)

| Outil | Version | Rôle | Source |
|-------|---------|------|--------|
| **Git** | 2.x | Version control | Standard |
| **Node.js** | 20+ | Runtime JavaScript | nodejs.org |
| **npm** | 10+ | Package manager | Bundled with Node |
| **Vite** | 5.x | Build tool | vite.dev |
| **TypeScript** | 5.x | Type checking | typescriptlang.org |
| **s3cmd** | 2.x | S3 CLI tool | s3tools.org |
| **Linode Object Storage** | - | S3-compatible storage | Linode |
| **Akamai/Linode CDN** | - | Content delivery | Akamai/Linode |
| **Bash** | 5.x | Scripting | Standard |

---

## ⚙️ Option 2: Pipeline Tekton (Semi-Automatique)

### Workflow Complet

```
┌─────────────────────────────────────────────────────────┐
│              PIPELINE TEKTON CI/CD                      │
└─────────────────────────────────────────────────────────┘

Étape 1: Déclenchement
├─ Outil: kubectl / tkn CLI
├─ Action: Créer PipelineRun
└─ Commande: tkn pipeline start bookstore-frontend-s3-deploy

Étape 2: Clone Git Repository (Tekton Task)
├─ Outil: Tekton git-clone ClusterTask (APL Core)
├─ Image: gcr.io/tekton-releases/github.com/tektoncd/pipeline/cmd/git-init
├─ Action: Clone depuis Gitea
├─ Workspace: shared-workspace (PVC)
└─ Credentials: gitea-credentials Secret

Étape 3: Install Dependencies (Tekton Task)
├─ Outil: Tekton custom Task
├─ Image: node:20-alpine
├─ Action: npm ci
└─ Workspace: shared-workspace

Étape 4: Lint Code (Tekton Task)
├─ Outil: Tekton custom Task
├─ Image: node:20-alpine
├─ Action: npm run lint
└─ Continue on warnings

Étape 5: Build React (Tekton Task)
├─ Outil: Tekton custom Task
├─ Image: node:20-alpine
├─ Action: npm run build
├─ Environment: Production variables
└─ Output: dist/ in workspace

Étape 6: Upload to S3 (Tekton Custom Task)
├─ Outil: s3-upload custom Task
├─ Image: python:3.11-alpine (with s3cmd)
├─ Action: Upload dist/ to Object Storage
├─ Credentials: object-storage-credentials Secret
└─ Configuration:
   ├─ Assets: Cache 1 year
   └─ HTML: No cache

Étape 7: Verify & Notify (Tekton Task)
├─ Outil: Tekton custom Task
├─ Image: alpine:latest
└─ Action: Print deployment URLs

Étape 8: CDN Distribution
├─ Outil: Linode/Akamai CDN (automatic)
└─ Action: Cache and distribute globally
```

### Architecture Tekton Détaillée

```
┌──────────────────────────────────────────────────────────┐
│               KUBERNETES CLUSTER (LKE)                    │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────────────────────────────────┐            │
│  │     Pipeline: bookstore-frontend-s3     │            │
│  └─────────────────────────────────────────┘            │
│                       │                                   │
│        ┌──────────────┼──────────────┐                   │
│        │              │              │                   │
│   ┌────▼────┐    ┌───▼────┐    ┌───▼────┐              │
│   │  Task   │    │  Task  │    │  Task  │              │
│   │  Clone  │───▶│  Build │───▶│ Upload │              │
│   └────┬────┘    └───┬────┘    └───┬────┘              │
│        │             │             │                     │
│        ▼             ▼             ▼                     │
│   ┌─────────────────────────────────┐                   │
│   │   Workspace: shared-workspace   │                   │
│   │   (PersistentVolumeClaim 1Gi)   │                   │
│   └─────────────────────────────────┘                   │
│                                                           │
│   ┌─────────────────────────────────┐                   │
│   │   Secrets (Kubernetes)          │                   │
│   ├─────────────────────────────────┤                   │
│   │ • gitea-credentials             │                   │
│   │ • object-storage-credentials    │                   │
│   └─────────────────────────────────┘                   │
│                                                           │
└──────────────────────────────────────────────────────────┘
         │                                    │
         ▼                                    ▼
    ┌─────────┐                      ┌──────────────┐
    │  Gitea  │                      │   Object     │
    │  (Git)  │                      │   Storage    │
    └─────────┘                      └──────────────┘
                                             │
                                             ▼
                                     ┌──────────────┐
                                     │ Akamai CDN   │
                                     └──────────────┘
```

### Commandes Détaillées

```bash
#──────────────────────────────────────────────────────
# PRÉREQUIS: Installation Tekton (APL Core)
#──────────────────────────────────────────────────────
# Tekton est inclus dans APL Core Bootstrap
# Composants installés:
# - Tekton Pipelines
# - Tekton Triggers
# - Tekton Dashboard

# Vérifier installation
kubectl get pods -n tekton-pipelines

#──────────────────────────────────────────────────────
# ÉTAPE 1: Créer Secrets Kubernetes
#──────────────────────────────────────────────────────
# Outil: kubectl (Kubernetes CLI)

# 1a. Secret Git (pour clone)
kubectl create secret generic gitea-credentials \
  --from-literal=username=gitea_admin \
  --from-literal=password=YOUR_GITEA_TOKEN \
  -n bookstore

kubectl annotate secret gitea-credentials \
  tekton.dev/git-0=http://gitea.gitea.svc.cluster.local:3000 \
  -n bookstore

# 1b. Secret Object Storage (pour upload)
kubectl create secret generic object-storage-credentials \
  --from-literal=access-key=YOUR_ACCESS_KEY \
  --from-literal=secret-key=YOUR_SECRET_KEY \
  -n bookstore

#──────────────────────────────────────────────────────
# ÉTAPE 2: Appliquer Ressources Tekton
#──────────────────────────────────────────────────────
# Outil: kubectl + Kustomize

# 2a. Custom Task S3 Upload
kubectl apply -f tekton/tasks/s3-upload-task.yaml

# 2b. Pipeline Frontend S3
kubectl apply -f tekton/pipeline-frontend-s3.yaml

# Vérifier
kubectl get pipeline -n bookstore
kubectl get task -n bookstore

#──────────────────────────────────────────────────────
# ÉTAPE 3: Déclencher Pipeline (Manuel)
#──────────────────────────────────────────────────────
# Outil: tkn CLI (Tekton CLI)

# 3a. Via tkn CLI
tkn pipeline start bookstore-frontend-s3-deploy \
  --param git-url=http://gitea.gitea.svc.cluster.local:3000/gitea_admin/awsbookstoreconverter.git \
  --param git-revision=main \
  --param bucket-name=bookstore-frontend \
  --param s3-region=us-east-1 \
  --workspace name=shared-workspace,volumeClaimTemplateFile=workspace-pvc.yaml \
  --serviceaccount=tekton-gitea-sa \
  --namespace=bookstore

# 3b. Via kubectl (créer PipelineRun)
kubectl create -f - <<EOF
apiVersion: tekton.dev/v1beta1
kind: PipelineRun
metadata:
  generateName: bookstore-frontend-s3-deploy-run-
  namespace: bookstore
spec:
  pipelineRef:
    name: bookstore-frontend-s3-deploy
  params:
  - name: git-url
    value: http://gitea.gitea.svc.cluster.local:3000/gitea_admin/awsbookstoreconverter.git
  - name: git-revision
    value: main
  workspaces:
  - name: shared-workspace
    volumeClaimTemplate:
      spec:
        accessModes:
        - ReadWriteOnce
        resources:
          requests:
            storage: 1Gi
  serviceAccountName: tekton-gitea-sa
EOF

#──────────────────────────────────────────────────────
# ÉTAPE 4: Monitorer Pipeline
#──────────────────────────────────────────────────────
# Outil: tkn CLI / kubectl

# 4a. Lister les runs
tkn pipelinerun list -n bookstore

# 4b. Suivre les logs
tkn pipelinerun logs -f -n bookstore --last

# 4c. Via kubectl
kubectl get pipelinerun -n bookstore -w
kubectl logs -n bookstore -l tekton.dev/pipelineRun=<run-name> -f

#──────────────────────────────────────────────────────
# ÉTAPE 5: Accéder au Dashboard Tekton
#──────────────────────────────────────────────────────
# Outil: Tekton Dashboard (Web UI)

kubectl port-forward svc/tekton-dashboard -n tekton-pipelines 9097:9097
# Accès: http://localhost:9097

# Visualisation:
# - PipelineRuns en cours
# - Logs en temps réel
# - Task status
# - Résultats
```

### Outils Impliqués (Option 2)

| Outil | Version | Rôle | Source |
|-------|---------|------|--------|
| **Tekton Pipelines** | v0.53+ | CI/CD engine | APL Core |
| **Tekton CLI (tkn)** | v0.33+ | CLI pour Tekton | tekton.dev |
| **kubectl** | 1.28+ | Kubernetes CLI | kubernetes.io |
| **Kubernetes** | 1.28+ | Orchestration | LKE |
| **Gitea** | 1.21+ | Git server | APL Core |
| **git-clone ClusterTask** | - | Clone Git repos | Tekton Hub |
| **s3cmd** | 2.x | S3 CLI (in Task) | s3tools.org |
| **Node.js image** | 20-alpine | Build container | Docker Hub |
| **Python image** | 3.11-alpine | S3 upload container | Docker Hub |
| **PersistentVolume** | - | Workspace storage | Kubernetes |
| **Tekton Dashboard** | - | Web UI | APL Core |

---

## 🚀 Option 3: GitOps Complet (Production)

### Workflow Complet

```
┌─────────────────────────────────────────────────────────┐
│            GITOPS AUTOMATIQUE (PRODUCTION)              │
└─────────────────────────────────────────────────────────┘

Étape 1: Développeur Commit & Push
├─ Outil: Git
├─ Action: git push gitea main
└─ Destination: Gitea Repository

Étape 2: Gitea Webhook
├─ Outil: Gitea Webhook System
├─ Action: HTTP POST to EventListener
├─ Payload: JSON (commit SHA, branch, files, etc.)
└─ Target: http://el-gitea-listener.bookstore.svc:8080

Étape 3: EventListener Reception
├─ Outil: Tekton EventListener (APL Core)
├─ Action: Receive webhook, validate signature
└─ Interceptors:
   ├─ Gitea Interceptor (validate secret)
   └─ CEL Filter (branch == main)

Étape 4: TriggerBinding Extraction
├─ Outil: Tekton TriggerBinding
├─ Action: Extract data from webhook payload
└─ Données extraites:
   ├─ git-repo-url
   ├─ git-revision (commit SHA)
   ├─ git-branch
   ├─ pusher-name
   └─ commit-message

Étape 5: TriggerTemplate Creation
├─ Outil: Tekton TriggerTemplate
├─ Action: Create PipelineRun from template
└─ PipelineRun créé avec:
   ├─ Labels (git/repo, git/branch)
   ├─ Annotations (git/commit, git/pusher)
   └─ Parameters (from binding)

Étape 6: Pipeline Execution
├─ Outil: Tekton Pipeline
├─ Tasks:
│  1. git-clone → Clone from Gitea
│  2. install-dependencies → npm ci
│  3. lint → ESLint
│  4. build → Vite build
│  5. upload-to-s3 → S3 sync
│  6. notify-completion → Print URLs
└─ Automatic execution

Étape 7: ArgoCD Sync (Optional)
├─ Outil: ArgoCD (APL Core)
├─ Action: Monitor Gitea, sync K8s resources
└─ GitOps: Keep cluster in sync with Git

Étape 8: CDN Distribution
├─ Outil: Akamai/Linode CDN
└─ Action: Automatic cache & distribution

Étape 9: Notification (Optional)
├─ Outil: Slack/Email/Custom
└─ Action: Notify team of deployment
```

### Architecture GitOps Complète

```
┌──────────────────────────────────────────────────────────────────┐
│                    GITOPS ARCHITECTURE                            │
└──────────────────────────────────────────────────────────────────┘

Developer Workstation
         │
         │ git push gitea main
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                          GITEA (APL Core)                        │
│  http://gitea.gitea.svc.cluster.local:3000                      │
│                                                                  │
│  Repository: awsbookstoreconverter                              │
│  ├── src/frontend/          (React app)                         │
│  ├── tekton/                (Pipelines)                         │
│  ├── kubernetes/            (K8s manifests)                     │
│  └── gitops/                (ArgoCD apps)                       │
└─────────────────────────────────────────────────────────────────┘
         │                                    │
         │ Webhook                            │ ArgoCD Polling
         │ (POST)                             │ (Git Sync)
         ▼                                    ▼
┌────────────────────────┐         ┌─────────────────────────┐
│  Tekton EventListener  │         │    ArgoCD (APL Core)    │
│  (Tekton Triggers)     │         │                         │
│                        │         │  Monitors:              │
│  Interceptors:         │         │  • kubernetes/          │
│  ✓ Gitea Validator     │         │  • gitops/              │
│  ✓ CEL Filter          │         │                         │
└────────────────────────┘         │  Auto-sync:             │
         │                         │  • Deployments          │
         │ Create                  │  • Services             │
         │ PipelineRun             │  • ConfigMaps           │
         ▼                         └─────────────────────────┘
┌────────────────────────┐                  │
│  TriggerBinding        │                  │
│  (Extract webhook)     │                  │ Apply to cluster
└────────────────────────┘                  ▼
         │                         ┌─────────────────────────┐
         │ Template                │   Kubernetes Cluster    │
         │ Parameters              │       (LKE)             │
         ▼                         │                         │
┌────────────────────────┐         │  • Knative Services     │
│  TriggerTemplate       │         │  • Istio Gateway        │
│  (Create PipelineRun)  │         │  • CloudNative-PG       │
└────────────────────────┘         └─────────────────────────┘
         │
         │ Start
         ▼
┌────────────────────────────────────────────────────────┐
│         Tekton Pipeline (CI/CD)                        │
├────────────────────────────────────────────────────────┤
│  1. git-clone    → Clone from Gitea                    │
│  2. npm-ci       → Install dependencies                │
│  3. lint         → Code quality check                  │
│  4. build        → Vite production build               │
│  5. s3-upload    → Upload to Object Storage            │
│  6. notify       → Deployment complete                 │
└────────────────────────────────────────────────────────┘
                        │
                        │ Upload
                        ▼
               ┌─────────────────┐
               │ Object Storage  │
               │   (Linode)      │
               └─────────────────┘
                        │
                        │ Distribute
                        ▼
               ┌─────────────────┐
               │  Akamai CDN     │
               └─────────────────┘
                        │
                        ▼
                  End Users
```

### Commandes Setup GitOps

```bash
#──────────────────────────────────────────────────────
# ÉTAPE 1: Setup Tekton Triggers
#──────────────────────────────────────────────────────
# Outil: kubectl + Kustomize

# Appliquer toutes les ressources Gitea Tekton
kubectl apply -k tekton/gitea/

# Ressources créées:
# ✓ ServiceAccount: tekton-gitea-sa
# ✓ Role + RoleBinding (RBAC)
# ✓ Secret: gitea-credentials
# ✓ Secret: gitea-webhook-secret
# ✓ EventListener: gitea-listener
# ✓ TriggerBinding: gitea-frontend-binding
# ✓ TriggerTemplate: gitea-frontend-template
# ✓ Service: el-gitea-listener

#──────────────────────────────────────────────────────
# ÉTAPE 2: Configuration Secrets
#──────────────────────────────────────────────────────
# Outil: kubectl

# 2a. Gitea Token (créer dans Gitea UI first)
kubectl patch secret gitea-credentials -n bookstore \
  --type='json' \
  -p='[{"op": "replace", "path": "/data/password", "value": "'$(echo -n YOUR_GITEA_TOKEN | base64)'"}]'

# 2b. Webhook Secret
WEBHOOK_SECRET=$(openssl rand -hex 20)
kubectl patch secret gitea-webhook-secret -n bookstore \
  --type='json' \
  -p='[{"op": "replace", "path": "/data/webhook-secret", "value": "'$(echo -n $WEBHOOK_SECRET | base64)'"}]'

echo "Webhook Secret: $WEBHOOK_SECRET"

#──────────────────────────────────────────────────────
# ÉTAPE 3: Configuration Gitea Webhook
#──────────────────────────────────────────────────────
# Outil: Gitea Web UI

# Accéder à Gitea
kubectl port-forward svc/gitea-http -n gitea 3000:3000
# URL: http://localhost:3000

# Dans Gitea:
# 1. Go to Repository → Settings → Webhooks
# 2. Add Webhook → Gitea
# 3. Payload URL: http://el-gitea-listener.bookstore.svc.cluster.local:8080
# 4. Content Type: application/json
# 5. Secret: (le WEBHOOK_SECRET ci-dessus)
# 6. Trigger: Just the push event
# 7. Branch filter: main (optional)
# 8. Active: ✓
# 9. Add Webhook

#──────────────────────────────────────────────────────
# ÉTAPE 4: Setup ArgoCD (GitOps)
#──────────────────────────────────────────────────────
# Outil: ArgoCD CLI / kubectl

# 4a. Ajouter Gitea Repository dans ArgoCD
kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: gitea-repo-secret
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repository
stringData:
  type: git
  url: http://gitea.gitea.svc.cluster.local:3000/gitea_admin/awsbookstoreconverter.git
  username: gitea_admin
  password: YOUR_GITEA_TOKEN
EOF

# 4b. Créer ArgoCD Application
kubectl apply -f gitops/applications/bookstore-frontend-pipeline.yaml

#──────────────────────────────────────────────────────
# ÉTAPE 5: Test du Workflow Complet
#──────────────────────────────────────────────────────
# Outil: Git

# 5a. Faire un changement
echo "# Test GitOps" >> README.md
git add README.md
git commit -m "test: GitOps workflow"
git push gitea main

# 5b. Vérifier webhook reçu
kubectl logs -n bookstore -l eventlistener=gitea-listener --tail=20

# 5c. Vérifier PipelineRun créé
tkn pipelinerun list -n bookstore

# 5d. Suivre les logs
tkn pipelinerun logs -f -n bookstore --last

# 5e. Vérifier déploiement
# Output attendu:
# ✅ EventListener received webhook
# ✅ TriggerBinding extracted data
# ✅ TriggerTemplate created PipelineRun
# ✅ Pipeline started automatically
# ✅ Build completed
# ✅ Uploaded to Object Storage
# ✅ Deployment successful
# 📍 URL: https://bookstore-frontend.us-east-1.cdn.linode.com

#──────────────────────────────────────────────────────
# ÉTAPE 6: Monitoring
#──────────────────────────────────────────────────────

# Tekton Dashboard
kubectl port-forward svc/tekton-dashboard -n tekton-pipelines 9097:9097
# http://localhost:9097

# ArgoCD Dashboard
kubectl port-forward svc/argocd-server -n argocd 8080:443
# https://localhost:8080
# User: admin
# Password: kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d

# Gitea UI
kubectl port-forward svc/gitea-http -n gitea 3000:3000
# http://localhost:3000
```

### Outils Impliqués (Option 3)

| Outil | Version | Rôle | Source |
|-------|---------|------|--------|
| **Gitea** | 1.21+ | Git repository | APL Core |
| **Tekton Pipelines** | v0.53+ | CI/CD engine | APL Core |
| **Tekton Triggers** | v0.25+ | Webhook automation | APL Core |
| **ArgoCD** | 2.9+ | GitOps controller | APL Core |
| **EventListener** | - | Webhook receiver | Tekton Triggers |
| **TriggerBinding** | - | Data extraction | Tekton Triggers |
| **TriggerTemplate** | - | PipelineRun creation | Tekton Triggers |
| **Gitea Interceptor** | - | Webhook validation | Tekton Triggers |
| **CEL Filter** | - | Event filtering | Tekton Triggers |
| **Kubernetes** | 1.28+ | Orchestration | LKE |
| **kubectl** | 1.28+ | K8s CLI | kubernetes.io |
| **tkn** | v0.33+ | Tekton CLI | tekton.dev |

---

## 📊 Comparaison des 3 Options

| Aspect | Manuel | Tekton Pipeline | GitOps Complet |
|--------|--------|-----------------|----------------|
| **Déclenchement** | Commande manuelle | Commande `tkn` | git push (auto) |
| **Temps setup** | 0 min | 30 min | 60 min |
| **Temps deploy** | 5 min | 10 min | 10 min (auto) |
| **Répétabilité** | Faible | Moyenne | Élevée |
| **Traçabilité** | Logs locaux | Tekton Dashboard | Git + Tekton + ArgoCD |
| **Rollback** | Manuel | Manuel | Git revert (auto) |
| **Multi-env** | Scripts séparés | Pipelines séparés | Branches Git |
| **Équipe** | 1 développeur | Petite équipe | Production/équipe |
| **Outils APL** | 0 | 2 (Tekton) | 4 (Gitea+Tekton+ArgoCD) |
| **Complexité** | ★☆☆☆☆ | ★★★☆☆ | ★★★★☆ |
| **Production-ready** | ❌ | ✅ | ✅✅✅ |

---

## 🛠️ Stack Technologique Complète

### Couche par Couche

```
┌─────────────────────────────────────────────────────┐
│            STACK TECHNIQUE COMPLÈTE                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│  LAYER 7: USER ACCESS                              │
│  └─ Navigateur Web                                 │
│                                                     │
│  LAYER 6: CONTENT DELIVERY                         │
│  ├─ Akamai CDN                                     │
│  └─ Linode CDN                                     │
│                                                     │
│  LAYER 5: OBJECT STORAGE                           │
│  ├─ Linode Object Storage (S3-compatible)          │
│  └─ s3cmd CLI                                      │
│                                                     │
│  LAYER 4: CI/CD AUTOMATION                         │
│  ├─ Tekton Pipelines (APL Core)                    │
│  ├─ Tekton Triggers (APL Core)                     │
│  ├─ Tekton Dashboard (APL Core)                    │
│  └─ ArgoCD (APL Core)                              │
│                                                     │
│  LAYER 3: SOURCE CONTROL                           │
│  ├─ Gitea (APL Core)                               │
│  ├─ Git (protocol)                                 │
│  └─ Webhooks                                       │
│                                                     │
│  LAYER 2: BUILD TOOLS                              │
│  ├─ Vite (build tool)                              │
│  ├─ TypeScript (compiler)                          │
│  ├─ ESLint (linter)                                │
│  └─ npm (package manager)                          │
│                                                     │
│  LAYER 1: APPLICATION                              │
│  ├─ React 18 (framework)                           │
│  ├─ Redux Toolkit (state)                          │
│  ├─ React Router (routing)                         │
│  └─ Keycloak Client (auth)                         │
│                                                     │
│  LAYER 0: INFRASTRUCTURE                           │
│  ├─ Kubernetes (LKE)                               │
│  ├─ Linode Cloud                                   │
│  └─ APL Core                                       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 📝 Résumé Exécutif

### Workflow Recommandé par Environnement

| Environnement | Option | Raison |
|---------------|--------|--------|
| **Dev Local** | Manuel | Rapidité, feedback immédiat |
| **Staging** | Tekton Pipeline | Tests CI/CD, validation |
| **Production** | GitOps Complet | Automatisation, traçabilité |

### Temps d'Exécution Typiques

| Phase | Manuel | Tekton | GitOps |
|-------|--------|--------|--------|
| Clone | 10s | 15s | 15s |
| npm ci | 30s | 30s | 30s |
| Lint | 5s | 5s | 5s |
| Build | 20s | 20s | 20s |
| Upload | 15s | 20s | 20s |
| **Total** | **~80s** | **~90s** | **~90s (auto)** |

### Outils APL Core Utilisés

✅ **Gitea** - Git repository self-hosted
✅ **Tekton Pipelines** - CI/CD cloud-native
✅ **Tekton Triggers** - Webhook automation
✅ **Tekton Dashboard** - Visual monitoring
✅ **ArgoCD** - GitOps continuous delivery

**5/5 composants APL Core** pour un workflow 100% cloud-native ! 🎉

---

## 🎓 Conclusion

Le déploiement du frontend Bookstore peut se faire de **3 façons**:

1. **Manuelle** (dev) - Script Bash simple
2. **Tekton** (staging) - Pipeline cloud-native
3. **GitOps** (prod) - Automatisation complète

Tous utilisent les **mêmes outils APL Core** et aboutissent au **même résultat** : une application React servie depuis Object Storage via CDN, avec les avantages de la stack CNCF ! 🚀
