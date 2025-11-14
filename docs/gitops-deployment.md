# GitOps Deployment Guide - Bookstore on Akamai App Platform

## 📋 Overview

This guide walks you through deploying the Bookstore application on Linode Kubernetes Engine (LKE) using GitOps with ArgoCD and Akamai App Platform Core components.

**Architecture**: 100% Serverless
- **Frontend**: Linode Object Storage + Akamai CDN (static files)
- **Backend**: Knative Services (5 serverless APIs with scale-to-zero)
- **Databases**: CloudNative-PG (3 PostgreSQL clusters)
- **GitOps**: ArgoCD (automated deployment from Git)
- **Service Mesh**: Istio (traffic management, security)
- **CI/CD**: Tekton Pipelines
- **Monitoring**: Prometheus + Grafana + Loki

---

## ⏱️ Estimated Deployment Time

| Phase | Time | Description |
|-------|------|-------------|
| Prerequisites | 15-30 min | LKE cluster + tools setup |
| APL Bootstrap | 20-30 min | Install all APL Core components |
| GitOps Setup | 10-15 min | Configure ArgoCD Applications |
| Database Init | 5-10 min | Run migration Jobs |
| Frontend Deploy | 5 min | Upload to Object Storage |
| **Total** | **55-90 min** | End-to-end deployment |

---

## 📦 Prerequisites

### 1. Linode Account & LKE Cluster

```bash
# Create LKE cluster (via Linode Cloud Manager or CLI)
# Recommended specs:
# - 3x nodes (4GB RAM, 2 vCPUs minimum)
# - Kubernetes 1.28+
# - Region: Choose closest to your users

# Get kubeconfig
linode-cli lke kubeconfig-view <cluster-id> --json | jq -r '.[0].kubeconfig' | base64 -d > ~/.kube/config-lke
export KUBECONFIG=~/.kube/config-lke
```

### 2. Required Tools

```bash
# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# Install Helm 3
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Install kustomize
curl -s "https://raw.githubusercontent.com/kubernetes-sigs/kustomize/master/hack/install_kustomize.sh"  | bash
sudo mv kustomize /usr/local/bin/

# Install ArgoCD CLI
curl -sSL -o argocd https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
sudo install -o root -g root -m 0755 argocd /usr/local/bin/argocd

# Verify
kubectl cluster-info
helm version
kustomize version
```

### 3. Container Registry

```bash
# Option 1: Linode Container Registry (recommended)
# Create registry via Linode Cloud Manager
# Get credentials and login:
docker login <registry-url>

# Option 2: Docker Hub
docker login

# Set environment variables
export CONTAINER_REGISTRY="<your-registry-url>"  # e.g., "lke-registry.linode.com/bookstore"
export IMAGE_TAG="v1.0.0"
```

---

## 🚀 Phase 1: Bootstrap Akamai App Platform

### Step 1: Clone APL Core Charts

```bash
cd /path/to/awsbookstoreconverter
git clone https://github.com/linode/apl-core.git
```

### Step 2: Run Bootstrap Script

```bash
# This installs:
# - Cert-Manager, Sealed Secrets
# - Istio service mesh
# - Knative Serving
# - CloudNative-PG operator
# - Keycloak
# - ArgoCD
# - Tekton Pipelines
# - Prometheus + Grafana + Loki

chmod +x scripts/bootstrap-apl.sh
./scripts/bootstrap-apl.sh
```

**Expected output**:
```
[2025-11-14 18:00:00] Checking prerequisites...
[2025-11-14 18:00:01] Prerequisites check passed ✅
[2025-11-14 18:00:02] Installing Cert-Manager...
[2025-11-14 18:02:30] Cert-Manager installed ✅
...
[2025-11-14 18:25:00] APL Bootstrap Complete! 🎉
```

### Step 3: Get ArgoCD Credentials

```bash
# Get ArgoCD admin password
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d
# Output: <password>

# Get ArgoCD LoadBalancer URL
kubectl -n argocd get svc argocd-server
# Or port-forward for local access:
kubectl port-forward svc/argocd-server -n argocd 8080:443
# Access: https://localhost:8080
# Username: admin
# Password: <from above>
```

