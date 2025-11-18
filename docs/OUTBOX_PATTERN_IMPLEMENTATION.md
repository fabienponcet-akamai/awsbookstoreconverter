# 📦 Outbox Pattern - Garantir la Cohérence Éventuelle

## 🎯 Le Problème à Résoudre

### Dual Write Problem

Quand on écrit dans 2 bases de données simultanément, plusieurs problèmes peuvent survenir :

```
┌────────────────────────────────────────────────────────────────┐
│              LE PROBLÈME DU DUAL WRITE                          │
└────────────────────────────────────────────────────────────────┘

Scénario 1 : Crash après le 1er commit
────────────────────────────────────────
  1. ✅ COMMIT bookstore-main (orders)
  2. 💥 CRASH avant COMMIT bookstore-graph
  Result: Incohérence ! Order existe mais pas de relation graph

Scénario 2 : Network failure
────────────────────────────────────────
  1. ✅ COMMIT bookstore-main (orders)
  2. ❌ Network timeout vers bookstore-graph
  Result: Incohérence ! On ne sait pas si le graph a été mis à jour

Scénario 3 : Partial failure
────────────────────────────────────────
  1. ✅ COMMIT bookstore-main (orders)
  2. ❌ Constraint violation dans bookstore-graph
  3. ⚠️ Rollback main ? Trop tard, déjà commité !
  Result: Incohérence permanente
```

### La Solution : Outbox Pattern

**Principe** : Écrire les événements dans une table "outbox" **dans la même transaction** que les données, puis les traiter de manière asynchrone.

```
┌────────────────────────────────────────────────────────────────┐
│                    OUTBOX PATTERN FLOW                          │
└────────────────────────────────────────────────────────────────┘

POST /api/orders
    │
    ▼
┌─────────────────────────────────────────┐
│  BEGIN TRANSACTION (atomic!)            │
│                                         │
│  1. INSERT INTO orders (...)            │
│  2. INSERT INTO outbox_events (...)     │◄─── Same transaction!
│                                         │
│  COMMIT                                 │
└────────────┬────────────────────────────┘
             │
             │ ✅ Guaranteed: Si order existe, event existe aussi
             │
             ▼
┌─────────────────────────────────────────┐
│  Outbox Processor (background worker)  │
│  Polling every 5 seconds                │
└────────────┬────────────────────────────┘
             │
             │ 1. SELECT * FROM outbox_events WHERE processed = false
             │ 2. FOR EACH event: process(event)
             │ 3. Mark event as processed
             │
             ▼
┌─────────────────────────────────────────┐
│  bookstore-graph                        │
│  CREATE (User)-[:PURCHASED]->(Book)     │
└─────────────────────────────────────────┘
```

**Avantages** :
✅ **Cohérence garantie** : Événements et données dans la même transaction ACID
✅ **At-least-once delivery** : Même en cas de crash, l'événement sera traité
✅ **Retry automatique** : Si le traitement échoue, on réessaie plus tard
✅ **Ordering** : Les événements sont traités dans l'ordre
✅ **Debuggable** : Tous les événements sont loggés dans la DB

**Inconvénients** :
⚠️ **Latence** : 5-10 secondes entre l'écriture et le traitement
⚠️ **Complexité** : Besoin d'un worker background
⚠️ **Idempotence requise** : Le traitement doit être idempotent (peut être rejoué)

---

## 🏗️ Architecture Complète

