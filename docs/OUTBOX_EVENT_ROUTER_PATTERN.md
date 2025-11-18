# Outbox Event Router Pattern - Workflow Mutualisé

## Problème : Multiplication des workers Outbox

### Architecture actuelle (inefficace)

```
┌─────────────────────────────────────────────────────────────┐
│              DBaaS PostgreSQL Main                           │
│                                                              │
│              outbox_events table                            │
│              - id, event_type, payload, processed           │
└──────────────────┬──────────────┬──────────────┬────────────┘
                   │              │              │
        Poll 5s    │   Poll 5s    │   Poll 5s    │
                   ▼              ▼              ▼
    ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
    │ Search Sync      │ │ Reco Sync        │ │ Bestsellers      │
    │ Worker           │ │ Worker           │ │ Update Worker    │
    │                  │ │                  │ │                  │
    │ Filter:          │ │ Filter:          │ │ Filter:          │
    │ book_created     │ │ order_created    │ │ order_created    │
    │ book_updated     │ │ book_viewed      │ │                  │
    └──────────────────┘ └──────────────────┘ └──────────────────┘
```

**Problèmes** :
- ❌ 3 polls simultanés de la même table (charge DB × 3)
- ❌ Code de polling dupliqué 3 fois
- ❌ Connexions DB multiples
- ❌ Difficile d'ajouter un nouveau consumer

### Architecture mutualisée (optimisée)

```
┌─────────────────────────────────────────────────────────────┐
│              DBaaS PostgreSQL Main                           │
│                                                              │
│              outbox_events table                            │
│              - id, event_type, payload, processed           │
└──────────────────────────────┬─────────────────────────────┘
                                │
                    Poll 5s (UNE FOIS)
                                │
                                ▼
            ┌───────────────────────────────────┐
            │   Outbox Event Router             │
            │   (Central Worker)                │
            │                                   │
            │   - Poll events once              │
            │   - Route to handlers             │
            │   - Mark as processed once        │
            └───────────┬────────┬──────────────┘
                        │        │
            ┌───────────┘        │
            │                    │
            ▼                    ▼                    ▼
    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
    │ Search       │    │ Recommenda   │    │ Bestsellers  │
    │ Handler      │    │ tions        │    │ Handler      │
    │              │    │ Handler      │    │              │
    │ → OpenSearch │    │ → Reco DB    │    │ → Redis      │
    └──────────────┘    └──────────────┘    └──────────────┘
```

**Avantages** :
- ✅ Un seul poll de la table (charge DB / 3)
- ✅ Code centralisé et réutilisable
- ✅ Une seule connexion DB pour polling
- ✅ Facile d'ajouter un nouveau handler
- ✅ Traçabilité centralisée

## Implémentation : Event Router

### Architecture du Router

```typescript
// Structure d'un handler
interface IEventHandler {
  name: string;
  supportedEvents: string[];
  handle(event: OutboxEvent): Promise<void>;
}

// Event Router central
class OutboxEventRouter {
  - handlers: Map<string, IEventHandler[]>
  - pollInterval: 5s

  + registerHandler(handler: IEventHandler)
  + processEvents()
  + routeEvent(event: OutboxEvent)
}
```

### Code complet du Router

