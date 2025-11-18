# 🏗️ Architecture Alternative - DBaaS PostgreSQL + APL Core Max

## 🎯 Vue d'Ensemble

Ce document présente une **architecture hybride optimale** qui :
- Utilise **DBaaS PostgreSQL** (Akamai) pour simplifier la gestion des bases de données
- Déploie **Redis + OpenSearch dans LKE** avec APL Core (operators)
- **Maximise APL Core** pour tout le reste (Istio, Knative, Tekton, monitoring)

## 📊 Comparaison des Architectures

```
┌──────────────────────────────────────────────────────────────────┐
│         ARCHITECTURE 1: 100% APL CORE (Self-Hosted)               │
└──────────────────────────────────────────────────────────────────┘

Stack Kubernetes (6 Node Pools)
├─ Pool 1: APL Core Operators (Istio, Knative, Tekton, CNPG)
├─ Pool 2: Ingress Gateways
├─ Pool 3: Databases (CloudNative-PG × 3 instances)
├─ Pool 4: Applications (Knative Services)
├─ Pool 5: CI/CD (Tekton)
└─ Pool 6: Monitoring (Prometheus/Grafana/Loki/Jaeger)

Avantages: Contrôle total, portabilité maximale
Inconvénients: Complexité PostgreSQL HA, backups manuels
Coût: ~$800/mois

───────────────────────────────────────────────────────────────────

┌──────────────────────────────────────────────────────────────────┐
│    ARCHITECTURE 2: HYBRIDE DBaaS + APL CORE (Recommandée)        │
└──────────────────────────────────────────────────────────────────┘

DBaaS PostgreSQL (Hors Cluster - Akamai Managed)
└─ PostgreSQL Dedicated 4GB (3 nodes HA)
   Cost: $300/mois

Stack Kubernetes (6 Node Pools - APL Core Max)
├─ Pool 1: APL Core Operators (Istio, Knative, Tekton, Redis Op, OpenSearch Op)
├─ Pool 2: Ingress Gateways
├─ Pool 3: Applications (Knative Services)
├─ Pool 4: Stateful (Redis, OpenSearch)  ← NOUVEAU
├─ Pool 5: CI/CD (Tekton)
└─ Pool 6: Monitoring (Prometheus/Grafana/Loki/Jaeger)

Avantages: PostgreSQL managé, Redis/OpenSearch in-cluster
Inconvénients: Vendor lock-in PostgreSQL uniquement
Coût: ~$750/mois
```

---

## 🏛️ Architecture Détaillée

### Services Managés (Hors Kubernetes)

```
┌─────────────────────────────────────┐
│  DBaaS PostgreSQL - Cluster HA      │
│  ├─ Primary (us-east)               │
│  ├─ Standby 1 (us-east)             │
│  └─ Standby 2 (us-east)             │
│                                     │
│  Plan: Dedicated 4GB                │
│  Stockage: 80GB SSD                 │
│  Bases de données:                  │
│    - bookstore_main                 │
│    - bookstore_graph (Apache AGE)   │
│                                     │
│  Backups: Auto daily (7 jours)     │
│  HA: Auto failover < 30s            │
│  Cost: ~$300/mois                   │
└─────────────────────────────────────┘

C'est TOUT pour les services managés !
```

### Stack Kubernetes (APL Core Maximisé)

```
┌────────────────────────────────────────────────────────────────┐
│              KUBERNETES CLUSTER (APL CORE MAXIMAL)              │
└────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Pool 1: Control Plane              │
│  ├─ Istio Operator                  │
│  ├─ Knative Operator                │
│  ├─ Tekton Operator                 │
│  ├─ Redis Operator ← NOUVEAU        │
│  ├─ OpenSearch Operator ← NOUVEAU   │
│  ├─ Cert-Manager                    │
│  └─ External Secrets Operator       │
│  2× g6-standard-2: $72/mois         │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Pool 2: Ingress Gateways           │
│  ├─ Istio Ingress Gateway (2 rep)   │
│  └─ NodeBalancer integration        │
│  2× g6-standard-2: $72/mois         │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Pool 3: Applications (Knative)     │
│  ├─ bookstore-api                   │
│  ├─ bookstore-frontend-ssr          │
│  └─ outbox-processor                │
│  2× g6-standard-2: $72/mois         │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Pool 4: Stateful Services ← NOUVEAU│
│  ├─ Redis (3 replicas HA)           │
│  ├─ OpenSearch (3 nodes cluster)    │
│  └─ Persistent Volumes (SSD)        │
│  3× g6-standard-4: $216/mois        │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Pool 5: CI/CD (Tekton)             │
│  ├─ Tekton Pipelines                │
│  ├─ Gitea (optional)                │
│  └─ Container Registry              │
│  2× g6-standard-2: $72/mois         │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Pool 6: Monitoring                 │
│  ├─ Prometheus                      │
│  ├─ Grafana                         │
│  ├─ Loki                            │
│  └─ Jaeger                          │
│  2× g6-standard-2: $72/mois         │
└─────────────────────────────────────┘

Total Kubernetes: ~$576/mois
```

