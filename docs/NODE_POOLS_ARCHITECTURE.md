# 🏗️ Architecture Node Pools - Déploiement Bookstore sur APL/LKE

## Vue d'Ensemble

Ce document définit la **stratégie optimale de node pools** pour déployer l'ensemble de la stack Bookstore sur Akamai App Platform (LKE), avec une répartition efficace des ressources et une isolation des charges de travail.

---

## 📊 Inventaire des Composants à Déployer

### Composants APL Core (Déjà inclus)

| Composant | Type | Ressources | Criticité | Caractéristique |
|-----------|------|------------|-----------|-----------------|
| **Gitea** | Stateful | Medium | Haute | I/O intensif (Git repos) |
| **Tekton Pipelines** | Stateless | Variable | Haute | Burst CPU (builds) |
| **Tekton Triggers** | Stateless | Low | Haute | Léger, événementiel |
| **Tekton Dashboard** | Stateless | Low | Moyenne | UI web |
| **ArgoCD** | Stateful | Low-Medium | Haute | GitOps controller |
| **Istio** (Control Plane) | Stateless | Medium | Critique | Service mesh |
| **Istio** (Data Plane) | Sidecar | Low/pod | Critique | Proxies Envoy |
| **Knative** (Serving) | Stateless | Low | Haute | Serverless controller |
| **CloudNative-PG Operator** | Stateless | Low | Critique | Database operator |
| **Keycloak** | Stateful | Medium | Haute | Auth, session store |
| **Cert-Manager** | Stateless | Low | Haute | TLS automation |

### Applications Bookstore

| Composant | Type | Ressources | Criticité | Caractéristique |
|-----------|------|------------|-----------|-----------------|
| **API Backend** (Knative) | Stateless | Medium | Haute | Scale-to-zero |
| **Products Service** | Stateless | Low | Haute | CRUD operations |
| **Cart Service** | Stateless | Low | Haute | Session-based |
| **Orders Service** | Stateless | Low | Haute | Transactional |
| **Search Service** | Stateless | Medium | Moyenne | CPU intensif |
| **Recommendations** | Stateless | Medium | Moyenne | Graph queries |

### Bases de Données

| Composant | Type | Ressources | Criticité | Caractéristique |
|-----------|------|------------|-----------|-----------------|
| **PostgreSQL Main** | Stateful | High | Critique | I/O intensif, 3 instances HA |
| **PostgreSQL Search** | Stateful | Medium | Haute | Full-text search, 2 instances |
| **PostgreSQL Graph** | Stateful | Medium | Haute | Apache AGE, 2 instances |

### Monitoring

| Composant | Type | Ressources | Criticité | Caractéristique |
|-----------|------|------------|-----------|-----------------|
| **Prometheus** | Stateful | Medium | Haute | Métriques time-series |
| **Grafana** | Stateless | Low | Moyenne | UI dashboards |
| **Loki** | Stateful | Medium | Moyenne | Logs aggregation |
| **Jaeger** | Stateful | Medium | Moyenne | Distributed tracing |

---

## 🌐 Architecture Réseau Complète

### Flux Utilisateur et Séparation Frontend/Backend

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET                                 │
└──────────────┬──────────────────────────┬───────────────────────┘
               │                          │
               │ Frontend (Statique)      │ Backend (Dynamique)
               ▼                          ▼
    ┌──────────────────────┐   ┌──────────────────────────┐
    │  Akamai CDN          │   │  NodeBalancer (LKE)      │
    └──────────┬───────────┘   └──────────┬───────────────┘
               │                          │
               ▼                          ▼
    ┌──────────────────────┐   ┌──────────────────────────┐
    │ Linode Object        │   │ Istio Ingress Gateway    │
    │ Storage (S3)         │   │ (Node Pool 2)            │
    │                      │   └──────────┬───────────────┘
    │ ❌ PAS K8S           │              │
    │ ❌ PAS ISTIO         │              │ VirtualService
    └──────────────────────┘              ▼
                              ┌──────────────────────────┐
                              │ Knative Services         │
                              │ (Node Pool 3)            │
                              │ • bookstore-api          │
                              │ • products-svc           │
                              │ • cart-svc               │
                              │ • orders-svc             │
                              │ • search-svc             │
                              │ • recommendations-svc    │
                              └──────────┬───────────────┘
                                         │
                                         ▼
                              ┌──────────────────────────┐
                              │ CloudNative-PG           │
                              │ (Node Pool 4)            │
                              │ • bookstore-db           │
                              │ • search-db              │
                              │ • graph-db               │
                              └──────────────────────────┘
