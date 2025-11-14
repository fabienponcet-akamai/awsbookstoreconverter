# Plan de Migration : AWS Bookstore → Akamai App Platform (Knative + CloudNative-PG)

## Vue d'ensemble

Migration d'une application serverless AWS vers une architecture **Kubernetes serverless cloud-native** avec **Knative** et **CloudNative-PG**.

Cette version utilise une approche **100% cloud-native** :
- **Knative Serving** pour les API serverless (remplace Lambda)
- **CloudNative-PG** pour TOUTES les bases de données (PostgreSQL unifié)
- **Extensions PostgreSQL** pour remplacer les services spécialisés

## Mapping des Services

### 1. Compute & API - Serverless Knative
| AWS Service | Solution Cloud-Native | Notes |
|-------------|----------------------|-------|
| AWS Lambda | **Knative Serving** | Serverless Kubernetes, scale-to-zero, auto-scaling |
| API Gateway | Istio Gateway + Knative | Routage intelligent avec auto-scaling |

### 2. Bases de Données - PostgreSQL Unifié avec CloudNative-PG
| AWS Service | Solution Cloud-Native | Extensions PostgreSQL |
|-------------|----------------------|----------------------|
| DynamoDB | **CloudNative-PG** (cluster "main") | Tables relationnelles standard |
| Amazon Neptune | **CloudNative-PG** (cluster "graph") + **Apache AGE** | Extension graph database pour PostgreSQL |
| Elasticsearch | **CloudNative-PG** (cluster "search") + **pg_trgm + ts_vector** | Recherche full-text native PostgreSQL |
| ElastiCache Redis | **Redis StatefulSet** | Cache et leaderboard (conservé) |

### 3. Authentification & Sécurité
| AWS Service | Akamai/APL Équivalent | Notes |
|-------------|----------------------|-------|
| Amazon Cognito | Keycloak | Inclus dans APL, OIDC/OAuth2 |
| IAM | Kubernetes RBAC + Istio AuthorizationPolicy | Zero-trust avec Istio |

### 4. Stockage & CDN
| AWS Service | Akamai/APL Équivalent | Notes |
|-------------|----------------------|-------|
| S3 | Linode Object Storage | Stockage d'objets compatible S3 |
| CloudFront | Nginx/Istio Ingress + Akamai CDN | Distribution de contenu |

### 5. CI/CD & Monitoring
| AWS Service | Akamai/APL Équivalent | Notes |
|-------------|----------------------|-------|
| CodePipeline/CodeBuild | Tekton Pipelines | Inclus dans APL |
| CloudWatch | Prometheus + Grafana | Monitoring et métriques |
| X-Ray | Jaeger | Tracing distribué |

## Architecture PostgreSQL Unifiée

Tous les besoins de données sont gérés par CloudNative-PG avec 3 clusters spécialisés :

```
┌─────────────────────────────────────────────────────────┐
│           CloudNative-PG Operator                        │
└─────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼────────┐  ┌──────▼─────┐  ┌────────▼────────┐
│  PG Cluster    │  │ PG Cluster  │  │  PG Cluster     │
│  "main"        │  │ "search"    │  │  "graph"        │
│                │  │             │  │                 │
│  • Products    │  │ • Full-text │  │ • Apache AGE    │
│  • Cart        │  │ • ts_vector │  │ • Graph queries │
│  • Orders      │  │ • pg_trgm   │  │ • Social graph  │
│  • Users       │  │ • Fuzzy     │  │ • Recomm.       │
│                │  │   search    │  │                 │
└────────────────┘  └─────────────┘  └─────────────────┘
     3 instances       2 instances       2 instances
     (HA)              (Performance)      (Graph ops)
```

## Architecture Cible avec Knative

```
┌─────────────────────────────────────────────────────────┐
│                    Akamai CDN                            │
└─────────────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────┐
│              Istio Gateway (Ingress)                     │
└─────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼────────┐  ┌──────▼─────────┐  ┌────▼────────┐
│  Frontend      │  │ Knative Services │  │  Keycloak   │
│  (React SPA)   │  │  (Serverless)    │  │   (Auth)    │
│                │  │                  │  │             │
│  • Nginx       │  │ • Products API   │  └─────────────┘
│  • Static      │  │ • Cart API       │
└────────────────┘  │ • Orders API     │
                    │ • Search API     │
                    │                  │
                    │ 🔄 Auto-scaling  │
                    │ 💤 Scale-to-zero │
                    └──────┬───────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼────────┐  ┌──────▼─────┐  ┌────────▼────────┐
│ CloudNative-PG │  │   Redis     │  │ CloudNative-PG  │
│   "main"       │  │   Cache     │  │   "search"      │
│                │  │ Leaderboard │  │                 │
│ • Products     │  └─────────────┘  │ • Full-text     │
│ • Cart         │                   │ • ts_vector     │
│ • Orders       │  ┌─────────────┐  │ • pg_trgm       │
│ • Users        │  │CloudNative- │  └─────────────────┘
└────────────────┘  │  PG "graph" │
                    │             │
                    │ • Apache AGE│
                    │ • Social    │
                    │   graph     │
                    │ • Recomm.   │
                    └─────────────┘
```

