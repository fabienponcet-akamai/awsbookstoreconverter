# Démarrage Rapide - Bookstore sur Akamai App Platform

Guide de démarrage rapide pour tester l'application localement.

## Prérequis

- Docker et Docker Compose
- Node.js 20+
- 8GB RAM minimum

## 5 Minutes pour Démarrer

### 1. Cloner et Installer

```bash
git clone <votre-repo>
cd awsbookstoreconverter

# Installer les dépendances API
cd src/api && npm install && cd ../..

# Installer les dépendances Frontend
cd src/frontend && npm install && cd ../..
```

### 2. Démarrer les Services

```bash
# Démarrer PostgreSQL, Redis, Elasticsearch, Keycloak
docker-compose up -d

# Attendre que les services démarrent (30-60 secondes)
docker-compose ps
```

### 3. Configurer l'API

```bash
cd src/api

# Copier le fichier d'environnement
cp .env.example .env

# Initialiser la base de données
npx prisma generate
npx prisma db push

# Démarrer l'API
npm run dev
```

L'API est maintenant accessible sur http://localhost:3000

### 4. Démarrer le Frontend

```bash
# Dans un nouveau terminal
cd src/frontend

# Copier le fichier d'environnement
cp .env.example .env

# Démarrer le frontend
npm run dev
```

Le frontend est maintenant accessible sur http://localhost:3001

## Tester l'Application

### Health Checks

```bash
# API
curl http://localhost:3000/health

# Frontend
curl http://localhost:3001/health
```

### Tester les Endpoints

```bash
# Lister les produits
curl http://localhost:3000/api/v1/products

# Rechercher
curl "http://localhost:3000/api/v1/search?q=javascript"
```

### Accéder aux Interfaces

- **Frontend** : http://localhost:3001
- **API Docs** : http://localhost:3000/api/v1
- **Keycloak** : http://localhost:8080 (admin/admin)
- **Adminer (DB)** : http://localhost:8081
  - System: PostgreSQL
  - Server: postgres
  - Username: bookstore
  - Password: bookstore_dev_password

## Configuration Keycloak (Optionnel pour Auth)

1. Ouvrir http://localhost:8080
2. Login : admin / admin
3. Créer un realm `bookstore`
4. Créer les clients :
   - `bookstore-api` (confidential)
   - `bookstore-frontend` (public)

Voir [docs/development.md](./docs/development.md) pour les détails.

## Arrêter l'Application

```bash
# Arrêter l'API et le Frontend (Ctrl+C dans chaque terminal)

# Arrêter les services Docker
docker-compose down

# Supprimer aussi les volumes (ATTENTION : supprime les données)
docker-compose down -v
```

## Prochaines Étapes

- Lire [MIGRATION_PLAN.md](./MIGRATION_PLAN.md) pour comprendre l'architecture
- Lire [docs/development.md](./docs/development.md) pour le développement
- Lire [docs/deployment.md](./docs/deployment.md) pour déployer sur Kubernetes

## Problèmes Courants

### Port déjà utilisé

```bash
# Trouver et tuer le processus sur le port 3000
lsof -i :3000
kill -9 <PID>
```

### Services Docker ne démarrent pas

```bash
# Voir les logs
docker-compose logs

# Redémarrer
docker-compose restart
```

### Prisma ne peut pas se connecter

```bash
# Vérifier que PostgreSQL est démarré
docker-compose ps postgres

# Réinitialiser
cd src/api
npx prisma migrate reset
```

## Support

- Documentation complète : [docs/](./docs/)
- Issues : GitHub Issues
- Architecture : [docs/architecture.md](./docs/architecture.md)
