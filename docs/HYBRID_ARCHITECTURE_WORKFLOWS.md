# Workflows - Architecture Hybride (DBaaS + Operators In-Cluster)

Ce document décrit les workflows de données pour l'architecture hybride qui utilise :
- **DBaaS PostgreSQL** (Akamai, externe au cluster)
- **Redis Operator** (in-cluster, via APL Core)
- **OpenSearch Operator** (in-cluster, via APL Core)

## Vue d'ensemble de l'architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      LKE Cluster (APL Core)                  │
│  ┌────────────────┐    ┌──────────────┐    ┌─────────────┐ │
│  │  Application   │───▶│    Redis     │    │ OpenSearch  │ │
│  │  (Knative)     │    │  (Operator)  │    │ (Operator)  │ │
│  └────────────────┘    └──────────────┘    └─────────────┘ │
│         │                                          ▲         │
│         │                                          │         │
│         │                  ┌─────────────────┐    │         │
│         │                  │ Outbox Worker   │────┘         │
│         │                  │  (Deployment)   │              │
│         │                  └─────────────────┘              │
└─────────┼────────────────────────────┬───────────────────────┘
          │                            │
          │ SSL Connection             │ Poll & Sync
          ▼                            ▼
┌──────────────────────────────────────────────────────────────┐
│              DBaaS PostgreSQL (Akamai Managed)               │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐    │
│  │    Main     │  │  outbox_    │  │   wal_level =    │    │
│  │   Tables    │  │  events     │  │   'logical'      │    │
│  └─────────────┘  └─────────────┘  └──────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

## Workflow 1 : Application → DBaaS PostgreSQL

### Architecture de connexion

Les applications Knative se connectent au DBaaS PostgreSQL via SSL avec authentification par certificat.

```typescript
// config/database.ts
import { Pool } from 'pg';
import * as fs from 'fs';

// DBaaS PostgreSQL - Connexion externe
export const mainDb = new Pool({
  host: process.env.DBAAS_PG_HOST, // lin-12345-6789.postgres.linodelke.net
  port: 5432,
  database: 'bookstore_main',
  user: process.env.DBAAS_PG_USER,
  password: process.env.DBAAS_PG_PASSWORD,

  // SSL obligatoire pour DBaaS
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync('/etc/secrets/db-ca.crt', 'utf8')
  },

  // Connection pooling
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,

  // Retry logic pour connexions externes
  retryAttempts: 3,
  retryDelay: 1000
});

// Redis in-cluster - Connexion interne
export const redisClient = createClient({
  socket: {
    host: 'bookstore-redis-cluster.stateful.svc.cluster.local',
    port: 6379
  },
  password: process.env.REDIS_PASSWORD
});
```

### Configuration Kubernetes - Secrets DBaaS

```yaml
# secrets/dbaas-postgresql.yaml
apiVersion: v1
kind: Secret
metadata:
  name: dbaas-postgresql
  namespace: bookstore
type: Opaque
stringData:
  host: lin-12345-6789.postgres.linodelke.net
  port: "5432"
  database: bookstore_main
  username: bookstore_user
  password: <secure-password>
  ca.crt: |
    -----BEGIN CERTIFICATE-----
    MIIDdzCCAl+gAwIBAgIEAgAAuTANBgkqhkiG9w0BAQUFADBaMQswCQYDVQQGEwJJ
    ...
    -----END CERTIFICATE-----
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: bookstore
data:
  DB_CONNECTION_TYPE: "dbaas-external"
  DB_MAX_CONNECTIONS: "20"
  DB_SSL_MODE: "require"
```

### Exemple d'opération CRUD