```

**Points Clés** :
- ✅ **Frontend React** → Object Storage + CDN (HORS Kubernetes)
- ✅ **Ingress Gateway** → Uniquement pour APIs backend (Knative Services)
- ✅ **70-80% du trafic HTTP** → Géré par S3/CDN, pas par K8s
- ✅ **Charge réduite** sur l'Ingress Gateway

### Configuration DNS

```bash
# Frontend - Object Storage + CDN (PAS dans Kubernetes)
bookstore.example.com            CNAME   akamai.cdn.example.com
akamai.cdn.example.com           CNAME   us-east-1.linodeobjects.com

# Backend API - Istio Ingress Gateway (DANS Kubernetes)
api.bookstore.example.com        A       <NodeBalancer IP LKE>

# Authentification - Keycloak (DANS Kubernetes)
auth.bookstore.example.com       A       <NodeBalancer IP LKE>
```

---

## 🏗️ APL Core : Opérateurs vs Instances

### Distinction Importante

**APL Core fournit les OPÉRATEURS (Pool 1)** :
- Knative Serving Controller → Gère les Knative Services
- CloudNative-PG Operator → Gère les PostgreSQL Clusters
- Istio Control Plane → Gère le service mesh

**Nous créons les INSTANCES applicatives (Pools 2-4)** :
- Knative Services → Gérées par Knative (APL)
- PostgreSQL Clusters → Gérés par CNPG (APL)
- Istio Gateways → Gérés par Istio (APL)

```
┌─────────────────────────────────────────────────────────────┐
│                    APL CORE ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────┤
│ Pool 1: Opérateurs APL Core                                 │
│  ├─ Knative Serving Controller  ← Fourni par APL           │
│  ├─ CloudNative-PG Operator     ← Fourni par APL           │
│  ├─ Istio Control Plane         ← Fourni par APL           │
│  └─ Tekton, ArgoCD, Gitea...    ← Fourni par APL           │
│                                                              │
│ Pool 2: Istio Data Plane (géré par APL Istio)               │
│  └─ istio-ingressgateway        ← Utilise Istio APL        │
│                                                              │
│ Pool 3: Instances Knative (géré par APL Knative)            │
│  └─ bookstore-api, products...  ← Utilise Knative APL      │
│                                                              │
│ Pool 4: Instances CNPG (géré par APL CNPG)                  │
│  └─ bookstore-db, search-db...  ← Utilise CNPG APL         │
└─────────────────────────────────────────────────────────────┘
```

**100% APL Core** : Tous les composants sont fournis ou gérés par APL ! 🎯

---

## 🎯 Stratégie de Node Pools Recommandée

### Option 1 : Production (5 Node Pools) - Recommandé

```
┌────────────────────────────────────────────────────────────────┐
│                    LKE CLUSTER ARCHITECTURE                     │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  NODE POOL 1: CONTROL PLANE (APL Core Operators)         │ │
│  │  ─────────────────────────────────────────────────────── │ │
│  │  Type: g6-standard-4 (4 vCPU, 8 GB RAM)                  │ │
│  │  Nodes: 3 (HA)                                           │ │
│  │  Auto-scale: 3-5                                         │ │
│  │                                                           │ │
│  │  Workloads APL Core (Opérateurs):                        │ │
│  │  • Gitea                    (Git repository)             │ │
│  │  • ArgoCD                   (GitOps controller)          │ │
│  │  • Tekton Controllers       (CI/CD)                      │ │
│  │  • Istio Control Plane      (istiod)                     │ │
│  │  • Knative Serving          (Controllers)                │ │
│  │  • Cert-Manager             (TLS)                        │ │
│  │  • CloudNative-PG Operator  (DB Operator)                │ │
│  │  • Keycloak                 (Auth server)                │ │
│  │                                                           │ │
│  │  Labels: role=control-plane, workload=apl-core          │ │
│  │  Taints: None (accepte tous les workloads si besoin)    │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  NODE POOL 2: INGRESS GATEWAYS (Istio Data Plane) ⭐     │ │
│  │  ─────────────────────────────────────────────────────── │ │
│  │  Type: g6-standard-2 (2 vCPU, 4 GB RAM)                  │ │
│  │  Nodes: 2 (HA)                                           │ │
│  │  Auto-scale: 2-4 (selon trafic API)                     │ │
│  │                                                           │ │
│  │  Workloads (géré par Istio APL):                         │ │
│  │  • istio-ingressgateway     (API traffic)                │ │
│  │    - api.bookstore.example.com                           │ │
│  │    - auth.bookstore.example.com (Keycloak)               │ │
│  │                                                           │ │
│  │  ❌ PAS le frontend (sur Object Storage)                │ │
│  │  ✅ Uniquement trafic backend APIs                       │ │
│  │                                                           │ │
│  │  Labels: role=ingress, workload=gateway                 │ │
│  │  Taints: workload=ingress:NoSchedule                    │ │
│  │  Exposition: NodeBalancer (LoadBalancer type)           │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  NODE POOL 3: APPLICATIONS (Knative Services)            │ │
│  │  ─────────────────────────────────────────────────────── │ │
│  │  Type: g6-standard-2 (2 vCPU, 4 GB RAM)                  │ │
│  │  Nodes: 3 (HA)                                           │ │
│  │  Auto-scale: 3-10 (burst support)                       │ │
│  │                                                           │ │
│  │  Workloads (géré par Knative APL):                       │ │
│  │  • Products API             (Knative Service)            │ │
│  │  • Cart API                 (Knative Service)            │ │
│  │  • Orders API               (Knative Service)            │ │
│  │  • Search API               (Knative Service)            │ │
│  │  • Recommendations API      (Knative Service)            │ │
│  │  • Istio Sidecars           (Envoy proxies)              │ │
│  │                                                           │ │
│  │  Labels: role=application, workload=knative             │ │
│  │  Taints: workload=application:NoSchedule                │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  NODE POOL 4: DATABASES (CloudNative-PG)                 │ │
│  │  ─────────────────────────────────────────────────────── │ │
│  │  Type: g6-dedicated-4 (4 vCPU, 16 GB RAM, NVMe)          │ │
│  │  Nodes: 3 (HA pour 3 clusters PG)                       │ │
│  │  Auto-scale: NO (stable database sizing)                │ │
│  │                                                           │ │
│  │  Workloads (géré par CloudNative-PG APL):                │ │
│  │  • PostgreSQL Main Cluster  (3 instances)                │ │
│  │  • PostgreSQL Search        (2 instances)                │ │
│  │  • PostgreSQL Graph         (2 instances)                │ │
│  │                                                           │ │
│  │  Labels: role=database, workload=postgres               │ │
│  │  Taints: workload=database:NoSchedule                   │ │
│  │  Local SSD: YES (performance I/O)                       │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  NODE POOL 5: CI/CD BUILDS (Tekton Pipelines)            │ │
│  │  ─────────────────────────────────────────────────────── │ │
│  │  Type: g6-standard-4 (4 vCPU, 8 GB RAM)                  │ │
│  │  Nodes: 0-1 (peut être 0 si pas de builds)              │ │
│  │  Auto-scale: 0-5 (scale to zero)                        │ │
│  │                                                           │ │
│  │  Workloads (géré par Tekton APL):                        │ │
│  │  • Tekton PipelineRuns      (npm build, Docker build)    │ │
│  │  • TaskRuns                 (git-clone, s3-upload)       │ │
│  │  • Build Workspaces         (PVC temporaires)            │ │
│  │                                                           │ │
│  │  Labels: role=build, workload=tekton                    │ │
│  │  Taints: workload=build:NoSchedule                      │ │
│  │  Preemptible: YES (cost optimization)                   │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  NODE POOL 6: MONITORING (Optionnel)                     │ │
│  │  ─────────────────────────────────────────────────────── │ │
│  │  Type: g6-standard-2 (2 vCPU, 4 GB RAM)                  │ │
│  │  Nodes: 2                                                │ │
│  │  Auto-scale: 2-3                                         │ │
│  │                                                           │ │
│  │  Workloads:                                              │ │
│  │  • Prometheus               (Metrics)                    │ │
│  │  • Grafana                  (Dashboards)                 │ │
│  │  • Loki                     (Logs)                       │ │
│  │  • Jaeger                   (Tracing)                    │ │
│  │                                                           │ │
│  │  Labels: role=monitoring, workload=observability        │ │
│  │  Taints: workload=monitoring:NoSchedule                 │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### Option 2 : Coût Optimisé (3 Node Pools)