```typescript
// workers/outbox-event-router.ts
import { mainDb } from '../config/database';

export interface OutboxEvent {
  id: number;
  event_type: string;
  aggregate_id: string;
  aggregate_type: string;
  payload: any;
  created_at: Date;
}

export interface IEventHandler {
  name: string;
  supportedEvents: string[];
  handle(event: OutboxEvent): Promise<void>;
}

export class OutboxEventRouter {
  private handlers: Map<string, IEventHandler[]> = new Map();
  private isProcessing = false;
  private batchSize = 100;
  private pollInterval = 5000; // 5 secondes

  /**
   * Enregistrer un handler pour certains types d'événements
   */
  registerHandler(handler: IEventHandler) {
    console.log(`📝 Registering handler: ${handler.name}`);
    console.log(`   Supported events: ${handler.supportedEvents.join(', ')}`);

    for (const eventType of handler.supportedEvents) {
      if (!this.handlers.has(eventType)) {
        this.handlers.set(eventType, []);
      }
      this.handlers.get(eventType)!.push(handler);
    }
  }

  /**
   * Démarrer le router
   */
  async start() {
    console.log('🚀 Outbox Event Router started');
    console.log(`📊 Registered handlers for events:`);

    for (const [eventType, handlers] of this.handlers) {
      console.log(`   - ${eventType}: ${handlers.map(h => h.name).join(', ')}`);
    }

    // Poll continu
    setInterval(async () => {
      if (!this.isProcessing) {
        await this.processEvents();
      }
    }, this.pollInterval);
  }

  /**
   * Poll et traite les événements (UNE SEULE FOIS)
   */
  async processEvents() {
    this.isProcessing = true;
    const client = await mainDb.connect();

    try {
      // 1. Poll TOUS les événements non traités (un seul query)
      const result = await client.query(`
        SELECT
          id, event_type, aggregate_id, aggregate_type,
          payload, created_at
        FROM outbox_events
        WHERE processed = false
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `, [this.batchSize]);

      if (result.rows.length === 0) {
        return; // Pas d'événements
      }

      console.log(`📦 Processing ${result.rows.length} events...`);

      // 2. Router chaque événement vers ses handlers
      for (const row of result.rows) {
        const event: OutboxEvent = {
          id: row.id,
          event_type: row.event_type,
          aggregate_id: row.aggregate_id,
          aggregate_type: row.aggregate_type,
          payload: JSON.parse(row.payload),
          created_at: row.created_at
        };

        await this.routeEvent(event);

        // 3. Marquer comme traité (UNE SEULE FOIS)
        await client.query(
          'UPDATE outbox_events SET processed = true, processed_at = NOW() WHERE id = $1',
          [event.id]
        );
      }

      console.log(`✅ Successfully processed ${result.rows.length} events`);

    } catch (error) {
      console.error('❌ Error processing events:', error);
    } finally {
      client.release();
      this.isProcessing = false;
    }
  }

  /**
   * Route un événement vers tous ses handlers
   */
  private async routeEvent(event: OutboxEvent) {
    const handlers = this.handlers.get(event.event_type);

    if (!handlers || handlers.length === 0) {
      console.warn(`⚠️  No handlers registered for event type: ${event.event_type}`);
      return;
    }

    // Exécuter tous les handlers en parallèle
    const promises = handlers.map(async (handler) => {
      try {
        console.log(`   → Routing ${event.event_type} to ${handler.name}`);
        await handler.handle(event);
      } catch (error) {
        console.error(`❌ Error in handler ${handler.name}:`, error);
        // Ne pas throw - continuer avec les autres handlers
        // On peut aussi implémenter un système de retry ici
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Statistiques
   */
  getStats() {
    const stats: any = {
      total_handlers: 0,
      events_with_handlers: this.handlers.size,
      handlers_by_event: {}
    };

    for (const [eventType, handlers] of this.handlers) {
      stats.total_handlers += handlers.length;
      stats.handlers_by_event[eventType] = handlers.map(h => h.name);
    }

    return stats;
  }
}
```

### Handler : Search Sync (OpenSearch)

```typescript
// handlers/search-sync.handler.ts
import { IEventHandler, OutboxEvent } from '../workers/outbox-event-router';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';

const searchClient = new OpenSearchClient({
  node: 'https://bookstore-search-master.stateful.svc.cluster.local:9200',
  auth: {
    username: process.env.OPENSEARCH_USER,
    password: process.env.OPENSEARCH_PASSWORD
  }
});

export class SearchSyncHandler implements IEventHandler {
  name = 'SearchSyncHandler';
  supportedEvents = ['book_created', 'book_updated', 'book_deleted'];

  async handle(event: OutboxEvent): Promise<void> {
    const { event_type, payload } = event;

    switch (event_type) {
      case 'book_created':
      case 'book_updated':
        await this.indexBook(payload);
        break;

      case 'book_deleted':
        await this.deleteBook(payload.id);
        break;
    }
  }

  private async indexBook(book: any) {
    await searchClient.index({
      index: 'books',
      id: book.id,
      body: {
        title: book.title,
        author: book.author,
        category: book.category,
        price: book.price,
        search_text: `${book.title} ${book.author}`,
        indexed_at: new Date().toISOString()
      }
    });

    console.log(`   ✅ SearchSync: Indexed book ${book.id}`);
  }

  private async deleteBook(bookId: string) {
    await searchClient.delete({
      index: 'books',
      id: bookId
    });

    console.log(`   ✅ SearchSync: Deleted book ${bookId}`);
  }
}
```