---

## 🔐 Phase 2: Configure Secrets

### Option A: Using kubectl (Development)

```bash
# Create database secrets (replace REPLACE_ME with real passwords)
kubectl create secret generic bookstore-api-secrets \
  --from-literal=database-url-main="postgresql://bookstore:YOUR_PASSWORD@bookstore-main-rw.bookstore.svc.cluster.local:5432/bookstore" \
  --from-literal=database-url-search="postgresql://bookstore:YOUR_PASSWORD@bookstore-search-rw.bookstore.svc.cluster.local:5432/bookstore_search" \
  --from-literal=database-url-graph="postgresql://bookstore:YOUR_PASSWORD@bookstore-graph-rw.bookstore.svc.cluster.local:5432/bookstore_graph" \
  --from-literal=keycloak-client-id="bookstore-api" \
  --from-literal=keycloak-client-secret="YOUR_KEYCLOAK_SECRET" \
  --from-literal=jwt-secret="$(openssl rand -base64 32)" \
  -n bookstore \
  --dry-run=client -o yaml | kubectl apply -f -
```

### Option B: Using Sealed Secrets (Production - Recommended)

```bash
# Install kubeseal CLI
wget https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.24.0/kubeseal-0.24.0-linux-amd64.tar.gz
tar xfz kubeseal-0.24.0-linux-amd64.tar.gz
sudo install -m 755 kubeseal /usr/local/bin/kubeseal

# Create secret and seal it
kubectl create secret generic bookstore-api-secrets \
  --from-literal=database-url-main="postgresql://bookstore:YOUR_PASSWORD@..." \
  --from-literal=database-url-search="..." \
  --from-literal=database-url-graph="..." \
  --from-literal=keycloak-client-id="bookstore-api" \
  --from-literal=keycloak-client-secret="YOUR_SECRET" \
  --from-literal=jwt-secret="$(openssl rand -base64 32)" \
  -n bookstore \
  --dry-run=client -o yaml | \
  kubeseal -o yaml > kubernetes/base/secrets/bookstore-api-secrets-sealed.yaml

# Commit sealed secret to Git (it's encrypted!)
git add kubernetes/base/secrets/bookstore-api-secrets-sealed.yaml
git commit -m "Add sealed secrets for bookstore API"
git push
```

---

## 📊 Phase 3: Deploy PostgreSQL Clusters

### Step 1: Deploy Database Clusters

```bash
# Deploy 3 PostgreSQL clusters via ArgoCD
kubectl apply -f gitops/applications/bookstore-databases.yaml

# Or manually:
kubectl apply -k kubernetes/base/databases/

# Wait for clusters to be ready (2-3 minutes)
kubectl get clusters -n bookstore -w
# Wait for all 3 to show "Cluster in healthy state"
```

### Step 2: Run Database Migrations

```bash
# Create ConfigMap with actual migration files
kubectl create configmap database-migrations \
  --from-file=001-search-database.sql=src/api/db/migrations/001-search-database.sql \
  --from-file=002-graph-database.sql=src/api/db/migrations/002-graph-database.sql \
  --from-file=003-cache-leaderboard.sql=src/api/db/migrations/003-cache-leaderboard.sql \
  -n bookstore

# Run migration Jobs
kubectl apply -f kubernetes/base/migrations/init-databases-job.yaml

# Check migration status
kubectl get jobs -n bookstore
kubectl logs -n bookstore job/init-main-database
kubectl logs -n bookstore job/init-search-database
kubectl logs -n bookstore job/init-graph-database
```

---

## 🐳 Phase 4: Build & Push Container Images

### Step 1: Build API Image

```bash
cd src/api

# Build Docker image
docker build -t $CONTAINER_REGISTRY/bookstore-api:$IMAGE_TAG .

# Push to registry
docker push $CONTAINER_REGISTRY/bookstore-api:$IMAGE_TAG

# Tag as latest for dev
docker tag $CONTAINER_REGISTRY/bookstore-api:$IMAGE_TAG $CONTAINER_REGISTRY/bookstore-api:latest
docker push $CONTAINER_REGISTRY/bookstore-api:latest
```