```typescript
// services/book.service.ts
import { mainDb, redisClient } from '../config/database';

export class BookService {
  /**
   * Workflow complet : Cache → DBaaS → OpenSearch
   */
  async getBook(bookId: string) {
    // 1. Vérifier Redis (in-cluster, rapide)
    const cached = await redisClient.get(`book:${bookId}`);
    if (cached) {
      console.log('Cache hit - Redis in-cluster');
      return JSON.parse(cached);
    }

    // 2. Query DBaaS PostgreSQL (externe, SSL)
    const result = await mainDb.query(
      'SELECT * FROM books WHERE id = $1',
      [bookId]
    );

    if (result.rows.length === 0) {
      throw new Error('Book not found');
    }

    const book = result.rows[0];

    // 3. Mettre en cache Redis (in-cluster)
    await redisClient.setEx(
      `book:${bookId}`,
      3600, // 1 heure
      JSON.stringify(book)
    );

    console.log('Cache miss - Loaded from DBaaS and cached');
    return book;
  }

  /**
   * Création avec Outbox Pattern
   */
  async createBook(bookData: BookCreateDto) {
    const client = await mainDb.connect();

    try {
      await client.query('BEGIN');

      // 1. Insérer dans DBaaS PostgreSQL
      const bookResult = await client.query(`
        INSERT INTO books (title, author, isbn, price, category)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [bookData.title, bookData.author, bookData.isbn,
          bookData.price, bookData.category]);

      const book = bookResult.rows[0];

      // 2. Insérer événement Outbox (MÊME TRANSACTION)
      await client.query(`
        INSERT INTO outbox_events (
          aggregate_id, aggregate_type, event_type, payload, created_at
        ) VALUES ($1, $2, $3, $4, NOW())
      `, [
        book.id,
        'book',
        'book_created',
        JSON.stringify({
          id: book.id,
          title: book.title,
          author: book.author,
          isbn: book.isbn,
          price: book.price,
          category: book.category
        })
      ]);

      await client.query('COMMIT');

      // 3. Invalider cache Redis
      await redisClient.del(`book:${book.id}`);
      await redisClient.del('books:list:*'); // Pattern matching

      console.log('Book created in DBaaS with outbox event');
      return book;

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
```

## Workflow 2 : DBaaS PostgreSQL → OpenSearch (Synchronisation)

### Architecture du Outbox Worker

Le worker Outbox s'exécute dans le cluster LKE et poll la table `outbox_events` du DBaaS PostgreSQL, puis synchronise vers OpenSearch in-cluster.

```typescript
// workers/outbox-processor.ts
import { mainDb } from '../config/database';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';

// OpenSearch in-cluster
const searchClient = new OpenSearchClient({
  node: 'https://bookstore-search-master.stateful.svc.cluster.local:9200',
  auth: {
    username: process.env.OPENSEARCH_USER,
    password: process.env.OPENSEARCH_PASSWORD
  },
  ssl: {
    rejectUnauthorized: false // Certificat auto-signé in-cluster
  }
});

export class OutboxProcessor {
  private isProcessing = false;
  private batchSize = 100;
  private pollInterval = 5000; // 5 secondes

  async start() {
    console.log('Outbox Processor started - Polling DBaaS PostgreSQL');

    setInterval(async () => {
      if (!this.isProcessing) {
        await this.processEvents();
      }
    }, this.pollInterval);
  }

  async processEvents() {
    this.isProcessing = true;
    const client = await mainDb.connect();

    try {
      // 1. Récupérer événements non traités du DBaaS
      const result = await client.query(`
        SELECT id, aggregate_id, aggregate_type, event_type, payload, created_at
        FROM outbox_events
        WHERE processed = false
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `, [this.batchSize]);

      if (result.rows.length === 0) {
        return;
      }

      console.log(`Processing ${result.rows.length} events from DBaaS`);

      // 2. Traiter chaque événement
      for (const event of result.rows) {
        await this.handleEvent(event);

        // 3. Marquer comme traité dans DBaaS
        await client.query(
          'UPDATE outbox_events SET processed = true, processed_at = NOW() WHERE id = $1',
          [event.id]
        );
      }

      console.log(`Successfully processed ${result.rows.length} events`);

    } catch (error) {
      console.error('Error processing outbox events:', error);
    } finally {
      client.release();
      this.isProcessing = false;
    }
  }

  async handleEvent(event: any) {
    const { aggregate_type, event_type, payload } = event;
    const data = JSON.parse(payload);

    switch (event_type) {
      case 'book_created':
        await this.indexBookInOpenSearch(data);
        break;

      case 'book_updated':
        await this.updateBookInOpenSearch(data);
        break;

      case 'book_deleted':
        await this.deleteBookFromOpenSearch(data.id);
        break;

      default:
        console.warn(`Unknown event type: ${event_type}`);
    }
  }

