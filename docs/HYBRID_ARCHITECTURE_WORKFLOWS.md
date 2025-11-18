# Workflows - Architecture Hybride (DBaaS + Operators In-Cluster)

Ce document décrit les workflows de données pour l'architecture hybride qui utilise :
- **DBaaS PostgreSQL** (Akamai, externe au cluster)
- **Redis Operator** (in-cluster, via APL Core)
- **OpenSearch Operator** (in-cluster, via APL Core)

## Vue d'ensemble de l'architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                        LKE Cluster (APL Core)                          │
│  ┌────────────────┐    ┌──────────────┐    ┌─────────────┐          │
│  │  Application   │───▶│    Redis     │    │ OpenSearch  │          │
│  │  (Knative)     │    │  (Operator)  │    │ (Operator)  │          │
│  └────────────────┘    └──────────────┘    └─────────────┘          │
│         │                                          ▲                   │
│         │                                          │                   │
│         │                  ┌─────────────────┐    │                   │
│         │                  │ Outbox Worker   │────┘                   │
│         │                  │  (Search Sync)  │                        │
│         │                  └─────────────────┘                        │
│         │                                                              │
│         │                  ┌─────────────────┐                        │
│         │                  │ Reco Sync       │                        │
│         │                  │  Worker         │                        │
│         │                  └─────────────────┘                        │
└─────────┼────────────────────────────┬──────────────┬─────────────────┘
          │                            │              │
          │ SSL                        │ Poll         │ Sync Events
          ▼                            ▼              ▼
┌──────────────────────────────────────────────────────────────────────┐
│              DBaaS PostgreSQL Main (Akamai Managed)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐            │
│  │    Main     │  │  outbox_    │  │   wal_level =    │            │
│  │   Tables    │  │  events     │  │   'logical'      │            │
│  └─────────────┘  └─────────────┘  └──────────────────┘            │
└──────────────────────────────────────────────────────────────────────┘
                                       ▲
                                       │ Sync (Outbox Pattern)
                                       │
┌──────────────────────────────────────────────────────────────────────┐
│         DBaaS PostgreSQL Recommendations (Akamai Managed)            │
│  ┌───────────────┐  ┌──────────────┐  ┌────────────────┐           │
│  │ User Vectors  │  │   Similar    │  │   Trending     │           │
│  │ (Embeddings)  │  │   Books      │  │   Books        │           │
│  └───────────────┘  └──────────────┘  └────────────────┘           │
└──────────────────────────────────────────────────────────────────────┘
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

## Workflow 6 : Système de Recommandations avec DBaaS PostgreSQL

### Architecture du système de recommandations

Le système de recommandations utilise une **base de données PostgreSQL DBaaS séparée** pour :
- Isoler les charges de travail analytiques des opérations transactionnelles
- Permettre un scaling indépendant
- Optimiser les index et configurations pour les requêtes analytiques

### Schéma de la base Recommendations