```
┌──────────────────────────────────────────────────────────────────┐
│                  BOOKSTORE OUTBOX ARCHITECTURE                    │
└──────────────────────────────────────────────────────────────────┘

┌─────────────────┐
│  Knative API    │ POST /api/orders
│  (3 replicas)   │
└────────┬────────┘
         │
         │ Writes to main DB only
         │
         ▼
┌────────────────────────────────────────────────────┐
│  bookstore-main (PostgreSQL)                       │
│                                                    │
│  ┌──────────────┐         ┌──────────────────┐   │
│  │ orders       │         │ outbox_events     │   │
│  ├──────────────┤         ├──────────────────┤   │
│  │ id           │         │ id                │   │
│  │ user_id      │         │ aggregate_type    │   │
│  │ book_id      │         │ aggregate_id      │   │
│  │ total        │         │ event_type        │   │
│  │ created_at   │         │ payload (JSONB)   │   │
│  └──────────────┘         │ processed         │   │
│                           │ created_at        │   │
│                           └──────────────────┘   │
└────────────────────────────────────────────────────┘
         ▲                          │
         │                          │ Polling every 5s
         │                          │
         │                          ▼
┌────────┴────────────────────────────────────────────┐
│  Outbox Processor (Deployment, 2 replicas)         │
│                                                     │
│  1. SELECT * FROM outbox_events                    │
│     WHERE processed = false                        │
│     ORDER BY created_at ASC                        │
│     LIMIT 100                                      │
│     FOR UPDATE SKIP LOCKED; ◄─── Prevents conflicts│
│                                                     │
│  2. Process each event (send to graph DB)          │
│                                                     │
│  3. UPDATE outbox_events                           │
│     SET processed = true, processed_at = NOW()     │
│     WHERE id = $1;                                 │
└─────────────────────┬───────────────────────────────┘
                      │
                      │ Writes graph relationships
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│  bookstore-graph (PostgreSQL + Apache AGE)          │
│                                                     │
│  (User)-[:PURCHASED]->(Book)                        │
└─────────────────────────────────────────────────────┘
```

---

## 💾 Schéma de Base de Données

### Table `outbox_events`

```sql
-- k8s/databases/schema/outbox_events.sql
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Aggregate info (for ordering and filtering)
  aggregate_type VARCHAR(50) NOT NULL,  -- 'order', 'user', 'book', etc.
  aggregate_id UUID NOT NULL,           -- ID of the order/user/book

  -- Event info
  event_type VARCHAR(50) NOT NULL,      -- 'order_created', 'order_cancelled', etc.
  payload JSONB NOT NULL,               -- Full event data

  -- Processing status
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP,
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),

  -- For idempotence (optional)
  idempotency_key VARCHAR(100) UNIQUE
);

-- Indexes for performance
CREATE INDEX idx_outbox_unprocessed
  ON outbox_events(created_at)
  WHERE processed = FALSE;

CREATE INDEX idx_outbox_aggregate
  ON outbox_events(aggregate_type, aggregate_id);

CREATE INDEX idx_outbox_event_type
  ON outbox_events(event_type);

-- Partial index for efficient polling
CREATE INDEX idx_outbox_pending
  ON outbox_events(created_at ASC)
  WHERE processed = FALSE AND retry_count < 5;
```

### Exemple de données

```sql
SELECT * FROM outbox_events LIMIT 3;

 id                                   | aggregate_type | aggregate_id                         | event_type      | payload                                                         | processed | created_at
--------------------------------------+----------------+--------------------------------------+-----------------+----------------------------------------------------------------+-----------+-------------------------
 a1b2c3d4-e5f6-7890-abcd-111111111111 | order          | 550e8400-e29b-41d4-a716-446655440000 | order_created   | {"orderId":"550e8400...","userId":"user-123","bookId":"book-456"} | true      | 2024-01-15 10:30:00
 a1b2c3d4-e5f6-7890-abcd-222222222222 | order          | 550e8400-e29b-41d4-a716-446655440001 | order_created   | {"orderId":"550e8400...","userId":"user-789","bookId":"book-789"} | false     | 2024-01-15 10:31:00
 a1b2c3d4-e5f6-7890-abcd-333333333333 | user           | user-999                             | user_registered | {"userId":"user-999","email":"john@example.com"}                  | false     | 2024-01-15 10:32:00
```

---

## 💻 Implémentation Node.js/TypeScript

### 1. Service avec Outbox Pattern