### Step 2: Create Image Pull Secret (if using private registry)

```bash
kubectl create secret docker-registry regcred \
  --docker-server=$CONTAINER_REGISTRY \
  --docker-username=YOUR_USERNAME \
  --docker-password=YOUR_PASSWORD \
  --docker-email=YOUR_EMAIL \
  -n bookstore
```

---

## ☁️ Phase 5: Deploy Knative Services (APIs)

### Step 1: Update Kustomize with Registry

```bash
# Edit kubernetes/overlays/dev/kustomization.yaml
# Replace ${CONTAINER_REGISTRY} and ${IMAGE_TAG} with actual values

# Or use kustomize edit:
cd kubernetes/overlays/dev
kustomize edit set image ${CONTAINER_REGISTRY}/bookstore-api=$CONTAINER_REGISTRY/bookstore-api:$IMAGE_TAG
```

### Step 2: Deploy via ArgoCD

```bash
# Update Git repository URL in gitops/applications/bookstore-api.yaml
# Replace: https://github.com/YOUR_ORG/awsbookstoreconverter.git

# Deploy ArgoCD Application
kubectl apply -f gitops/applications/bookstore-api.yaml

# Watch deployment in ArgoCD UI or CLI
argocd app get bookstore-api
argocd app sync bookstore-api
```

### Step 3: Verify Knative Services

```bash
# Check Knative services
kubectl get ksvc -n bookstore
# Should show 5 services: products-api, cart-api, orders-api, search-api, recommendations-api

# Check if services are ready
kubectl wait --for=condition=Ready ksvc --all -n bookstore --timeout=300s

# Get service URLs
kubectl get ksvc -n bookstore -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.url}{"\n"}{end}'
```

---

## 🌐 Phase 6: Configure Istio Gateway

### Step 1: Deploy Gateway & VirtualService

```bash
# Deploy via ArgoCD
kubectl apply -f gitops/applications/bookstore-gateway.yaml

# Or manually:
kubectl apply -k kubernetes/base/gateway/
```

### Step 2: Update DNS

```bash
# Get Istio Gateway LoadBalancer IP
kubectl get svc -n istio-system istio-ingressgateway
# EXTERNAL-IP: <your-lb-ip>

# Create DNS A records:
# api.bookstore.example.com -> <your-lb-ip>
# bookstore.example.com -> <your-lb-ip>
```

### Step 3: Configure TLS Certificate

```bash
# Option 1: Let's Encrypt with Cert-Manager
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: bookstore-tls-cert
  namespace: bookstore
spec:
  secretName: bookstore-tls-cert
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
    - bookstore.example.com
    - api.bookstore.example.com
EOF

# Option 2: Use existing certificate
kubectl create secret tls bookstore-tls-cert \
  --cert=path/to/tls.crt \
  --key=path/to/tls.key \
  -n bookstore
```

---

## 📦 Phase 7: Deploy Frontend to Object Storage

```bash
cd src/frontend

# Build React app
npm run build

# Configure Linode Object Storage
# Install s3cmd
sudo apt-get install s3cmd  # or: brew install s3cmd

# Configure s3cmd
s3cmd --configure
# Enter Linode Object Storage credentials

# Create bucket
s3cmd mb s3://bookstore-frontend

# Deploy using script
../../deploy-frontend.sh

# Or manually:
s3cmd sync --add-header="Cache-Control: public, max-age=31536000, immutable" \
  --exclude="*.html" dist/ s3://bookstore-frontend/

s3cmd sync --add-header="Cache-Control: no-cache, no-store, must-revalidate" \
  --include="*.html" dist/ s3://bookstore-frontend/

# Configure Akamai CDN (via Linode Cloud Manager)
# - Point CDN to Object Storage bucket
# - Enable HTTPS
# - Update DNS CNAME for bookstore.example.com
```

---

## ✅ Phase 8: Verify Deployment

### 1. Check All Components