Pour réduire les coûts, fusionner Monitoring avec Control Plane :

```
┌────────────────────────────────────────────────────────────────┐
│  NODE POOL 1: CONTROL PLANE + MONITORING                       │
│  Type: g6-standard-4 (4 vCPU, 8 GB RAM) × 3 nodes             │
│  APL Core + Prometheus + Grafana + Loki                       │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  NODE POOL 2: APPLICATIONS                                     │
│  Type: g6-standard-2 (2 vCPU, 4 GB RAM) × 3-10 nodes          │
│  Knative Services (scale-to-zero)                             │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  NODE POOL 3: DATABASES + BUILDS                               │
│  Type: g6-dedicated-4 (4 vCPU, 16 GB RAM) × 3 nodes           │
│  CloudNative-PG + Tekton builds (avec taints)                 │
└────────────────────────────────────────────────────────────────┘
```

### Option 3 : Développement (1-2 Node Pools)

Pour environnement dev/staging :

```
┌────────────────────────────────────────────────────────────────┐
│  NODE POOL 1: ALL-IN-ONE                                       │
│  Type: g6-standard-4 (4 vCPU, 8 GB RAM) × 3 nodes             │
│  Tout dans le même pool (sans isolation)                      │
└────────────────────────────────────────────────────────────────┘
```