  /**
   * Indexer dans OpenSearch (in-cluster)
   */
  async indexBookInOpenSearch(book: any) {
    await searchClient.index({
      index: 'books',
      id: book.id,
      body: {
        title: book.title,
        author: book.author,
        isbn: book.isbn,
        price: book.price,
        category: book.category,
        search_text: `${book.title} ${book.author}`,
        indexed_at: new Date().toISOString()
      }
    });

    console.log(`Book ${book.id} indexed in OpenSearch`);
  }

  async updateBookInOpenSearch(book: any) {
    await searchClient.update({
      index: 'books',
      id: book.id,
      body: {
        doc: {
          title: book.title,
          author: book.author,
          price: book.price,
          category: book.category,
          search_text: `${book.title} ${book.author}`,
          updated_at: new Date().toISOString()
        }
      }
    });
  }

  async deleteBookFromOpenSearch(bookId: string) {
    await searchClient.delete({
      index: 'books',
      id: bookId
    });
  }
}

// Entry point
const processor = new OutboxProcessor();
processor.start();
```

### Déploiement Kubernetes du Outbox Worker

```yaml
# deployments/outbox-processor.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: outbox-processor
  namespace: bookstore
spec:
  replicas: 2 # HA avec SKIP LOCKED
  selector:
    matchLabels:
      app: outbox-processor
  template:
    metadata:
      labels:
        app: outbox-processor
        version: v1
    spec:
      # Pool 2 : Services système
      nodeSelector:
        workload.type: system

      containers:
      - name: processor
        image: bookstore/outbox-processor:latest
        resources:
          requests:
            memory: "256Mi"
            cpu: "200m"
          limits:
            memory: "512Mi"
            cpu: "500m"

        env:
        # DBaaS PostgreSQL (externe)
        - name: DBAAS_PG_HOST
          valueFrom:
            secretKeyRef:
              name: dbaas-postgresql
              key: host
        - name: DBAAS_PG_USER
          valueFrom:
            secretKeyRef:
              name: dbaas-postgresql
              key: username
        - name: DBAAS_PG_PASSWORD
          valueFrom:
            secretKeyRef:
              name: dbaas-postgresql
              key: password

        # OpenSearch in-cluster
        - name: OPENSEARCH_HOST
          value: "bookstore-search-master.stateful.svc.cluster.local"
        - name: OPENSEARCH_USER
          valueFrom:
            secretKeyRef:
              name: opensearch-credentials
              key: username
        - name: OPENSEARCH_PASSWORD
          valueFrom:
            secretKeyRef:
              name: opensearch-credentials
              key: password

        volumeMounts:
        - name: db-ca-cert
          mountPath: /etc/secrets
          readOnly: true

        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10

        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5

      volumes:
      - name: db-ca-cert
        secret:
          secretName: dbaas-postgresql
          items:
          - key: ca.crt
            path: db-ca.crt
---
# Service pour monitoring
apiVersion: v1
kind: Service
metadata:
  name: outbox-processor
  namespace: bookstore
spec:
  selector:
    app: outbox-processor
  ports:
  - name: http
    port: 8080
    targetPort: 8080
```

## Workflow 3 : Application → Redis → DBaaS PostgreSQL (Cache-Aside Pattern)

### Pattern Cache-Aside avec Redis In-Cluster

```typescript
// services/order.service.ts
import { mainDb, redisClient } from '../config/database';

export class OrderService {
  /**
   * Cache-Aside Pattern :
   * 1. Check Redis (in-cluster, <1ms)
   * 2. If miss, query DBaaS PostgreSQL (externe, ~10ms)
   * 3. Populate cache
   */
  async getUserOrders(userId: string) {
    const cacheKey = `user:${userId}:orders`;

    // 1. Vérifier Redis in-cluster
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // 2. Query DBaaS PostgreSQL
    const result = await mainDb.query(`
      SELECT o.*, b.title, b.author
      FROM orders o
      JOIN books b ON o.book_id = b.id
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC
      LIMIT 50
    `, [userId]);

    const orders = result.rows;

    // 3. Mettre en cache Redis
    await redisClient.setEx(
      cacheKey,
      1800, // 30 minutes
      JSON.stringify(orders)
    );

    return orders;
  }