**Total Architecture 2** : $300 (DBaaS) + $576 (LKE) = **$876/mois**

---

## 🔧 Déploiement des Composants APL Core

### 1. Redis avec Redis Operator

#### Installation Redis Operator

```bash
# Installer Redis Operator (OT-CONTAINER-KIT)
helm repo add ot-helm https://ot-container-kit.github.io/helm-charts/
helm repo update

# Installer l'operator dans namespace redis-operator
kubectl create namespace redis-operator
helm install redis-operator ot-helm/redis-operator \
  --namespace redis-operator \
  --set nodeSelector."workload\.type"=control-plane \
  --set tolerations[0].key=workload \
  --set tolerations[0].value=control-plane \
  --set tolerations[0].effect=NoSchedule
```

#### Déployer Redis Cluster HA

```yaml
# k8s/redis/redis-cluster.yaml
apiVersion: redis.redis.opstreelabs.in/v1beta1
kind: RedisCluster
metadata:
  name: bookstore-redis
  namespace: bookstore
spec:
  clusterSize: 3

  # Storage
  storage:
    volumeClaimTemplate:
      spec:
        accessModes:
          - ReadWriteOnce
        resources:
          requests:
            storage: 10Gi
        storageClassName: linode-block-storage-retain

  # Resources
  resources:
    requests:
      cpu: 200m
      memory: 512Mi
    limits:
      cpu: 1000m
      memory: 1Gi

  # Node placement (Pool 4: Stateful)
  nodeSelector:
    workload.type: stateful

  tolerations:
  - key: workload
    value: stateful
    effect: NoSchedule

  # Redis configuration
  redisConfig:
    maxmemory: "768mb"
    maxmemory-policy: "allkeys-lru"
    save: "900 1 300 10 60 10000"  # RDB persistence
    appendonly: "yes"               # AOF persistence

  # Security
  securityContext:
    runAsUser: 1000
    fsGroup: 1000
```

**Déploiement** :

```bash
# Appliquer le cluster Redis
kubectl apply -f k8s/redis/redis-cluster.yaml

# Vérifier
kubectl get rediscluster -n bookstore
kubectl get pods -n bookstore -l app=bookstore-redis

# Obtenir le service endpoint
kubectl get svc -n bookstore -l app=bookstore-redis
# Output: bookstore-redis.bookstore.svc.cluster.local:6379
```

#### Configuration Application (Redis)

```typescript
// src/config/redis.ts
import { createClient } from 'redis';

export const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST || 'bookstore-redis.bookstore.svc.cluster.local',
    port: parseInt(process.env.REDIS_PORT || '6379')
  },
  password: process.env.REDIS_PASSWORD  // From K8s Secret
});

await redisClient.connect();

// Use cases
export const cache = {
  // Session storage
  async setSession(sessionId: string, data: any, ttl = 3600) {
    await redisClient.setEx(`session:${sessionId}`, ttl, JSON.stringify(data));
  },

  async getSession(sessionId: string) {
    const data = await redisClient.get(`session:${sessionId}`);
    return data ? JSON.parse(data) : null;
  },

  // Cache books
  async cacheBook(bookId: string, book: any, ttl = 300) {
    await redisClient.setEx(`book:${bookId}`, ttl, JSON.stringify(book));
  },

  async getCachedBook(bookId: string) {
    const data = await redisClient.get(`book:${bookId}`);
    return data ? JSON.parse(data) : null;
  },

  // Shopping cart
  async addToCart(userId: string, bookId: string, quantity: number) {
    await redisClient.hSet(`cart:${userId}`, bookId, quantity.toString());
    await redisClient.expire(`cart:${userId}`, 86400);  // 24h TTL
  },

  async getCart(userId: string) {
    return await redisClient.hGetAll(`cart:${userId}`);
  },

  // Rate limiting
  async checkRateLimit(userId: string, max = 100, window = 60) {
    const key = `ratelimit:${userId}:${Math.floor(Date.now() / (window * 1000))}`;
    const current = await redisClient.incr(key);
    if (current === 1) await redisClient.expire(key, window);
    return current <= max;
  }
};
```

