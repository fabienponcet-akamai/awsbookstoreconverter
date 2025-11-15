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

## 🎯 Stratégie de Node Pools Recommandée

### Option 1 : Production (4 Node Pools) - Recommandé

```
┌────────────────────────────────────────────────────────────────┐
│                    LKE CLUSTER ARCHITECTURE                     │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  NODE POOL 1: CONTROL PLANE (APL Core)                   │ │
│  │  ─────────────────────────────────────────────────────── │ │
│  │  Type: g6-standard-4 (4 vCPU, 8 GB RAM)                  │ │
│  │  Nodes: 3 (HA)                                           │ │
│  │  Auto-scale: 3-5                                         │ │
│  │                                                           │ │
│  │  Workloads:                                              │ │
│  │  • Gitea                    (Git repository)             │ │
│  │  • ArgoCD                   (GitOps)                     │ │
│  │  • Tekton Triggers          (Webhooks)                   │ │
│  │  • Istio Control Plane      (istiod)                     │ │
│  │  • Knative Serving          (Controllers)                │ │
│  │  • Cert-Manager             (TLS)                        │ │
│  │  • CloudNative-PG Operator  (DB Operator)                │ │
│  │  • Keycloak                 (Auth)                       │ │
│  │                                                           │ │
│  │  Labels: role=control-plane, workload=apl-core          │ │
│  │  Taints: None (accepte tous les workloads si besoin)    │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  NODE POOL 2: APPLICATIONS (Knative Services)            │ │
│  │  ─────────────────────────────────────────────────────── │ │
│  │  Type: g6-standard-2 (2 vCPU, 4 GB RAM)                  │ │
│  │  Nodes: 3 (HA)                                           │ │
│  │  Auto-scale: 3-10 (burst support)                       │ │
│  │                                                           │ │
│  │  Workloads:                                              │ │
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
│  │  NODE POOL 3: DATABASES (CloudNative-PG)                 │ │
│  │  ─────────────────────────────────────────────────────── │ │
│  │  Type: g6-dedicated-4 (4 vCPU, 16 GB RAM, NVMe)          │ │
│  │  Nodes: 3 (HA pour 3 clusters PG)                       │ │
│  │  Auto-scale: NO (stable database sizing)                │ │
│  │                                                           │ │
│  │  Workloads:                                              │ │
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
│  │  NODE POOL 4: CI/CD BUILDS (Tekton Pipelines)            │ │
│  │  ─────────────────────────────────────────────────────── │ │
│  │  Type: g6-standard-4 (4 vCPU, 8 GB RAM)                  │ │
│  │  Nodes: 1 (peut être 0 si pas de builds)                │ │
│  │  Auto-scale: 0-5 (scale to zero)                        │ │
│  │                                                           │ │
│  │  Workloads:                                              │ │
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
│  │  NODE POOL 5: MONITORING (Optionnel)                     │ │
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

### Node Pool 2 : Applications (Knative Services)

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

### Node Pool 4 : CI/CD Builds (Tekton)

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

### Node Pool 5 : Monitoring (Optionnel)

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

# Node Pool 2: Applications
node.kubernetes.io/role: application
workload.type: knative
environment: production

# Node Pool 3: Databases
node.kubernetes.io/role: database
workload.type: postgres
storage.type: high-iops
environment: production

# Node Pool 4: Builds
node.kubernetes.io/role: build
workload.type: tekton
cost.optimization: preemptible
environment: ci-cd

# Node Pool 5: Monitoring
node.kubernetes.io/role: monitoring
workload.type: observability
environment: production
```

### Taints de Node

```yaml
# Node Pool 2: Applications (force Knative services only)
taints:
- key: workload
  value: application
  effect: NoSchedule

# Node Pool 3: Databases (force databases only)
taints:
- key: workload
  value: database
  effect: NoSchedule

# Node Pool 4: Builds (force builds only)
taints:
- key: workload
  value: build
  effect: NoSchedule

# Node Pool 5: Monitoring (force monitoring only)
taints:
- key: workload
  value: monitoring
  effect: NoSchedule
```