  /**
   * Write-Through Pattern :
   * 1. Write to DBaaS PostgreSQL
   * 2. Invalidate cache Redis
   * 3. Outbox event pour OpenSearch
   */
  async createOrder(userId: string, bookId: string, quantity: number) {
    const client = await mainDb.connect();

    try {
      await client.query('BEGIN');

      // 1. Vérifier stock dans DBaaS
      const stockResult = await client.query(
        'SELECT stock_quantity FROM books WHERE id = $1 FOR UPDATE',
        [bookId]
      );

      if (stockResult.rows[0].stock_quantity < quantity) {
        throw new Error('Insufficient stock');
      }

      // 2. Créer commande dans DBaaS
      const orderResult = await client.query(`
        INSERT INTO orders (user_id, book_id, quantity, status, created_at)
        VALUES ($1, $2, $3, 'pending', NOW())
        RETURNING *
      `, [userId, bookId, quantity]);

      const order = orderResult.rows[0];

      // 3. Décrémenter stock
      await client.query(
        'UPDATE books SET stock_quantity = stock_quantity - $1 WHERE id = $2',
        [quantity, bookId]
      );

      // 4. Insérer événement Outbox
      await client.query(`
        INSERT INTO outbox_events (
          aggregate_id, aggregate_type, event_type, payload
        ) VALUES ($1, $2, $3, $4)
      `, [
        order.id,
        'order',
        'order_created',
        JSON.stringify({
          orderId: order.id,
          userId,
          bookId,
          quantity
        })
      ]);

      await client.query('COMMIT');

      // 5. Invalider caches Redis (in-cluster)
      await Promise.all([
        redisClient.del(`user:${userId}:orders`),
        redisClient.del(`book:${bookId}`),
        redisClient.del(`book:${bookId}:stock`)
      ]);

      return order;

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Cache de requêtes complexes avec TTL court
   */
  async getTopSellingBooks(limit: number = 10) {
    const cacheKey = `analytics:top-selling:${limit}`;

    // Check cache
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Query analytique sur DBaaS
    const result = await mainDb.query(`
      SELECT
        b.id, b.title, b.author, b.price,
        COUNT(o.id) as total_orders,
        SUM(o.quantity) as total_quantity
      FROM books b
      JOIN orders o ON b.id = o.book_id
      WHERE o.created_at > NOW() - INTERVAL '30 days'
      GROUP BY b.id
      ORDER BY total_quantity DESC
      LIMIT $1
    `, [limit]);

    // Cache court pour données analytiques
    await redisClient.setEx(
      cacheKey,
      300, // 5 minutes
      JSON.stringify(result.rows)
    );

    return result.rows;
  }
}
```

### Pattern de cache Redis avancé

```typescript
// utils/cache-manager.ts
import { redisClient } from '../config/database';

export class CacheManager {
  /**
   * Cache with automatic refresh (Cache-Aside with background refresh)
   */
  async getOrFetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = 3600
  ): Promise<T> {
    // 1. Vérifier cache
    const cached = await redisClient.get(key);
    if (cached) {
      // Refresh si proche expiration (< 10% TTL restant)
      const ttlRemaining = await redisClient.ttl(key);
      if (ttlRemaining < ttl * 0.1) {
        // Background refresh sans attendre
        this.refreshCache(key, fetchFn, ttl).catch(console.error);
      }
      return JSON.parse(cached);
    }

    // 2. Cache miss - fetch et cache
    const data = await fetchFn();
    await redisClient.setEx(key, ttl, JSON.stringify(data));
    return data;
  }

  private async refreshCache<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number
  ) {
    const data = await fetchFn();
    await redisClient.setEx(key, ttl, JSON.stringify(data));
    console.log(`Background refresh completed for key: ${key}`);
  }

  /**
   * Invalidation pattern par tags
   */
  async invalidateByTag(tag: string) {
    const pattern = `*:${tag}:*`;
    const keys = await redisClient.keys(pattern);

    if (keys.length > 0) {
      await redisClient.del(keys);
      console.log(`Invalidated ${keys.length} keys with tag: ${tag}`);
    }
  }