### Handler : Recommendations Sync

```typescript
// handlers/recommendations-sync.handler.ts
import { IEventHandler, OutboxEvent } from '../workers/outbox-event-router';
import { recoDb } from '../config/database';

export class RecommendationsSyncHandler implements IEventHandler {
  name = 'RecommendationsSyncHandler';
  supportedEvents = [
    'order_created',
    'book_viewed',
    'book_searched',
    'book_added_to_cart',
    'book_created',
    'book_updated'
  ];

  async handle(event: OutboxEvent): Promise<void> {
    const { event_type, payload } = event;

    switch (event_type) {
      case 'book_viewed':
        await this.trackInteraction(payload, 'view', 1.0);
        await this.createGraphViewedEdge(payload);
        break;

      case 'order_created':
        await this.trackInteraction(payload, 'purchase', 10.0);
        await this.createGraphPurchasedEdge(payload);
        break;

      case 'book_searched':
        await this.trackInteraction(payload, 'search', 0.5);
        break;

      case 'book_added_to_cart':
        await this.trackInteraction(payload, 'add_to_cart', 3.0);
        break;

      case 'book_created':
      case 'book_updated':
        await this.syncBookVector(payload);
        await this.upsertGraphBookVertex(payload);
        break;
    }
  }

  private async trackInteraction(data: any, type: string, weight: number) {
    const client = await recoDb.connect();
    try {
      await client.query(`
        INSERT INTO user_interactions (user_id, book_id, interaction_type, interaction_weight, metadata)
        VALUES ($1, $2, $3, $4, $5)
      `, [data.userId, data.bookId, type, weight, JSON.stringify(data.metadata || {})]);

      console.log(`   ✅ RecoSync: Tracked ${type} for user ${data.userId}`);
    } finally {
      client.release();
    }
  }

  private async createGraphViewedEdge(data: any) {
    const client = await recoDb.connect();
    try {
      await client.query('SELECT upsert_user_vertex($1, $2, $3)',
        [data.userId, data.username || 'unknown', data.timestamp]);
      await client.query('SELECT create_viewed_edge($1, $2, $3, $4)',
        [data.userId, data.bookId, data.viewDuration || 0, data.timestamp]);

      console.log(`   ✅ RecoSync: Created VIEWED edge (Apache AGE)`);
    } finally {
      client.release();
    }
  }

  private async createGraphPurchasedEdge(data: any) {
    const client = await recoDb.connect();
    try {
      await client.query('SELECT upsert_user_vertex($1, $2, $3)',
        [data.userId, data.username || 'unknown', data.timestamp]);
      await client.query('SELECT create_purchased_edge($1, $2, $3, $4)',
        [data.userId, data.bookId, data.purchaseAmount || 0, data.timestamp]);

      console.log(`   ✅ RecoSync: Created PURCHASED edge (Apache AGE)`);
    } finally {
      client.release();
    }
  }

  private async syncBookVector(bookData: any) {
    const client = await recoDb.connect();
    try {
      const vector = await this.generateBookEmbedding(bookData);
      await client.query(`
        INSERT INTO book_vectors (book_id, title, author, category, price, content_vector)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (book_id) DO UPDATE SET
          title = EXCLUDED.title, author = EXCLUDED.author,
          category = EXCLUDED.category, price = EXCLUDED.price,
          content_vector = EXCLUDED.content_vector
      `, [bookData.id, bookData.title, bookData.author, bookData.category,
          bookData.price, JSON.stringify(vector)]);

      console.log(`   ✅ RecoSync: Synced book vector for ${bookData.id}`);
    } finally {
      client.release();
    }
  }

  private async upsertGraphBookVertex(bookData: any) {
    const client = await recoDb.connect();
    try {
      await client.query('SELECT upsert_book_vertex($1, $2, $3, $4, $5)',
        [bookData.id, bookData.title, bookData.author, bookData.category, bookData.price]);

      console.log(`   ✅ RecoSync: Upserted Book vertex (Apache AGE)`);
    } finally {
      client.release();
    }
  }

  private async generateBookEmbedding(bookData: any): Promise<number[]> {
    // Placeholder - en prod : appeler service ML
    const text = `${bookData.title} ${bookData.author} ${bookData.category}`;
    return new Array(128).fill(0).map((_, i) =>
      Math.sin(text.charCodeAt(i % text.length) * (i + 1)) * 0.5
    );
  }
}
```