## Structure du Projet

```
awsbookstoreconverter/
├── apps/                           # Applications APL
│   ├── bookstore-api/             # Services API backend
│   ├── bookstore-frontend/        # Application React
│   └── databases/                 # Configurations DB
├── kubernetes/                     # Manifests K8s
│   ├── base/                      # Configurations de base
│   └── overlays/                  # Environnements (dev/prod)
├── src/                           # Code source
│   ├── api/                       # Services API (ex-Lambda)
│   ├── frontend/                  # React app
│   └── shared/                    # Code partagé
├── tekton/                        # Pipelines CI/CD
└── docs/                          # Documentation

```

## Phases de Migration

### Phase 1 : Infrastructure de Base ✓
- [x] Analyse de l'architecture AWS
- [ ] Configuration APL core
- [ ] Déploiement des bases de données (PostgreSQL, Redis, Elasticsearch)
- [ ] Configuration Keycloak pour l'authentification

### Phase 2 : Backend
- [ ] Conversion des fonctions Lambda en services Node.js/Python
- [ ] Création des APIs REST avec Express/FastAPI
- [ ] Migration du schéma DynamoDB vers PostgreSQL
- [ ] Configuration des connexions aux bases de données
- [ ] Tests des endpoints API

### Phase 3 : Frontend
- [ ] Adaptation du code React pour Keycloak (remplacer Amplify/Cognito)
- [ ] Configuration des URLs d'API
- [ ] Containerisation de l'application React
- [ ] Configuration du build et déploiement

### Phase 4 : DevOps & Déploiement
- [ ] Création des Tekton Pipelines
- [ ] Configuration Istio (Gateway, VirtualService, DestinationRule)
- [ ] Configuration des secrets (Sealed Secrets)
- [ ] Tests d'intégration end-to-end

### Phase 5 : Fonctionnalités Avancées
- [ ] Configuration du système de recommandations (graph DB)
- [ ] Mise en place du leaderboard avec Redis
- [ ] Configuration de la recherche Elasticsearch
- [ ] Monitoring avec Prometheus/Grafana

## Décisions Techniques

## Avantages de cette Architecture

### 1. Knative Serving (vs Kubernetes Deployments classiques)

**Pourquoi Knative ?**
- ✅ **Scale-to-zero** : Économies importantes quand pas de trafic
- ✅ **Auto-scaling rapide** : Scale en fonction des requêtes/sec (pas seulement CPU)
- ✅ **Gestion du trafic** : Blue/Green, Canary deployments intégrés
- ✅ **Serverless natif** : Même expérience que Lambda mais avec Kubernetes
- ✅ **Cold start optimisé** : Plus rapide que Lambda (conteneurs pré-chauffés)

**Comportement du scale-to-zero** :
```
Pas de requêtes → 0 pods (économies)
    ↓
Requêtes arrivent → Auto-scale instantané (1-N pods)
    ↓
Trafic élevé → Scale jusqu'à N pods
    ↓
Retour au calme → Scale-down progressif → 0
```

### 2. CloudNative-PG Unifié (vs Services multiples)

**Pourquoi unifier avec PostgreSQL ?**
- ✅ **Un seul opérateur** : CloudNative-PG gère tout
- ✅ **Backups unifiés** : Stratégie de backup cohérente
- ✅ **Coûts réduits** : Moins de resources que Elasticsearch + Neptune séparés
- ✅ **Maintenance simplifiée** : Un seul système à gérer
- ✅ **Performance** : PostgreSQL 15+ avec optimisations modernes
- ✅ **Extensions puissantes** : AGE, pg_trgm, ts_vector incluses

### 3. Extensions PostgreSQL Utilisées

#### Apache AGE (Graph Database) - Remplace Neptune

