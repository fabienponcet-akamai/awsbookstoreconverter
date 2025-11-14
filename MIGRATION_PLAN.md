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
| ElastiCache Redis | **CloudNative-PG** (cluster "main") + **Materialized Views** | Cache (JSONB + TTL) + Leaderboard (Materialized View auto-refresh) |

### 3. Authentification & Sécurité
| AWS Service | Akamai/APL Équivalent | Notes |
|-------------|----------------------|-------|
| Amazon Cognito | Keycloak | Inclus dans APL, OIDC/OAuth2 |
| IAM | Kubernetes RBAC + Istio AuthorizationPolicy | Zero-trust avec Istio |

### 4. Stockage & CDN
| AWS Service | Akamai/APL Équivalent | Notes |
|-------------|----------------------|-------|
| S3 (frontend) | Linode Object Storage | Fichiers statiques React (HTML/JS/CSS) |
| CloudFront | Akamai CDN | Distribution globale avec caching |

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

## Architecture Cible 100% Serverless

```
┌────────────────────────────────────────────────────────────────────┐
│                         User's Browser                              │
└────────────┬───────────────────────────────────┬────────────────────┘
             │                                   │
     Static Files (HTML/JS/CSS)          API Calls (/api/*)
             │                                   │
             ▼                                   ▼
┌─────────────────────────┐         ┌────────────────────────────┐
│     Akamai CDN          │         │    Istio Gateway (API)     │
│  (Global Distribution)  │         │     (Ingress routing)      │
└────────────┬────────────┘         └────────────┬───────────────┘
             │                                   │
             ▼                                   │
┌─────────────────────────┐                     │
│ Linode Object Storage   │                     │
│   (S3-compatible)       │                     │
│                         │                     │
│  bookstore-frontend/    │         ┌───────────▼───────────┐
│  • index.html           │         │  Knative Services     │
│  • bundle.[hash].js     │         │   (Serverless)        │
│  • styles.[hash].css    │         │                       │
│  • assets/              │         │ • Products API        │
│                         │         │ • Cart API            │
│  Cache: 1 year (assets) │         │ • Orders API          │
│         no-cache (HTML) │         │ • Search API          │
└─────────────────────────┘         │ • Recommendations API │
                                    │                       │
      ┌──────────────┐              │ 🔄 Auto-scaling      │
      │  Keycloak    │              │ 💤 Scale-to-zero     │
      │   (Auth)     │              └───────────┬───────────┘
      └──────────────┘                          │
                                ┌───────────────┼───────────────┐
                                │               │               │
                      ┌─────────▼────────┐ ┌───▼────────┐ ┌───▼─────────┐
                      │ CloudNative-PG   │ │CloudNative │ │CloudNative  │
                      │    "main"        │ │  "graph"   │ │  "search"   │
                      │                  │ │            │ │             │
                      │ • Products       │ │• Apache AGE│ │• Full-text  │
                      │ • Cart           │ │• Cypher    │ │• ts_vector  │
                      │ • Orders         │ │• Social    │ │• pg_trgm    │
                      │ • Users          │ │  graph     │ │• Fuzzy      │
                      │ • Cache (JSONB)  │ │• Recomm.   │ │  search     │
                      │ • Leaderboard    │ └────────────┘ └─────────────┘
                      │   (Mat. View)    │
                      └──────────────────┘

         ✨ 100% Serverless Architecture ✨
         Frontend: Object Storage + CDN (pas de pods)
         Backend: Knative (scale-to-zero)
         Databases: CloudNative-PG (PostgreSQL pour TOUT)
         Pas de Redis, Elasticsearch, Neptune séparés !
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
- [ ] Déploiement des bases de données (3 clusters CloudNative-PG : main, graph, search)
- [ ] Configuration Keycloak pour l'authentification

### Phase 2 : Backend
- [ ] Conversion des fonctions Lambda en services Node.js/Python
- [ ] Création des APIs REST avec Express/FastAPI
- [ ] Migration du schéma DynamoDB vers PostgreSQL
- [ ] Configuration des connexions aux bases de données
- [ ] Tests des endpoints API

### Phase 3 : Frontend (100% Serverless)
- [ ] Adaptation du code React pour Keycloak (remplacer Amplify/Cognito)
- [ ] Configuration des URLs d'API
- [ ] Build de production React (npm run build)
- [ ] Déploiement sur Linode Object Storage
- [ ] Configuration Akamai CDN pour distribution globale
- [ ] Setup cache headers (1 year pour assets, no-cache pour HTML)

### Phase 4 : DevOps & Déploiement
- [ ] Création des Tekton Pipelines
- [ ] Configuration Istio (Gateway, VirtualService, DestinationRule)
- [ ] Configuration des secrets (Sealed Secrets)
- [ ] Tests d'intégration end-to-end

### Phase 5 : Fonctionnalités Avancées
- [ ] Configuration du système de recommandations (Apache AGE graph DB)
- [ ] Mise en place du leaderboard (Materialized View avec pg_cron)
- [ ] Configuration de la recherche (PostgreSQL full-text avec pg_trgm)
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

#### Materialized Views (Leaderboard) - Remplace Redis Sorted Sets

**Pourquoi Materialized View au lieu d'une table manuelle ?**
- ✅ **Une seule source de vérité** : Calcul automatique depuis la table `orders`
- ✅ **Pas de risque de désynchronisation** : Impossible d'oublier de mettre à jour
- ✅ **Refresh concurrentiel** : `REFRESH MATERIALIZED VIEW CONCURRENTLY` (non-bloquant)
- ✅ **Scoring sophistiqué** : Pondération par récence, quantité, ratings
- ✅ **Maintenance automatique** : pg_cron refresh chaque minute

```sql
-- Création de la materialized view
CREATE MATERIALIZED VIEW leaderboard AS
SELECT
  p.id as book_id,
  p.title,
  p.author,
  COUNT(DISTINCT o.id) as sales_count,
  COALESCE(SUM(oi.quantity), 0) as total_quantity,
  -- Score pondéré par récence (30 jours de decay)
  COALESCE(
    SUM(
      oi.quantity *
      EXTRACT(EPOCH FROM (NOW() - o.created_at)) / (86400.0 * 30)
    ),
    0
  )::BIGINT as score,
  COALESCE(AVG(r.rating), 0.0)::NUMERIC(3, 2) as rating_avg,
  MAX(o.created_at) as last_purchase_at
