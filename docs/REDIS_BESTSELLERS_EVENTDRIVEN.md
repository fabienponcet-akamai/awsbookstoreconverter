# Redis Bestsellers - Event-Driven avec Sorted Sets (AWS Bookstore Pattern)

## Comparaison : AWS Bookstore vs Architecture Hybride

### AWS Bookstore (original)

```
1. User creates order
   ↓
2. DynamoDB Orders table (write)
   ↓
3. DynamoDB Streams (trigger)
   ↓
4. Lambda "UpdateBestSellers" (event-driven)
   ↓
5. Redis ZINCRBY bestsellers {book_id} {quantity}
   ↓
6. Application reads: ZREVRANGE bestsellers 0 99 WITHSCORES
```

### Architecture Hybride APL/LKE (équivalent exact)

```
1. User creates order
   ↓
2. DBaaS PostgreSQL Main (write order + outbox event in SAME transaction)
   ↓
3. Outbox Pattern (poll every 5s - near real-time)
   ↓
4. Bestsellers Update Worker (event-driven, comme Lambda)
   ↓
5. Redis ZINCRBY bestsellers {book_id} {quantity}
   ↓
6. Application reads: ZREVRANGE bestsellers 0 99 WITHSCORES
```

## Architecture complète

```
┌─────────────────────────────────────────────────────────────────────┐
│                         LKE Cluster (APL Core)                       │
│                                                                      │
│  ┌─────────────────┐              ┌────────────────────────────┐   │
│  │   Application   │◀─────────────│   Redis In-Cluster         │   │
│  │   (Knative)     │   ZREVRANGE  │   (Operator)               │   │
│  │                 │   < 1ms      │                             │   │
│  │ GET /api/       │              │   SORTED SET                │   │
│  │  bestsellers    │              │   Key: "bestsellers"        │   │
│  │                 │              │                             │   │
│  └─────────────────┘              │   Members (book_id):        │   │
│                                    │   - "book-123" → 456.0     │   │
│                                    │   - "book-789" → 234.0     │   │
│                                    │   - "book-456" → 189.0     │   │
│                                    │                             │   │
│                                    │   (Scores = total orders)   │   │
│                                    └────────────────────────────┘   │
│                                              ▲                       │
│                                              │ ZINCRBY              │
│                                              │ (real-time)          │
│                                              │                       │
│                   ┌──────────────────────────┴────────────┐         │
│                   │  Bestsellers Update Worker            │         │
│                   │  (Deployment - Continuous Polling)    │         │
│                   │                                        │         │
│                   │  - Poll outbox every 5 seconds        │         │
│                   │  - Process "order_created" events     │         │
│                   │  - ZINCRBY for each book              │         │
│                   │  - Mark event as processed            │         │
│                   └──────────────────────┬─────────────────┘         │
└──────────────────────────────────────────┼───────────────────────────┘
                                           │
                                           │ Poll & Process
                                           ▼
                    ┌────────────────────────────────────────────────┐
                    │   DBaaS PostgreSQL Main                        │
                    │                                                │
                    │   outbox_events:                              │
                    │   ┌─────────────────────────────────────────┐ │
                    │   │ id | event_type      | payload         │ │
                    │   │ 1  | "order_created" | {book: "123",   │ │
                    │   │    |                 |  qty: 2}        │ │
                    │   └─────────────────────────────────────────┘ │
                    └────────────────────────────────────────────────┘
```

## Workflow Event-Driven : Temps Réel

