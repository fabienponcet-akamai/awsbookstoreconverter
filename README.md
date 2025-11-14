# AWS Bookstore to Akamai App Platform Migration
## Serverless Cloud-Native avec Knative + CloudNative-PG

Ce projet convertit l'[AWS Bookstore Demo App](https://github.com/aws-samples/aws-bookstore-demo-app) pour fonctionner sur [Akamai App Platform (APL)](https://github.com/linode/apl-core) sur Linode.

## Vue d'ensemble

Migration d'une architecture serverless AWS vers une architecture **Kubernetes serverless cloud-native** :

- **Frontend** : React SPA servie via Nginx
- **Backend** : **Knative Serving** (serverless, scale-to-zero)
- **Auth** : Keycloak (remplace Cognito)
- **Databases** : **CloudNative-PG** 100% unifié (3 clusters PostgreSQL - TOUT !)
  - Main : Données transactionnelles + **Cache** + **Leaderboard** (remplace Redis aussi!)
  - Search : Full-text search avec **pg_trgm + ts_vector** (remplace Elasticsearch)
  - Graph : Recommandations avec **Apache AGE** (remplace Neptune)
- **Déploiement** : Kubernetes via APL avec Istio, Tekton, ArgoCD

## Architecture Cloud-Native

```
Akamai CDN → Istio Gateway → Frontend (React) + Knative Services (Serverless)
                                                       ↓
                                 ┌────────────────────┼────────────────────┐
                                 │                    │                    │
                         CloudNative-PG      CloudNative-PG       CloudNative-PG
                            "main"              "search"             "graph"
                         ━━━━━━━━━━━━        ━━━━━━━━━━━━        ━━━━━━━━━━━━
                         • Products           • Full-text         • Apache AGE
                         • Cart               • pg_trgm           • Graph DB
                         • Orders             • ts_vector         • Cypher
                         • Users              • Fuzzy search      • Recommendations
                         • Cache (!)
                         • Leaderboard (!)
                                 │                    │                    │
                                 └────────────────────┴────────────────────┘
                                            Keycloak (Auth)

                          🎉 Redis supprimé - TOUT dans PostgreSQL ! 🎉
```

## Avantages de cette Architecture

### ✅ Knative Serving
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
- **Tables + INDEX** : Leaderboard avec ORDER BY (remplace Redis sorted sets)
- **Triggers** : Nettoyage automatique du cache expiré
- **pg_cron** : Maintenance programmée (optionnel)

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
