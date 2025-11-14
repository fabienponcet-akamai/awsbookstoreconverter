# AWS Bookstore to Akamai App Platform Migration

Ce projet convertit l'[AWS Bookstore Demo App](https://github.com/aws-samples/aws-bookstore-demo-app) pour fonctionner sur [Akamai App Platform (APL)](https://github.com/linode/apl-core) sur Linode.

## Vue d'ensemble

Migration d'une architecture serverless AWS vers une architecture Kubernetes native :

- **Frontend** : React SPA servie via Nginx
- **Backend** : Services API Node.js (ex-Lambda functions)
- **Auth** : Keycloak (remplace Cognito)
- **Databases** : PostgreSQL, Redis, Elasticsearch
- **Déploiement** : Kubernetes via APL avec Istio, Tekton, ArgoCD

## Architecture

```
Akamai CDN → Istio Gateway → Frontend (React) + API Services
                                    ↓
                      PostgreSQL + Redis + Elasticsearch
                                    ↓
                               Keycloak (Auth)
```

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

## Services Migrés

| Service AWS | Équivalent APL | Statut |
|-------------|----------------|--------|
| Lambda | Kubernetes Services | 🚧 En cours |
| DynamoDB | PostgreSQL | 🚧 En cours |
| Cognito | Keycloak | ⏳ À faire |
| ElastiCache | Redis | ⏳ À faire |
| Elasticsearch | Elasticsearch | ⏳ À faire |
| API Gateway | Istio Gateway | ⏳ À faire |
| S3/CloudFront | Object Storage + CDN | ⏳ À faire |

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