FROM products p
LEFT JOIN order_items oi ON p.id = oi.product_id
LEFT JOIN orders o ON oi.order_id = o.id AND o.status != 'cancelled'
LEFT JOIN reviews r ON p.id = r.product_id
GROUP BY p.id
HAVING COUNT(DISTINCT o.id) > 0
ORDER BY score DESC;

-- Index unique requis pour REFRESH CONCURRENTLY
CREATE UNIQUE INDEX idx_leaderboard_book_id ON leaderboard (book_id);
CREATE INDEX idx_leaderboard_score ON leaderboard (score DESC);

-- Fonction de refresh (non-bloquante)
CREATE FUNCTION leaderboard_refresh() RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard;
END;
$$ LANGUAGE plpgsql;

-- Automatisation avec pg_cron (refresh chaque minute)
SELECT cron.schedule('leaderboard-refresh', '* * * * *',
  'SELECT leaderboard_refresh()');

-- Ou trigger probabiliste (10% des orders déclenchent un refresh)
CREATE FUNCTION leaderboard_refresh_on_order() RETURNS TRIGGER AS $$
BEGIN
  IF random() < 0.1 THEN
    PERFORM leaderboard_refresh();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leaderboard_refresh_trigger
  AFTER INSERT OR UPDATE ON orders
  FOR EACH STATEMENT
  EXECUTE FUNCTION leaderboard_refresh_on_order();

-- Requêtes rapides sur la vue matérialisée
SELECT * FROM leaderboard ORDER BY score DESC LIMIT 20; -- Top 20
SELECT * FROM leaderboard WHERE category = 'Programming' LIMIT 10; -- Par catégorie
```

**Comparaison : Table manuelle vs Materialized View**

| Aspect | Table Manuelle | Materialized View |
|--------|----------------|-------------------|
| Source de vérité | Double (orders + table) | Unique (orders) |
| Risque de bug | Oublier de mettre à jour | Aucun (auto-calculé) |
| Maintenance | Fonctions d'update manuelles | Refresh automatique |
| Performances lecture | ⚡ Très rapide | ⚡ Très rapide |
| Performances écriture | ⚡ Rapide (simple UPDATE) | ⚠️ Refresh périodique |
| Temps réel | ✅ Immédiat | ⚠️ ~1 minute de lag |
| Complexité code | Plus complexe | Plus simple |
| Recommandé pour | Leaderboards temps réel | **Bestsellers (notre cas)** |

**Verdict** : Pour un bookstore, un lag de 1 minute est acceptable → Materialized View est le meilleur choix !

## Décisions Techniques (Mise à Jour)

### Backend - Serverless avec Knative
- **Runtime** : Knative Serving (serverless, scale-to-zero)
- **Langage** : Node.js avec Express
- **ORM** : Prisma avec support extensions PostgreSQL
- **API** : REST avec auto-scaling Knative
- **Containerisation** : Docker multi-stage

### Frontend - 100% Serverless (Object Storage + CDN)
- **Framework** : React 18
- **Auth** : Keycloak adapter (@react-keycloak/web)
- **Hébergement** : Linode Object Storage (compatible S3)
- **CDN** : Akamai CDN pour distribution globale
- **Build** : Production build avec Vite/CRA
- **Déploiement** : s3cmd ou linode-cli upload
- **Cache Strategy** :
  - Assets (JS/CSS/images) : `Cache-Control: public, max-age=31536000, immutable` (1 an)
  - HTML : `Cache-Control: no-cache, no-store, must-revalidate`
- **Coût estimé** : ~$5/mois (vs ~$20/mois pour pods Kubernetes)

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

1. ✅ Créer la structure de base du projet
2. ✅ Architecture 100% serverless (Knative + Object Storage + CloudNative-PG)
3. ✅ Migrations SQL (cache, leaderboard, search, graph)
4. ✅ Services backend (cache, leaderboard, recommendations, search)
5. ✅ Déploiement frontend Object Storage
6. ⏳ Configurer les manifests Kubernetes pour les bases de données
7. ⏳ Développer les services API Knative
8. ⏳ Configurer Keycloak pour l'authentification
9. ⏳ Configurer les pipelines Tekton pour CI/CD

## Documentation Additionnelle

- [Guide Déploiement Frontend Object Storage](./docs/frontend-deployment.md) - Déploiement React sur Linode Object Storage + Akamai CDN
- [Script de Déploiement](./deploy-frontend.sh) - Automatisation du build et upload

## Estimations

- **Durée estimée** : 4-6 semaines
- **Complexité** : Élevée
- **Risques** : Migration du schéma de données, configuration de Keycloak, performance

---

Dernière mise à jour : 2025-11-14