```
┌───────────────────────────────────────────────────────────────────┐
│ 1. User places order                                               │
│    └─▶ POST /api/orders                                          │
└─────────────────────────────┬─────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│ 2. Application writes to DBaaS Main (SINGLE TRANSACTION)          │
│    BEGIN;                                                         │
│    INSERT INTO orders (user_id, book_id, quantity) ...           │
│    INSERT INTO outbox_events (event_type, payload) VALUES (      │
│      'order_created',                                             │
│      '{"book_id": "123", "quantity": 2}'                         │
│    );                                                             │
│    COMMIT;  ← Atomic!                                            │
└─────────────────────────────┬─────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│ 3. Bestsellers Worker polls outbox (every 5 seconds)              │
│    SELECT * FROM outbox_events                                    │
│    WHERE processed = false AND event_type = 'order_created'      │
│    ORDER BY created_at ASC                                        │
│    LIMIT 100 FOR UPDATE SKIP LOCKED;                             │
│                                                                   │
│    → Finds the "order_created" event                             │
└─────────────────────────────┬─────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│ 4. Worker updates Redis Sorted Set (EXACTLY like AWS Lambda)      │
│    ZINCRBY bestsellers book-123 2                                 │
│    → Increments score by 2 (quantity ordered)                    │
│                                                                   │
│    Result:                                                        │
│    If book-123 had score 100 → now 102                          │
│    If book-123 didn't exist → created with score 2              │
└─────────────────────────────┬─────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│ 5. Worker marks event as processed                                │
│    UPDATE outbox_events SET processed = true WHERE id = 1;       │
└───────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│ 6. User fetches bestsellers (< 1ms from Redis)                    │
│    GET /api/bestsellers?limit=10                                  │
│    → ZREVRANGE bestsellers 0 9 WITHSCORES                        │
│                                                                   │
│    Returns:                                                       │
│    [                                                              │
│      {"book_id": "book-123", "score": 456},                      │
│      {"book_id": "book-789", "score": 234},                      │
│      ...                                                          │
│    ]                                                              │
└───────────────────────────────────────────────────────────────────┘
```

## Code complet : Bestsellers Update Worker

```typescript
// workers/bestsellers-update.ts
import { mainDb, redisClient } from '../config/database';

export class BestsellersUpdateWorker {
  private isProcessing = false;
  private batchSize = 100;
  private pollInterval = 5000; // 5 secondes (near real-time)

  async start() {
    console.log('🚀 Bestsellers Update Worker started (Event-Driven)');
    console.log('📊 Using Redis Sorted Sets (ZINCRBY) - AWS Bookstore pattern');

    // Poll continuous
    setInterval(async () => {
      if (!this.isProcessing) {
        await this.processOrderEvents();
      }
    }, this.pollInterval);
  }

  /**
   * Poll et traite les événements order_created depuis l'outbox
   * Équivalent à : DynamoDB Streams → Lambda UpdateBestSellers
   */
  async processOrderEvents() {
    this.isProcessing = true;
    const mainClient = await mainDb.connect();

    try {
      // 1. Poll outbox events (order_created uniquement)
      const eventsResult = await mainClient.query(`
        SELECT id, event_type, payload, created_at
        FROM outbox_events
        WHERE processed = false
          AND event_type = 'order_created'
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `, [this.batchSize]);

      if (eventsResult.rows.length === 0) {
        return; // Pas d'événements
      }

      console.log(`📦 Processing ${eventsResult.rows.length} order events...`);

      // 2. Traiter chaque événement
      for (const event of eventsResult.rows) {
        await this.updateBestSeller(event);

        // 3. Marquer comme traité
        await mainClient.query(
          'UPDATE outbox_events SET processed = true, processed_at = NOW() WHERE id = $1',
          [event.id]
        );
      }

      console.log(`✅ Successfully processed ${eventsResult.rows.length} events`);

    } catch (error) {
      console.error('❌ Error processing bestseller events:', error);
    } finally {
      mainClient.release();
      this.isProcessing = false;
    }
  }

  /**
   * Met à jour le bestseller dans Redis Sorted Set
   * Équivalent exact de Lambda UpdateBestSellers dans AWS Bookstore
   */
  async updateBestSeller(event: any) {
    try {
      const payload = JSON.parse(event.payload);
      const { book_id, quantity } = payload;

      // ZINCRBY : Incrémente le score du livre dans le sorted set
      // Si le livre n'existe pas, il est créé avec quantity comme score initial
      const newScore = await redisClient.zIncrBy('bestsellers', quantity, book_id);

      console.log(`📈 ZINCRBY bestsellers ${book_id} ${quantity} → ${newScore}`);

      // Optionnel : Limiter le sorted set aux top 1000 pour économiser mémoire
      // Garder seulement les 1000 meilleurs
      await this.trimBestsellers();

    } catch (error) {
      console.error(`Error updating bestseller for event ${event.id}:`, error);
      throw error; // Rethrow pour ne pas marquer comme traité
    }
  }

  /**
   * Limite le sorted set aux top 1000
   * Supprime les livres au-delà du top 1000
   */
  async trimBestsellers() {
    // ZREMRANGEBYRANK : Supprime les membres dont le rang est > 1000
    // Rank 0 = highest score, donc on garde 0-999 et supprime le reste
    const removed = await redisClient.zRemRangeByRank('bestsellers', 0, -1001);

    if (removed > 0) {
      console.log(`🧹 Trimmed ${removed} books from bestsellers (keeping top 1000)`);
    }
  }

  /**
   * Optionnel : Décrémente si une commande est annulée
   */
  async handleOrderCancelled(event: any) {
    try {
      const payload = JSON.parse(event.payload);
      const { book_id, quantity } = payload;

      // ZINCRBY avec valeur négative pour décrémenter
      const newScore = await redisClient.zIncrBy('bestsellers', -quantity, book_id);

      console.log(`📉 Order cancelled - ZINCRBY bestsellers ${book_id} -${quantity} → ${newScore}`);

      // Si le score est maintenant <= 0, supprimer le membre
      if (newScore <= 0) {
        await redisClient.zRem('bestsellers', book_id);
        console.log(`🗑️  Removed ${book_id} from bestsellers (score <= 0)`);
      }

    } catch (error) {
      console.error('Error handling order cancellation:', error);
      throw error;
    }
  }
}

// Entry point
const worker = new BestsellersUpdateWorker();
worker.start();
```

