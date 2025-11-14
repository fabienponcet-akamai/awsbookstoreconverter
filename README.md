# AWS Bookstore to Akamai App Platform Migration
## Serverless Cloud-Native avec Knative + CloudNative-PG

Ce projet convertit l'[AWS Bookstore Demo App](https://github.com/aws-samples/aws-bookstore-demo-app) pour fonctionner sur [Akamai App Platform (APL)](https://github.com/linode/apl-core) sur Linode.

## Vue d'ensemble

Migration d'une architecture serverless AWS vers une architecture **Kubernetes serverless cloud-native** :

- **Frontend** : React SPA **statique sur Linode Object Storage + Akamai CDN** (exactement comme S3 + CloudFront !)
- **Backend** : **Knative Serving** (serverless, scale-to-zero)
- **Auth** : Keycloak (remplace Cognito)
- **Databases** : **CloudNative-PG** 100% unifié (3 clusters PostgreSQL - TOUT !)
  - Main : Données transactionnelles + **Cache** + **Leaderboard** (remplace Redis aussi!)
  - Search : Full-text search avec **pg_trgm + ts_vector** (remplace Elasticsearch)
  - Graph : Recommandations avec **Apache AGE** (remplace Neptune)
- **Déploiement** : Kubernetes via APL avec Istio, Tekton, ArgoCD

## Architecture Cloud-Native

```
┌──────────────────────────────────────────────────────────────────┐
│                      User's Browser                              │
└────────────┬──────────────────────────────┬──────────────────────┘
             │                              │
             │ Static Files                 │ API Calls
             ▼                              ▼
    ┌─────────────────┐           ┌──────────────────┐
    │  Akamai CDN     │           │  Istio Gateway   │
    │  (HTML/JS/CSS)  │           │  (API Routing)   │
    └────────┬────────┘           └────────┬─────────┘
             │                              │
             ▼                              ▼
    ┌─────────────────┐           ┌──────────────────┐
    │ Linode Object   │           │ Knative Services │
    │   Storage       │           │   (Serverless)   │
    │  ─────────────  │           │  Scale-to-Zero   │
    │ React Build:    │           └────────┬─────────┘
    │ • index.html    │                    │
    │ • bundle.js     │      ┌─────────────┼─────────────┐
    │ • styles.css    │      │             │             │
    └─────────────────┘┌─────▼──────┐┌────▼──────┐┌────▼──────┐
                       │CloudNative ││CloudNative││CloudNative│
                       │  PG "main" ││PG "search"││ PG "graph"│
                       │━━━━━━━━━━━━││━━━━━━━━━━━││━━━━━━━━━━━│
                       │• Products  ││• pg_trgm  ││• Apache   │
                       │• Cart      ││• ts_vector││  AGE      │
                       │• Orders    ││• FTS      ││• Cypher   │
                       │• Users     ││• Fuzzy    ││• Reco     │
                       │• Cache     ││           ││           │
                       │• Board     ││           ││           │
                       └────────────┘└───────────┘└───────────┘
                                Keycloak (Auth)

    🎉 100% Serverless : Frontend (Object Storage) + Backend (Knative) 🎉
         Pas de Redis, Elasticsearch, Neptune, ni pods frontend !
```

## Avantages de cette Architecture

### ✅ Frontend 100% Serverless (exactement comme AWS S3 + CloudFront)
- **Pas de pods Kubernetes** : Juste des fichiers statiques sur Object Storage
- **Linode Object Storage** : Compatible S3 API, ~$5/mois
- **Akamai CDN** : Distribution globale, caching automatique
- **Déploiement** : `npm build` + upload → C'est tout !
- **Économies** : ~$15/mois vs Deployment Kubernetes avec pods frontend

### ✅ Backend Knative Serving
- **Scale-to-zero** : Pas de coûts quand pas de trafic
- **Auto-scaling** : Scale basé sur les requêtes/sec
- **Serverless natif** : Comme Lambda mais sur Kubernetes

### ✅ CloudNative-PG 100% Unifié - TOUT dans PostgreSQL !
- **Un seul opérateur** : PostgreSQL pour TOUT (données, cache, search, graph)
- **Extensions + fonctionnalités natives** : pg_trgm, ts_vector, Apache AGE, JSONB
- **Coûts réduits** : vs Elasticsearch + Neptune + Redis séparés
- **Backups unifiés** : Stratégie cohérente
- **Pas de Redis !** : Cache et leaderboard aussi dans PostgreSQL

## Prérequis

