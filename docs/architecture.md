# Architecture - Bookstore sur Akamai App Platform

## Vue d'ensemble

Cette application est une migration de l'AWS Bookstore Demo App vers une architecture cloud-native basée sur Kubernetes, déployée sur Akamai App Platform (APL) avec Linode Kubernetes Engine (LKE).

## Architecture Globale

```
┌─────────────────────────────────────────────────────────────────┐
│                        Akamai CDN                                │
│                    (Content Delivery)                            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                     Istio Gateway                                │
│              (Ingress & Service Mesh)                            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            │                               │
┌───────────▼─────────┐         ┌───────────▼─────────┐
│   Frontend (React)  │         │   Keycloak (Auth)    │
│   - Nginx           │         │   - OAuth2/OIDC     │
│   - SPA             │         │   - User Management  │
└───────────┬─────────┘         └─────────────────────┘
            │
┌───────────▼─────────────────────────────────────────────────────┐
│                    API Backend (Node.js)                         │
│                    Express REST Services                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Products │  │   Cart   │  │  Orders  │  │  Search  │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└───────────┬─────────────────────────────────────────────────────┘
            │
    ┌───────┼───────┬───────────┐
    │       │       │           │
┌───▼──┐ ┌──▼──┐ ┌─▼────┐ ┌────▼─────────┐
│ PG   │ │Redis│ │ ES   │ │ Object Store │
│ SQL  │ │     │ │      │ │  (Backups)   │
└──────┘ └─────┘ └──────┘ └──────────────┘
```

## Composants Principaux

### 1. Frontend (React SPA)

**Technologie** : React 18 + Vite + TypeScript

**Responsabilités** :
- Interface utilisateur pour le catalogue de livres
- Gestion du panier d'achat
- Authentification utilisateur via Keycloak
- Recherche et filtrage des produits

**Déploiement** :
- Conteneur Nginx servant les assets statiques
- Réplication : 2 pods minimum
- Auto-scaling basé sur le CPU

**Intégrations** :
- API Backend via proxy Nginx
- Keycloak pour l'authentification (OIDC)

### 2. API Backend (Node.js/Express)

**Technologie** : Node.js 20 + Express + TypeScript + Prisma

**Services** :

#### Products Service
- CRUD produits (livres)
- Gestion des catégories
- Bestsellers (via Redis leaderboard)

#### Cart Service
- Gestion du panier par utilisateur
- Ajout/Suppression/Mise à jour d'articles
- Stockage dans PostgreSQL

#### Orders Service
- Création de commandes (checkout)
- Historique des commandes
- Mise à jour du leaderboard

#### Search Service
- Recherche full-text via Elasticsearch
- Autocomplétion
- Filtres avancés

**Déploiement** :
- Réplication : 3 pods minimum
- Auto-scaling : 3-10 pods
- Health checks : liveness et readiness probes

### 3. Bases de Données

#### PostgreSQL (CloudNative-pg)

**Usage** : Base de données principale

**Schéma** :
- `users` : Informations utilisateurs (+ liaison Keycloak)
- `products` : Catalogue de livres
- `carts` / `cart_items` : Paniers d'achat
- `orders` / `order_items` : Commandes

**Configuration** :
- Cluster 3 instances (haute disponibilité)
- Backups quotidiens vers Linode Object Storage
- Rétention : 30 jours

#### Redis

**Usage** :
- Cache des données fréquentes
- Leaderboard des bestsellers (sorted sets)
- Sessions (si nécessaire)

**Configuration** :
- StatefulSet avec 1 replica
- Persistence (RDB + AOF)
- Volume persistant 10Gi

#### Elasticsearch

**Usage** :
- Recherche full-text des produits
- Indexation titre, auteur, description, catégorie
- Suggestions de recherche

**Configuration** :
- StatefulSet 1 node (production: 3 nodes recommandé)
- Volume persistant 30Gi
- Index : `bookstore_products`

### 4. Authentification - Keycloak

**Technologie** : Keycloak 23 (inclus dans APL)