---

### 2. OpenSearch avec OpenSearch Operator

#### Installation OpenSearch Operator

```bash
# Installer OpenSearch Operator (opensearch-project)
helm repo add opensearch-operator https://opensearch-project.github.io/opensearch-k8s-operator/
helm repo update

# Installer l'operator
kubectl create namespace opensearch-operator
helm install opensearch-operator opensearch-operator/opensearch-operator \
  --namespace opensearch-operator \
  --set nodeSelector."workload\.type"=control-plane \
  --set tolerations[0].key=workload \
  --set tolerations[0].value=control-plane \
  --set tolerations[0].effect=NoSchedule
```

#### Déployer OpenSearch Cluster

```yaml
# k8s/opensearch/opensearch-cluster.yaml
apiVersion: opensearch.opster.io/v1
kind: OpenSearchCluster
metadata:
  name: bookstore-search
  namespace: bookstore
spec:
  general:
    serviceName: bookstore-search
    version: 2.11.0
    httpPort: 9200

  # Dashboard (optional)
  dashboards:
    enable: true
    version: 2.11.0
    replicas: 1
    resources:
      requests:
        memory: 512Mi
        cpu: 200m
      limits:
        memory: 1Gi
        cpu: 500m

  # Node pools
  nodePools:
  - component: masters
    replicas: 3
    diskSize: 20Gi
    resources:
      requests:
        memory: 2Gi
        cpu: 500m
      limits:
        memory: 4Gi
        cpu: 2000m

    # Node placement (Pool 4: Stateful)
    nodeSelector:
      workload.type: stateful

    tolerations:
    - key: workload
      value: stateful
      effect: NoSchedule

    # Roles
    roles:
    - master
    - data
    - ingest

  # Security (basic auth)
  security:
    config:
      securityConfigSecret:
        name: opensearch-security-config
      adminCredentialsSecret:
        name: opensearch-admin-credentials
```

**Créer les secrets** :

```bash
# Générer mot de passe admin
OPENSEARCH_PASSWORD=$(openssl rand -base64 32)

# Créer secret admin
kubectl create secret generic opensearch-admin-credentials \
  -n bookstore \
  --from-literal=username=admin \
  --from-literal=password=$OPENSEARCH_PASSWORD

# Créer secret security config (optionnel, defaults OK)
kubectl create secret generic opensearch-security-config \
  -n bookstore \
  --from-literal=internal_users.yml='
admin:
  hash: $2a$12$...'  # bcrypt hash du password
```

**Déploiement** :

```bash
# Appliquer le cluster OpenSearch
kubectl apply -f k8s/opensearch/opensearch-cluster.yaml

# Vérifier
kubectl get opensearchcluster -n bookstore
kubectl get pods -n bookstore -l cluster-name=bookstore-search

# Port-forward pour tester
kubectl port-forward -n bookstore svc/bookstore-search 9200:9200

# Test
curl -u admin:$OPENSEARCH_PASSWORD https://localhost:9200 -k
```

#### Configuration Application (OpenSearch)