## Service Application : Lecture Redis Sorted Sets

```typescript
// services/bestseller.service.ts
import { redisClient, mainDb } from '../config/database';

export class BestsellerService {
  /**
   * Obtenir les bestsellers depuis Redis Sorted Set
   * Équivalent à : AWS Bookstore ZREVRANGE
   */
  async getBestsellers(limit: number = 100): Promise<any> {
    try {
      // ZREVRANGE : Récupère les membres avec les scores les plus élevés
      // WITHSCORES : Inclut les scores dans la réponse
      // 0 to limit-1 : Les N premiers
      const results = await redisClient.zRevRangeWithScores('bestsellers', 0, limit - 1);

      console.log(`✅ Retrieved ${results.length} bestsellers from Redis Sorted Set`);

      // Enrichir avec métadonnées depuis cache ou DB
      const bestsellers = await this.enrichBestsellers(results);

      return {
        count: bestsellers.length,
        updated_at: new Date().toISOString(),
        source: 'redis-sorted-set',
        books: bestsellers
      };

    } catch (error) {
      console.error('❌ Error getting bestsellers from Redis:', error);
      // Fallback vers DB si Redis indisponible
      return await this.getBestsellersFromDB(limit);
    }
  }

  /**
   * Enrichir les bestsellers avec métadonnées (title, author, etc.)
   */
  private async enrichBestsellers(results: Array<{value: string, score: number}>) {
    const enriched = [];

    for (const result of results) {
      const book_id = result.value;
      const order_count = result.score;

      // 1. Check cache Redis pour métadonnées
      const cacheKey = `book:meta:${book_id}`;
      let bookMeta = await redisClient.get(cacheKey);

      if (!bookMeta) {
        // 2. Cache miss - fetch depuis DBaaS Main
        const dbResult = await mainDb.query(
          'SELECT id, title, author, category, price, cover_image_url FROM books WHERE id = $1',
          [book_id]
        );

        if (dbResult.rows.length > 0) {
          bookMeta = JSON.stringify(dbResult.rows[0]);
          // Cache 1 heure
          await redisClient.setEx(cacheKey, 3600, bookMeta);
        }
      }

      if (bookMeta) {
        const meta = JSON.parse(bookMeta);
        enriched.push({
          rank: enriched.length + 1,
          book_id,
          order_count: Math.floor(order_count),
          title: meta.title,
          author: meta.author,
          category: meta.category,
          price: meta.price,
          cover_image_url: meta.cover_image_url
        });
      }
    }

    return enriched;
  }

  /**
   * Fallback : Query directe depuis DBaaS si Redis indisponible
   */
  private async getBestsellersFromDB(limit: number) {
    const result = await mainDb.query(`
      SELECT
        b.id as book_id,
        b.title,
        b.author,
        b.category,
        b.price,
        b.cover_image_url,
        COUNT(DISTINCT o.id) as order_count
      FROM books b
      INNER JOIN orders o ON b.id = o.book_id
      WHERE o.status = 'completed'
        AND o.created_at > NOW() - INTERVAL '90 days'
      GROUP BY b.id
      ORDER BY order_count DESC
      LIMIT $1
    `, [limit]);

    return {
      count: result.rows.length,
      updated_at: new Date().toISOString(),
      source: 'database-fallback',
      books: result.rows.map((book, index) => ({
        rank: index + 1,
        ...book
      }))
    };
  }

  /**
   * Obtenir le rang d'un livre spécifique dans les bestsellers
   */
  async getBookRank(bookId: string): Promise<number | null> {
    try {
      // ZREVRANK : Obtient le rang (0-based) dans l'ordre décroissant
      const rank = await redisClient.zRevRank('bestsellers', bookId);

      if (rank !== null) {
        return rank + 1; // Convertir en 1-based
      }

      return null; // Pas dans le top
    } catch (error) {
      console.error('Error getting book rank:', error);
      return null;
    }
  }

  /**
   * Obtenir le score (nombre de commandes) d'un livre
   */
  async getBookScore(bookId: string): Promise<number | null> {
    try {
      const score = await redisClient.zScore('bestsellers', bookId);
      return score !== null ? Math.floor(score) : null;
    } catch (error) {
      console.error('Error getting book score:', error);
      return null;
    }
  }

  /**
   * Obtenir bestsellers par plage de rangs
   */
  async getBestsellersByRange(startRank: number, endRank: number) {
    try {
      // Convert 1-based to 0-based
      const results = await redisClient.zRevRangeWithScores(
        'bestsellers',
        startRank - 1,
        endRank - 1
      );

      const enriched = await this.enrichBestsellers(results);

      return {
        start_rank: startRank,
        end_rank: endRank,
        count: enriched.length,
        books: enriched.map((book, index) => ({
          ...book,
          rank: startRank + index
        }))
      };
    } catch (error) {
      console.error('Error getting bestsellers by range:', error);
      return { count: 0, books: [] };
    }
  }
}
```