```sql
-- Base DBaaS PostgreSQL Recommendations
-- Instance séparée : lin-67890-1234.postgres.linodelke.net

-- Extension pgvector pour les embeddings
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- Pour similarité texte

-- Table : User Behavior (répliquée depuis Main DB)
CREATE TABLE user_interactions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  book_id UUID NOT NULL,
  interaction_type VARCHAR(50) NOT NULL, -- view, add_to_cart, purchase, search
  interaction_weight FLOAT NOT NULL DEFAULT 1.0,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_interactions_user ON user_interactions(user_id, created_at DESC);
CREATE INDEX idx_user_interactions_book ON user_interactions(book_id);
CREATE INDEX idx_user_interactions_type ON user_interactions(interaction_type);

-- Table : User Preference Vectors (ML embeddings)
CREATE TABLE user_vectors (
  user_id UUID PRIMARY KEY,
  preference_vector vector(128) NOT NULL, -- Embedding 128 dimensions
  favorite_categories TEXT[],
  favorite_authors TEXT[],
  avg_price_range NUMRANGE,
  last_computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_interactions INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_user_vectors_embedding ON user_vectors
  USING ivfflat (preference_vector vector_cosine_ops)
  WITH (lists = 100);

-- Table : Book Vectors (ML embeddings)
CREATE TABLE book_vectors (
  book_id UUID PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  author VARCHAR(200) NOT NULL,
  category VARCHAR(100),
  price DECIMAL(10,2),
  content_vector vector(128) NOT NULL, -- Embedding du contenu
  popularity_score FLOAT DEFAULT 0.0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_book_vectors_embedding ON book_vectors
  USING ivfflat (content_vector vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX idx_book_vectors_category ON book_vectors(category);
CREATE INDEX idx_book_vectors_popularity ON book_vectors(popularity_score DESC);

-- Table : Similar Books (précalculés)
CREATE TABLE similar_books (
  book_id UUID NOT NULL,
  similar_book_id UUID NOT NULL,
  similarity_score FLOAT NOT NULL,
  similarity_type VARCHAR(50) NOT NULL, -- content, collaborative, hybrid
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (book_id, similar_book_id)
);

CREATE INDEX idx_similar_books_score ON similar_books(book_id, similarity_score DESC);

-- Table : Trending Books (mise à jour périodique)
CREATE TABLE trending_books (
  book_id UUID PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  trend_score FLOAT NOT NULL,
  view_count_24h INTEGER DEFAULT 0,
  purchase_count_24h INTEGER DEFAULT 0,
  purchase_count_7d INTEGER DEFAULT 0,
  trend_velocity FLOAT DEFAULT 0.0, -- Rate of change
  category VARCHAR(100),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trending_books_score ON trending_books(trend_score DESC);
CREATE INDEX idx_trending_books_category ON trending_books(category, trend_score DESC);

-- Table : Personalized Recommendations (cache)
CREATE TABLE user_recommendations (
  user_id UUID NOT NULL,
  book_id UUID NOT NULL,
  recommendation_score FLOAT NOT NULL,
  recommendation_reason VARCHAR(200),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
  PRIMARY KEY (user_id, book_id)
);

CREATE INDEX idx_user_recommendations_score ON user_recommendations(user_id, recommendation_score DESC);
CREATE INDEX idx_user_recommendations_expiry ON user_recommendations(expires_at);

-- Cleanup automatique des recommandations expirées
CREATE OR REPLACE FUNCTION cleanup_expired_recommendations()
RETURNS void AS $$
BEGIN
  DELETE FROM user_recommendations WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
```

### Configuration de connexion DBaaS Recommendations

```typescript
// config/database.ts

// DBaaS PostgreSQL Main
export const mainDb = new Pool({
  host: process.env.DBAAS_MAIN_HOST, // lin-12345-6789.postgres.linodelke.net
  port: 5432,
  database: 'bookstore_main',
  user: process.env.DBAAS_MAIN_USER,
  password: process.env.DBAAS_MAIN_PASSWORD,
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync('/etc/secrets/main-db-ca.crt', 'utf8')
  },
  max: 20
});

// DBaaS PostgreSQL Recommendations (instance séparée)
export const recoDb = new Pool({
  host: process.env.DBAAS_RECO_HOST, // lin-67890-1234.postgres.linodelke.net
  port: 5432,
  database: 'bookstore_recommendations',
  user: process.env.DBAAS_RECO_USER,
  password: process.env.DBAAS_RECO_PASSWORD,
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync('/etc/secrets/reco-db-ca.crt', 'utf8')
  },
  max: 15 // Moins de connexions car analytique
});
```

### Secrets Kubernetes pour les 2 bases

```yaml
# secrets/dbaas-postgresql-main.yaml
apiVersion: v1
kind: Secret
metadata:
  name: dbaas-postgresql-main
  namespace: bookstore
type: Opaque
stringData:
  host: lin-12345-6789.postgres.linodelke.net
  database: bookstore_main
  username: bookstore_user
  password: <main-db-password>
  ca.crt: |
    -----BEGIN CERTIFICATE-----
    ...
    -----END CERTIFICATE-----
---
# secrets/dbaas-postgresql-recommendations.yaml
apiVersion: v1
kind: Secret
metadata:
  name: dbaas-postgresql-recommendations
  namespace: bookstore
type: Opaque
stringData:
  host: lin-67890-1234.postgres.linodelke.net
  database: bookstore_recommendations
  username: bookstore_reco_user
  password: <reco-db-password>
  ca.crt: |
    -----BEGIN CERTIFICATE-----
    ...
    -----END CERTIFICATE-----
```

## Workflow 7 : Synchronisation Main DB → Recommendations DB

### Architecture de synchronisation

