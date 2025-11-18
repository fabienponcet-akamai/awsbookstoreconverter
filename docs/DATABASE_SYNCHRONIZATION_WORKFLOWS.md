# 🔄 Workflows de Synchronisation des Bases de Données PostgreSQL

## Vue d'Ensemble de l'Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                    ARCHITECTURE 3 BASES POSTGRESQL                    │
└──────────────────────────────────────────────────────────────────────┘

                        ┌─────────────────┐
                        │  Knative API    │
                        │  (bookstore-api)│
                        └────────┬────────┘
                                 │
                    ┌────────────┴───────────┐
                    │  Écriture Simultanée   │
                    └────────────┬───────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
┌───────────────┐      ┌──────────────────┐      ┌──────────────┐
│ bookstore-    │      │ bookstore-       │      │ bookstore-   │
│ main          │──────│ search           │      │ graph        │
│               │Replic│                  │      │              │
│ Pool 3        │ Logic│ Pool 4           │      │ Pool 4       │
│ (2 vCPU)      │      │ (1 vCPU)         │      │ (2 vCPU)     │
└───────────────┘      └──────────────────┘      └──────────────┘
      │                         │                        │
      │                         │                        │
      ▼                         ▼                        ▼
Books, Orders,          Books (réplica)         User→Book Graph
Cart, Users             Full-Text Search        Recommendations
```

---

## 📊 Workflow 1 : Main → Search (Logical Replication)

### Concept

**Logical Replication** = Réplication asynchrone au niveau logique (lignes) plutôt que physique (blocs).

```
┌─────────────────────────────────────────────────────────────────────┐
│                   LOGICAL REPLICATION FLOW                           │
└─────────────────────────────────────────────────────────────────────┘

bookstore-main-1 (Publisher)
    │
    │ 1. INSERT INTO books VALUES (...)
    │
    ▼
┌─────────────────────┐
│  WAL (Write-Ahead   │ ← PostgreSQL écrit chaque transaction
│  Log)               │   dans le WAL avant de la commiter
└──────────┬──────────┘
           │
           │ 2. WAL Sender Process lit le WAL
           │
           ▼
┌─────────────────────┐
│  Logical Decoding   │ ← Convertit WAL binaire en commandes SQL
│  (pgoutput plugin)  │   logiques (INSERT/UPDATE/DELETE)
└──────────┬──────────┘
           │
           │ 3. Envoie via réseau Kubernetes
           │
           ▼
bookstore-search-1 (Subscriber)
    │
    ▼
┌─────────────────────┐
│  Logical Replication│ ← Reçoit et applique les changements
│  Worker             │
└──────────┬──────────┘
           │
           │ 4. APPLY: INSERT INTO books VALUES (...)
           │
           ▼
┌─────────────────────┐
│  books table        │ ← Table réplica en lecture seule
│  (Read-Only)        │
└─────────────────────┘
```

### Configuration Détaillée

#### Étape 1 : Configurer bookstore-main (Publisher)

```yaml
# k8s/databases/bookstore-main.yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: bookstore-main
  namespace: bookstore
spec:
  instances: 3

  postgresql:
    parameters:
      # Enable logical replication
      wal_level: "logical"                    # Default: replica
      max_replication_slots: "10"             # Nombre max de subscribers
      max_wal_senders: "10"                   # Nombre max de connexions WAL
      max_logical_replication_workers: "4"    # Workers pour appliquer les changements

      # Performance tuning
      shared_buffers: "256MB"
      effective_cache_size: "1GB"
      maintenance_work_mem: "64MB"

  bootstrap:
    initdb:
      database: bookstore
      owner: postgres
      postInitSQL:
        - |
          -- Create replication user
          CREATE USER replication_user WITH REPLICATION PASSWORD 'secure_repl_password';
          GRANT SELECT ON ALL TABLES IN SCHEMA public TO replication_user;

          -- Create books table
          CREATE TABLE books (
            id UUID PRIMARY KEY,
            category VARCHAR(50) NOT NULL,
            title VARCHAR(200) NOT NULL,
            author VARCHAR(100) NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            description TEXT,
            image_url VARCHAR(500),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          );

          CREATE INDEX idx_books_category ON books(category);
          CREATE INDEX idx_books_author ON books(author);

          -- Create publication for books table
          CREATE PUBLICATION books_publication FOR TABLE books;