---

## 📐 Sizing Détaillé par Node Pool

### Node Pool 1 : Control Plane (APL Core)

**Instance Type** : `g6-standard-4`
- **vCPU** : 4
- **RAM** : 8 GB
- **Stockage** : 80 GB SSD
- **Réseau** : 4 Gbps

**Nombre de nodes** : 3 (HA)
**Auto-scaling** : 3-5

**Répartition des ressources** :

| Composant | Pods | CPU (request) | RAM (request) | Total CPU | Total RAM |
|-----------|------|---------------|---------------|-----------|-----------|
| Gitea | 2 | 500m | 1Gi | 1000m | 2Gi |
| ArgoCD | 5 | 250m | 512Mi | 1250m | 2.5Gi |
| Tekton Triggers | 3 | 100m | 128Mi | 300m | 384Mi |
| Istio (istiod) | 2 | 500m | 2Gi | 1000m | 4Gi |
| Knative Serving | 4 | 100m | 100Mi | 400m | 400Mi |
| Keycloak | 2 | 500m | 1Gi | 1000m | 2Gi |
| Cert-Manager | 3 | 100m | 128Mi | 300m | 384Mi |
| CloudNative-PG Op | 1 | 100m | 128Mi | 100m | 128Mi |
| **Total** | **22** | - | - | **~5.4 CPU** | **~12Gi** |

**Répartition sur 3 nodes** :
- Par node : ~1.8 CPU, ~4Gi RAM
- **Utilisation** : ~45% CPU, ~50% RAM
- **Headroom** : 55% pour burst et nouveaux pods

**Coût mensuel** : ~$96/mois (3 × $32/mois)

---

### Node Pool 2 : Ingress Gateways (Istio Data Plane)

**Instance Type** : `g6-standard-2`
- **vCPU** : 2
- **RAM** : 4 GB
- **Stockage** : 50 GB SSD
- **Réseau** : 2 Gbps (important pour gateway)

**Nombre de nodes** : 2 (HA)
**Auto-scaling** : 2-4

**Rôle** : Point d'entrée pour TOUT le trafic backend API

**Répartition des ressources** :

| Composant | Replicas | CPU (request) | RAM (request) | CPU (limit) | RAM (limit) |
|-----------|----------|---------------|---------------|-------------|-------------|
| istio-ingressgateway | 2 | 500m | 512Mi | 2000m | 2Gi |

**Configuration Istio Gateway** :

```yaml
# kubernetes/base/gateway/istio-ingressgateway.yaml
apiVersion: v1
kind: Service
metadata:
  name: istio-ingressgateway
  namespace: istio-system
  annotations:
    service.beta.kubernetes.io/linode-loadbalancer-throttle: "20"
spec:
  type: LoadBalancer  # → NodeBalancer LKE
  selector:
    app: istio-ingressgateway
  ports:
  - name: http
    port: 80
    targetPort: 8080
  - name: https
    port: 443
    targetPort: 8443

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: istio-ingressgateway
  namespace: istio-system
spec:
  replicas: 2  # HA
  selector:
    matchLabels:
      app: istio-ingressgateway
  template:
    metadata:
      labels:
        app: istio-ingressgateway
    spec:
      nodeSelector:
        workload.type: gateway
      tolerations:
      - key: workload
        operator: Equal
        value: ingress
        effect: NoSchedule
      containers:
      - name: istio-proxy
        image: gcr.io/istio-release/proxyv2:1.20.0
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 2000m
            memory: 2Gi
```

**Services Exposés via ce Gateway** :

```yaml
# Gateway configuration
apiVersion: networking.istio.io/v1beta1
kind: Gateway
metadata:
  name: bookstore-gateway
  namespace: bookstore
spec:
  selector:
    app: istio-ingressgateway  # Pool 2
  servers:
  - port:
      number: 443
      name: https
      protocol: HTTPS
    tls:
      mode: SIMPLE
      credentialName: bookstore-tls
    hosts:
    - "api.bookstore.example.com"      # ✅ Backend APIs
    - "auth.bookstore.example.com"     # ✅ Keycloak
    # PAS bookstore.example.com         # ❌ Frontend (S3)
```

**CORS Configuration** :

```yaml
# VirtualService avec CORS pour frontend S3
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: bookstore-api
  namespace: bookstore
spec:
  hosts:
  - "api.bookstore.example.com"
  gateways:
  - bookstore-gateway
  http:
  - corsPolicy:
      allowOrigins:
      - exact: "https://bookstore.example.com"  # Frontend S3
      allowMethods:
      - GET
      - POST
      - PUT
      - DELETE
      allowHeaders:
      - authorization
      - content-type
      maxAge: "24h"
    route:
    - destination:
        host: products-svc.bookstore.svc.cluster.local
      weight: 100
```