### Handler : Bestsellers Update (Redis)

```typescript
// handlers/bestsellers-update.handler.ts
import { IEventHandler, OutboxEvent } from '../workers/outbox-event-router';
import { redisClient } from '../config/database';

export class BestsellersUpdateHandler implements IEventHandler {
  name = 'BestsellersUpdateHandler';
  supportedEvents = ['order_created'];

  async handle(event: OutboxEvent): Promise<void> {
    const { payload } = event;
    const { book_id, quantity } = payload;

    // ZINCRBY : Incrémente le score du livre dans le sorted set
    const newScore = await redisClient.zIncrBy('bestsellers', quantity, book_id);

    console.log(`   ✅ Bestsellers: ZINCRBY bestsellers ${book_id} ${quantity} → ${newScore}`);

    // Trim aux top 1000
    await this.trimBestsellers();
  }

  private async trimBestsellers() {
    const removed = await redisClient.zRemRangeByRank('bestsellers', 0, -1001);
    if (removed > 0) {
      console.log(`   🧹 Bestsellers: Trimmed ${removed} books (keeping top 1000)`);
    }
  }
}
```

### Entry Point : Configuration du Router

```typescript
// workers/outbox-router-main.ts
import { OutboxEventRouter } from './outbox-event-router';
import { SearchSyncHandler } from '../handlers/search-sync.handler';
import { RecommendationsSyncHandler } from '../handlers/recommendations-sync.handler';
import { BestsellersUpdateHandler } from '../handlers/bestsellers-update.handler';

async function main() {
  console.log('🚀 Starting Outbox Event Router...');

  // Créer le router
  const router = new OutboxEventRouter();

  // Enregistrer tous les handlers
  router.registerHandler(new SearchSyncHandler());
  router.registerHandler(new RecommendationsSyncHandler());
  router.registerHandler(new BestsellersUpdateHandler());

  // Afficher stats
  console.log('📊 Router Stats:', router.getStats());

  // Démarrer le polling
  await router.start();
}

main().catch(console.error);
```

## Déploiement Kubernetes

```yaml
# deployments/outbox-event-router.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: outbox-event-router
  namespace: bookstore
spec:
  replicas: 2  # HA avec SKIP LOCKED
  selector:
    matchLabels:
      app: outbox-event-router
  template:
    metadata:
      labels:
        app: outbox-event-router
        version: v1
    spec:
      nodeSelector:
        workload.type: system

      containers:
      - name: router
        image: bookstore/outbox-event-router:latest
        resources:
          requests:
            memory: "512Mi"
            cpu: "300m"
          limits:
            memory: "1Gi"
            cpu: "1000m"

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

        # DBaaS PostgreSQL Recommendations
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

        # Redis in-cluster
        - name: REDIS_HOST
          value: "bookstore-redis-cluster.stateful.svc.cluster.local"
        - name: REDIS_PASSWORD
          valueFrom:
            secretKeyRef:
              name: redis-credentials
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

        # Configuration
        - name: POLL_INTERVAL_MS
          value: "5000"
        - name: BATCH_SIZE
          value: "100"

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

        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5

      volumes:
      - name: main-db-ca
        secret:
          secretName: dbaas-postgresql-main
      - name: reco-db-ca
        secret:
          secretName: dbaas-postgresql-recommendations
```

## Exemple de logs du Router