```sql
-- Installation de l'extension
CREATE EXTENSION age;

-- Créer un graph pour le réseau social
SELECT create_graph('social_network');

-- Ajouter des utilisateurs et leurs achats
SELECT * FROM cypher('social_network', $$
  CREATE (u:User {id: 'user123', name: 'Alice'})
$$) as (v agtype);

SELECT * FROM cypher('social_network', $$
  MATCH (u:User {id: 'user123'})
  CREATE (b:Book {isbn: '1234', title: 'JavaScript Guide'})
  CREATE (u)-[:PURCHASED {date: '2024-01-15'}]->(b)
$$) as (v agtype);

-- Recommandations basées sur le graph social
-- "Trouve les livres achetés par des utilisateurs qui ont acheté les mêmes livres que moi"
SELECT * FROM cypher('social_network', $$
  MATCH (user:User {id: 'user123'})-[:PURCHASED]->(book:Book)
        <-[:PURCHASED]-(other:User)-[:PURCHASED]->(recommendation:Book)
  WHERE NOT (user)-[:PURCHASED]->(recommendation)
  RETURN recommendation.title, recommendation.isbn, COUNT(other) as score
  ORDER BY score DESC
  LIMIT 10
$$) as (title text, isbn text, score bigint);
```

#### pg_trgm + ts_vector (Full-text Search) - Remplace Elasticsearch

```sql
-- Installation des extensions
CREATE EXTENSION pg_trgm;
CREATE EXTENSION unaccent;

-- Index pour recherche full-text
CREATE INDEX idx_product_fulltext ON products
  USING GIN (to_tsvector('english', title || ' ' || author || ' ' || description));

-- Index trigram pour fuzzy search (typos)
CREATE INDEX idx_product_trigram ON products
  USING GIN (title gin_trgm_ops);

-- Recherche full-text avec ranking
SELECT
  title,
  author,
  ts_rank(to_tsvector('english', title || ' ' || author || ' ' || description),
          to_tsquery('english', 'javascript & programming')) as rank
FROM products
WHERE to_tsvector('english', title || ' ' || author || ' ' || description)
      @@ to_tsquery('english', 'javascript & programming')
ORDER BY rank DESC
LIMIT 20;

-- Recherche fuzzy (tolère les fautes de frappe)
SELECT title, similarity(title, 'javascrpt') as sim
FROM products
WHERE title % 'javascrpt'  -- trouve "javascript"
ORDER BY sim DESC
LIMIT 10;

-- Autocomplétion
SELECT DISTINCT title
FROM products
WHERE title ILIKE 'java%'
LIMIT 5;
```

## Décisions Techniques (Mise à Jour)

### Backend - Serverless avec Knative
- **Runtime** : Knative Serving (serverless, scale-to-zero)
- **Langage** : Node.js avec Express
- **ORM** : Prisma avec support extensions PostgreSQL
- **API** : REST avec auto-scaling Knative
- **Containerisation** : Docker multi-stage

### Frontend
- **Framework** : React 18
- **Auth** : Keycloak adapter (@react-keycloak/web)
- **Build** : Nginx pour servir le SPA

### Bases de Données - Architecture CloudNative-PG Unifiée

#### Cluster 1: "bookstore-main"
- **Usage** : Données principales (products, cart, orders, users)
- **Extensions** : Standard PostgreSQL
- **Instances** : 3 (haute disponibilité)
- **Backup** : Continuous WAL archiving
- **Storage** : 20Gi par instance

#### Cluster 2: "bookstore-search"
- **Usage** : Recherche full-text (remplace Elasticsearch)
- **Extensions** : `pg_trgm`, `fuzzystrmatch`, `unaccent`
- **Instances** : 2 (read replicas pour performance)
- **Optimisations** : Index GIN, ts_vector, trigrams
- **Storage** : 15Gi par instance

#### Cluster 3: "bookstore-graph"
- **Usage** : Graph database (remplace Neptune)
- **Extensions** : `apache_age` (graph database)
- **Instances** : 2 (réplication pour HA)
- **Usage** : Recommandations sociales, relations utilisateurs
- **Storage** : 10Gi par instance

## Prochaines Étapes

1. Créer la structure de base du projet
2. Configurer les manifests Kubernetes pour les bases de données
3. Développer les services API de base
4. Migrer le frontend React
5. Configurer les pipelines Tekton

## Estimations

- **Durée estimée** : 4-6 semaines
- **Complexité** : Élevée
- **Risques** : Migration du schéma de données, configuration de Keycloak, performance

---

Dernière mise à jour : 2025-11-14