La synchronisation entre Main DB et Recommendations DB utilise le **Outbox Pattern** avec un worker dédié qui :
1. Poll la table `outbox_events` du DBaaS Main
2. Extrait les événements pertinents pour les recommandations
3. Transforme et écrit dans DBaaS Recommendations
4. Marque les événements comme traités

### Événements synchronisés

```typescript
// types/events.ts
export enum RecommendationEventType {
  // User interactions
  BOOK_VIEWED = 'book_viewed',
  BOOK_SEARCHED = 'book_searched',
  BOOK_ADDED_TO_CART = 'book_added_to_cart',
  BOOK_PURCHASED = 'book_purchased',

  // Book updates
  BOOK_CREATED = 'book_created',
  BOOK_UPDATED = 'book_updated',
  BOOK_DELETED = 'book_deleted',

  // Compute triggers
  COMPUTE_USER_VECTOR = 'compute_user_vector',
  COMPUTE_TRENDING = 'compute_trending'
}

export interface BookInteractionEvent {
  userId: string;
  bookId: string;
  interactionType: 'view' | 'search' | 'add_to_cart' | 'purchase';
  metadata?: {
    searchQuery?: string;
    price?: number;
    category?: string;
  };
  timestamp: string;
}
```

### Worker de synchronisation

```typescript
// workers/recommendations-sync.ts
import { mainDb, recoDb } from '../config/database';

export class RecommendationsSyncWorker {
  private isProcessing = false;
  private batchSize = 50;
  private pollInterval = 10000; // 10 secondes

  async start() {
    console.log('Recommendations Sync Worker started');

    setInterval(async () => {
      if (!this.isProcessing) {
        await this.syncEvents();
      }
    }, this.pollInterval);
  }

  async syncEvents() {
    this.isProcessing = true;
    const mainClient = await mainDb.connect();
    const recoClient = await recoDb.connect();

    try {
      // 1. Récupérer événements non traités depuis Main DB
      const eventsResult = await mainClient.query(`
        SELECT id, aggregate_id, aggregate_type, event_type, payload, created_at
        FROM outbox_events
        WHERE processed = false
          AND event_type IN (
            'book_viewed', 'book_searched', 'book_added_to_cart', 'book_purchased',
            'book_created', 'book_updated'
          )
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `, [this.batchSize]);

      if (eventsResult.rows.length === 0) {
        return;
      }

      console.log(`Syncing ${eventsResult.rows.length} events to Recommendations DB`);

      // 2. Traiter chaque événement
      for (const event of eventsResult.rows) {
        await this.handleEvent(event, recoClient);

        // 3. Marquer comme traité dans Main DB
        await mainClient.query(
          'UPDATE outbox_events SET processed = true, processed_at = NOW() WHERE id = $1',
          [event.id]
        );
      }

      console.log(`Successfully synced ${eventsResult.rows.length} events`);

    } catch (error) {
      console.error('Error syncing recommendations events:', error);
    } finally {
      mainClient.release();
      recoClient.release();
      this.isProcessing = false;
    }
  }

  async handleEvent(event: any, recoClient: any) {
    const { event_type, payload } = event;
    const data = JSON.parse(payload);

    switch (event_type) {
      case 'book_viewed':
        await this.trackInteraction(recoClient, data, 'view', 1.0);
        break;

      case 'book_searched':
        await this.trackInteraction(recoClient, data, 'search', 0.5);
        break;

      case 'book_added_to_cart':
        await this.trackInteraction(recoClient, data, 'add_to_cart', 3.0);
        break;

      case 'book_purchased':
        await this.trackInteraction(recoClient, data, 'purchase', 10.0);
        await this.invalidateRecommendations(recoClient, data.userId);
        break;

      case 'book_created':
      case 'book_updated':
        await this.syncBookVector(recoClient, data);
        break;

      default:
        console.warn(`Unknown event type: ${event_type}`);
    }
  }

  /**
   * Enregistrer interaction utilisateur dans Recommendations DB
   */
  async trackInteraction(
    recoClient: any,
    data: any,
    interactionType: string,
    weight: number
  ) {
    await recoClient.query(`
      INSERT INTO user_interactions (
        user_id, book_id, interaction_type, interaction_weight, metadata, created_at, synced_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [
      data.userId,
      data.bookId,
      interactionType,
      weight,
      JSON.stringify(data.metadata || {}),
      data.timestamp || new Date().toISOString()
    ]);

    console.log(`Tracked ${interactionType} for user ${data.userId}, book ${data.bookId}`);
  }

  /**
   * Synchroniser métadonnées de livre
   */
  async syncBookVector(recoClient: any, bookData: any) {
    // Générer embedding (simplifié - en prod utiliser ML model)
    const contentVector = await this.generateBookEmbedding(bookData);

    await recoClient.query(`
      INSERT INTO book_vectors (
        book_id, title, author, category, price, content_vector, synced_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (book_id) DO UPDATE SET
        title = EXCLUDED.title,
        author = EXCLUDED.author,
        category = EXCLUDED.category,
        price = EXCLUDED.price,
        content_vector = EXCLUDED.content_vector,
        synced_at = NOW()
    `, [
      bookData.id,
      bookData.title,
      bookData.author,
      bookData.category,
      bookData.price,
      JSON.stringify(contentVector)
    ]);

    console.log(`Synced book vector for book ${bookData.id}`);
  }

  /**
   * Invalider recommandations en cache
   */
  async invalidateRecommendations(recoClient: any, userId: string) {
    await recoClient.query(
      'DELETE FROM user_recommendations WHERE user_id = $1',
      [userId]
    );
  }

  /**
   * Générer embedding pour un livre (placeholder - utiliser ML en prod)
   */
  async generateBookEmbedding(bookData: any): Promise<number[]> {
    // En production : appeler service ML (TensorFlow, PyTorch)
    // Pour l'instant : embedding simple basé sur hash
    const text = `${bookData.title} ${bookData.author} ${bookData.category}`;
    const vector = new Array(128).fill(0).map((_, i) => {
      return Math.sin(text.charCodeAt(i % text.length) * (i + 1)) * 0.5;
    });
    return vector;
  }
}