## API Controller

```typescript
// controllers/bestseller.controller.ts
import { BestsellerService } from '../services/bestseller.service';

export class BestsellerController {
  private bestsellerService = new BestsellerService();

  /**
   * GET /api/bestsellers?limit=100
   * Lecture ultra-rapide depuis Redis Sorted Set
   */
  async getBestsellers(req: any, res: any) {
    try {
      const limit = Math.min(parseInt(req.query.limit || '100'), 1000);
      const bestsellers = await this.bestsellerService.getBestsellers(limit);

      res.json({
        success: true,
        data: bestsellers
      });

    } catch (error) {
      console.error('Error getting bestsellers:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/books/:bookId/rank
   * Obtenir le rang d'un livre dans les bestsellers
   */
  async getBookRank(req: any, res: any) {
    try {
      const { bookId } = req.params;

      const rank = await this.bestsellerService.getBookRank(bookId);
      const score = await this.bestsellerService.getBookScore(bookId);

      if (rank === null) {
        return res.json({
          success: true,
          data: {
            book_id: bookId,
            in_bestsellers: false,
            message: 'Book is not in top 1000 bestsellers'
          }
        });
      }

      res.json({
        success: true,
        data: {
          book_id: bookId,
          in_bestsellers: true,
          rank,
          order_count: score
        }
      });

    } catch (error) {
      console.error('Error getting book rank:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/bestsellers/range?start=1&end=50
   * Pagination des bestsellers
   */
  async getBestsellersByRange(req: any, res: any) {
    try {
      const start = parseInt(req.query.start || '1');
      const end = parseInt(req.query.end || '50');

      if (start < 1 || end < start || end > 1000) {
        return res.status(400).json({
          error: 'Invalid range. Must be: 1 <= start <= end <= 1000'
        });
      }

      const bestsellers = await this.bestsellerService.getBestsellersByRange(start, end);

      res.json({
        success: true,
        data: bestsellers
      });

    } catch (error) {
      console.error('Error getting bestsellers by range:', error);
      res.status(500).json({ error: error.message });
    }
  }
}
```

## Déploiement Kubernetes