```

**Vérification** :

```bash
# Vérifier que la publication est créée
kubectl exec -n bookstore bookstore-main-1 -- \
  psql -U postgres -d bookstore -c "SELECT * FROM pg_publication;"

# Résultat attendu:
#      pubname       | pubowner | puballtables | pubinsert | pubupdate | pubdelete
# -------------------+----------+--------------+-----------+-----------+-----------
#  books_publication |       10 | f            | t         | t         | t
```

#### Étape 2 : Configurer bookstore-search (Subscriber)

```yaml
# k8s/databases/bookstore-search.yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: bookstore-search
  namespace: bookstore
spec:
  instances: 3

  postgresql:
    parameters:
      max_logical_replication_workers: "4"
      max_sync_workers_per_subscription: "2"

  bootstrap:
    initdb:
      database: bookstore_search
      owner: postgres
      postInitSQL:
        - |
          -- Create books table (SAME SCHEMA as main!)
          CREATE TABLE books (
            id UUID PRIMARY KEY,
            category VARCHAR(50) NOT NULL,
            title VARCHAR(200) NOT NULL,
            author VARCHAR(100) NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            description TEXT,
            image_url VARCHAR(500),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          );

          -- Create subscription to bookstore-main
          CREATE SUBSCRIPTION books_subscription
            CONNECTION 'host=bookstore-main-rw.bookstore.svc.cluster.local port=5432 dbname=bookstore user=replication_user password=secure_repl_password'
            PUBLICATION books_publication
            WITH (
              copy_data = true,              -- Copy existing data
              create_slot = true,            -- Create replication slot automatically
              enabled = true,                -- Start replication immediately
              slot_name = 'books_search_slot'
            );

          -- Create Full-Text Search index (SEARCH SPECIFIC)
          CREATE INDEX idx_books_fts ON books
          USING GIN(to_tsvector('english', title || ' ' || author || ' ' || COALESCE(description, '')));

          -- Create materialized view for optimized search
          CREATE MATERIALIZED VIEW books_search_mv AS
          SELECT
            id,
            category,
            title,
            author,
            description,
            price,
            image_url,
            to_tsvector('english', title || ' ' || author || ' ' || COALESCE(description, '')) as search_vector
          FROM books;

          CREATE INDEX idx_books_search_mv_vector ON books_search_mv USING GIN(search_vector);

          -- Create function to refresh materialized view
          CREATE OR REPLACE FUNCTION refresh_books_search()
          RETURNS TRIGGER AS $$
          BEGIN
            REFRESH MATERIALIZED VIEW CONCURRENTLY books_search_mv;
            RETURN NULL;
          END;
          $$ LANGUAGE plpgsql;

          -- Trigger to auto-refresh on changes (debounced via cron job instead)
          -- CREATE TRIGGER refresh_search_trigger
          -- AFTER INSERT OR UPDATE OR DELETE ON books
          -- FOR EACH STATEMENT
          -- EXECUTE FUNCTION refresh_books_search();

  storage:
    size: 20Gi
```

**Vérification** :

```bash
# Vérifier que la subscription est active
kubectl exec -n bookstore bookstore-search-1 -- \
  psql -U postgres -d bookstore_search -c "SELECT * FROM pg_stat_subscription;"

# Résultat attendu:
#  subid |     subname       | pid  | relid | received_lsn | last_msg_send_time | last_msg_receipt_time | latest_end_lsn | latest_end_time
# -------+-------------------+------+-------+--------------+--------------------+-----------------------+----------------+------------------
#  16394 | books_subscription| 1234 |       | 0/3000060    | 2024-01-15 10:30   | 2024-01-15 10:30      | 0/3000060      | 2024-01-15 10:30
```

#### Étape 3 : Tester la Réplication

```bash
# 1. Insérer un livre dans bookstore-main
kubectl exec -n bookstore bookstore-main-1 -- \
  psql -U postgres -d bookstore <<EOF
INSERT INTO books (id, category, title, author, price, description, image_url)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Fiction',
  'The PostgreSQL Chronicles',
  'John Doe',
  29.99,
  'A thrilling tale of database replication',
  'https://bookstore-assets.us-east-1.linodeobjects.com/covers/pg-chronicles.jpg'
);
EOF