```
🚀 Starting Outbox Event Router...
📝 Registering handler: SearchSyncHandler
   Supported events: book_created, book_updated, book_deleted
📝 Registering handler: RecommendationsSyncHandler
   Supported events: order_created, book_viewed, book_searched, book_added_to_cart, book_created, book_updated
📝 Registering handler: BestsellersUpdateHandler
   Supported events: order_created

📊 Router Stats: {
  total_handlers: 3,
  events_with_handlers: 6,
  handlers_by_event: {
    'book_created': ['SearchSyncHandler', 'RecommendationsSyncHandler'],
    'book_updated': ['SearchSyncHandler', 'RecommendationsSyncHandler'],
    'book_deleted': ['SearchSyncHandler'],
    'order_created': ['RecommendationsSyncHandler', 'BestsellersUpdateHandler'],
    'book_viewed': ['RecommendationsSyncHandler'],
    'book_searched': ['RecommendationsSyncHandler'],
    'book_added_to_cart': ['RecommendationsSyncHandler']
  }
}

🚀 Outbox Event Router started
📦 Processing 3 events...
   → Routing order_created to RecommendationsSyncHandler
   ✅ RecoSync: Tracked purchase for user user-123
   ✅ RecoSync: Created PURCHASED edge (Apache AGE)
   → Routing order_created to BestsellersUpdateHandler
   ✅ Bestsellers: ZINCRBY bestsellers book-456 2 → 128
   → Routing book_created to SearchSyncHandler
   ✅ SearchSync: Indexed book book-789
   → Routing book_created to RecommendationsSyncHandler
   ✅ RecoSync: Synced book vector for book-789
   ✅ RecoSync: Upserted Book vertex (Apache AGE)
✅ Successfully processed 3 events
```

## Avantages de la mutualisation

### Performance

| Métrique | 3 Workers séparés | 1 Router mutualisé | Gain |
|----------|-------------------|--------------------|------|
| **Polls DB / 5s** | 3 | 1 | **-66%** |
| **Connexions DB** | 3 | 1 | **-66%** |
| **Code dupliqué** | ~300 lignes × 3 | 0 | **-900 lignes** |
| **Charge CPU** | 3 × 100m = 300m | 300m | **Identique** |
| **Latence** | 5s | 5s | **Identique** |

### Extensibilité

**Ajouter un nouveau consumer** :

Avant (3 workers séparés) :
1. Créer un nouveau worker complet
2. Dupliquer le code de polling
3. Ajouter un nouveau Deployment Kubernetes
4. Gérer la colonne `processed`

Après (Router mutualisé) :
1. Créer un handler (30 lignes)
2. Enregistrer le handler dans le router
3. C'est tout ! ✅

```typescript
// Nouveau handler en 30 lignes
export class EmailNotificationHandler implements IEventHandler {
  name = 'EmailNotificationHandler';
  supportedEvents = ['order_created'];

  async handle(event: OutboxEvent): Promise<void> {
    await sendEmail(event.payload.userEmail, 'Order confirmed!');
    console.log(`   ✅ Email: Sent to ${event.payload.userEmail}`);
  }
}

// Dans outbox-router-main.ts
router.registerHandler(new EmailNotificationHandler()); // Une ligne !
```

### Résilience

**Gestion des erreurs** :
- Si un handler échoue, les autres continuent
- `Promise.allSettled()` garantit l'exécution de tous
- Logs détaillés par handler
- Facile d'ajouter retry logic centralisé

**Monitoring** :
- Un seul endroit pour monitorer le polling
- Métriques centralisées
- Dead letter queue facile à implémenter

## Comparaison finale

| Aspect | 3 Workers séparés | Router mutualisé |
|--------|-------------------|------------------|
| **Polls DB** | 3 toutes les 5s | 1 toutes les 5s ✅ |
| **Code** | ~1500 lignes | ~500 lignes ✅ |
| **Déploiements** | 3 Deployments | 1 Deployment ✅ |
| **Complexité** | Moyenne | Simple ✅ |
| **Extensibilité** | Difficile | Facile ✅ |
| **Monitoring** | 3 endpoints | 1 endpoint ✅ |
| **Performances** | Charge × 3 | Charge / 3 ✅ |

## Recommandation

✅ **Utiliser le Event Router Pattern** :
- Beaucoup plus efficace
- Code centralisé et maintenable
- Facile d'ajouter de nouveaux consumers
- Meilleure utilisation des ressources

Le seul inconvénient : **Single Point of Failure** (résolu par 2 replicas avec SKIP LOCKED).