**Charge attendue** :
- Uniquement trafic **APIs backend** (pas de frontend statique)
- ~20-30% du trafic total (70% géré par S3/CDN)
- CPU : ~1 CPU total (0.5 CPU par node)
- RAM : ~1Gi total (512Mi par node)

**Utilisation par node** :
- CPU : ~25% (headroom pour burst)
- RAM : ~13% (très léger)

**Auto-scaling** :
- 2 nodes (normal) → 4 nodes (pic de trafic API)
- Triggers : >70% CPU ou >10000 req/s

**Coût mensuel** :
- Nodes (2 × $36/mois) : ~$72/mois
- NodeBalancer (inclus dans LKE) : $0
- **Total** : **$72/mois**

---

### Node Pool 3 : Applications (Knative Services)

**Instance Type** : `g6-standard-2`
- **vCPU** : 2
- **RAM** : 4 GB
- **Stockage** : 50 GB SSD
- **Réseau** : 2 Gbps

**Nombre de nodes** : 3-10 (auto-scale)
**Auto-scaling** : 3-10

**Répartition des ressources** :

| Service | Replicas (min-max) | CPU (request) | RAM (request) | CPU (max) | RAM (max) |
|---------|-------------------|---------------|---------------|-----------|-----------|
| Products API | 1-3 | 250m | 256Mi | 500m | 512Mi |
| Cart API | 1-3 | 250m | 256Mi | 500m | 512Mi |
| Orders API | 1-3 | 250m | 256Mi | 500m | 512Mi |
| Search API | 1-5 | 500m | 512Mi | 1000m | 1Gi |
| Recommendations | 1-3 | 500m | 512Mi | 1000m | 1Gi |
| Istio Sidecars | 1/pod | 100m | 128Mi | 200m | 256Mi |

**Charge moyenne** (5 services, 2 replicas chacun) :
- **Total** : ~10 pods applicatifs + 10 sidecars = 20 pods
- **CPU** : ~4 CPU
- **RAM** : ~5 Gi

**Répartition sur 3 nodes** (charge normale) :
- Par node : ~1.3 CPU, ~1.7Gi RAM
- **Utilisation** : ~65% CPU, ~42% RAM

**Scale-out** : Jusqu'à 10 nodes en peak (Knative auto-scale)

**Coût mensuel** :
- Base (3 nodes) : ~$48/mois
- Peak (10 nodes) : ~$160/mois
- **Moyenne** : ~$80-100/mois

---

### Node Pool 3 : Databases (CloudNative-PG)

**Instance Type** : `g6-dedicated-4`
- **vCPU** : 4 (dedicated)
- **RAM** : 16 GB
- **Stockage** : 200 GB NVMe SSD (local)
- **I/O** : High performance

**Nombre de nodes** : 3 (fixed, HA)
**Auto-scaling** : NO (databases need stable resources)

**Répartition des ressources** :

| Cluster | Instances | CPU/instance | RAM/instance | Total CPU | Total RAM | Storage/instance |
|---------|-----------|--------------|--------------|-----------|-----------|------------------|
| PG Main | 3 | 1000m | 4Gi | 3000m | 12Gi | 50Gi |
| PG Search | 2 | 500m | 2Gi | 1000m | 4Gi | 30Gi |
| PG Graph | 2 | 500m | 2Gi | 1000m | 4Gi | 30Gi |
| **Total** | **7** | - | - | **5 CPU** | **20Gi** | **~250Gi** |

**Répartition sur 3 nodes** :
- Node 1 : PG Main primary + PG Search replica
- Node 2 : PG Main standby + PG Graph primary
- Node 3 : PG Main standby + PG Search primary + PG Graph replica

**Utilisation par node** :
- CPU : ~1.7 CPU (42%)
- RAM : ~6.7 Gi (42%)
- **Headroom** : 58% pour cache PostgreSQL et burst

**Volumes** : Block Storage (high IOPS)
- 3 × 50Gi (PG Main)
- 2 × 30Gi (PG Search)
- 2 × 30Gi (PG Graph)
- **Total** : 210Gi Block Storage

**Coût mensuel** :
- Nodes (3 × $96/mois) : ~$288/mois
- Block Storage (210Gi × $0.10/Gi) : ~$21/mois
- **Total** : ~$309/mois

---

### Node Pool 5 : CI/CD Builds (Tekton)

**Instance Type** : `g6-standard-4`
- **vCPU** : 4
- **RAM** : 8 GB
- **Stockage** : 80 GB SSD

**Nombre de nodes** : 0-5 (auto-scale to zero)
**Auto-scaling** : 0-5 (scale from zero)

**Charge par build** :