  /**
   * Cache de session utilisateur
   */
  async getUserSession(userId: string) {
    const key = `session:${userId}`;
    const session = await redisClient.get(key);
    return session ? JSON.parse(session) : null;
  }

  async setUserSession(userId: string, sessionData: any, ttl: number = 86400) {
    const key = `session:${userId}`;
    await redisClient.setEx(key, ttl, JSON.stringify(sessionData));
  }
}
```

## Workflow 4 : Recherche avec OpenSearch In-Cluster

### Service de recherche full-text

```typescript
// services/search.service.ts
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';

const searchClient = new OpenSearchClient({
  node: 'https://bookstore-search-master.stateful.svc.cluster.local:9200',
  auth: {
    username: process.env.OPENSEARCH_USER,
    password: process.env.OPENSEARCH_PASSWORD
  }
});

export class SearchService {
  /**
   * Recherche full-text avec facets
   */
  async searchBooks(query: string, filters?: any) {
    const searchBody: any = {
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: query,
                fields: ['title^3', 'author^2', 'description'],
                type: 'best_fields',
                fuzziness: 'AUTO'
              }
            }
          ],
          filter: []
        }
      },
      aggs: {
        categories: {
          terms: { field: 'category.keyword', size: 20 }
        },
        price_ranges: {
          range: {
            field: 'price',
            ranges: [
              { to: 10 },
              { from: 10, to: 25 },
              { from: 25, to: 50 },
              { from: 50 }
            ]
          }
        }
      },
      size: 20,
      from: filters?.offset || 0
    };

    // Ajouter filtres
    if (filters?.category) {
      searchBody.query.bool.filter.push({
        term: { 'category.keyword': filters.category }
      });
    }

    if (filters?.minPrice || filters?.maxPrice) {
      searchBody.query.bool.filter.push({
        range: {
          price: {
            gte: filters.minPrice || 0,
            lte: filters.maxPrice || 999999
          }
        }
      });
    }

    const result = await searchClient.search({
      index: 'books',
      body: searchBody
    });

    return {
      hits: result.body.hits.hits.map((hit: any) => ({
        id: hit._id,
        score: hit._score,
        ...hit._source
      })),
      total: result.body.hits.total.value,
      aggregations: result.body.aggregations
    };
  }

  /**
   * Suggestions autocomplete
   */
  async suggest(prefix: string) {
    const result = await searchClient.search({
      index: 'books',
      body: {
        suggest: {
          title_suggest: {
            prefix: prefix,
            completion: {
              field: 'title_suggest',
              size: 10,
              skip_duplicates: true
            }
          },
          author_suggest: {
            prefix: prefix,
            completion: {
              field: 'author_suggest',
              size: 5
            }
          }
        }
      }
    });

    return {
      titles: result.body.suggest.title_suggest[0].options,
      authors: result.body.suggest.author_suggest[0].options
    };
  }
}
```

## Workflow 5 : End-to-End - Création de commande

### Séquence complète

```typescript
// controllers/order.controller.ts
import { OrderService } from '../services/order.service';
import { SearchService } from '../services/search.service';
import { CacheManager } from '../utils/cache-manager';

export class OrderController {
  private orderService = new OrderService();
  private searchService = new SearchService();
  private cacheManager = new CacheManager();

