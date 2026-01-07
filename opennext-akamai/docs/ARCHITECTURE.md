# OpenNext Akamai Adapter - Architecture

## Vue d'ensemble

Ce document décrit l'architecture de l'adaptateur OpenNext pour l'écosystème Akamai, permettant de déployer des applications Next.js sur l'infrastructure Akamai avec des performances optimales.

## Contexte

### OpenNext
[OpenNext](https://opennext.js.org/) est un outil de build qui transforme les applications Next.js en packages optimisés pour le déploiement sur différentes plateformes. Il supporte nativement AWS Lambda, Cloudflare Workers, et les serveurs Node.js classiques.

### Écosystème Akamai (2025+)
Suite à l'acquisition de Linode (2022) et Fermyon (décembre 2025), Akamai dispose d'un écosystème cloud complet :

| Service | Description | Équivalent AWS |
|---------|-------------|----------------|
| **Akamai CDN** | 4200+ Edge PoPs, 340+ zones métro | CloudFront |
| **EdgeWorkers** | JavaScript serverless à l'edge (<5ms cold start) | Lambda@Edge |
| **EdgeKV** | Key-value store distribué | DynamoDB Global Tables |
| **LKE** | Linode Kubernetes Engine | EKS |
| **Linode Object Storage** | S3-compatible | S3 |
| **Fermyon Spin** | WebAssembly serverless (<1ms cold start) | Lambda |
| **Linode Managed Database** | PostgreSQL, MySQL, Redis | RDS |

## Architecture Cible

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Utilisateur                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AKAMAI CDN (Edge)                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    EdgeWorkers (Middleware)                          │    │
│  │  • Routing intelligent                                               │    │
│  │  • Authentication/Authorization                                      │    │
│  │  • Geo-targeting                                                     │    │
│  │  • A/B Testing                                                       │    │
│  │  • Request/Response transformation                                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐   │
│  │  Static Assets   │  │    EdgeKV        │  │   Property Manager       │   │
│  │  (Netstorage)    │  │  (Cache Tags)    │  │   (Cache Rules)          │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
┌───────────────────────┐ ┌───────────────────┐ ┌────────────────────────────┐
│   FERMYON SPIN        │ │   LKE CLUSTER     │ │  LINODE OBJECT STORAGE     │
│   (Serverless WASM)   │ │   (Kubernetes)    │ │  (S3-compatible)           │
│                       │ │                   │ │                            │
│ • ISR Revalidation    │ │ • SSR Server      │ │ • Static Assets            │
│ • Image Optimization  │ │ • API Routes      │ │ • Build artifacts          │
│ • Light compute       │ │ • Heavy compute   │ │ • ISR Cache (fallback)     │
│                       │ │ • WebSocket       │ │ • Image cache              │
└───────────────────────┘ └───────────────────┘ └────────────────────────────┘
            │                       │                        │
            └───────────────────────┼────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │     LINODE MANAGED SERVICES   │
                    │                               │
                    │  • PostgreSQL (data)          │
                    │  • Redis (session/cache)      │
                    │  • NodeBalancer (LB)          │
                    └───────────────────────────────┘
```

## Mapping des composants OpenNext → Akamai

### 1. Assets Statiques (`.open-next/assets`)

| OpenNext AWS | OpenNext Akamai |
|--------------|-----------------|
| S3 + CloudFront | Linode Object Storage + Akamai CDN (Netstorage) |

**Stratégie :**
- Les assets hashés (`_next/static/*`) → Cache CDN long (1 an)
- Les assets non-hashés → Cache CDN court + revalidation
- Option : Netstorage pour les assets critiques (performances optimales)

### 2. Server Backend (SSR, API Routes)

| OpenNext AWS | OpenNext Akamai |
|--------------|-----------------|
| Lambda | LKE (Kubernetes) ou Fermyon Spin |

**Stratégie hybride :**

```
┌─────────────────────────────────────────────────────────────────┐
│                     Server Backend Decision                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Request Type          │  Target              │  Raison          │
│  ─────────────────────────────────────────────────────────────  │
│  SSR pages légères     │  Fermyon Spin       │  Cold start <1ms │
│  API routes simples    │  Fermyon Spin       │  Scale to zero   │
│  SSR pages complexes   │  LKE (Node.js)      │  Full Node.js    │
│  API routes lourdes    │  LKE (Node.js)      │  Long-running    │
│  WebSocket             │  LKE (Node.js)      │  Persistent conn │
│  Image Optimization    │  Fermyon Spin       │  CPU efficient   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Middleware (Edge Functions)

| OpenNext AWS | OpenNext Akamai |
|--------------|-----------------|
| Lambda@Edge / CloudFront Functions | EdgeWorkers |

**Implémentation :**
- Le middleware Next.js est compilé en EdgeWorkers
- Utilise le runtime ES2015+ d'EdgeWorkers
- Accès à EdgeKV pour le state partagé

### 4. Incremental Cache (ISR/SSG)

| OpenNext AWS | OpenNext Akamai |
|--------------|-----------------|
| S3 + DynamoDB | EdgeKV (primary) + Linode Object Storage (fallback) |

**Architecture multi-tier :**

```
┌─────────────────────────────────────────────────────────────┐
│                    Incremental Cache Flow                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. EdgeKV (Edge)          ← Latence ultra-faible           │
│     └─ TTL: court (stale-while-revalidate)                  │
│                                                              │
│  2. Linode Object Storage  ← Persistence + fallback         │
│     └─ TTL: long (source of truth)                          │
│                                                              │
│  3. Origin (LKE/Spin)      ← Revalidation on-demand         │
│     └─ Génère le nouveau contenu                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5. Revalidation Queue

| OpenNext AWS | OpenNext Akamai |
|--------------|-----------------|
| SQS FIFO | Redis Streams (Linode) ou Kafka (si scale) |

**Implémentation :**
- Redis Streams sur Linode Managed Database
- Worker de revalidation sur LKE ou Fermyon Spin
- Support des tags de cache pour invalidation groupée

### 6. Image Optimization

| OpenNext AWS | OpenNext Akamai |
|--------------|-----------------|
| Lambda + S3 | Akamai Image Manager OU Fermyon Spin |

**Options :**

1. **Akamai Image & Video Manager** (recommandé)
   - Transformation à l'edge
   - Cache optimisé
   - Formats modernes (WebP, AVIF)

2. **Fermyon Spin** (alternative self-hosted)
   - Sharp compilé en WASM
   - Contrôle total
   - Coût prévisible

## Configuration de l'adaptateur

### `open-next.config.ts`

```typescript
import type { OpenNextConfig } from "@opennextjs/akamai/types";
import { defineAkamaiConfig } from "@opennextjs/akamai";

export default defineAkamaiConfig({
  // Configuration générale
  buildCommand: "npx next build",

  // Middleware → EdgeWorkers
  middleware: {
    external: true, // Déployé séparément sur EdgeWorkers
  },

  // Server backend
  default: {
    // Option 1: LKE (Kubernetes)
    runtime: "lke",

    // Option 2: Fermyon Spin
    // runtime: "fermyon",

    override: {
      // Cache incrémental
      incrementalCache: "edgekv", // ou "object-storage", "multi-tier"

      // Queue de revalidation
      queue: "redis-streams",

      // Converter pour le format des requêtes
      converter: "akamai-cdn",

      // Wrapper pour le cycle de vie
      wrapper: "node", // ou "spin" pour Fermyon
    },
  },

  // Functions spécialisées
  functions: {
    // ISR Revalidation sur Fermyon (scale to zero)
    revalidation: {
      runtime: "fermyon",
      handler: "revalidation.handler",
    },

    // Image optimization
    imageOptimization: {
      // Option 1: Akamai Image Manager (externe)
      external: true,
      provider: "akamai-image-manager",

      // Option 2: Fermyon Spin
      // runtime: "fermyon",
      // handler: "image-optimization.handler",
    },
  },

  // Configuration CDN Akamai
  cdn: {
    // Property Manager configuration
    propertyName: "my-nextjs-app",

    // Origins
    origins: {
      static: {
        type: "object-storage",
        bucket: "my-app-assets",
        region: "us-east",
      },
      dynamic: {
        type: "lke",
        cluster: "my-lke-cluster",
        service: "nextjs-server",
      },
    },

    // Cache rules
    caching: {
      staticAssets: {
        ttl: "365d",
        browserTtl: "365d",
      },
      pages: {
        ttl: "1h",
        staleWhileRevalidate: "24h",
      },
    },
  },
});
```

## Flux de requêtes détaillé

### 1. Requête pour une page SSR

```
Client → Akamai CDN → EdgeWorkers (middleware)
                           │
                           ├─ Cache HIT? → Return cached response
                           │
                           └─ Cache MISS → LKE/Fermyon Server
                                                │
                                                ├─ Render page
                                                ├─ Store in EdgeKV
                                                └─ Return response
```

### 2. Requête pour une page ISR

```
Client → Akamai CDN → EdgeWorkers
                           │
                           ├─ EdgeKV cache HIT + fresh? → Return
                           │
                           ├─ EdgeKV cache HIT + stale?
                           │      │
                           │      ├─ Return stale response
                           │      └─ Trigger background revalidation
                           │                    │
                           │                    └─ Redis Streams → Fermyon Worker
                           │                                           │
                           │                                           └─ Update EdgeKV
                           │
                           └─ Cache MISS → LKE/Fermyon Server → Generate + Cache
```

### 3. Requête pour un asset statique

```
Client → Akamai CDN
              │
              ├─ CDN Cache HIT → Return (optimal)
              │
              └─ CDN Cache MISS → Linode Object Storage
                                        │
                                        └─ Return + Cache at CDN
```

## Déploiement

### Structure des artefacts

```
.open-next/
├── assets/                    → Linode Object Storage
│   ├── _next/static/
│   └── public/
│
├── server-function/           → LKE Deployment
│   ├── index.mjs
│   └── node_modules/
│
├── middleware/                → EdgeWorkers
│   └── handler.js
│
├── revalidation-function/     → Fermyon Spin
│   └── spin.toml
│
├── image-optimization/        → Akamai Image Manager config
│   └── im-policy.json
│
└── akamai-config/            → Akamai Property Manager
    ├── property.json
    └── edgeworker.json
```

### Kubernetes Manifests (LKE)

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nextjs-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nextjs-server
  template:
    metadata:
      labels:
        app: nextjs-server
    spec:
      containers:
      - name: server
        image: ${REGISTRY}/nextjs-server:${VERSION}
        ports:
        - containerPort: 3000
        env:
        - name: CACHE_HANDLER
          value: "edgekv"
        - name: AKAMAI_EDGEKV_NAMESPACE
          valueFrom:
            secretKeyRef:
              name: akamai-credentials
              key: edgekv-namespace
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: nextjs-server
spec:
  type: ClusterIP
  ports:
  - port: 80
    targetPort: 3000
  selector:
    app: nextjs-server
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nextjs-server-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nextjs-server
  minReplicas: 2
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

### Fermyon Spin Configuration

```toml
# spin.toml
spin_manifest_version = 2

[application]
name = "nextjs-revalidation"
version = "1.0.0"
authors = ["OpenNext Akamai"]

[[trigger.http]]
route = "/revalidate/..."
component = "revalidation"

[component.revalidation]
source = "target/wasm32-wasip1/release/revalidation.wasm"
allowed_outbound_hosts = [
  "https://*.akamai.com",
  "https://*.linode.com",
]

[component.revalidation.build]
command = "cargo build --target wasm32-wasip1 --release"

[[trigger.http]]
route = "/api/image/..."
component = "image-optimization"

[component.image-optimization]
source = "target/wasm32-wasip1/release/image_optimization.wasm"
```

## Migration depuis Netlify

### Étapes de migration

1. **Analyse de l'application Netlify**
   ```bash
   npx @opennextjs/akamai analyze
   ```

2. **Build avec l'adaptateur Akamai**
   ```bash
   npx @opennextjs/akamai build
   ```

3. **Déploiement des assets**
   ```bash
   npx @opennextjs/akamai deploy:assets
   ```

4. **Déploiement du serveur sur LKE**
   ```bash
   npx @opennextjs/akamai deploy:server
   ```

5. **Configuration CDN Akamai**
   ```bash
   npx @opennextjs/akamai deploy:cdn
   ```

### Compatibilité Netlify → Akamai

| Netlify Feature | Akamai Equivalent |
|-----------------|-------------------|
| Edge Functions | EdgeWorkers |
| Netlify Functions | Fermyon Spin / LKE |
| Netlify Blobs | Linode Object Storage |
| Deploy Previews | Branch deployments via CI/CD |
| Forms | Self-hosted / third-party |
| Identity | Keycloak / Auth0 |

## Avantages de cette architecture

### Performance
- **Cold start Fermyon** : <1ms (vs ~100ms Lambda)
- **EdgeKV latency** : <10ms mondial
- **CDN global** : 4200+ PoPs Akamai

### Coûts
- **LKE** : Tarification prévisible (pas de pay-per-request)
- **Fermyon Spin** : Scale-to-zero natif
- **Object Storage** : S3-compatible, moins cher que S3

### Contrôle
- **Pas de vendor lock-in** : Standards ouverts (K8s, S3, WASM)
- **Self-hosted possible** : Tous les composants peuvent être self-hosted
- **Observabilité** : Intégration OpenTelemetry native

### Scalabilité
- **Horizontal** : HPA sur LKE
- **Edge** : Distribution mondiale Akamai
- **Serverless** : Fermyon pour le burst traffic

## Prochaines étapes

1. Implémenter le package `@opennextjs/akamai`
2. Créer les handlers de cache (EdgeKV, Object Storage)
3. Développer le converter pour le format Akamai
4. Créer la CLI de déploiement
5. Écrire la documentation et les exemples
6. Tests d'intégration avec une vraie app Next.js