// Entry point
const syncWorker = new RecommendationsSyncWorker();
syncWorker.start();
```

### Déploiement du Sync Worker

```yaml
# deployments/recommendations-sync-worker.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: recommendations-sync-worker
  namespace: bookstore
spec:
  replicas: 2 # HA avec SKIP LOCKED
  selector:
    matchLabels:
      app: recommendations-sync-worker
  template:
    metadata:
      labels:
        app: recommendations-sync-worker
        version: v1
    spec:
      nodeSelector:
        workload.type: system

      containers:
      - name: sync-worker
        image: bookstore/recommendations-sync-worker:latest
        resources:
          requests:
            memory: "512Mi"
            cpu: "300m"
          limits:
            memory: "1Gi"
            cpu: "1000m"

        env:
        # Main DBaaS
        - name: DBAAS_MAIN_HOST
          valueFrom:
            secretKeyRef:
              name: dbaas-postgresql-main
              key: host
        - name: DBAAS_MAIN_USER
          valueFrom:
            secretKeyRef:
              name: dbaas-postgresql-main
              key: username
        - name: DBAAS_MAIN_PASSWORD
          valueFrom:
            secretKeyRef:
              name: dbaas-postgresql-main
              key: password

        # Recommendations DBaaS
        - name: DBAAS_RECO_HOST
          valueFrom:
            secretKeyRef:
              name: dbaas-postgresql-recommendations
              key: host
        - name: DBAAS_RECO_USER
          valueFrom:
            secretKeyRef:
              name: dbaas-postgresql-recommendations
              key: username
        - name: DBAAS_RECO_PASSWORD
          valueFrom:
            secretKeyRef:
              name: dbaas-postgresql-recommendations
              key: password

        volumeMounts:
        - name: main-db-ca
          mountPath: /etc/secrets/main-db-ca.crt
          subPath: ca.crt
        - name: reco-db-ca
          mountPath: /etc/secrets/reco-db-ca.crt
          subPath: ca.crt

        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10

      volumes:
      - name: main-db-ca
        secret:
          secretName: dbaas-postgresql-main
      - name: reco-db-ca
        secret:
          secretName: dbaas-postgresql-recommendations
```

### Service de recommandations

```typescript
// services/recommendation.service.ts
import { recoDb, redisClient } from '../config/database';

