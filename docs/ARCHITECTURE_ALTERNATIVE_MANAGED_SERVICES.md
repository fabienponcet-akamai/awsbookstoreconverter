# 🏗️ Architecture Alternative - Services Managés (DBaaS + OpenSearch + Redis)

## 🎯 Vue d'Ensemble

Ce document présente une **architecture alternative** qui utilise des services managés pour les composants stateful tout en maximisant l'utilisation d'APL Core pour les composants stateless.

## 📊 Comparaison des Deux Architectures

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     ARCHITECTURE 1: 100% APL CORE (Actuelle)              │
└──────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  Node Pool 1: Control Plane (APL Core Operators)                        │
│  - CloudNative-PG Operator                                              │
│  - Istio Operator                                                       │
│  - Knative Operator                                                     │
│  - Tekton Operator                                                      │
│  Cost: $72/mois (2× g6-standard-2)                                      │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  Node Pool 3: Databases (Self-Hosted)                                   │
│  - CloudNative-PG: bookstore-main (3 replicas)                          │
│  - CloudNative-PG: bookstore-search (3 replicas)                        │
│  - CloudNative-PG: bookstore-graph (3 replicas)                         │
│  Cost: $144/mois (2× g6-standard-4)                                     │
└─────────────────────────────────────────────────────────────────────────┘

Total Coût: ~$800/mois (production HA)
Complexité: Élevée (gérer PostgreSQL, backups, HA)
Flexibilité: Maximale (contrôle total)

───────────────────────────────────────────────────────────────────────────

┌──────────────────────────────────────────────────────────────────────────┐
│              ARCHITECTURE 2: HYBRIDE MANAGED SERVICES (Nouvelle)          │
└──────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  Node Pool 1: Control Plane (APL Core Operators - GARDÉ)                │
│  - Istio Operator                                                       │
│  - Knative Operator                                                     │
│  - Tekton Operator                                                      │
│  - Prometheus Operator                                                  │
│  Cost: $36/mois (2× g6-nanode-1) ← Réduit car pas CNPG Operator        │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  Services Managés (Hors Cluster)                                        │
│  - Akamai DBaaS PostgreSQL: Dedicated 4GB (3 nodes HA)                  │
│  - Akamai DBaaS Redis: Shared 1GB                                       │
│  - OpenSearch Cloud: 2 data nodes + 1 master                            │
│  Cost: ~$450/mois                                                       │
└─────────────────────────────────────────────────────────────────────────┘

Total Coût: ~$750/mois (comparable mais simplifié)
Complexité: Faible (services managés)
Flexibilité: Moyenne (config limitée)
```

---

## 🏛️ Architecture Détaillée Alternative

### Services Managés (Hors Kubernetes)

```
┌────────────────────────────────────────────────────────────────┐
│                   SERVICES MANAGÉS AKAMAI                       │
└────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────┐
│  DBaaS PostgreSQL - Cluster HA      │
│  ├─ Primary (us-east)               │
│  ├─ Standby 1 (us-east)             │
│  └─ Standby 2 (us-east)             │
│                                     │
│  Plan: Dedicated 4GB                │
│  Stockage: 80GB SSD                 │
│  Backups: Auto daily (7 jours)     │
│  HA: Auto failover < 30s            │
│  Cost: ~$300/mois                   │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  DBaaS Redis - Cache & Sessions     │
│  ├─ Master (us-east)                │
│  └─ Replica (us-east)               │
│                                     │
│  Plan: Shared 1GB                   │
│  Persistence: RDB + AOF             │
│  Eviction: allkeys-lru              │
│  Cost: ~$15/mois                    │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  OpenSearch Cloud (Elastic Cloud)   │
│  ├─ Data Node 1 (4GB)               │
│  ├─ Data Node 2 (4GB)               │
│  └─ Master Node (2GB)               │
│                                     │
│  Version: OpenSearch 2.11           │
│  Stockage: 100GB SSD                │
│  Snapshots: Auto daily              │
│  Cost: ~$135/mois                   │
└─────────────────────────────────────┘