```typescript
// src/services/orderServiceWithOutbox.ts
import { Pool, PoolClient } from 'pg';
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

interface OutboxEvent {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: any;
  idempotencyKey?: string;
}

export class OrderServiceWithOutbox {
  constructor(private mainDb: Pool) {}

  /**
   * Create order with Outbox Pattern
   * Single transaction: order + outbox event
   */
  async createOrder(request: CreateOrderRequest): Promise<Order> {
    const orderId = uuidv4();
    const client = await this.mainDb.connect();

    try {
      // 1. Start transaction
      await client.query('BEGIN');

      logger.info('Creating order with outbox pattern', {
        orderId,
        userId: request.userId,
        bookId: request.bookId
      });

      // 2. Get book price
      const bookResult = await client.query(
        'SELECT price, title FROM books WHERE id = $1',
        [request.bookId]
      );

      if (bookResult.rows.length === 0) {
        throw new Error(`Book not found: ${request.bookId}`);
      }

      const book = bookResult.rows[0];
      const total = parseFloat(book.price) * request.quantity;

      // 3. Insert order into orders table
      const orderResult = await client.query(`
        INSERT INTO orders (id, user_id, book_id, quantity, total, status, created_at)
        VALUES ($1, $2, $3, $4, $5, 'completed', NOW())
        RETURNING *
      `, [orderId, request.userId, request.bookId, request.quantity, total]);

      const order = orderResult.rows[0];

      // 4. Insert event into outbox_events table (SAME TRANSACTION!)
      await this.insertOutboxEvent(client, {
        aggregateType: 'order',
        aggregateId: orderId,
        eventType: 'order_created',
        payload: {
          orderId: orderId,
          userId: request.userId,
          bookId: request.bookId,
          bookTitle: book.title,
          quantity: request.quantity,
          total: total,
          createdAt: order.created_at
        },
        idempotencyKey: `order-${orderId}` // Prevents duplicate processing
      });

      // 5. Commit transaction (both order and event are saved atomically!)
      await client.query('COMMIT');

      logger.info('Order and outbox event created successfully', { orderId });

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
      // 6. Rollback on error
      await client.query('ROLLBACK');
      logger.error('Error creating order, rolled back transaction', {
        error: error.message,
        orderId
      });
      throw error;

    } finally {
      client.release();
    }
  }

  /**
   * Insert event into outbox_events table
   * Must be called within an active transaction
   */
  private async insertOutboxEvent(
    client: PoolClient,
    event: OutboxEvent
  ): Promise<void> {
    await client.query(`
      INSERT INTO outbox_events (
        aggregate_type,
        aggregate_id,
        event_type,
        payload,
        idempotency_key
      ) VALUES ($1, $2, $3, $4, $5)
    `, [
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      JSON.stringify(event.payload),
      event.idempotencyKey
    ]);

    logger.debug('Outbox event inserted', {
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType
    });
  }

  /**
   * Cancel order (also uses outbox pattern)
   */
  async cancelOrder(orderId: string, reason: string): Promise<void> {
    const client = await this.mainDb.connect();

    try {
      await client.query('BEGIN');

      // Update order status
      await client.query(
        `UPDATE orders SET status = 'cancelled' WHERE id = $1`,
        [orderId]
      );

      // Insert cancellation event
      await this.insertOutboxEvent(client, {
        aggregateType: 'order',
        aggregateId: orderId,
        eventType: 'order_cancelled',
        payload: {
          orderId,
          reason,
          cancelledAt: new Date()
        }
      });

      await client.query('COMMIT');
      logger.info('Order cancelled', { orderId, reason });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
```

### 2. Outbox Processor (Background Worker)