```typescript
// src/config/opensearch.ts
import { Client } from '@opensearch-project/opensearch';

export const opensearchClient = new Client({
  node: process.env.OPENSEARCH_URL || 'https://bookstore-search.bookstore.svc.cluster.local:9200',
  auth: {
    username: process.env.OPENSEARCH_USERNAME || 'admin',
    password: process.env.OPENSEARCH_PASSWORD!
  },
  ssl: {
    rejectUnauthorized: false  // Self-signed cert in dev
  }
});

// Créer index books
export async function createBooksIndex() {
  const indexName = 'books';

  const exists = await opensearchClient.indices.exists({ index: indexName });

  if (!exists.body) {
    await opensearchClient.indices.create({
      index: indexName,
      body: {
        settings: {
          number_of_shards: 3,
          number_of_replicas: 2,
          analysis: {
            analyzer: {
              book_analyzer: {
                type: 'custom',
                tokenizer: 'standard',
                filter: ['lowercase', 'stop', 'snowball']
              }
            }
          }
        },
        mappings: {
          properties: {
            id: { type: 'keyword' },
            title: {
              type: 'text',
              analyzer: 'book_analyzer',
              fields: { keyword: { type: 'keyword' } }
            },
            author: {
              type: 'text',
              analyzer: 'book_analyzer',
              fields: { keyword: { type: 'keyword' } }
            },
            description: { type: 'text', analyzer: 'book_analyzer' },
            category: { type: 'keyword' },
            price: { type: 'float' },
            created_at: { type: 'date' },
            popularity: { type: 'float' }
          }
        }
      }
    });
  }
}

// Indexer un livre
export async function indexBook(book: any) {
  await opensearchClient.index({
    index: 'books',
    id: book.id,
    body: book,
    refresh: true
  });
}

// Recherche avancée
export async function searchBooks(query: string, filters?: any) {
  const result = await opensearchClient.search({
    index: 'books',
    body: {
      query: {
        bool: {
          must: {
            multi_match: {
              query,
              fields: ['title^3', 'author^2', 'description'],
              fuzziness: 'AUTO',
              prefix_length: 2
            }
          },
          filter: filters?.category ? [
            { term: { category: filters.category } }
          ] : []
        }
      },
      highlight: {
        fields: {
          title: {},
          author: {},
          description: { fragment_size: 150, number_of_fragments: 3 }
        }
      },
      aggs: {
        categories: {
          terms: { field: 'category', size: 10 }
        },
        price_ranges: {
          range: {
            field: 'price',
            ranges: [
              { to: 10 },
              { from: 10, to: 20 },
              { from: 20, to: 50 },
              { from: 50 }
            ]
          }
        }
      },
      sort: [
        { _score: 'desc' },
        { popularity: 'desc' }
      ],
      size: 20
    }
  });

  return {
    total: result.body.hits.total.value,
    books: result.body.hits.hits.map((hit: any) => ({
      ...hit._source,
      score: hit._score,
      highlights: hit.highlight
    })),
    aggregations: result.body.aggregations
  };
}
```

---

### 3. DBaaS PostgreSQL (Akamai)

#### Provisionnement

```bash
# Créer cluster PostgreSQL HA
linode-cli databases postgresql-create \
  --label bookstore-postgres \
  --region us-east \
  --type g6-dedicated-4 \
  --cluster_size 3 \
  --engine postgresql/14 \
  --ssl_connection true

# Récupérer credentials
DB_ID=$(linode-cli databases list --json | jq -r '.[] | select(.label=="bookstore-postgres") | .id')
linode-cli databases postgresql-creds-view $DB_ID

# Output:
# {
#   "username": "linpostgres",
#   "password": "xxx",
#   "host": "lin-12345-6789.postgres.linodelke.net",
#   "port": 5432
# }
```

#### Création des Bases

```sql
-- Se connecter
psql "postgresql://linpostgres:xxx@lin-12345-6789.postgres.linodelke.net:5432/defaultdb?sslmode=require"

-- Créer les bases
CREATE DATABASE bookstore_main;
CREATE DATABASE bookstore_graph;

-- Créer utilisateur applicatif
CREATE USER bookstore_app WITH PASSWORD 'secure_app_password';
GRANT ALL PRIVILEGES ON DATABASE bookstore_main TO bookstore_app;
GRANT ALL PRIVILEGES ON DATABASE bookstore_graph TO bookstore_app;

-- Activer Apache AGE pour le graph
\c bookstore_graph
CREATE EXTENSION age;
LOAD 'age';
SET search_path = ag_catalog, "$user", public;
SELECT ag_catalog.create_graph('recommendations');
```

#### Configuration Kubernetes

```yaml
# k8s/databases/dbaas-postgres-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: dbaas-postgres
  namespace: bookstore
type: Opaque
stringData:
  MAIN_DB_HOST: "lin-12345-6789.postgres.linodelke.net"
  MAIN_DB_PORT: "5432"
  MAIN_DB_NAME: "bookstore_main"
  MAIN_DB_USER: "bookstore_app"
  MAIN_DB_PASSWORD: "secure_app_password"
  MAIN_DB_SSL_MODE: "require"

  GRAPH_DB_HOST: "lin-12345-6789.postgres.linodelke.net"
  GRAPH_DB_PORT: "5432"
  GRAPH_DB_NAME: "bookstore_graph"
  GRAPH_DB_USER: "bookstore_app"
  GRAPH_DB_PASSWORD: "secure_app_password"
  GRAPH_DB_SSL_MODE: "require"

  DB_CA_CERT: |
    -----BEGIN CERTIFICATE-----
    ...
    -----END CERTIFICATE-----
```

---