### Tolerations dans les Pods

```yaml
# Knative Services (Applications)
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

### Option 1 : Production (4-5 Node Pools)

| Node Pool | Type | Nodes | Prix/node | Sous-total |
|-----------|------|-------|-----------|------------|
| Control Plane | g6-standard-4 | 3 | $32 | $96 |
| Applications | g6-standard-2 | 3-10 | $24 | $72-240 |
| Databases | g6-dedicated-4 | 3 | $96 | $288 |
| Builds | g6-standard-4 | 0-2 | $32 | $0-64 |
| Monitoring | g6-standard-2 | 2 | $24 | $48 |
| **Subtotal Compute** | | | | **$504-736/mois** |
| Block Storage | | 305 Gi | $0.10/Gi | $30.50 |
| Object Storage | | 10 Gi | $0.02/Gi | $0.20 |
| Bandwidth | | 1 TB | Included | $0 |
| **TOTAL** | | | | **~$535-770/mois** |

**Moyenne** : ~$650/mois pour production HA

### Option 2 : Coût Optimisé (3 Node Pools)

| Configuration | Coût mensuel |
|---------------|--------------|
| Control Plane + Monitoring | $96 |
| Applications (moyenne) | $120 |
| Databases + Builds | $288 |
| Storage | $30 |
| **TOTAL** | **~$534/mois** |

### Option 3 : Développement (1-2 Node Pools)

| Configuration | Coût mensuel |
|---------------|--------------|
| All-in-one (3 nodes g6-standard-4) | $96 |
| Storage minimal | $10 |
| **TOTAL** | **~$106/mois** |

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

  # Node Pool 2: Applications
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

  # Node Pool 3: Databases
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

  # Node Pool 4: Builds
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
}
```

---

## 📊 Comparaison : Coûts vs Isolation

| Approche | Node Pools | Coût/mois | Isolation | Performance | HA | Recommandé pour |
|----------|------------|-----------|-----------|-------------|----|--------------------|
| **Single Pool** | 1 | $96-150 | ❌ | ⭐⭐ | ⭐⭐ | Dev/Test |
| **Minimal** | 2-3 | $300-400 | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | Staging |
| **Optimisé** | 3 | $530-550 | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Production budget |
| **Production** | 4-5 | $650-770 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Production HA |

---

## ✅ Recommandations Finales

### Pour Production (Recommandé)

**4 Node Pools** :
1. **Control Plane** (3× g6-standard-4) - APL Core
2. **Applications** (3-10× g6-standard-2) - Knative avec auto-scale
3. **Databases** (3× g6-dedicated-4) - PostgreSQL avec I/O haute performance
4. **Builds** (0-5× g6-standard-4) - Tekton avec scale-to-zero

**Avantages** :
- ✅ Isolation complète des charges
- ✅ Performance optimale (databases sur nodes dédiés)
- ✅ Cost control (builds scale-to-zero)
- ✅ HA garantie (3 nodes minimum partout)

**Coût** : ~$650/mois

### Pour Staging

**3 Node Pools** :
1. **Control Plane + Monitoring** (3× g6-standard-4)
2. **Applications** (2-5× g6-standard-2)
3. **Databases** (2× g6-standard-4)

**Coût** : ~$400/mois

### Pour Dev

**1 Node Pool** :
- All-in-one (3× g6-standard-2)

**Coût** : ~$72/mois

---

## 🎯 Résumé Exécutif

| Environnement | Node Pools | Nodes Total | Coût/mois | Use Case |
|---------------|------------|-------------|-----------|----------|
| **Production** | 4-5 | 9-21 | $650-770 | Production HA, isolation complète |
| **Staging** | 3 | 7-10 | $400-500 | Pre-production, tests |
| **Dev** | 1-2 | 3-5 | $72-150 | Développement, CI |

**Recommandation** : Commencer avec **3 node pools (Option Optimisée)** pour équilibrer coût et performance, puis migrer vers 4-5 pools pour production à haute charge.