```typescript
// src/workers/outboxProcessor.ts
import { Pool } from 'pg';
import logger from '../monitoring/logger';
import { EventHandler } from './eventHandlers';

interface OutboxEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: any;
  retryCount: number;
  createdAt: Date;
}

export class OutboxProcessor {
  private isRunning: boolean = false;
  private intervalId?: NodeJS.Timer;

  constructor(
    private mainDb: Pool,
    private graphDb: Pool,
    private eventHandler: EventHandler,
    private pollingIntervalMs: number = 5000,  // 5 seconds
    private batchSize: number = 100
  ) {}

  /**
   * Start the outbox processor
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Outbox processor already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting outbox processor', {
      pollingInterval: this.pollingIntervalMs,
      batchSize: this.batchSize
    });

    this.intervalId = setInterval(
      () => this.processEvents(),
      this.pollingIntervalMs
    );
  }

  /**
   * Stop the outbox processor
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isRunning = false;
    logger.info('Outbox processor stopped');
  }

  /**
   * Main processing loop
   */
  private async processEvents(): Promise<void> {
    const client = await this.mainDb.connect();

    try {
      // 1. Fetch unprocessed events with row-level locking
      // FOR UPDATE SKIP LOCKED prevents multiple workers from processing same event
      const result = await client.query<OutboxEvent>(`
        SELECT
          id,
          aggregate_type,
          aggregate_id,
          event_type,
          payload,
          retry_count,
          created_at
        FROM outbox_events
        WHERE processed = FALSE
          AND retry_count < 5  -- Max 5 retries
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `, [this.batchSize]);

      const events = result.rows;

      if (events.length === 0) {
        return; // No events to process
      }

      logger.info(`Processing ${events.length} outbox events`);

      // 2. Process each event
      for (const event of events) {
        await this.processEvent(client, event);
      }

    } catch (error) {
      logger.error('Error in outbox processor', { error: error.message });
    } finally {
      client.release();
    }
  }

  /**
   * Process a single event
   */
  private async processEvent(client: any, event: OutboxEvent): Promise<void> {
    try {
      logger.debug('Processing event', {
        eventId: event.id,
        eventType: event.eventType,
        aggregateId: event.aggregateId
      });

      // Parse payload
      const payload = typeof event.payload === 'string'
        ? JSON.parse(event.payload)
        : event.payload;

      // Handle the event (write to graph DB, send notification, etc.)
      await this.eventHandler.handle(event.eventType, payload);

      // Mark as processed
      await client.query(`
        UPDATE outbox_events
        SET
          processed = TRUE,
          processed_at = NOW()
        WHERE id = $1
      `, [event.id]);

      logger.info('Event processed successfully', {
        eventId: event.id,
        eventType: event.eventType
      });

    } catch (error) {
      logger.error('Error processing event', {
        eventId: event.id,
        eventType: event.eventType,
        error: error.message
      });

      // Increment retry count and store error
      await client.query(`
        UPDATE outbox_events
        SET
          retry_count = retry_count + 1,
          last_error = $2
        WHERE id = $1
      `, [event.id, error.message]);

      // If max retries reached, mark as failed
      if (event.retryCount >= 4) {
        logger.error('Event failed after max retries', {
          eventId: event.id,
          eventType: event.eventType,
          retries: event.retryCount + 1
        });
      }
    }
  }
}
```

### 3. Event Handlers

