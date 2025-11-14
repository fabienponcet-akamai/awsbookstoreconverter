# Plan de Migration : AWS Bookstore → Akamai App Platform (Linode)

## Vue d'ensemble

Migration d'une application serverless AWS vers une architecture Kubernetes native sur Akamai App Platform (APL).

## Mapping des Services

### 1. Compute & API
| AWS Service | Akamai/APL Équivalent | Notes |
|-------------|----------------------|-------|
| AWS Lambda | Kubernetes Deployments/Services | Conteneuriser les fonctions Lambda |
| API Gateway | Istio Gateway + Virtual Services | Inclus dans APL |

### 2. Bases de Données
| AWS Service | Akamai/APL Équivalent | Notes |
|-------------|----------------------|-------|
| DynamoDB | PostgreSQL (CloudNative-pg) | Inclus dans APL, schéma relationnel |
| Amazon Neptune | Neo4j / PostgreSQL avec extension graph | Pour les recommandations sociales |
| ElastiCache Redis | Redis StatefulSet | Cache et leaderboard |
| Elasticsearch | Elasticsearch/OpenSearch | Recherche full-text |

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

## Architecture Cible

```
┌─────────────────────────────────────────────────────────┐
│                    Akamai CDN / Nginx                    │
└─────────────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────┐
│              Istio Gateway (Ingress)                     │
└─────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼────────┐  ┌──────▼─────┐  ┌────────▼────────┐
│  Frontend      │  │   API       │  │   Keycloak      │
│  (React SPA)   │  │  Services   │  │   (Auth)        │
│                │  │             │  │                 │
└────────────────┘  └──────┬──────┘  └─────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼────────┐  ┌──────▼─────┐  ┌────────▼────────┐
│  PostgreSQL    │  │   Redis     │  │  Elasticsearch  │
│  (CloudNative) │  │             │  │                 │
└────────────────┘  └─────────────┘  └─────────────────┘
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

### Backend
- **Langage** : Node.js (Express) pour faciliter la migration depuis Lambda Node.js
- **ORM** : Prisma ou TypeORM pour PostgreSQL
- **API** : REST avec OpenAPI/Swagger

### Frontend
- **Framework** : React (existant)
- **Auth** : Keycloak adapter pour React
- **Build** : Nginx pour servir le build production

### Bases de Données
- **Principale** : PostgreSQL (via CloudNative-pg)
- **Cache** : Redis
- **Recherche** : Elasticsearch ou OpenSearch
- **Graph** : PostgreSQL avec extension AGE ou Neo4j

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