- Cluster Kubernetes (LKE recommandé)
- Akamai App Platform (APL) installé
- `kubectl` configuré
- `docker` pour le développement local

## Structure du Projet

```
├── apps/                    # Applications APL
│   ├── bookstore-api/      # Backend services
│   ├── bookstore-frontend/ # React frontend
│   └── databases/          # Database configs
├── kubernetes/             # K8s manifests
│   ├── base/              # Base configurations
│   └── overlays/          # Environment-specific
├── src/                   # Source code
│   ├── api/              # API services (ex-Lambda)
│   ├── frontend/         # React application
│   └── shared/           # Shared utilities
├── tekton/               # CI/CD pipelines
└── docs/                 # Documentation
```

## Démarrage Rapide

### 1. Développement Local

```bash
# Démarrer les bases de données localement
docker-compose up -d

# Installer les dépendances
cd src/api && npm install
cd ../frontend && npm install

# Démarrer l'API
cd src/api && npm run dev

# Démarrer le frontend
cd src/frontend && npm start
```

### 2. Déploiement sur APL

```bash
# Appliquer les configurations de base de données
kubectl apply -k kubernetes/base/databases/

# Déployer l'API
kubectl apply -k kubernetes/overlays/dev/api/

# Déployer le frontend
kubectl apply -k kubernetes/overlays/dev/frontend/

# Configurer Istio Gateway
kubectl apply -k kubernetes/base/gateway/
```

## Services Migrés (Cloud-Native)

| Service AWS | Solution Cloud-Native | Statut |
|-------------|----------------------|--------|
| Lambda | **Knative Serving** (serverless, scale-to-zero) | ✅ Implémenté |
| DynamoDB | **CloudNative-PG** cluster "main" | ✅ Implémenté |
| Neptune (graph) | **CloudNative-PG** + Apache AGE (cluster "graph") | ✅ Implémenté |
| Elasticsearch | **CloudNative-PG** + pg_trgm/ts_vector (cluster "search") | ✅ Implémenté |
| ElastiCache (Redis) | **PostgreSQL** cache + leaderboard tables | ✅ Implémenté |
| Cognito | Keycloak | ✅ Configuré |
| API Gateway | Istio Gateway + Knative | ✅ Configuré |
| S3/CloudFront | Object Storage + Akamai CDN | ✅ Configuré |

### PostgreSQL - Tout-en-un ! 🚀

**Extensions utilisées** :
- **Apache AGE** : Graph database (recommandations sociales)
- **pg_trgm** : Fuzzy search (tolérance aux fautes)
- **ts_vector** : Full-text search (recherche sémantique)
- **fuzzystrmatch** : Matching flou
- **unaccent** : Recherche sans accents

**Fonctionnalités natives PostgreSQL** :
- **JSONB** : Cache avec TTL (remplace Redis cache)
- **Materialized Views** : Leaderboard auto-calculé depuis orders (remplace Redis sorted sets)
  - Refresh concurrentiel (non-bloquant)
  - Score pondéré par récence et quantité
  - Une seule source de vérité (orders table)
  - Refresh automatique chaque minute via pg_cron
- **Triggers** : Nettoyage automatique du cache expiré
- **pg_cron** : Refresh automatique du leaderboard + maintenance

## Fonctionnalités

- ✅ Plan de migration créé
- 🚧 Structure du projet
- ⏳ Configuration des bases de données
- ⏳ API Backend
- ⏳ Frontend React
- ⏳ Authentification Keycloak
- ⏳ Recherche (Elasticsearch)
- ⏳ Recommandations
- ⏳ Leaderboard (Redis)
- ⏳ CI/CD Pipelines

## Documentation

- [Plan de Migration](./MIGRATION_PLAN.md)
- [Architecture](./docs/architecture.md)
- [Guide de Déploiement](./docs/deployment.md)
- [Guide de Développement](./docs/development.md)

## Contribution

Ce projet est une migration de l'application AWS Bookstore Demo. Pour contribuer :

1. Fork le projet
2. Créer une branche (`git checkout -b feature/amélioration`)
3. Commit les changements (`git commit -am 'Ajout de fonctionnalité'`)
4. Push vers la branche (`git push origin feature/amélioration`)
5. Créer une Pull Request

## Licence

Ce projet est basé sur l'AWS Bookstore Demo App (MIT-0 License).

## Références

- [AWS Bookstore Demo](https://github.com/aws-samples/aws-bookstore-demo-app)
- [Akamai App Platform](https://github.com/linode/apl-core)
- [Linode Kubernetes Engine](https://www.linode.com/products/kubernetes/)