| Build Type | CPU | RAM | Duration | Nodes needed |
|------------|-----|-----|----------|--------------|
| Frontend (React) | 2 CPU | 2Gi | ~2 min | 1 node |
| API (Docker) | 2 CPU | 3Gi | ~3 min | 1 node |
| Parallel builds | 4+ CPU | 6Gi | ~3 min | 2-3 nodes |

**Pattern d'utilisation** :
- **Idle** : 0 nodes (scale to zero)
- **1 build** : 1 node
- **Builds simultanés** : 2-5 nodes
- **Post-build** : Scale down après 10 min

**Coût mensuel** :
- Build fréquence : 50 builds/mois
- Durée moyenne : 3 min/build
- Temps actif : 150 min/mois = 2.5h
- **Coût** : ~$2-5/mois (usage minimal, pay-as-you-go)

**Option** : Utiliser des nodes **Preemptible** (50% moins cher)

---

### Node Pool 6 : Monitoring (Optionnel)

**Instance Type** : `g6-standard-2`
- **vCPU** : 2
- **RAM** : 4 GB
- **Stockage** : 50 GB SSD

**Nombre de nodes** : 2-3
**Auto-scaling** : 2-3

**Répartition des ressources** :

| Composant | Replicas | CPU | RAM | Storage |
|-----------|----------|-----|-----|---------|
| Prometheus | 2 | 500m | 2Gi | 50Gi |
| Grafana | 2 | 250m | 512Mi | 5Gi |
| Loki | 2 | 500m | 1Gi | 30Gi |
| Jaeger | 1 | 250m | 512Mi | 10Gi |

**Total** :
- CPU : ~2 CPU
- RAM : ~6 Gi
- Storage : ~95 Gi (Block Storage)

**Répartition sur 2 nodes** :
- Par node : ~1 CPU, ~3Gi RAM
- **Utilisation** : ~50% CPU, ~75% RAM

**Coût mensuel** :
- Nodes (2 × $24/mois) : ~$48/mois
- Block Storage (95Gi × $0.10) : ~$9.50/mois
- **Total** : ~$57.50/mois

---

## 🏷️ Configuration Labels et Taints

### Labels de Node

```yaml
# Node Pool 1: Control Plane
node.kubernetes.io/role: control-plane
workload.type: apl-core
environment: production

# Node Pool 2: Ingress Gateways
node.kubernetes.io/role: ingress
workload.type: gateway
network.intensive: "true"
environment: production

# Node Pool 3: Applications
node.kubernetes.io/role: application
workload.type: knative
environment: production

# Node Pool 4: Databases
node.kubernetes.io/role: database
workload.type: postgres
storage.type: high-iops
environment: production

# Node Pool 5: Builds
node.kubernetes.io/role: build
workload.type: tekton
cost.optimization: preemptible
environment: ci-cd

# Node Pool 6: Monitoring
node.kubernetes.io/role: monitoring
workload.type: observability
environment: production
```

### Taints de Node

```yaml
# Node Pool 2: Ingress Gateways (force gateways only)
taints:
- key: workload
  value: ingress
  effect: NoSchedule

# Node Pool 3: Applications (force Knative services only)
taints:
- key: workload
  value: application
  effect: NoSchedule

# Node Pool 4: Databases (force databases only)
taints:
- key: workload
  value: database
  effect: NoSchedule

# Node Pool 5: Builds (force builds only)
taints:
- key: workload
  value: build
  effect: NoSchedule

# Node Pool 6: Monitoring (force monitoring only)
taints:
- key: workload
  value: monitoring
  effect: NoSchedule
```

### Tolerations dans les Pods

```yaml
# Istio Ingress Gateway (Pool 2)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: istio-ingressgateway
  namespace: istio-system
spec:
  template:
    spec:
      nodeSelector:
        workload.type: gateway
      tolerations:
      - key: workload
        operator: Equal
        value: ingress
        effect: NoSchedule

# Knative Services (Applications - Pool 3)
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: products-api
spec:
  template:
    spec:
      nodeSelector:
        workload.type: knative
      tolerations:
      - key: workload
        operator: Equal
        value: application
        effect: NoSchedule

# CloudNative-PG Clusters (Databases)
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: bookstore-main
spec:
  affinity:
    nodeSelector:
      workload.type: postgres
    tolerations:
    - key: workload
      operator: Equal
      value: database
      effect: NoSchedule

# Tekton PipelineRuns (Builds)
apiVersion: tekton.dev/v1beta1
kind: PipelineRun
metadata:
  name: frontend-build
spec:
  podTemplate:
    nodeSelector:
      workload.type: tekton
    tolerations:
    - key: workload
      operator: Equal
      value: build
      effect: NoSchedule
```

---

## 💰 Analyse des Coûts

### Option 1 : Production (5-6 Node Pools)