export class RecommendationService {
  /**
   * Obtenir recommandations personnalisées pour un utilisateur
   */
  async getPersonalizedRecommendations(userId: string, limit: number = 10) {
    const cacheKey = `recommendations:${userId}`;

    // 1. Check cache Redis
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // 2. Check cache dans Recommendations DB
    const cachedReco = await recoDb.query(`
      SELECT book_id, recommendation_score, recommendation_reason
      FROM user_recommendations
      WHERE user_id = $1 AND expires_at > NOW()
      ORDER BY recommendation_score DESC
      LIMIT $2
    `, [userId, limit]);

    if (cachedReco.rows.length >= limit) {
      const recommendations = cachedReco.rows;
      await redisClient.setEx(cacheKey, 1800, JSON.stringify(recommendations));
      return recommendations;
    }

    // 3. Calculer nouvelles recommandations
    const recommendations = await this.computeRecommendations(userId, limit);

    // 4. Sauvegarder dans cache DB
    for (const reco of recommendations) {
      await recoDb.query(`
        INSERT INTO user_recommendations (
          user_id, book_id, recommendation_score, recommendation_reason, computed_at, expires_at
        ) VALUES ($1, $2, $3, $4, NOW(), NOW() + INTERVAL '1 hour')
        ON CONFLICT (user_id, book_id) DO UPDATE SET
          recommendation_score = EXCLUDED.recommendation_score,
          computed_at = NOW(),
          expires_at = NOW() + INTERVAL '1 hour'
      `, [userId, reco.book_id, reco.score, reco.reason]);
    }

    // 5. Cache Redis
    await redisClient.setEx(cacheKey, 1800, JSON.stringify(recommendations));

    return recommendations;
  }

  /**
   * Calculer recommandations avec pgvector
   */
  async computeRecommendations(userId: string, limit: number) {
    // 1. Obtenir vecteur de préférence utilisateur
    const userVectorResult = await recoDb.query(
      'SELECT preference_vector FROM user_vectors WHERE user_id = $1',
      [userId]
    );

    if (userVectorResult.rows.length === 0) {
      // Pas de vecteur - recommandations trending
      return this.getTrendingRecommendations(limit);
    }

    const userVector = userVectorResult.rows[0].preference_vector;

    // 2. Recherche cosine similarity avec pgvector
    const result = await recoDb.query(`
      SELECT
        bv.book_id,
        bv.title,
        bv.author,
        bv.category,
        bv.price,
        bv.popularity_score,
        1 - (bv.content_vector <=> $1) as similarity_score
      FROM book_vectors bv
      WHERE bv.book_id NOT IN (
        -- Exclure livres déjà achetés
        SELECT book_id FROM user_interactions
        WHERE user_id = $2 AND interaction_type = 'purchase'
      )
      ORDER BY bv.content_vector <=> $1
      LIMIT $3
    `, [JSON.stringify(userVector), userId, limit]);

    return result.rows.map(row => ({
      book_id: row.book_id,
      title: row.title,
      author: row.author,
      category: row.category,
      price: row.price,
      score: row.similarity_score,
      reason: 'Based on your preferences'
    }));
  }

  /**
   * Recommandations trending (fallback)
   */
  async getTrendingRecommendations(limit: number) {
    const result = await recoDb.query(`
      SELECT book_id, title, trend_score
      FROM trending_books
      ORDER BY trend_score DESC
      LIMIT $1
    `, [limit]);

    return result.rows.map(row => ({
      book_id: row.book_id,
      title: row.title,
      score: row.trend_score,
      reason: 'Trending now'
    }));
  }

  /**
   * Obtenir livres similaires
   */
  async getSimilarBooks(bookId: string, limit: number = 5) {
    const cacheKey = `similar:${bookId}`;

    // Cache Redis
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Query Recommendations DB
    const result = await recoDb.query(`
      SELECT sb.similar_book_id, sb.similarity_score, bv.title, bv.author
      FROM similar_books sb
      JOIN book_vectors bv ON sb.similar_book_id = bv.book_id
      WHERE sb.book_id = $1
      ORDER BY sb.similarity_score DESC
      LIMIT $2
    `, [bookId, limit]);

    const similarBooks = result.rows;
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(similarBooks));

    return similarBooks;
  }
}
```

### Calcul périodique des embeddings et trending

```yaml
# cronjobs/compute-recommendations.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: compute-user-vectors
  namespace: bookstore
spec:
  schedule: "0 */6 * * *" # Toutes les 6 heures
  jobTemplate:
    spec:
      template:
        spec:
          nodeSelector:
            workload.type: system
          containers:
          - name: compute
            image: bookstore/recommendations-compute:latest
            env:
            - name: DBAAS_RECO_HOST
              valueFrom:
                secretKeyRef:
                  name: dbaas-postgresql-recommendations
                  key: host
            - name: COMPUTE_TYPE
              value: "user_vectors"
          restartPolicy: OnFailure
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: compute-trending
  namespace: bookstore