## 💰 Comparaison des Coûts Corrigée

| Composant | Architecture 1 (100% APL) | Architecture 2 (Hybride) | Δ |
|-----------|---------------------------|--------------------------|---|
| **PostgreSQL** | $144 (Pool 3) | $300 (DBaaS) | +$156 |
| **Redis** | $0 (in-memory) | $72 (Pool 4 - 1/3) | +$72 |
| **OpenSearch** | - | $144 (Pool 4 - 2/3) | +$144 |
| **Node Pools** | | | |
| - Pool 1 (Control) | $72 | $72 | $0 |
| - Pool 2 (Ingress) | $72 | $72 | $0 |
| - Pool 3 (Apps) | $72 | $72 | $0 |
| - Pool 3 (DB) | $144 | - | -$144 |
| - Pool 4 (Stateful) | - | $216 | +$216 |
| - Pool 5 (CI/CD) | $72 | $72 | $0 |
| - Pool 6 (Monitoring) | $88 | $72 | -$16 |
| **Total** | **~$800/mois** | **~$876/mois** | **+$76/mois** |

**Correction** : Architecture 2 coûte légèrement plus cher (+$76/mois) mais apporte :
- ✅ PostgreSQL managé (backups auto, HA < 30s)
- ✅ Search avancé (OpenSearch >> PostgreSQL FTS)
- ✅ Cache dédié (Redis)

---

## 📊 Trade-offs Techniques

| Critère | 100% APL Core | Hybride DBaaS + APL |
|---------|---------------|---------------------|
| **PostgreSQL** | | |
| - Gestion | CloudNative-PG (manuel) | DBaaS (auto) ✅ |
| - Backups | Velero/pg_dump (manuel) | Auto daily ✅ |
| - HA Failover | Manuel (~5min) | Auto < 30s ✅ |
| - Tuning | Total contrôle ✅ | Config limitée |
| **Redis** | | |
| - Déploiement | In-memory ou operator | Redis Operator ✅ |
| - Persistence | Optionnel | RDB + AOF ✅ |
| - Latence | In-cluster ✅ | In-cluster ✅ |
| **OpenSearch** | | |
| - Alternative | PostgreSQL FTS | OpenSearch ✅ |
| - Features | Basique | ML, facets, fuzzy ✅ |
| - Performance | < 1M docs | > 10M docs ✅ |
| **Portabilité** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ (PostgreSQL lock-in) |
| **Complexité** | ⭐⭐⭐⭐ Élevée | ⭐⭐ Faible ✅ |
| **Coût** | $800/mois | $876/mois (+$76) |

---

## 🚀 Recommandation Finale

### Architecture Hybride (DBaaS + APL Core) si :

✅ **Pas d'expertise PostgreSQL HA** dans l'équipe
✅ **Time-to-market critique** (< 1 mois)
✅ **Search avancé** requis (ML, fuzzy, facets)
✅ **SLA élevé** pour la base de données (99.99%)
✅ **Cache dédié** requis (sessions, rate limiting)
✅ **Budget confortable** ($800-900/mois)

### Architecture 100% APL Core si :

✅ **Expertise PostgreSQL** disponible
✅ **Budget serré** (< $600/mois)
✅ **Multi-cloud** prévu (portabilité)
✅ **Search basique** suffisant (< 1M docs)
✅ **Compliance** stricte (tout in-cluster)

---

## 🎯 Ma Recommandation : Stratégie Progressive

**Phase 1 (Mois 1-3) : Hybride DBaaS**
- DBaaS PostgreSQL ✅ (simplicité)
- Redis Operator ✅ (in-cluster)
- OpenSearch ✅ (search avancé)
- Focus sur product-market fit

**Coût** : $876/mois
**Complexité** : Faible

**Phase 2 (Mois 6-12) : Migration PostgreSQL**
- Migrer PostgreSQL → CloudNative-PG
- Garder Redis + OpenSearch in-cluster
- Expertise PostgreSQL acquise

**Coût** : $720/mois (-$156)
**Complexité** : Moyenne

**Phase 3 (Mois 12+) : Optimisation Search**
- Évaluer OpenSearch vs Meilisearch
- Possible downgrade si < 1M docs
- Optimisation finale

**Coût** : $500-600/mois
**Complexité** : Faible

---

Veux-tu que je détaille :
- Configuration avancée Redis Operator (clustering, persistence) ?
- OpenSearch ML features (relevance tuning, synonyms) ?
- Migration path DBaaS → CloudNative-PG ?