| Node Pool | Type | Nodes | Prix/node | Sous-total |
|-----------|------|-------|-----------|------------|
| 1. Control Plane | g6-standard-4 | 3 | $72 | $216 |
| 2. Ingress Gateways | g6-standard-2 | 2 | $36 | $72 |
| 3. Applications | g6-standard-2 | 3-10 | $36 | $108-360 |
| 4. Databases | g6-dedicated-4 | 3 | $72 | $216 |
| 5. Builds | g6-standard-4 | 0-2 | $72 | $0-144 |
| 6. Monitoring | g6-standard-2 | 2 | $36 | $72 |
| **Subtotal Compute** | | | | **$684-1080/mois** |
| Block Storage (DBs) | | 210 Gi | $0.10/Gi | $21 |
| Object Storage (Frontend) | | 500 Gi + CDN | ~$10/mois | $10 |
| Bandwidth | | 1 TB | Included | $0 |
| **TOTAL K8s** | | | | **~$705-1111/mois** |
| **TOTAL avec S3** | | | | **~$715-1121/mois** |

**Moyenne Production HA** : ~$800/mois (K8s + Object Storage + CDN)

### Option 2 : Coût Optimisé (4 Node Pools)

Fusionner Control Plane + Monitoring, et Ingress + Applications :

| Configuration | Coût mensuel |
|---------------|--------------|
| 1. Control Plane + Monitoring (3× g6-standard-4) | $216 |
| 2. Ingress + Applications (3-8× g6-standard-2) | $108-288 |
| 3. Databases (3× g6-dedicated-4) | $216 |
| 4. Builds (0-2× g6-standard-4) | $0-144 |
| Storage + Object Storage | $31 |
| **TOTAL** | **~$571-895/mois** |

**Moyenne** : ~$650/mois

### Option 3 : Développement (2 Node Pools)

| Configuration | Coût mensuel |
|---------------|--------------|
| 1. Control Plane + Ingress (3× g6-standard-2) | $108 |
| 2. Apps + DBs (3× g6-standard-4) | $216 |
| Storage minimal | $15 |
| **TOTAL** | **~$339/mois** |

---

## 📈 Stratégies d'Auto-scaling

### Cluster Autoscaler Configuration

```yaml
# Applications Node Pool
apiVersion: v1
kind: ConfigMap
metadata:
  name: cluster-autoscaler-config
data:
  application-pool: |
    minNodes: 3
    maxNodes: 10
    scaleUpUtilizationThreshold: 0.70
    scaleDownUtilizationThreshold: 0.40
    scaleDownDelayAfterAdd: 10m
    scaleDownUnneededTime: 10m

# Builds Node Pool
  build-pool: |
    minNodes: 0
    maxNodes: 5
    scaleUpUtilizationThreshold: 0.80
    scaleDownUtilizationThreshold: 0.30
    scaleDownDelayAfterAdd: 5m
    scaleDownUnneededTime: 5m  # Fast scale-down
```

### Horizontal Pod Autoscaler (HPA)

```yaml
# Knative Services (auto-scale par défaut)
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: products-api
spec:
  scaleTargetRef:
    apiVersion: serving.knative.dev/v1
    kind: Service
    name: products-api
  minReplicas: 1
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

---

## 🚀 Déploiement Terraform (LKE)

```hcl
# terraform/lke-node-pools.tf