**Configuration** :
- Realm : `bookstore`
- Clients :
  - `bookstore-api` (confidential, pour l'API)
  - `bookstore-frontend` (public, pour le SPA)

**Fonctionnalités** :
- OAuth2 / OpenID Connect
- Gestion des utilisateurs
- Rôles et permissions
- Social login (optionnel)

### 5. Service Mesh - Istio

**Technologie** : Istio (inclus dans APL)

**Fonctionnalités** :
- **Gateway** : Point d'entrée unique
- **VirtualService** : Routage intelligent
- **DestinationRule** : Load balancing, circuit breaking
- **mTLS** : Chiffrement inter-services
- **Observabilité** : Tracing avec Jaeger

**Configuration** :
- Gateway sur ports 80/443
- TLS termination
- CORS configuré
- Rate limiting
- Retry policies

### 6. CI/CD - Tekton

**Pipelines** :

#### API Pipeline
1. Clone Git repository
2. Run tests (npm test)
3. Build Docker image (Buildah)
4. Push to registry
5. Deploy to Kubernetes
6. Rolling update

#### Frontend Pipeline
1. Clone Git repository
2. Lint & Build (npm run build)
3. Build Docker image
4. Push to registry
5. Deploy to Kubernetes
6. Rolling update

**Déclencheurs** :
- Git push sur main/develop
- Tags Git pour les releases
- Webhooks GitHub/GitLab

### 7. Monitoring & Observabilité

#### Prometheus
- Collecte des métriques
- Alerting
- Métriques custom de l'application

#### Grafana
- Dashboards de visualisation
- Alertes visuelles
- Dashboards par défaut pour Kubernetes

#### Jaeger
- Distributed tracing
- Performance analysis
- Debugging des requêtes

#### Logging
- Winston (API logs)
- ELK Stack ou Loki (agrégation)

## Flux de Données

### 1. Consultation du Catalogue

```
User → CDN → Istio Gateway → Frontend
Frontend → API (/api/v1/products)
API → PostgreSQL (liste produits)
API → Redis (cache)
API ← PostgreSQL
Frontend ← API (JSON)
User ← Frontend (HTML)
```

### 2. Recherche de Produits

```
User → Frontend (search input)
Frontend → API (/api/v1/search?q=...)
API → Elasticsearch (query)
API ← Elasticsearch (results)
Frontend ← API (JSON)
User ← Frontend (affichage)
```

### 3. Ajout au Panier

```
User → Frontend (add to cart)
Frontend → Keycloak (verify auth)
Frontend → API (/api/v1/cart/:userId/items)
API → PostgreSQL (insert cart_item)
API → Redis (invalidate cache)
Frontend ← API (success)
User ← Frontend (confirmation)
```

### 4. Passage de Commande

```
User → Frontend (checkout)
Frontend → API (/api/v1/orders)
API → PostgreSQL (create order)
API → PostgreSQL (clear cart)
API → Redis (update bestsellers leaderboard)
API → Elasticsearch (trigger reindex if needed)
Frontend ← API (order confirmation)
User ← Frontend (order details)
```

## Comparaison AWS vs APL

| Composant AWS | Équivalent APL | Notes |
|---------------|----------------|-------|
| Lambda | Kubernetes Pods | Services conteneurisés vs serverless |
| API Gateway | Istio Gateway | Service mesh avec plus de fonctionnalités |
| DynamoDB | PostgreSQL | NoSQL → SQL (plus structuré) |
| Cognito | Keycloak | Open-source, plus flexible |
| ElastiCache | Redis StatefulSet | Même technologie, différent déploiement |
| Elasticsearch | Elasticsearch | Même technologie |
| S3 | Linode Object Storage | Compatible S3 |
| CloudFront | Akamai CDN | CDN plus performant |
| CloudWatch | Prometheus + Grafana | Plus de contrôle, open-source |
| X-Ray | Jaeger | Tracing distribué standard |
| CodePipeline | Tekton | CI/CD Kubernetes-native |

## Sécurité

### Couches de Sécurité

1. **Réseau**
   - Istio mTLS entre services
   - Network Policies Kubernetes
   - Firewall Linode

2. **Application**
   - Authentification Keycloak (OAuth2/OIDC)
   - Validation des entrées (Joi)
   - Rate limiting
   - CORS strict

3. **Données**
   - Encryption at rest (volumes)
   - Encryption in transit (TLS)
   - Secrets management (Sealed Secrets)
   - Backups chiffrés

4. **Infrastructure**
   - RBAC Kubernetes
   - Pod Security Standards
   - Image scanning
   - Vulnerability assessments

## Scalabilité

### Horizontal Scaling

- **Frontend** : 2-5 pods (HPA sur CPU)
- **API** : 3-10 pods (HPA sur CPU/Memory)
- **PostgreSQL** : 3 instances (clustering)
- **Redis** : 1-3 instances (optionnel: Redis Cluster)
- **Elasticsearch** : 1-3 nodes

### Vertical Scaling

Ajustement des ressources par composant selon la charge.

## Haute Disponibilité

- Multi-zone deployment (LKE)
- Réplication des bases de données
- Health checks automatiques
- Rolling updates sans downtime
- Backups automatisés
- Disaster recovery plan

## Coûts Estimés

### Infrastructure Mensuelle (estimation)

- **LKE Cluster** (3x g6-standard-2): ~$90/mois
- **Block Storage** (100Gi total): ~$10/mois
- **Object Storage** (backups): ~$5/mois
- **Load Balancer**: ~$10/mois
- **Bandwidth**: Variable selon le trafic

**Total estimé**: ~$115-150/mois (vs ~$324/mois sur AWS selon la doc originale)

## Évolutions Futures

1. **Graph Database** : Ajouter Neo4j pour les recommandations sociales
2. **Cache avancé** : Redis Cluster pour plus de performance
3. **Multi-region** : Déploiement sur plusieurs régions Linode
4. **Serverless** : Intégrer Knative pour certaines fonctions
5. **ML/AI** : Recommandations intelligentes avec TensorFlow