spec:
  schedule: "*/30 * * * *" # Toutes les 30 minutes
  jobTemplate:
    spec:
      template:
        spec:
          nodeSelector:
            workload.type: system
          containers:
          - name: compute
            image: bookstore/recommendations-compute:latest
            env:
            - name: DBAAS_RECO_HOST
              valueFrom:
                secretKeyRef:
                  name: dbaas-postgresql-recommendations
                  key: host
            - name: COMPUTE_TYPE
              value: "trending"
          restartPolicy: OnFailure
```

### Workflow complet : Recommandations End-to-End

```typescript
// controllers/recommendation.controller.ts
import { RecommendationService } from '../services/recommendation.service';

export class RecommendationController {
  private recoService = new RecommendationService();

  /**
   * Workflow complet :
   * 1. User visite page livre
   * 2. Event "book_viewed" écrit dans Main DB (outbox)
   * 3. Sync Worker transfert vers Recommendations DB
   * 4. CronJob calcule trending et user vectors
   * 5. User demande recommandations
   * 6. Service lit depuis Recommendations DB avec cache Redis
   */
  async getRecommendations(req: any, res: any) {
    try {
      const { userId } = req.params;
      const limit = parseInt(req.query.limit || '10');

      // Obtenir recommandations personnalisées
      const recommendations = await this.recoService.getPersonalizedRecommendations(
        userId,
        limit
      );

      res.json({
        userId,
        recommendations,
        cached: true,
        source: 'dbaas-recommendations'
      });

    } catch (error) {
      console.error('Error getting recommendations:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getSimilarBooks(req: any, res: any) {
    try {
      const { bookId } = req.params;
      const limit = parseInt(req.query.limit || '5');

      const similarBooks = await this.recoService.getSimilarBooks(bookId, limit);

      res.json({
        bookId,
        similarBooks,
        source: 'dbaas-recommendations'
      });

    } catch (error) {
      console.error('Error getting similar books:', error);
      res.status(500).json({ error: error.message });
    }
  }
}
```

### Résumé du workflow de synchronisation

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. User Action (view/purchase/search)                                │
│    └─▶ Application écrit dans Main DB + Outbox event                │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 2. Recommendations Sync Worker (poll toutes les 10s)                 │
│    └─▶ Poll Main DB outbox_events                                   │
│    └─▶ Extrait événements pertinents                                │
│    └─▶ Écrit dans Recommendations DB (user_interactions)            │
│    └─▶ Marque événements comme traités                              │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 3. CronJobs périodiques                                              │
│    └─▶ Compute User Vectors (toutes les 6h)                         │
│    └─▶ Compute Trending Books (toutes les 30min)                    │
│    └─▶ Compute Similar Books (nightly)                              │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 4. User demande recommandations                                      │
│    └─▶ Check Redis cache (in-cluster, <1ms)                         │
│    └─▶ Si miss : Check Recommendations DB cache                     │
│    └─▶ Si miss : Compute avec pgvector cosine similarity            │
│    └─▶ Cache résultat (Redis + DB)                                  │
└──────────────────────────────────────────────────────────────────────┘
```

### Avantages de l'architecture 2 bases DBaaS

1. **Isolation des workloads**
   - Main DB : OLTP (transactions rapides)
   - Recommendations DB : OLAP (requêtes analytiques complexes)

2. **Scaling indépendant**
   - Main DB : Scale pour volume de transactions
   - Recommendations DB : Scale pour calculs ML

3. **Performance**
   - Indexes optimisés différemment
   - Pas d'impact des calculs ML sur transactions

4. **Coûts**
   - Main DB : Instance plus petite (transactions only)
   - Recommendations DB : Instance avec plus de CPU pour calculs

### Coûts estimés

| Composant | Configuration | Coût mensuel |
|-----------|--------------|--------------|
| DBaaS PostgreSQL Main | 4 vCPU, 8 GB RAM | $432 |
| DBaaS PostgreSQL Recommendations | 4 vCPU, 8 GB RAM | $432 |
| Redis Operator (LKE) | 3 nodes × 4GB | Inclus dans LKE |
| OpenSearch Operator (LKE) | 3 nodes × 8GB | Inclus dans LKE |
| **Total** | | **$864/mois** |

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