resource "linode_lke_cluster" "bookstore" {
  label       = "bookstore-apl-cluster"
  k8s_version = "1.28"
  region      = "us-east"
  tags        = ["bookstore", "apl-core", "production"]

  # Node Pool 1: Control Plane
  pool {
    type  = "g6-standard-4"
    count = 3
    autoscaler {
      min = 3
      max = 5
    }
    labels = {
      "node.kubernetes.io/role" = "control-plane"
      "workload.type"           = "apl-core"
    }
  }

  # Node Pool 2: Ingress Gateways
  pool {
    type  = "g6-standard-2"
    count = 2
    autoscaler {
      min = 2
      max = 4
    }
    labels = {
      "node.kubernetes.io/role" = "ingress"
      "workload.type"           = "gateway"
      "network.intensive"       = "true"
    }
    taints {
      key    = "workload"
      value  = "ingress"
      effect = "NoSchedule"
    }
  }

  # Node Pool 3: Applications
  pool {
    type  = "g6-standard-2"
    count = 3
    autoscaler {
      min = 3
      max = 10
    }
    labels = {
      "node.kubernetes.io/role" = "application"
      "workload.type"           = "knative"
    }
    taints {
      key    = "workload"
      value  = "application"
      effect = "NoSchedule"
    }
  }

  # Node Pool 4: Databases
  pool {
    type  = "g6-dedicated-4"
    count = 3
    autoscaler {
      min = 3
      max = 3  # Fixed size for databases
    }
    labels = {
      "node.kubernetes.io/role" = "database"
      "workload.type"           = "postgres"
      "storage.type"            = "high-iops"
    }
    taints {
      key    = "workload"
      value  = "database"
      effect = "NoSchedule"
    }
  }

  # Node Pool 5: Builds
  pool {
    type  = "g6-standard-4"
    count = 0
    autoscaler {
      min = 0
      max = 5
    }
    labels = {
      "node.kubernetes.io/role" = "build"
      "workload.type"           = "tekton"
    }
    taints {
      key    = "workload"
      value  = "build"
      effect = "NoSchedule"
    }
  }

  # Node Pool 6: Monitoring (Optionnel)
  pool {
    type  = "g6-standard-2"
    count = 2
    autoscaler {
      min = 2
      max = 3
    }
    labels = {
      "node.kubernetes.io/role" = "monitoring"
      "workload.type"           = "observability"
    }
    taints {
      key    = "workload"
      value  = "monitoring"
      effect = "NoSchedule"
    }
  }
}
```

---

## 📊 Comparaison : Coûts vs Isolation

| Approche | Node Pools | Coût/mois | Isolation | Performance | HA | Recommandé pour |
|----------|------------|-----------|-----------|-------------|----|--------------------|
| **Minimal Dev** | 2 | $339 | ⭐⭐ | ⭐⭐ | ⭐⭐ | Dev/Test |
| **Optimisé** | 4 | $571-895 | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Staging/Prod budget |
| **Production HA** | 5-6 | $715-1121 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Production HA |

---

## ✅ Recommandations Finales

### Pour Production HA (Recommandé)

**5-6 Node Pools** :
1. **Control Plane** (3× g6-standard-4) - APL Core Opérateurs
2. **Ingress Gateways** (2× g6-standard-2) - Istio Data Plane ⭐ NOUVEAU
3. **Applications** (3-10× g6-standard-2) - Knative Services avec auto-scale
4. **Databases** (3× g6-dedicated-4) - CloudNative-PG avec I/O haute performance
5. **Builds** (0-5× g6-standard-4) - Tekton avec scale-to-zero
6. **Monitoring** (2× g6-standard-2) - Prometheus/Grafana (optionnel)

**Points clés** :
- ✅ **Frontend** → Object Storage + Akamai CDN (HORS Kubernetes)
- ✅ **Ingress Gateway** → Uniquement pour APIs backend
- ✅ **70-80% du trafic** → Géré par S3/CDN, pas par K8s
- ✅ Isolation complète des charges de travail
- ✅ Performance optimale (databases sur nodes dédiés)
- ✅ Cost control (builds scale-to-zero)
- ✅ HA garantie (minimum 2 nodes partout)

**Coût** : ~$800/mois (incluant Object Storage + CDN)

### Pour Staging/Production Budget

**4 Node Pools** (fusionné) :
1. **Control Plane + Monitoring** (3× g6-standard-4)
2. **Ingress + Applications** (3-8× g6-standard-2)
3. **Databases** (3× g6-dedicated-4)
4. **Builds** (0-2× g6-standard-4)

**Coût** : ~$650/mois

### Pour Dev/Test

**2 Node Pools** :
1. **Control Plane + Ingress** (3× g6-standard-2)
2. **Apps + DBs** (3× g6-standard-4)

**Coût** : ~$339/mois

---

## 🎯 Résumé Exécutif

| Environnement | Node Pools | Nodes Total | Coût/mois | Use Case |
|---------------|------------|-------------|-----------|----------|
| **Production HA** | 5-6 | 13-27 | $715-1121 | Production HA, isolation complète |
| **Staging/Prod Budget** | 4 | 9-16 | $571-895 | Pre-production, prod budget |
| **Dev/Test** | 2 | 6 | $339 | Développement, CI |

**Architecture Clé** :
- 🌐 **Frontend** : Object Storage + Akamai CDN (70-80% du trafic, HORS K8s)
- 🚪 **Ingress** : Pool dédié pour Istio Gateway (APIs backend uniquement)
- 🚀 **Applications** : Pool Knative auto-scale (scale-to-zero)
- 💾 **Databases** : Pool dédié haute performance (NVMe, I/O optimisé)
- 🔨 **Builds** : Pool scale-to-zero Tekton (coût optimisé)

**Recommandation** : Démarrer avec **4 node pools (Option Optimisée)** pour équilibrer coût/performance, puis migrer vers **5-6 pools** pour production HA à haute charge.

**Points Critiques** :
- ✅ Tous les composants gérés par **APL Core** (100% CNCF stack)
- ✅ Séparation frontend statique (S3) vs backend dynamique (K8s)
- ✅ Pool Ingress Gateway **essentiel** pour isolation du trafic API
- ✅ Auto-scaling intelligent (applications et builds)