# 2. Vérifier que le livre apparaît dans bookstore-search (peut prendre 1-2 secondes)
sleep 2

kubectl exec -n bookstore bookstore-search-1 -- \
  psql -U postgres -d bookstore_search -c \
  "SELECT id, title, author FROM books WHERE title LIKE '%PostgreSQL%';"

# Résultat attendu:
#                  id                  |          title              |  author
# -------------------------------------+-----------------------------+-----------
#  a1b2c3d4-e5f6-7890-abcd-ef1234567890| The PostgreSQL Chronicles   | John Doe
```

### Monitoring de la Réplication

```sql
-- Monitoring script à exécuter régulièrement
-- k8s/monitoring/check_replication_lag.sql

SELECT
  subscription_name,
  pid,
  received_lsn,
  latest_end_lsn,
  pg_size_pretty(pg_wal_lsn_diff(latest_end_lsn, received_lsn)) as replication_lag,
  last_msg_send_time,
  last_msg_receipt_time,
  EXTRACT(EPOCH FROM (NOW() - last_msg_receipt_time)) as seconds_since_last_message
FROM pg_stat_subscription;
```

**Prometheus Metrics** :

```yaml
# k8s/monitoring/servicemonitor-postgresql.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: postgresql-replication
  namespace: bookstore
spec:
  selector:
    matchLabels:
      cnpg.io/cluster: bookstore-search
  endpoints:
  - port: metrics
    interval: 30s
```

**Alert Rule** :

```yaml
# k8s/monitoring/alerts-replication.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: postgresql-replication-alerts
  namespace: bookstore
spec:
  groups:
  - name: replication
    rules:
    - alert: ReplicationLagHigh
      expr: |
        pg_stat_subscription_lag_seconds > 60
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "PostgreSQL replication lag is high"
        description: "Replication lag is {{ $value }} seconds (threshold: 60s)"
```

### Cas d'Usage : Recherche Full-Text

```typescript
// src/services/searchService.ts
import { Pool } from 'pg';

const searchDb = new Pool({
  host: 'bookstore-search-ro.bookstore.svc.cluster.local',  // Read-only replica
  port: 5432,
  database: 'bookstore_search',
  user: 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  max: 20
});

export async function searchBooks(query: string, limit: number = 20) {
  const result = await searchDb.query(`
    SELECT
      id,
      category,
      title,
      author,
      description,
      price,
      image_url,
      ts_rank(search_vector, plainto_tsquery('english', $1)) as rank
    FROM books_search_mv
    WHERE search_vector @@ plainto_tsquery('english', $1)
    ORDER BY rank DESC
    LIMIT $2
  `, [query, limit]);

  return result.rows;
}

// Exemple d'utilisation
app.get('/api/search', async (req, res) => {
  const query = req.query.q as string;

  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'Query too short' });
  }

  const results = await searchBooks(query, 20);
  res.json({ results, count: results.length });
});
```

**Test** :

```bash
curl "https://api.bookstore.example.com/search?q=postgresql"

# Résultat:
# {
#   "results": [
#     {
#       "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
#       "title": "The PostgreSQL Chronicles",
#       "author": "John Doe",
#       "rank": 0.0607927
#     }
#   ],
#   "count": 1
# }
```

---

## 🔗 Workflow 2 : Main → Graph (Application-Level Dual Write)

### Concept

**Dual Write** = L'application écrit simultanément dans 2 bases de données au sein de la même transaction métier.

```
┌─────────────────────────────────────────────────────────────────────┐
│                   APPLICATION DUAL WRITE FLOW                        │
└─────────────────────────────────────────────────────────────────────┘

User clicks "Buy Book"
    │
    ▼
