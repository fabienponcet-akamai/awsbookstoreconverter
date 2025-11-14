# Guide de Développement - Bookstore

Guide pour développer et tester localement l'application Bookstore.

## Configuration de l'Environnement de Développement

### Prérequis

- **Node.js** : 20.x ou supérieur
- **Docker** : Pour les bases de données locales
- **Docker Compose** : Pour orchestrer les services
- **PostgreSQL Client** : `psql` pour interagir avec la DB
- **Git** : Pour le versioning

### Installation Initiale

```bash
# Cloner le repository
git clone https://github.com/votre-repo/awsbookstoreconverter.git
cd awsbookstoreconverter

# Installer les dépendances de l'API
cd src/api
npm install

# Installer les dépendances du Frontend
cd ../frontend
npm install

# Revenir à la racine
cd ../..
```

## Démarrage des Services Locaux

### 1. Démarrer les Bases de Données avec Docker Compose

```bash
# Démarrer tous les services (PostgreSQL, Redis, Elasticsearch, Keycloak)
docker-compose up -d

# Vérifier que tous les services sont démarrés
docker-compose ps

# Voir les logs
docker-compose logs -f
```

**Services disponibles** :
- PostgreSQL : `localhost:5432`
- Redis : `localhost:6379`
- Elasticsearch : `localhost:9200`
- Keycloak : `localhost:8080`
- Adminer (DB GUI) : `localhost:8081`

### 2. Configurer les Variables d'Environnement

```bash
# API
cd src/api
cp .env.example .env

# Frontend
cd ../frontend
cp .env.example .env
```

Éditer les fichiers `.env` selon vos besoins (les valeurs par défaut fonctionnent avec docker-compose).

### 3. Initialiser la Base de Données

```bash
cd src/api

# Générer le client Prisma
npx prisma generate

# Créer les tables
npx prisma db push

# Optionnel: Charger des données de test
npm run db:seed
```

### 4. Configurer Keycloak

```bash
# Ouvrir Keycloak dans le navigateur
open http://localhost:8080

# Se connecter avec admin/admin
```

**Configuration manuelle** :
1. Créer un nouveau realm `bookstore`
2. Créer un client `bookstore-api` :
   - Client ID: `bookstore-api`
   - Access Type: `confidential`
   - Valid Redirect URIs: `http://localhost:3000/*`
   - Copier le secret du client
3. Créer un client `bookstore-frontend` :
   - Client ID: `bookstore-frontend`
   - Access Type: `public`
   - Valid Redirect URIs: `http://localhost:3001/*`
   - Web Origins: `http://localhost:3001`
4. Créer des utilisateurs de test dans le realm

**Mettre à jour le .env de l'API** avec le secret Keycloak :
```bash
KEYCLOAK_CLIENT_SECRET=le-secret-copié-depuis-keycloak
```

### 5. Démarrer l'API Backend

```bash
cd src/api

# Mode développement avec hot-reload
npm run dev

# L'API démarre sur http://localhost:3000
```

**Endpoints disponibles** :
- Health check : http://localhost:3000/health
- API docs : http://localhost:3000/api/v1

### 6. Démarrer le Frontend

```bash
cd src/frontend

# Mode développement avec hot-reload
npm run dev

# Le frontend démarre sur http://localhost:3001
```

Ouvrir http://localhost:3001 dans le navigateur.

## Développement

### Structure du Code API

```
src/api/
├── src/
│   ├── server.ts              # Point d'entrée
│   ├── routes/                # Définition des routes
│   │   ├── index.ts
│   │   ├── products.routes.ts
│   │   ├── cart.routes.ts
│   │   ├── orders.routes.ts
│   │   └── search.routes.ts
│   ├── controllers/           # Logique métier
│   │   ├── products.controller.ts
│   │   ├── cart.controller.ts
│   │   ├── orders.controller.ts
│   │   └── search.controller.ts
│   ├── services/              # Services réutilisables (à créer)
│   ├── middleware/            # Middleware Express
│   │   ├── errorHandler.ts
│   │   └── notFoundHandler.ts
│   └── utils/                 # Utilitaires
│       └── logger.ts
├── prisma/
│   └── schema.prisma         # Schéma de base de données
└── package.json
```

### Structure du Code Frontend

```
src/frontend/
├── src/
│   ├── main.tsx              # Point d'entrée
│   ├── App.tsx               # Composant principal
│   ├── components/           # Composants React
│   ├── pages/                # Pages de l'application
│   ├── services/             # Services API
│   ├── store/                # Redux store
│   ├── hooks/                # Custom hooks
│   ├── types/                # Types TypeScript
│   └── utils/                # Utilitaires
├── public/                   # Assets statiques
└── package.json
```

## Tâches de Développement Courantes

### Modifier le Schéma de Base de Données

```bash
cd src/api

# 1. Modifier prisma/schema.prisma

# 2. Créer une migration
npx prisma migrate dev --name description-du-changement

# 3. Le client Prisma est automatiquement regénéré
```

### Ajouter un Nouveau Endpoint API

1. **Créer le contrôleur** dans `src/api/src/controllers/`
2. **Créer les routes** dans `src/api/src/routes/`
3. **Importer les routes** dans `src/api/src/routes/index.ts`
4. **Tester** avec curl ou Postman