  /**
   * Workflow complet : Create Order
   *
   * 1. Application Knative reçoit requête
   * 2. Valide session Redis (in-cluster)
   * 3. Écrit dans DBaaS PostgreSQL avec Outbox event
   * 4. Invalide caches Redis
   * 5. Outbox Worker sync vers OpenSearch (in-cluster)
   */
  async createOrder(req: any, res: any) {
    try {
      const { userId, bookId, quantity } = req.body;

      // 1. Valider session Redis in-cluster
      const session = await this.cacheManager.getUserSession(userId);
      if (!session) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // 2. Créer commande dans DBaaS avec Outbox
      const order = await this.orderService.createOrder(
        userId,
        bookId,
        quantity
      );

      // 3. Invalider caches (automatique dans service)

      // 4. Retourner résultat
      res.status(201).json({
        order,
        message: 'Order created successfully'
      });

      // Note: L'indexation OpenSearch se fera de manière asynchrone
      // via le Outbox Worker qui poll DBaaS toutes les 5 secondes

    } catch (error) {
      console.error('Error creating order:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Workflow complet : Search & Order
   *
   * 1. Recherche dans OpenSearch (in-cluster)
   * 2. Enrichissement depuis cache Redis
   * 3. Si nécessaire, fetch depuis DBaaS
   */
  async searchAndOrder(req: any, res: any) {
    try {
      const { query, userId } = req.query;

      // 1. Rechercher dans OpenSearch in-cluster
      const searchResults = await this.searchService.searchBooks(query);

      // 2. Enrichir avec données temps-réel depuis Redis
      const enrichedResults = await Promise.all(
        searchResults.hits.map(async (book: any) => {
          // Check stock en temps réel depuis cache
          const stockCacheKey = `book:${book.id}:stock`;
          let stock = await redisClient.get(stockCacheKey);

          if (!stock) {
            // Cache miss - fetch depuis DBaaS
            const result = await mainDb.query(
              'SELECT stock_quantity FROM books WHERE id = $1',
              [book.id]
            );
            stock = result.rows[0]?.stock_quantity || 0;
            await redisClient.setEx(stockCacheKey, 300, stock.toString());
          }

          return {
            ...book,
            available_stock: parseInt(stock),
            can_order: parseInt(stock) > 0
          };
        })
      );

      res.json({
        results: enrichedResults,
        total: searchResults.total,
        facets: searchResults.aggregations
      });

    } catch (error) {
      console.error('Error in search and order:', error);
      res.status(500).json({ error: error.message });
    }
  }
}
```

## Monitoring et Observabilité

### Métriques Prometheus

```typescript
// monitoring/metrics.ts
import { Counter, Histogram, Gauge } from 'prom-client';

// DBaaS PostgreSQL metrics
export const dbQueryDuration = new Histogram({
  name: 'dbaas_query_duration_seconds',
  help: 'Duration of DBaaS PostgreSQL queries',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]
});

export const dbConnectionPoolSize = new Gauge({
  name: 'dbaas_connection_pool_size',
  help: 'Number of connections in DBaaS pool',
  labelNames: ['state'] // active, idle, waiting
});

// Redis metrics
export const redisCacheHits = new Counter({
  name: 'redis_cache_hits_total',
  help: 'Total Redis cache hits',
  labelNames: ['key_pattern']
});

export const redisCacheMisses = new Counter({
  name: 'redis_cache_misses_total',
  help: 'Total Redis cache misses',
  labelNames: ['key_pattern']
});

// OpenSearch metrics
export const searchQueryDuration = new Histogram({
  name: 'opensearch_query_duration_seconds',
  help: 'Duration of OpenSearch queries',
  labelNames: ['index'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2]
});

// Outbox metrics
export const outboxEventsProcessed = new Counter({
  name: 'outbox_events_processed_total',
  help: 'Total outbox events processed',
  labelNames: ['event_type', 'status'] // success, error
});

export const outboxProcessingLag = new Gauge({
  name: 'outbox_processing_lag_seconds',
  help: 'Time lag between event creation and processing'
});
```

### Health Checks

```typescript
// health/health-check.ts
import { mainDb, redisClient } from '../config/database';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';

export async function checkHealth() {
  const results = {
    dbaas_postgresql: await checkDBaaS(),
    redis_cluster: await checkRedis(),
    opensearch_cluster: await checkOpenSearch()
  };

  const isHealthy = Object.values(results).every(r => r.healthy);

  return {
    status: isHealthy ? 'healthy' : 'degraded',
    components: results,
    timestamp: new Date().toISOString()
  };
}

async function checkDBaaS() {
  try {
    const start = Date.now();
    const result = await mainDb.query('SELECT 1 as health');
    const latency = Date.now() - start;

    return {
      healthy: true,
      latency_ms: latency,
      type: 'dbaas-external',
      ssl: true
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message
    };
  }
}

async function checkRedis() {
  try {
    const start = Date.now();
    await redisClient.ping();
    const latency = Date.now() - start;

    return {
      healthy: true,
      latency_ms: latency,
      type: 'in-cluster-operator',
      location: 'bookstore-redis-cluster.stateful.svc.cluster.local'
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message
    };
  }
}

async function checkOpenSearch() {
  try {
    const searchClient = new OpenSearchClient({
      node: 'https://bookstore-search-master.stateful.svc.cluster.local:9200'
    });

    const start = Date.now();
    const health = await searchClient.cluster.health();
    const latency = Date.now() - start;

    return {
      healthy: health.body.status !== 'red',
      latency_ms: latency,
      cluster_status: health.body.status,
      type: 'in-cluster-operator',
      nodes: health.body.number_of_nodes
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message
    };
  }
}
```

## Comparaison : Architecture 100% APL Core vs Hybride

| Aspect | 100% APL Core | Hybride (DBaaS + Operators) |
|--------|---------------|----------------------------|
| **PostgreSQL** | CloudNative-PG in-cluster | DBaaS Akamai (externe) |
| **Connexion DB** | Locale (< 1ms) | Externe SSL (~10ms) |
| **Backups DB** | Manuel (CronJob) | Automatique (DBaaS) |
| **Redis** | Redis Operator in-cluster | Redis Operator in-cluster |
| **OpenSearch** | OpenSearch Operator | OpenSearch Operator |
| **Sync Main→Search** | Logical Replication | Outbox Worker |
| **Latence totale** | ~5-10ms | ~15-25ms |
| **Complexité Ops** | Élevée | Moyenne |
| **Coût mensuel** | $1,128 | $876 |
| **HA PostgreSQL** | Manuel (3 replicas) | Auto (DBaaS < 30s) |

## Avantages de l'architecture hybride

### ✅ Avantages

1. **Simplicité opérationnelle PostgreSQL**
   - Backups automatiques DBaaS
   - HA automatique avec failover < 30s
   - Patches de sécurité gérés par Akamai

2. **Maximisation APL Core**
   - Redis et OpenSearch via operators
   - Contrôle total sur cache et recherche
   - Déploiement GitOps complet

3. **Coûts réduits**
   - $876/mois vs $1,128/mois
   - Pas besoin de gérer 3 replicas PostgreSQL
   - Stockage et IOPS inclus dans DBaaS

4. **Évolutivité**
   - Scale PostgreSQL via DBaaS (scaling vertical facile)
   - Scale Redis/OpenSearch via operators (scaling horizontal)

### ⚠️ Inconvénients

1. **Latence réseau**
   - +5-15ms pour requêtes PostgreSQL (externe vs in-cluster)
   - Mitigé par cache Redis in-cluster

2. **Vendor lock-in**
   - Dépendance à Akamai DBaaS pour PostgreSQL
   - Migration possible vers CloudNative-PG si nécessaire

3. **Sync asynchrone**
   - Logical Replication non disponible entre DBaaS et OpenSearch
   - Doit utiliser Outbox Pattern (lag de 5-10s acceptable)

## Recommandations

### Pour l'architecture hybride

1. **Utiliser le Outbox Pattern** pour toute synchronisation Main → Search
2. **Cache Redis agressif** pour compenser latence DBaaS PostgreSQL
3. **Connection pooling** avec `max: 20` vers DBaaS
4. **Health checks** sur les 3 composants (DBaaS, Redis, OpenSearch)
5. **Monitoring** de la latence DBaaS (alertes si > 50ms)

### Migration vers 100% APL Core (future)

Si vous souhaitez plus tard migrer vers 100% APL Core :

1. Déployer CloudNative-PG cluster in-cluster
2. Migrer données DBaaS → CloudNative-PG (pg_dump/pg_restore)
3. Basculer applications vers nouveau endpoint
4. Activer Logical Replication au lieu de Outbox Worker
5. Désactiver DBaaS Akamai

Le code applicatif reste identique (même interface `pg.Pool`).

## Conclusion

L'architecture hybride offre un excellent compromis entre :
- **Simplicité** : DBaaS PostgreSQL géré par Akamai
- **Contrôle** : Redis et OpenSearch via operators in-cluster
- **Coûts** : Réduction de 22% par rapport à 100% APL Core

Le workflow basé sur **Outbox Pattern** garantit la cohérence éventuelle entre DBaaS PostgreSQL et OpenSearch in-cluster, avec une latence acceptable de 5-10 secondes pour l'indexation de recherche.