┌─────────────────────┐
│  POST /api/orders   │
│  { userId, bookId } │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  orderService.createOrder()             │
│                                         │
│  1. BEGIN mainDb transaction            │
│  2. BEGIN graphDb transaction           │
│                                         │
│  3. Insert into orders table (main)     │
│  4. Insert graph relationship (graph)   │
│                                         │
│  5. COMMIT mainDb                       │
│  6. COMMIT graphDb                      │
└──────────┬──────────────────────────────┘
           │
           ├───────────────┬────────────────┐
           │               │                │
           ▼               ▼                ▼
    ┌───────────┐   ┌──────────┐   ┌──────────┐
    │ bookstore-│   │bookstore-│   │bookstore-│
    │ main      │   │ graph    │   │ search   │
    │           │   │          │   │(auto via │
    │ orders    │   │ User→Book│   │ replicat)│
    └───────────┘   └──────────┘   └──────────┘
```

### Implémentation : Service Node.js avec Dual Write

#### Configuration des Connexions

```typescript
// src/config/database.ts
import { Pool } from 'pg';

// Main database connection
export const mainDb = new Pool({
  host: process.env.MAIN_DB_HOST || 'bookstore-main-rw.bookstore.svc.cluster.local',
  port: 5432,
  database: 'bookstore',
  user: 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Graph database connection
export const graphDb = new Pool({
  host: process.env.GRAPH_DB_HOST || 'bookstore-graph-rw.bookstore.svc.cluster.local',
  port: 5432,
  database: 'bookstore_graph',
  user: 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Search database connection (read-only)
export const searchDb = new Pool({
  host: process.env.SEARCH_DB_HOST || 'bookstore-search-ro.bookstore.svc.cluster.local',
  port: 5432,
  database: 'bookstore_search',
  user: 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
});

// Health check
export async function checkDatabaseConnections() {
  try {
    await mainDb.query('SELECT 1');
    await graphDb.query('SELECT 1');
    await searchDb.query('SELECT 1');
    console.log('✅ All database connections healthy');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  }
}
```

#### Service avec Dual Write et Compensation

```typescript
// src/services/orderService.ts
import { mainDb, graphDb } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import logger from '../monitoring/logger';

interface CreateOrderRequest {
  userId: string;
  bookId: string;
  quantity: number;
}

interface Order {
  id: string;
  userId: string;
  bookId: string;
  quantity: number;
  total: number;
  status: string;
  createdAt: Date;
}

export class OrderService {
  /**
   * Create order with dual write to main DB and graph DB
   */
  async createOrder(request: CreateOrderRequest): Promise<Order> {
    const orderId = uuidv4();
    const mainClient = await mainDb.connect();
    const graphClient = await graphDb.connect();

    try {
      // 1. Start transactions on both databases
      await mainClient.query('BEGIN');
      await graphClient.query('BEGIN');

      logger.info('Creating order', { orderId, userId: request.userId, bookId: request.bookId });

      // 2. Get book price from main DB
      const bookResult = await mainClient.query(
        'SELECT price FROM books WHERE id = $1',
        [request.bookId]
      );

      if (bookResult.rows.length === 0) {
        throw new Error(`Book not found: ${request.bookId}`);
      }

      const bookPrice = parseFloat(bookResult.rows[0].price);
      const total = bookPrice * request.quantity;

      // 3. Insert order into main database
      const orderResult = await mainClient.query(`
        INSERT INTO orders (id, user_id, book_id, quantity, total, status, created_at)
        VALUES ($1, $2, $3, $4, $5, 'completed', NOW())
        RETURNING *
      `, [orderId, request.userId, request.bookId, request.quantity, total]);

      const order = orderResult.rows[0];

      logger.info('Order inserted into main DB', { orderId, total });

      // 4. Prepare Apache AGE for graph operations
      await graphClient.query(`LOAD 'age';`);
      await graphClient.query(`SET search_path = ag_catalog, "$user", public;`);

      // 5. Create graph relationship (User)-[:PURCHASED]->(Book)
      const cypherQuery = `
        SELECT * FROM cypher('recommendations', $$
          MERGE (u:User {id: $user_id})
          MERGE (b:Book {id: $book_id})
          CREATE (u)-[p:PURCHASED {
            order_id: $order_id,
            quantity: $quantity,
            total: $total,
            purchased_at: timestamp()
          }]->(b)
          RETURN p
        $$) as (purchase agtype);
      `;

      // Apache AGE requires dollar-quoted strings for parameters
      await graphClient.query(
        cypherQuery
          .replace('$user_id', `'${request.userId}'`)
          .replace('$book_id', `'${request.bookId}'`)
          .replace('$order_id', `'${orderId}'`)
          .replace('$quantity', request.quantity.toString())
          .replace('$total', total.toString())
      );

      logger.info('Purchase relationship created in graph DB', { orderId });

      // 6. Commit both transactions
      await mainClient.query('COMMIT');
      await graphClient.query('COMMIT');

      logger.info('Order created successfully', { orderId, total });

      return {
        id: order.id,
        userId: order.user_id,
        bookId: order.book_id,
        quantity: order.quantity,
        total: order.total,
        status: order.status,
        createdAt: order.created_at
      };

    } catch (error) {
      // 7. Rollback both transactions on error
      logger.error('Error creating order, rolling back', { error: error.message, orderId });

      try {
        await mainClient.query('ROLLBACK');
        await graphClient.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Error during rollback', { error: rollbackError.message });
      }

      throw error;

    } finally {
      // 8. Release connections back to pool
      mainClient.release();
      graphClient.release();
    }
  }

  /**
   * Get user recommendations based on purchase history
   */
  async getRecommendations(userId: string, limit: number = 5): Promise<any[]> {
    const graphClient = await graphDb.connect();

    try {
      await graphClient.query(`LOAD 'age';`);
      await graphClient.query(`SET search_path = ag_catalog, "$user", public;`);

      // Cypher query: Find books purchased by similar users
      const cypherQuery = `
        SELECT * FROM cypher('recommendations', $$
          MATCH (me:User {id: '${userId}'})-[:PURCHASED]->(book:Book)<-[:PURCHASED]-(other:User)
          MATCH (other)-[:PURCHASED]->(recommendation:Book)
          WHERE NOT (me)-[:PURCHASED]->(recommendation)
          RETURN recommendation.id as book_id, count(*) as score
          ORDER BY score DESC
          LIMIT ${limit}
        $$) as (book_id agtype, score agtype);
      `;

      const result = await graphClient.query(cypherQuery);

      // Extract book IDs from agtype
      const bookIds = result.rows.map(row => {
        const bookIdStr = row.book_id.toString();
        // Parse agtype string like '"book-id-123"'
        return bookIdStr.replace(/"/g, '');
      });

      if (bookIds.length === 0) {
        return [];
      }

      // 2. Fetch book details from main DB
      const mainClient = await mainDb.connect();
      try {
        const booksResult = await mainClient.query(
          'SELECT id, title, author, price, image_url FROM books WHERE id = ANY($1)',
          [bookIds]
        );

        return booksResult.rows;
      } finally {
        mainClient.release();
      }

    } finally {
      graphClient.release();
    }
  }
}
```

#### Route API

```typescript
// src/routes/orders.ts
import express from 'express';
import { OrderService } from '../services/orderService';
import { authenticate } from '../middleware/auth';

const router = express.Router();
const orderService = new OrderService();

// Create order
router.post('/orders', authenticate, async (req, res) => {
  try {
    const { bookId, quantity } = req.body;
    const userId = req.user.id;

    // Validation
    if (!bookId || !quantity || quantity < 1) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const order = await orderService.createOrder({
      userId,
      bookId,
      quantity
    });

    res.status(201).json(order);

  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Get recommendations
router.get('/recommendations', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit as string) || 5;

    const recommendations = await orderService.getRecommendations(userId, limit);

    res.json({ recommendations });

  } catch (error) {
    console.error('Error getting recommendations:', error);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

export default router;
```

### Pattern Saga pour Garantir la Cohérence

Si une transaction échoue après avoir committé la première base, utilisez le **Saga Pattern** :

```typescript
// src/services/sagaOrchestrator.ts
import { mainDb, graphDb } from '../config/database';
import logger from '../monitoring/logger';

interface SagaStep {
  name: string;
  execute: () => Promise<void>;
  compensate: () => Promise<void>;
}

export class OrderSaga {
  private steps: SagaStep[] = [];
  private completedSteps: SagaStep[] = [];

  async createOrder(userId: string, bookId: string, quantity: number) {
    // Step 1: Create order in main DB
    this.steps.push({
      name: 'create_order_main',
      execute: async () => {
        const mainClient = await mainDb.connect();
        try {
          await mainClient.query('BEGIN');
          await mainClient.query(
            'INSERT INTO orders (id, user_id, book_id, quantity, total, status) VALUES ($1, $2, $3, $4, $5, $6)',
            [this.orderId, userId, bookId, quantity, this.total, 'pending']
          );
          await mainClient.query('COMMIT');
        } finally {
          mainClient.release();
        }
      },
      compensate: async () => {
        const mainClient = await mainDb.connect();
        try {
          await mainClient.query('DELETE FROM orders WHERE id = $1', [this.orderId]);
          logger.info('Compensated: Deleted order from main DB', { orderId: this.orderId });
        } finally {
          mainClient.release();
        }
      }
    });

    // Step 2: Create graph relationship
    this.steps.push({
      name: 'create_graph_relationship',
      execute: async () => {
        const graphClient = await graphDb.connect();
        try {
          await graphClient.query(`LOAD 'age'; SET search_path = ag_catalog, "$user", public;`);
          await graphClient.query(`
            SELECT * FROM cypher('recommendations', $$
              MATCH (u:User {id: '${userId}'}), (b:Book {id: '${bookId}'})
              CREATE (u)-[:PURCHASED {order_id: '${this.orderId}'}]->(b)
            $$) as (r agtype);
          `);
        } finally {
          graphClient.release();
        }
      },
      compensate: async () => {
        const graphClient = await graphDb.connect();
        try {
          await graphClient.query(`LOAD 'age'; SET search_path = ag_catalog, "$user", public;`);
          await graphClient.query(`
            SELECT * FROM cypher('recommendations', $$
              MATCH (u:User {id: '${userId}'})-[p:PURCHASED {order_id: '${this.orderId}'}]->(b:Book {id: '${bookId}'})
              DELETE p
            $$) as (r agtype);
          `);
          logger.info('Compensated: Deleted graph relationship', { orderId: this.orderId });
        } finally {
          graphClient.release();
        }
      }
    });

    // Execute saga
    try {
      for (const step of this.steps) {
        await step.execute();
        this.completedSteps.push(step);
        logger.info(`Saga step completed: ${step.name}`);
      }

      logger.info('Saga completed successfully');
      return { success: true, orderId: this.orderId };

    } catch (error) {
      logger.error('Saga failed, executing compensations', { error: error.message });

      // Execute compensations in reverse order
      for (const step of this.completedSteps.reverse()) {
        try {
          await step.compensate();
        } catch (compensationError) {
          logger.error(`Compensation failed for ${step.name}`, { error: compensationError.message });
        }
      }

      throw error;
    }
  }

  private orderId: string = '';
  private total: number = 0;
}
```

---

## 📊 Comparaison des Deux Workflows

| Aspect | Main → Search (Logical Replication) | Main → Graph (Dual Write) |
|--------|-------------------------------------|---------------------------|
| **Méthode** | PostgreSQL native | Application-level |
| **Latence** | ~100ms - 2s | Immédiate (synchrone) |
| **Cohérence** | Éventuelle (asynchrone) | Forte (transactions) |
| **Complexité** | Faible (built-in PostgreSQL) | Moyenne (code applicatif) |
| **Overhead** | Faible (WAL déjà existant) | Moyen (2× connexions) |
| **Rollback** | Automatique | Manuel (compensation) |
| **Monitoring** | `pg_stat_subscription` | Logs applicatifs + Prometheus |
| **Cas d'échec** | Retry automatique | Saga pattern requis |
| **Utilisé pour** | Réplicas read-only, search | Relations métier critiques |

---

## ✅ Résumé

### Quand utiliser Logical Replication (Main → Search)

✅ **Réplicas read-only** (search, analytics, reporting)
✅ **Données non critiques** pour cohérence immédiate
✅ **Scalabilité en lecture** (distribuer la charge)
✅ **Maintenance simple** (PostgreSQL natif)

### Quand utiliser Dual Write (Main → Graph)

✅ **Relations métier critiques** (commandes, achats)
✅ **Cohérence forte requise** (ACID)
✅ **Données hétérogènes** (PostgreSQL + Graph)
✅ **Logique métier complexe** (triggers, validations)

---

Voulez-vous que je détaille un aspect particulier, comme le **monitoring**, le **troubleshooting**, ou l'implémentation d'un **Outbox Pattern** pour garantir la livraison des événements ?