```yaml
# deployments/bestsellers-update-worker.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bestsellers-update-worker
  namespace: bookstore
spec:
  replicas: 2  # HA avec SKIP LOCKED pour éviter doublons
  selector:
    matchLabels:
      app: bestsellers-update-worker
  template:
    metadata:
      labels:
        app: bestsellers-update-worker
        version: v1
    spec:
      nodeSelector:
        workload.type: system

      containers:
      - name: worker
        image: bookstore/bestsellers-update-worker:latest
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "256Mi"
            cpu: "200m"

        env:
        # DBaaS PostgreSQL Main
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

        # Redis in-cluster
        - name: REDIS_HOST
          value: "bookstore-redis-cluster.stateful.svc.cluster.local"
        - name: REDIS_PORT
          value: "6379"
        - name: REDIS_PASSWORD
          valueFrom:
            secretKeyRef:
              name: redis-credentials
              key: password

        # Configuration
        - name: POLL_INTERVAL_MS
          value: "5000"  # 5 secondes
        - name: BATCH_SIZE
          value: "100"
        - name: MAX_BESTSELLERS
          value: "1000"  # Limiter le sorted set

        volumeMounts:
        - name: db-ca-cert
          mountPath: /etc/secrets/db-ca.crt
          subPath: ca.crt

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
          secretName: dbaas-postgresql-main
```

## Comparaison finale : AWS vs Hybride

| Aspect | AWS Bookstore | Architecture Hybride APL/LKE | Identique ? |
|--------|---------------|------------------------------|-------------|
| **Trigger** | DynamoDB Streams | Outbox Pattern (poll 5s) | ⚠️ Quasi (< 5s lag) |
| **Worker** | Lambda UpdateBestSellers | Deployment (Kubernetes) | ✅ Même logique |
| **Redis command** | **ZINCRBY** | **ZINCRBY** | ✅ Identique |
| **Redis structure** | **Sorted Set** | **Sorted Set** | ✅ Identique |
| **Read command** | **ZREVRANGE** | **ZREVRANGE** | ✅ Identique |
| **Performance** | < 1ms | < 1ms | ✅ Identique |
| **Scalability** | Auto (Lambda) | Manual (replicas) | ⚠️ Différent |
| **Cost** | ElastiCache ($50+) + Lambda | Redis in-cluster ($0) | ✅ Meilleur coût |
| **Latency to update** | < 1 seconde | < 5 secondes | ⚠️ Acceptable |
| **Event ordering** | Garanti (Streams) | Garanti (outbox) | ✅ Identique |

## Avantages de cette approche

### ✅ Identique à AWS Bookstore

1. **Redis Sorted Sets** : Structure de données exacte (ZINCRBY/ZREVRANGE)
2. **Event-driven** : Déclenché par les commandes, pas de polling périodique
3. **Incrémental** : Pas besoin de recalculer tous les bestsellers
4. **Temps réel** : < 5 secondes de latence (vs 5 minutes avec CronJob)

### ✅ Améliorations vs AWS

1. **Coût** : Redis in-cluster gratuit (vs ElastiCache $50+/mois)
2. **Fallback** : Automatique vers DBaaS si Redis indisponible
3. **Transactionnel** : Outbox garantit atomicité (order + event en une transaction)
4. **Idempotence** : SKIP LOCKED évite les doublons même avec 2 replicas

### ⚠️ Différences vs AWS

1. **Latence** : ~5 secondes (poll interval) vs < 1s (DynamoDB Streams)
2. **Scaling** : Manuel (replicas) vs Auto (Lambda)

## Métriques Prometheus

```typescript
// monitoring/bestsellers-metrics.ts
import { Counter, Histogram } from 'prom-client';

export const bestsellersEventsProcessed = new Counter({
  name: 'bestsellers_events_processed_total',
  help: 'Total order events processed for bestsellers',
  labelNames: ['status'] // success, error
});

export const bestsellersZincrbyDuration = new Histogram({
  name: 'bestsellers_zincrby_duration_seconds',
  help: 'Duration of ZINCRBY operations',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1]
});

export const bestsellersApiLatency = new Histogram({
  name: 'bestsellers_api_latency_seconds',
  help: 'Latency of bestsellers API requests',
  labelNames: ['endpoint'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1]
});

export const bestsellersUpdateLag = new Histogram({
  name: 'bestsellers_update_lag_seconds',
  help: 'Time between order creation and bestseller update',
  buckets: [1, 5, 10, 30, 60]
});
```

## Conclusion

Cette approche **réplique exactement le pattern AWS Bookstore** en utilisant :
- **Redis Sorted Sets** (ZINCRBY/ZREVRANGE) au lieu de JSON
- **Outbox Pattern** (event-driven) au lieu de DynamoDB Streams
- **Worker continuous** au lieu de Lambda

**Performance identique** (< 1ms lecture), **coût réduit** ($0 pour Redis), **latence acceptable** (< 5s au lieu de < 1s).