```typescript
// src/workers/eventHandlers.ts
import { Pool } from 'pg';
import logger from '../monitoring/logger';

export class EventHandler {
  constructor(private graphDb: Pool) {}

  /**
   * Route event to appropriate handler
   */
  async handle(eventType: string, payload: any): Promise<void> {
    switch (eventType) {
      case 'order_created':
        await this.handleOrderCreated(payload);
        break;

      case 'order_cancelled':
        await this.handleOrderCancelled(payload);
        break;

      case 'user_registered':
        await this.handleUserRegistered(payload);
        break;

      default:
        logger.warn(`Unknown event type: ${eventType}`);
    }
  }

  /**
   * Handle order_created event
   * Create graph relationship: (User)-[:PURCHASED]->(Book)
   */
  private async handleOrderCreated(payload: any): Promise<void> {
    const { orderId, userId, bookId, quantity, total } = payload;

    const graphClient = await this.graphDb.connect();

    try {
      // Prepare Apache AGE
      await graphClient.query(`LOAD 'age';`);
      await graphClient.query(`SET search_path = ag_catalog, "$user", public;`);

      // Create relationship
      const cypher = `
        SELECT * FROM cypher('recommendations', $$
          MERGE (u:User {id: '${userId}'})
          MERGE (b:Book {id: '${bookId}'})
          CREATE (u)-[p:PURCHASED {
            order_id: '${orderId}',
            quantity: ${quantity},
            total: ${total},
            purchased_at: timestamp()
          }]->(b)
          RETURN p
        $$) as (purchase agtype);
      `;

      await graphClient.query(cypher);

      logger.info('Graph relationship created', { orderId, userId, bookId });

    } finally {
      graphClient.release();
    }
  }

  /**
   * Handle order_cancelled event
   * Delete graph relationship
   */
  private async handleOrderCancelled(payload: any): Promise<void> {
    const { orderId } = payload;

    const graphClient = await this.graphDb.connect();

    try {
      await graphClient.query(`LOAD 'age';`);
      await graphClient.query(`SET search_path = ag_catalog, "$user", public;`);

      const cypher = `
        SELECT * FROM cypher('recommendations', $$
          MATCH ()-[p:PURCHASED {order_id: '${orderId}'}]->()
          DELETE p
        $$) as (result agtype);
      `;

      await graphClient.query(cypher);

      logger.info('Graph relationship deleted', { orderId });

    } finally {
      graphClient.release();
    }
  }

  /**
   * Handle user_registered event
   * Create user node in graph
   */
  private async handleUserRegistered(payload: any): Promise<void> {
    const { userId, email, name } = payload;

    const graphClient = await this.graphDb.connect();

    try {
      await graphClient.query(`LOAD 'age';`);
      await graphClient.query(`SET search_path = ag_catalog, "$user", public;`);

      const cypher = `
        SELECT * FROM cypher('recommendations', $$
          CREATE (u:User {
            id: '${userId}',
            email: '${email}',
            name: '${name}',
            created_at: timestamp()
          })
          RETURN u
        $$) as (user agtype);
      `;

      await graphClient.query(cypher);

      logger.info('User node created in graph', { userId });

    } finally {
      graphClient.release();
    }
  }
}
```

### 4. Main Application

```typescript
// src/index.ts
import express from 'express';
import { Pool } from 'pg';
import { OrderServiceWithOutbox } from './services/orderServiceWithOutbox';
import { OutboxProcessor } from './workers/outboxProcessor';
import { EventHandler } from './workers/eventHandlers';

const app = express();
app.use(express.json());

// Database connections
const mainDb = new Pool({
  host: process.env.MAIN_DB_HOST || 'bookstore-main-rw.bookstore.svc.cluster.local',
  port: 5432,
  database: 'bookstore',
  user: 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  max: 20
});

const graphDb = new Pool({
  host: process.env.GRAPH_DB_HOST || 'bookstore-graph-rw.bookstore.svc.cluster.local',
  port: 5432,
  database: 'bookstore_graph',
  user: 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  max: 10
});

// Services
const orderService = new OrderServiceWithOutbox(mainDb);

// Outbox processor (only start on worker pods, not API pods)
let outboxProcessor: OutboxProcessor | null = null;

if (process.env.ENABLE_OUTBOX_PROCESSOR === 'true') {
  const eventHandler = new EventHandler(graphDb);
  outboxProcessor = new OutboxProcessor(
    mainDb,
    graphDb,
    eventHandler,
    parseInt(process.env.OUTBOX_POLLING_INTERVAL || '5000'),
    parseInt(process.env.OUTBOX_BATCH_SIZE || '100')
  );
  outboxProcessor.start();
}

// Routes
app.post('/api/orders', async (req, res) => {
  try {
    const { userId, bookId, quantity } = req.body;

    if (!userId || !bookId || !quantity || quantity < 1) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const order = await orderService.createOrder({ userId, bookId, quantity });

    res.status(201).json(order);

  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

app.delete('/api/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    await orderService.cancelOrder(orderId, reason || 'Customer request');

    res.status(200).json({ message: 'Order cancelled' });

  } catch (error) {
    console.error('Error cancelling order:', error);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await mainDb.query('SELECT 1');
    res.json({ status: 'healthy', outboxProcessor: outboxProcessor ? 'running' : 'disabled' });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (outboxProcessor) {
    outboxProcessor.stop();
  }
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Outbox processor: ${outboxProcessor ? 'enabled' : 'disabled'}`);
});
```

---

## 🚀 Déploiement Kubernetes

### 1. API Pods (sans outbox processor)

```yaml
# k8s/api/bookstore-api.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: bookstore-api
  namespace: bookstore
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/min-scale: "2"
        autoscaling.knative.dev/max-scale: "10"
    spec:
      containers:
      - image: registry.bookstore.example.com/bookstore-api:v1.0.0
        ports:
        - containerPort: 3000
        env:
        - name: ENABLE_OUTBOX_PROCESSOR
          value: "false"  # API pods don't process outbox
        - name: MAIN_DB_HOST
          value: "bookstore-main-rw.bookstore.svc.cluster.local"
        - name: GRAPH_DB_HOST
          value: "bookstore-graph-rw.bookstore.svc.cluster.local"
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: bookstore-pg-credentials
              key: password
        resources:
          requests:
            cpu: 200m
            memory: 256Mi
          limits:
            cpu: 1000m
            memory: 512Mi