Exemple :
```typescript
// src/api/src/controllers/books.controller.ts
export class BooksController {
  async getAll(req: Request, res: Response) {
    // Implémentation
  }
}

// src/api/src/routes/books.routes.ts
import { Router } from 'express';
import { BooksController } from '../controllers/books.controller';

const router = Router();
const controller = new BooksController();

router.get('/', controller.getAll);

export default router;

// src/api/src/routes/index.ts
import booksRouter from './books.routes';
router.use('/books', booksRouter);
```

### Tester les Endpoints

```bash
# Health check
curl http://localhost:3000/health

# Get products
curl http://localhost:3000/api/v1/products

# Search
curl "http://localhost:3000/api/v1/search?q=javascript"

# Avec authentification (récupérer le token depuis Keycloak)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/v1/cart/user123
```

### Ajouter une Page Frontend

1. Créer le composant dans `src/frontend/src/pages/`
2. Ajouter la route dans le router
3. Créer le service API si nécessaire

### Linting et Formatage

```bash
# API
cd src/api
npm run lint

# Frontend
cd src/frontend
npm run lint
```

## Tests

### Tests Unitaires API

```bash
cd src/api

# Exécuter les tests
npm test

# Tests en mode watch
npm run test:watch

# Coverage
npm run test:coverage
```

### Tests Frontend

```bash
cd src/frontend

# Exécuter les tests
npm test

# Tests en mode watch
npm run test:watch
```

## Base de Données

### Accéder à PostgreSQL

```bash
# Via psql
psql -h localhost -U bookstore -d bookstore
# Mot de passe: bookstore_dev_password

# Via Adminer (interface web)
open http://localhost:8081
# System: PostgreSQL
# Server: postgres
# Username: bookstore
# Password: bookstore_dev_password
# Database: bookstore
```

### Commandes Prisma Utiles

```bash
cd src/api

# Ouvrir Prisma Studio (interface graphique)
npx prisma studio

# Réinitialiser la base de données
npx prisma migrate reset

# Appliquer les migrations
npx prisma migrate deploy

# Générer le client Prisma
npx prisma generate

# Formater le schéma
npx prisma format
```

### Accéder à Redis

```bash
# Via redis-cli
docker exec -it bookstore-redis redis-cli

# Avec mot de passe
AUTH changeme-redis-password

# Commandes utiles
KEYS *
GET key
ZRANGE bestsellers 0 -1 WITHSCORES
```

### Accéder à Elasticsearch

```bash
# Vérifier la santé
curl http://localhost:9200/_cluster/health

# Lister les index
curl http://localhost:9200/_cat/indices

# Rechercher
curl -X GET "http://localhost:9200/bookstore_products/_search?q=title:javascript"
```

## Build et Déploiement Local

### Builder l'API

```bash
cd src/api

# Build TypeScript
npm run build

# Démarrer en mode production
npm start
```

### Builder le Frontend

```bash
cd src/frontend

# Build pour production
npm run build

# Preview du build
npm run preview
```

### Builder les Images Docker

```bash
# API
cd src/api
docker build -t bookstore-api:dev .

# Frontend
cd src/frontend
docker build -t bookstore-frontend:dev .

# Tester les images
docker run -p 3000:3000 --env-file .env bookstore-api:dev
docker run -p 3001:80 bookstore-frontend:dev
```

## Debugging

### Debug de l'API avec VSCode

Créer `.vscode/launch.json` :
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug API",
      "runtimeArgs": ["-r", "ts-node/register"],
      "args": ["${workspaceFolder}/src/api/src/server.ts"],
      "env": {
        "NODE_ENV": "development"
      },
      "cwd": "${workspaceFolder}/src/api",
      "console": "integratedTerminal"
    }
  ]
}
```

### Logs

```bash
# Logs Docker Compose
docker-compose logs -f

# Logs d'un service spécifique
docker-compose logs -f postgres
docker-compose logs -f redis

# Logs de l'API (en dev)
# Les logs apparaissent directement dans la console
```

## Dépannage

### Port déjà utilisé

```bash
# Trouver le processus utilisant le port 3000
lsof -i :3000

# Tuer le processus
kill -9 <PID>
```

### Réinitialiser complètement l'environnement

```bash
# Arrêter et supprimer tous les conteneurs et volumes
docker-compose down -v

# Supprimer node_modules
rm -rf src/api/node_modules src/frontend/node_modules

# Réinstaller
cd src/api && npm install
cd ../frontend && npm install

# Redémarrer
docker-compose up -d
```

### Problèmes de connexion à Keycloak

- Vérifier que Keycloak est démarré : `docker-compose ps`
- Attendre que Keycloak soit complètement démarré (peut prendre 30-60s)
- Vérifier les logs : `docker-compose logs keycloak`

### Problèmes de migration Prisma

```bash
# Réinitialiser complètement
cd src/api
npx prisma migrate reset --force

# Recréer les migrations
npx prisma migrate dev
```

## Bonnes Pratiques

1. **Commits** : Commits atomiques avec messages descriptifs
2. **Branches** : Feature branches pour chaque fonctionnalité
3. **Code Review** : Pull requests avec review avant merge
4. **Tests** : Écrire des tests pour les nouvelles fonctionnalités
5. **Documentation** : Documenter les fonctions complexes
6. **Types** : Utiliser TypeScript correctement, éviter `any`
7. **Sécurité** : Ne jamais committer les fichiers `.env`
8. **Performance** : Utiliser les index de base de données appropriés

## Ressources

- [Express.js Documentation](https://expressjs.com/)
- [React Documentation](https://react.dev/)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Docker Documentation](https://docs.docker.com/)