```bash
# Check PostgreSQL clusters
kubectl get clusters -n bookstore

# Check Knative services
kubectl get ksvc -n bookstore

# Check Istio gateway
kubectl get gateway -n bookstore

# Check ArgoCD applications
argocd app list

# Check pods
kubectl get pods -n bookstore
```

### 2. Test APIs

```bash
# Test products API
curl https://api.bookstore.example.com/api/products

# Test search API
curl https://api.bookstore.example.com/api/search?q=javascript

# Test health endpoint
curl https://api.bookstore.example.com/health
```

### 3. Access Monitoring

```bash
# Grafana (default password: changeme - CHANGE IT!)
kubectl port-forward svc/kube-prometheus-stack-grafana -n monitoring 3000:80
# Access: http://localhost:3000

# ArgoCD
kubectl port-forward svc/argocd-server -n argocd 8080:443
# Access: https://localhost:8080

# Tekton Dashboard
kubectl port-forward svc/tekton-dashboard -n tekton-pipelines 9097:9097
# Access: http://localhost:9097
```

---

## 🔄 GitOps Workflow

### Making Changes

```bash
# 1. Make changes to code or manifests
vim src/api/src/controllers/products.controller.ts

# 2. Build and push new image
docker build -t $CONTAINER_REGISTRY/bookstore-api:v1.0.1 src/api/
docker push $CONTAINER_REGISTRY/bookstore-api:v1.0.1

# 3. Update kustomization with new tag
cd kubernetes/overlays/dev
kustomize edit set image bookstore-api=$CONTAINER_REGISTRY/bookstore-api:v1.0.1

# 4. Commit and push
git add .
git commit -m "Update products API to v1.0.1"
git push

# 5. ArgoCD automatically syncs (if auto-sync enabled)
# Or manually sync:
argocd app sync bookstore-api

# 6. Watch rollout
kubectl get ksvc -n bookstore -w
```

---

## 🐛 Troubleshooting

### ArgoCD Application Not Syncing

```bash
# Check application status
argocd app get bookstore-api

# Force sync
argocd app sync bookstore-api --force

# Check logs
kubectl logs -n argocd -l app.kubernetes.io/name=argocd-application-controller
```

### Knative Service Not Ready

```bash
# Check service status
kubectl describe ksvc products-api -n bookstore

# Check pods
kubectl get pods -n bookstore -l serving.knative.dev/service=products-api

# Check logs
kubectl logs -n bookstore -l serving.knative.dev/service=products-api -c products-api

# Check events
kubectl get events -n bookstore --sort-by='.lastTimestamp'
```

### Database Connection Issues

```bash
# Check cluster status
kubectl get cluster -n bookstore

# Check pods
kubectl get pods -n bookstore -l postgresql=bookstore-main

# Test connection from pod
kubectl run -it --rm debug --image=postgres:15 --restart=Never -n bookstore -- \
  psql postgresql://bookstore:PASSWORD@bookstore-main-rw.bookstore.svc.cluster.local:5432/bookstore
```

### Image Pull Errors

```bash
# Check if secret exists
kubectl get secret regcred -n bookstore

# Recreate secret
kubectl delete secret regcred -n bookstore
kubectl create secret docker-registry regcred \
  --docker-server=$CONTAINER_REGISTRY \
  --docker-username=YOUR_USERNAME \
  --docker-password=YOUR_PASSWORD \
  -n bookstore
```

---

## 📚 Next Steps

1. **Configure Keycloak**: Set up realms, clients, and users
2. **Setup Monitoring Alerts**: Configure Prometheus AlertManager
3. **Enable Backups**: Configure CloudNative-PG backup to S3
4. **Setup CI/CD**: Configure Tekton Pipelines with GitHub webhooks
5. **Production Hardening**: Review security policies, resource limits

---

## 📖 Additional Resources

- [Akamai App Platform Core](https://github.com/linode/apl-core)
- [ArgoCD Documentation](https://argo-cd.readthedocs.io/)
- [Knative Serving Documentation](https://knative.dev/docs/serving/)
- [CloudNative-PG Documentation](https://cloudnative-pg.io/)
- [Istio Documentation](https://istio.io/latest/docs/)

---

**Need help?** Open an issue on GitHub or check our troubleshooting guide.