```

### 2. Outbox Processor Pods (dédié)

```yaml
# k8s/workers/outbox-processor.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: outbox-processor
  namespace: bookstore
  labels:
    app: outbox-processor
spec:
  replicas: 2  # Multiple workers for HA
  selector:
    matchLabels:
      app: outbox-processor
  template:
    metadata:
      labels:
        app: outbox-processor
    spec:
      containers:
      - name: processor
        image: registry.bookstore.example.com/bookstore-api:v1.0.0
        env:
        - name: ENABLE_OUTBOX_PROCESSOR
          value: "true"  # Enable outbox processing
        - name: OUTBOX_POLLING_INTERVAL
          value: "5000"  # 5 seconds
        - name: OUTBOX_BATCH_SIZE
          value: "100"
        - name: MAIN_DB_HOST
          value: "bookstore-main-rw.bookstore.svc.cluster.local"
        - name: GRAPH_DB_HOST
          value: "bookstore-graph-rw.bookstore.svc.cluster.local"
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: bookstore-pg-credentials
              key: password
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
```

---

## 📊 Monitoring et Observabilité

### 1. Prometheus Metrics

```typescript
// src/monitoring/outboxMetrics.ts
import promClient from 'prom-client';

export const outboxMetrics = {
  // Events processed
  eventsProcessed: new promClient.Counter({
    name: 'outbox_events_processed_total',
    help: 'Total number of outbox events processed',
    labelNames: ['event_type', 'status']
  }),

  // Processing duration
  processingDuration: new promClient.Histogram({
    name: 'outbox_processing_duration_seconds',
    help: 'Duration of outbox event processing',
    labelNames: ['event_type'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10]
  }),

  // Pending events gauge
  pendingEvents: new promClient.Gauge({
    name: 'outbox_pending_events',
    help: 'Number of pending outbox events'
  }),

  // Failed events
  failedEvents: new promClient.Counter({
    name: 'outbox_events_failed_total',
    help: 'Total number of failed outbox events',
    labelNames: ['event_type', 'error']
  })
};

// Update pending events gauge periodically
export async function updatePendingEventsMetric(db: Pool) {
  const result = await db.query(`
    SELECT COUNT(*) as count
    FROM outbox_events
    WHERE processed = FALSE
  `);
  outboxMetrics.pendingEvents.set(parseInt(result.rows[0].count));
}
```

### 2. Grafana Dashboard

```json
{
  "dashboard": {
    "title": "Outbox Pattern - Monitoring",
    "panels": [
      {
        "title": "Events Processing Rate",
        "targets": [
          {
            "expr": "rate(outbox_events_processed_total[5m])",
            "legendFormat": "{{event_type}} - {{status}}"
          }
        ]
      },
      {
        "title": "Pending Events",
        "targets": [
          {
            "expr": "outbox_pending_events"
          }
        ]
      },
      {
        "title": "Processing Duration (p95)",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(outbox_processing_duration_seconds_bucket[5m]))",
            "legendFormat": "{{event_type}}"
          }
        ]
      },
      {
        "title": "Failed Events",
        "targets": [
          {
            "expr": "rate(outbox_events_failed_total[5m])",
            "legendFormat": "{{event_type}}"
          }
        ]
      }
    ]
  }
}
```

### 3. Alerting Rules

```yaml
# k8s/monitoring/outbox-alerts.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: outbox-alerts
  namespace: bookstore