Total Services Managés: ~$450/mois
```

### Stack Kubernetes (Sur LKE avec APL Core)

```
┌────────────────────────────────────────────────────────────────┐
│              KUBERNETES CLUSTER (APL CORE MAXIMAL)              │
└────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Pool 1: Control Plane              │
│  ├─ Istio Operator                  │
│  ├─ Knative Operator                │
│  ├─ Tekton Operator                 │
│  ├─ Cert-Manager                    │
│  └─ External Secrets Operator       │
│  2× g6-nanode-1: $36/mois           │
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
│  ├─ bookstore-search-proxy          │
│  └─ outbox-processor                │
│  2× g6-standard-2: $72/mois         │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Pool 4: CI/CD (Tekton)             │
│  ├─ Tekton Pipelines                │
│  ├─ Gitea (optional)                │
│  └─ Container Registry              │
│  2× g6-standard-2: $72/mois         │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Pool 5: Monitoring (APL Core)      │
│  ├─ Prometheus                      │
│  ├─ Grafana                         │
│  ├─ Loki                            │
│  └─ Jaeger                          │
│  2× g6-standard-2: $72/mois         │
└─────────────────────────────────────┘

Total Kubernetes: ~$324/mois
```

**Total Coût Architecture Alternative** : ~$774/mois

---

## 🔧 Configuration des Services Managés

### 1. DBaaS PostgreSQL (Akamai)

#### Provisionnement

```bash
# Créer cluster PostgreSQL HA
linode-cli databases postgresql-create \
  --label bookstore-postgres \
  --region us-east \
  --type g6-dedicated-4 \
  --cluster-size 3 \
  --engine postgresql/14 \
  --ssl_connection true \
  --replication_type asynch

# Récupérer credentials
linode-cli databases postgresql-creds-view $DB_ID

# Output:
# {
#   "username": "linpostgres",
#   "password": "xxx",
#   "host": "lin-xxx-yyy.postgres.linodelke.net",
#   "port": 5432,
#   "ssl": true,
#   "ca_certificate": "-----BEGIN CERTIFICATE-----..."
# }
```

#### Création des Bases de Données

```sql
-- Se connecter au cluster
psql "postgresql://linpostgres:xxx@lin-xxx-yyy.postgres.linodelke.net:5432/defaultdb?sslmode=require"

-- Créer les bases
CREATE DATABASE bookstore_main;
CREATE DATABASE bookstore_graph;

-- Créer utilisateur applicatif
CREATE USER bookstore_app WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE bookstore_main TO bookstore_app;
GRANT ALL PRIVILEGES ON DATABASE bookstore_graph TO bookstore_app;

-- Activer Apache AGE pour le graph
\c bookstore_graph
CREATE EXTENSION age;
```

#### Configuration Kubernetes Secret

```yaml
# k8s/databases/dbaas-postgres-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: dbaas-postgres
  namespace: bookstore
type: Opaque
stringData:
  # Main database
  MAIN_DB_HOST: "lin-xxx-yyy.postgres.linodelke.net"
  MAIN_DB_PORT: "5432"
  MAIN_DB_NAME: "bookstore_main"
  MAIN_DB_USER: "bookstore_app"
  MAIN_DB_PASSWORD: "secure_password"
  MAIN_DB_SSL_MODE: "require"

  # Graph database
  GRAPH_DB_HOST: "lin-xxx-yyy.postgres.linodelke.net"
  GRAPH_DB_PORT: "5432"
  GRAPH_DB_NAME: "bookstore_graph"
  GRAPH_DB_USER: "bookstore_app"
  GRAPH_DB_PASSWORD: "secure_password"
  GRAPH_DB_SSL_MODE: "require"

  # CA Certificate
  DB_CA_CERT: |
    -----BEGIN CERTIFICATE-----
    MIIDdzCCAl+gAwIBAgIEAgAAuTANBgkqhkiG9w0BAQUFADBaMQswCQYDVQQGEwJJ
    ...
    -----END CERTIFICATE-----