spec:
  groups:
  - name: outbox
    rules:
    - alert: OutboxPendingEventsTooHigh
      expr: outbox_pending_events > 1000
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "Too many pending outbox events"
        description: "{{ $value }} events pending (threshold: 1000)"

    - alert: OutboxProcessingLagHigh
      expr: |
        max(time() - outbox_oldest_pending_event_timestamp) > 300
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: "Outbox processing lag too high"
        description: "Oldest event is {{ $value }} seconds old (threshold: 300s)"

    - alert: OutboxFailureRateHigh
      expr: |
        rate(outbox_events_failed_total[5m]) > 0.1
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: "High outbox event failure rate"
        description: "{{ $value }} events/sec failing"
```

---

## 🔧 Maintenance et Recovery

### 1. Script de Nettoyage

```sql
-- cleanup_old_outbox_events.sql
-- Run daily via CronJob

DELETE FROM outbox_events
WHERE processed = TRUE
  AND processed_at < NOW() - INTERVAL '7 days';

-- Archive failed events (optional)
INSERT INTO outbox_events_failed_archive
SELECT * FROM outbox_events
WHERE processed = FALSE
  AND retry_count >= 5
  AND created_at < NOW() - INTERVAL '24 hours';

DELETE FROM outbox_events
WHERE processed = FALSE
  AND retry_count >= 5
  AND created_at < NOW() - INTERVAL '24 hours';
```

### 2. Manual Retry

```bash
# Reset failed events for retry
kubectl exec -n bookstore bookstore-main-1 -- \
  psql -U postgres -d bookstore <<EOF
UPDATE outbox_events
SET
  processed = FALSE,
  retry_count = 0,
  last_error = NULL
WHERE id IN (
  SELECT id FROM outbox_events
  WHERE processed = FALSE
    AND retry_count >= 5
  LIMIT 100
);
EOF
```

---

## 📊 Comparaison : Dual Write vs Outbox Pattern

| Aspect | Dual Write | Outbox Pattern |
|--------|------------|----------------|
| **Cohérence** | ❌ Pas garantie (2 transactions) | ✅ Garantie (1 transaction ACID) |
| **Latence** | Immédiate (~50ms) | Éventuelle (~5-10s) |
| **Complexité** | Moyenne (code applicatif) | Élevée (worker background) |
| **Résilience** | ❌ Perte d'événements possible | ✅ At-least-once delivery |
| **Rollback** | ⚠️ Manuel (saga pattern) | ✅ Automatique (transaction) |
| **Ordering** | ⚠️ Pas garanti | ✅ Garanti (ORDER BY created_at) |
| **Debuggabilité** | ❌ Événements non loggés | ✅ Tous les événements en DB |
| **Idempotence requise** | Oui | Oui |
| **Scalabilité** | Linéaire | Linéaire (workers horizontaux) |
| **Monitoring** | Logs applicatifs | Métriques DB + Prometheus |

---

## ✅ Recommandations

### Utiliser Outbox Pattern pour :
✅ **Événements critiques** (commandes, paiements, inscriptions)
✅ **Intégrations externes** (notifications, webhooks)
✅ **Audit trail** (besoin de tracer tous les événements)
✅ **Systèmes distribués** (microservices, event-driven)

### Utiliser Dual Write pour :
✅ **Latence critique** (< 100ms requis)
✅ **Données non critiques** (analytics, cache)
✅ **Prototypes/MVP** (simplicité)

---

**Prochaines étapes** :
1. Implémenter l'Outbox Pattern dans bookstore-api
2. Déployer le worker outbox-processor
3. Configurer le monitoring Prometheus/Grafana
4. Tester la résilience (crash tests, network failures)
5. Configurer le cleanup automatique (CronJob)