```

#### Configuration Application

```typescript
// src/config/database.ts
import { Pool } from 'pg';
import fs from 'fs';

export const mainDb = new Pool({
  host: process.env.MAIN_DB_HOST,
  port: parseInt(process.env.MAIN_DB_PORT || '5432'),
  database: process.env.MAIN_DB_NAME,
  user: process.env.MAIN_DB_USER,
  password: process.env.MAIN_DB_PASSWORD,

  // SSL Configuration (DBaaS requires SSL)
  ssl: {
    rejectUnauthorized: true,
    ca: process.env.DB_CA_CERT
  },

  // Connection pooling
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

---

### 2. DBaaS Redis (Akamai)

#### Provisionnement

```bash
# Créer cluster Redis
linode-cli databases redis-create \
  --label bookstore-redis \
  --region us-east \
  --type g6-nanode-1 \
  --cluster_size 2 \
  --engine redis/7

# Récupérer credentials
linode-cli databases redis-creds-view $REDIS_ID

# Output:
# {
#   "host": "lin-xxx-yyy.redis.linodelke.net",
#   "port": 6379,
#   "password": "xxx",
#   "ssl": true
# }
```

#### Configuration Kubernetes Secret

```yaml
# k8s/databases/dbaas-redis-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: dbaas-redis
  namespace: bookstore
type: Opaque
stringData:
  REDIS_HOST: "lin-xxx-yyy.redis.linodelke.net"
  REDIS_PORT: "6379"
  REDIS_PASSWORD: "xxx"
  REDIS_TLS: "true"
```

#### Utilisation dans l'Application

```typescript
// src/config/redis.ts
import { createClient } from 'redis';

export const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    tls: process.env.REDIS_TLS === 'true'
  },
  password: process.env.REDIS_PASSWORD
});

redisClient.on('error', (err) => console.error('Redis Error:', err));
await redisClient.connect();

// Use cases
export const redisCache = {
  // 1. Session storage
  async setSession(sessionId: string, data: any, ttl: number = 3600) {
    await redisClient.setEx(`session:${sessionId}`, ttl, JSON.stringify(data));
  },

  async getSession(sessionId: string) {
    const data = await redisClient.get(`session:${sessionId}`);
    return data ? JSON.parse(data) : null;
  },

  // 2. Cache books data
  async cacheBook(bookId: string, book: any, ttl: number = 300) {
    await redisClient.setEx(`book:${bookId}`, ttl, JSON.stringify(book));
  },

  async getCachedBook(bookId: string) {
    const data = await redisClient.get(`book:${bookId}`);
    return data ? JSON.parse(data) : null;
  },

  // 3. Rate limiting
  async checkRateLimit(userId: string, maxRequests: number = 100, window: number = 60) {
    const key = `ratelimit:${userId}:${Math.floor(Date.now() / (window * 1000))}`;
    const current = await redisClient.incr(key);

    if (current === 1) {
      await redisClient.expire(key, window);
    }

    return current <= maxRequests;
  },

  // 4. Shopping cart (temporary storage)
  async addToCart(userId: string, bookId: string, quantity: number) {
    await redisClient.hSet(`cart:${userId}`, bookId, quantity.toString());
  },

  async getCart(userId: string) {
    const cart = await redisClient.hGetAll(`cart:${userId}`);
    return Object.entries(cart).map(([bookId, quantity]) => ({
      bookId,
      quantity: parseInt(quantity)
    }));
  }
};
```

---

### 3. OpenSearch Cloud (Elastic Cloud ou AWS OpenSearch)

#### Provisionnement (Elastic Cloud)

```bash
# Via Elastic Cloud Console
# 1. Create deployment:
#    - Version: OpenSearch 2.11
#    - Region: us-east-1
#    - Topology: 2× data nodes (4GB) + 1× master (2GB)
#    - Storage: 100GB SSD per node

# 2. Récupérer endpoint et credentials
# Endpoint: https://xxx.us-east-1.aws.found.io:9243
# Username: elastic
# Password: xxx
```

#### Configuration Kubernetes Secret

```yaml
# k8s/search/opensearch-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: opensearch
  namespace: bookstore
type: Opaque
stringData:
  OPENSEARCH_URL: "https://xxx.us-east-1.aws.found.io:9243"
  OPENSEARCH_USERNAME: "elastic"
  OPENSEARCH_PASSWORD: "xxx"
```

#### Création de l'Index Books

```typescript
// src/config/opensearch.ts
import { Client } from '@opensearch-project/opensearch';

export const opensearchClient = new Client({
  node: process.env.OPENSEARCH_URL,
  auth: {
    username: process.env.OPENSEARCH_USERNAME!,
    password: process.env.OPENSEARCH_PASSWORD!
  },
  ssl: {
    rejectUnauthorized: true
  }
});

// Create index with mapping
export async function createBooksIndex() {
  const indexName = 'books';

  const exists = await opensearchClient.indices.exists({ index: indexName });

  if (!exists.body) {
    await opensearchClient.indices.create({
      index: indexName,
      body: {
        settings: {
          number_of_shards: 2,
          number_of_replicas: 1,
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
              fields: {
                keyword: { type: 'keyword' }
              }
            },
            author: {
              type: 'text',
              analyzer: 'book_analyzer',
              fields: {
                keyword: { type: 'keyword' }
              }
            },
            description: {
              type: 'text',
              analyzer: 'book_analyzer'
            },
            category: { type: 'keyword' },
            price: { type: 'float' },
            image_url: { type: 'keyword' },
            created_at: { type: 'date' },
            popularity_score: { type: 'float' }
          }
        }
      }
    });
  }
}

// Index a book
export async function indexBook(book: any) {
  await opensearchClient.index({
    index: 'books',
    id: book.id,
    body: book,
    refresh: true
  });
}

// Search books
export async function searchBooks(query: string, page: number = 1, pageSize: number = 20) {
  const from = (page - 1) * pageSize;

  const result = await opensearchClient.search({
    index: 'books',
    body: {
      from,
      size: pageSize,
      query: {
        multi_match: {
          query,
          fields: ['title^3', 'author^2', 'description'],
          fuzziness: 'AUTO'
        }
      },
      highlight: {
        fields: {
          title: {},
          author: {},
          description: { fragment_size: 150 }
        }
      },
      sort: [
        { _score: 'desc' },
        { popularity_score: 'desc' }
      ]
    }
  });

  return {
    total: result.body.hits.total.value,
    books: result.body.hits.hits.map((hit: any) => ({
      ...hit._source,
      score: hit._score,
      highlights: hit.highlight
    }))
  };
}
```

#### Synchronisation PostgreSQL → OpenSearch

**Option 1 : Outbox Pattern**

```typescript
// src/workers/opensearchSyncer.ts
import { OutboxProcessor } from './outboxProcessor';
import { indexBook, opensearchClient } from '../config/opensearch';

class OpenSearchSyncer extends OutboxProcessor {
  async handleBookCreated(payload: any) {
    await indexBook({
      id: payload.bookId,
      title: payload.title,
      author: payload.author,
      description: payload.description,
      category: payload.category,
      price: payload.price,
      image_url: payload.imageUrl,
      created_at: payload.createdAt,
      popularity_score: 0
    });
  }

  async handleBookUpdated(payload: any) {
    await opensearchClient.update({
      index: 'books',
      id: payload.bookId,
      body: {
        doc: {
          title: payload.title,
          description: payload.description,
          price: payload.price
        }
      }
    });
  }

  async handleBookDeleted(payload: any) {
    await opensearchClient.delete({
      index: 'books',
      id: payload.bookId
    });
  }
}
```

**Option 2 : Logstash (Continuous Sync)**

```yaml
# logstash/pipeline/postgres-to-opensearch.conf
input {
  jdbc {
    jdbc_driver_library => "/usr/share/logstash/postgresql.jar"
    jdbc_driver_class => "org.postgresql.Driver"
    jdbc_connection_string => "jdbc:postgresql://lin-xxx.postgres.linodelke.net:5432/bookstore_main"
    jdbc_user => "bookstore_app"
    jdbc_password => "xxx"
    schedule => "*/5 * * * *"  # Every 5 minutes
    statement => "SELECT * FROM books WHERE updated_at > :sql_last_value"
    use_column_value => true
    tracking_column => "updated_at"
    tracking_column_type => "timestamp"
  }
}

filter {
  mutate {
    rename => { "image_url" => "imageUrl" }
    add_field => { "popularity_score" => 0 }
  }
}

output {
  opensearch {
    hosts => ["https://xxx.us-east-1.aws.found.io:9243"]
    user => "elastic"
    password => "xxx"
    index => "books"
    document_id => "%{id}"
  }
}
```

---

## 📊 Comparaison Détaillée

### Coûts Mensuels

| Composant | Architecture 1 (APL Core) | Architecture 2 (Managed) | Différence |
|-----------|---------------------------|--------------------------|------------|
| **Databases** | | | |
| PostgreSQL Main | Pool 3: $48 (inclus) | DBaaS: $300 | +$252 |
| PostgreSQL Graph | Pool 3: $48 (inclus) | DBaaS: inclus | $0 |
| PostgreSQL Search | Pool 3: $48 (inclus) | OpenSearch: $135 | +$87 |
| Redis | - | DBaaS: $15 | +$15 |
| **Operators** | | | |
| CloudNative-PG Op | Pool 1: $24 | - | -$24 |
| Istio Op | Pool 1: $24 | Pool 1: $12 | -$12 |
| Knative Op | Pool 1: $24 | Pool 1: $12 | -$12 |
| Tekton Op | Pool 1: $0 | Pool 1: $12 | +$12 |
| **Node Pools** | | | |
| Pool 1 (Control) | $72 | $36 | -$36 |
| Pool 2 (Ingress) | $72 | $72 | $0 |
| Pool 3 (Apps) | $72 | $72 | $0 |
| Pool 3 (Databases) | $144 | - | -$144 |
| Pool 4 (CI/CD) | $72 | $72 | $0 |
| Pool 5 (Monitoring) | $88 | $72 | -$16 |
| **Total** | **~$800/mois** | **~$774/mois** | **-$26/mois** |

### Trade-offs Techniques

| Critère | Architecture 1 (APL Core) | Architecture 2 (Managed) |
|---------|---------------------------|--------------------------|
| **Complexité Opérationnelle** | ⭐⭐⭐⭐ Élevée | ⭐⭐ Faible |
| **Expertise Requise** | PostgreSQL HA, backups, tuning | Configuration basique |
| **Temps de Setup** | 2-3 jours | 2-3 heures |
| **Maintenance** | Quotidienne (backups, monitoring) | Minimale (managed) |
| **Backups** | Manuel (Velero, pg_dump) | Automatique (snapshots daily) |
| **HA/Failover** | Manuel (CloudNative-PG) | Automatique (< 30s) |
| **Scalabilité** | Manuelle (edit CRD) | API/CLI/Console |
| **Monitoring** | Prometheus (self-hosted) | Dashboards intégrés + Prometheus |
| **Search Performance** | PostgreSQL FTS (bon < 10M docs) | OpenSearch (excellent) |
| **Search Features** | Basique (ts_vector) | Avancé (ML, fuzzy, facets) |
| **Cache** | In-memory ou Redis in-cluster | Redis managé |
| **Contrôle** | ⭐⭐⭐⭐⭐ Total | ⭐⭐⭐ Moyen |
| **Lock-in** | Aucun (open-source) | Vendor lock-in Akamai |
| **Portabilité** | ⭐⭐⭐⭐⭐ Excellente | ⭐⭐ Faible |

### Avantages Architecture 1 (100% APL Core)

✅ **Contrôle total** : Configuration PostgreSQL fine-tuned
✅ **Portabilité** : Migration facile vers autre cloud
✅ **Coût prévisible** : Pas de surprises billing DBaaS
✅ **Latence réseau** : Tout dans le même cluster
✅ **Compliance** : Données restent dans Kubernetes
✅ **Learning** : Expertise PostgreSQL acquise

### Avantages Architecture 2 (Managed Services)

✅ **Simplicité** : Pas de gestion PostgreSQL quotidienne
✅ **Backups automatiques** : Point-in-time recovery (7-30 jours)
✅ **HA automatique** : Failover < 30s sans intervention
✅ **Search avancé** : OpenSearch >> PostgreSQL FTS
✅ **Support** : SLA et support vendor
✅ **Scaling facile** : CLI/API pour resize
✅ **Time-to-market** : Déploiement en heures vs jours

---

## 🚀 Recommandations par Cas d'Usage

### Utiliser Architecture 1 (100% APL Core) si :

1. ✅ **Expertise PostgreSQL** dans l'équipe
2. ✅ **Budget limité** (< $500/mois)
3. ✅ **Multi-cloud** prévu (portabilité critique)
4. ✅ **Compliance stricte** (données doivent rester in-cluster)
5. ✅ **Learning objective** (monter en compétence PostgreSQL HA)
6. ✅ **Search basique** suffisant (< 1M documents)

### Utiliser Architecture 2 (Managed Services) si :

1. ✅ **Pas d'expertise PostgreSQL** (focus sur métier)
2. ✅ **Time-to-market** critique (< 1 mois)
3. ✅ **Search avancé** requis (ML, fuzzy, facets)
4. ✅ **SLA élevé** (99.99% uptime)
5. ✅ **Équipe réduite** (pas de DBA)
6. ✅ **Budget confortable** ($500-1000/mois)

---

## 🔄 Stratégie Hybride (Recommandée)

**Idée** : Commencer avec Architecture 2 (managed), migrer progressivement vers Architecture 1.

```
Phase 1 (Mois 1-3) : Managed Services
├─ DBaaS PostgreSQL
├─ OpenSearch Cloud
└─ Redis Cloud
  ↓ MVP lancé rapidement, équipe se concentre sur features

Phase 2 (Mois 4-6) : Migration Progressive
├─ Migrer Redis → Redis in-cluster (facile)
├─ Setup CloudNative-PG en staging
└─ Tests de performance PostgreSQL self-hosted
  ↓ Économies commencent, expertise acquise

Phase 3 (Mois 7-12) : Full APL Core
├─ Migrer PostgreSQL → CloudNative-PG
├─ Migrer OpenSearch → PostgreSQL FTS (ou Meilisearch)
└─ 100% APL Core atteint
  ↓ Coûts optimisés, portabilité maximale
```

**Bénéfices** :
- ✅ Lancement rapide (managed)
- ✅ Apprentissage progressif (pas tout en même temps)
- ✅ Validation produit avant optimisation coûts
- ✅ Réduction risques (migration incrémentale)

---

## 💻 Déploiement de l'Architecture Alternative

### Node Pools Configuration

```yaml
# k8s/node-pools/managed-services-architecture.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: node-pools-config
data:
  architecture: "managed-services"
  pools: |
    # Pool 1: Control Plane (APL Core Operators)
    - name: control-plane
      size: g6-nanode-1
      count: 2
      labels:
        workload.type: control-plane
      taints:
        - key: workload
          value: control-plane
          effect: NoSchedule
      components:
        - istio-operator
        - knative-operator
        - tekton-operator
        - cert-manager
        - external-secrets-operator
      cost_monthly: $36

    # Pool 2: Ingress Gateways
    - name: ingress
      size: g6-standard-2
      count: 2
      labels:
        workload.type: gateway
      taints:
        - key: workload
          value: ingress
          effect: NoSchedule
      components:
        - istio-ingressgateway
      cost_monthly: $72

    # Pool 3: Applications (Knative Services)
    - name: applications
      size: g6-standard-2
      count: 2
      labels:
        workload.type: application
      taints:
        - key: workload
          value: application
          effect: NoSchedule
      components:
        - bookstore-api
        - bookstore-frontend-ssr
        - opensearch-proxy
        - outbox-processor
      cost_monthly: $72

    # Pool 4: CI/CD (Tekton)
    - name: cicd
      size: g6-standard-2
      count: 2
      labels:
        workload.type: cicd
      taints:
        - key: workload
          value: cicd
          effect: NoSchedule
      components:
        - tekton-pipelines
        - tekton-triggers
        - gitea (optional)
      cost_monthly: $72

    # Pool 5: Observability (Prometheus, Grafana, Loki, Jaeger)
    - name: observability
      size: g6-standard-2
      count: 2
      labels:
        workload.type: observability
      taints:
        - key: workload
          value: observability
          effect: NoSchedule
      components:
        - prometheus
        - grafana
        - loki
        - jaeger
      cost_monthly: $72

  external_services: |
    # Services Managés (Hors Kubernetes)
    - service: dbaas-postgresql
      provider: akamai
      plan: dedicated-4gb
      nodes: 3
      cost_monthly: $300

    - service: dbaas-redis
      provider: akamai
      plan: shared-1gb
      nodes: 2
      cost_monthly: $15

    - service: opensearch
      provider: elastic-cloud
      plan: 2x-data-4gb-1x-master-2gb
      cost_monthly: $135
```

### Knative Service avec Services Managés

```yaml
# k8s/apps/bookstore-api-managed.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: bookstore-api
  namespace: bookstore
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/min-scale: "2"
        autoscaling.knative.dev/max-scale: "10"
        autoscaling.knative.dev/target: "70"
    spec:
      containers:
      - image: registry.bookstore.example.com/bookstore-api:v1.0.0
        ports:
        - containerPort: 3000

        env:
        # PostgreSQL (DBaaS)
        - name: MAIN_DB_HOST
          valueFrom:
            secretKeyRef:
              name: dbaas-postgres
              key: MAIN_DB_HOST
        - name: MAIN_DB_PORT
          valueFrom:
            secretKeyRef:
              name: dbaas-postgres
              key: MAIN_DB_PORT
        - name: MAIN_DB_NAME
          valueFrom:
            secretKeyRef:
              name: dbaas-postgres
              key: MAIN_DB_NAME
        - name: MAIN_DB_USER
          valueFrom:
            secretKeyRef:
              name: dbaas-postgres
              key: MAIN_DB_USER
        - name: MAIN_DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: dbaas-postgres
              key: MAIN_DB_PASSWORD

        # Redis (DBaaS)
        - name: REDIS_HOST
          valueFrom:
            secretKeyRef:
              name: dbaas-redis
              key: REDIS_HOST
        - name: REDIS_PORT
          valueFrom:
            secretKeyRef:
              name: dbaas-redis
              key: REDIS_PORT
        - name: REDIS_PASSWORD
          valueFrom:
            secretKeyRef:
              name: dbaas-redis
              key: REDIS_PASSWORD

        # OpenSearch
        - name: OPENSEARCH_URL
          valueFrom:
            secretKeyRef:
              name: opensearch
              key: OPENSEARCH_URL
        - name: OPENSEARCH_USERNAME
          valueFrom:
            secretKeyRef:
              name: opensearch
              key: OPENSEARCH_USERNAME
        - name: OPENSEARCH_PASSWORD
          valueFrom:
            secretKeyRef:
              name: opensearch
              key: OPENSEARCH_PASSWORD

        resources:
          requests:
            cpu: 200m
            memory: 256Mi
          limits:
            cpu: 1000m
            memory: 512Mi
```

---

## 📈 Monitoring des Services Managés

### Prometheus Exporters

```yaml
# k8s/monitoring/dbaas-exporters.yaml
---
# PostgreSQL Exporter (se connecte au DBaaS)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres-exporter
  namespace: monitoring
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres-exporter
  template:
    metadata:
      labels:
        app: postgres-exporter
    spec:
      containers:
      - name: exporter
        image: prometheuscommunity/postgres-exporter:latest
        env:
        - name: DATA_SOURCE_NAME
          value: "postgresql://$(MAIN_DB_USER):$(MAIN_DB_PASSWORD)@$(MAIN_DB_HOST):$(MAIN_DB_PORT)/$(MAIN_DB_NAME)?sslmode=require"
        envFrom:
        - secretRef:
            name: dbaas-postgres
        ports:
        - containerPort: 9187
          name: metrics

---
# Redis Exporter
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis-exporter
  namespace: monitoring
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis-exporter
  template:
    metadata:
      labels:
        app: redis-exporter
    spec:
      containers:
      - name: exporter
        image: oliver006/redis_exporter:latest
        env:
        - name: REDIS_ADDR
          value: "$(REDIS_HOST):$(REDIS_PORT)"
        - name: REDIS_PASSWORD
          valueFrom:
            secretKeyRef:
              name: dbaas-redis
              key: REDIS_PASSWORD
        envFrom:
        - secretRef:
            name: dbaas-redis
        ports:
        - containerPort: 9121
          name: metrics

---
# OpenSearch Exporter
apiVersion: apps/v1
kind: Deployment
metadata:
  name: opensearch-exporter
  namespace: monitoring
spec:
  replicas: 1
  selector:
    matchLabels:
      app: opensearch-exporter
  template:
    metadata:
      labels:
        app: opensearch-exporter
    spec:
      containers:
      - name: exporter
        image: justwatch/elasticsearch_exporter:latest
        args:
        - --es.uri=$(OPENSEARCH_URL)
        - --es.all
        - --es.indices
        - --es.shards
        envFrom:
        - secretRef:
            name: opensearch
        ports:
        - containerPort: 9114
          name: metrics
```

---

## ✅ Conclusion et Recommandation Finale

### Pour MVP/Startup (0-6 mois)

**Architecture 2 (Managed Services)** ✅

**Raison** :
- Time-to-market critique
- Pas d'expertise PostgreSQL HA
- Focus sur product-market fit
- Budget disponible

**Stack** :
- DBaaS PostgreSQL (Akamai)
- OpenSearch Cloud
- Redis Cloud
- Knative + Istio (APL Core)
- Tekton (APL Core)
- Prometheus/Grafana (APL Core)

**Coût** : ~$774/mois

---

### Pour Scale-up (6-12 mois)

**Architecture Hybride** ✅

**Migration progressive** :
1. Garder DBaaS PostgreSQL (critique)
2. Migrer Redis → in-cluster
3. Migrer OpenSearch → Meilisearch ou PostgreSQL FTS
4. Plus tard : PostgreSQL → CloudNative-PG

**Coût** : ~$600/mois (économies progressives)

---

### Pour Entreprise/Long Terme (12+ mois)

**Architecture 1 (100% APL Core)** ✅

**Raison** :
- Expertise acquise
- Contrôle total requis
- Multi-cloud/portabilité
- Optimisation coûts long terme

**Stack** :
- CloudNative-PG (main + graph)
- PostgreSQL FTS ou Meilisearch
- Redis in-cluster
- 100% APL Core

**Coût** : ~$500/mois (optimisé)

---

Veux-tu que je détaille un aspect particulier ? Par exemple :
- Migration PostgreSQL DBaaS → CloudNative-PG ?
- Configuration avancée OpenSearch (ML, facets) ?
- Redis use cases détaillés (cache strategy, session management) ?
