# PostgreSQL Logical Decoding vs Outbox Pattern

## Executive Summary

**PostgreSQL Logical Decoding** is the native PostgreSQL feature that enables Change Data Capture (CDC) by streaming changes from the Write-Ahead Log (WAL). While it's powerful, **it's not recommended for this use case** due to managed DBaaS limitations and operational complexity.

**Recommendation: Stick with Outbox Pattern** ✅

---

## What is PostgreSQL Logical Decoding?

**Logical Decoding** is a PostgreSQL native feature that:
- Streams row-level changes from the WAL (Write-Ahead Log)
- Provides a structured view of transactions
- Enables building custom replication solutions
- Powers tools like Debezium and AWS DMS

**Technical Overview:**
```
INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com');

PostgreSQL Process:
1. Write to WAL (physical format)
2. Logical decoding plugin converts to logical format
3. Output stream contains: table, operation, before/after values
4. Consumer reads from replication slot
```

**Output Format (using pgoutput plugin):**
```json
{
  "schema": "public",
  "table": "users",
  "operation": "INSERT",
  "after": {
    "id": 123,
    "name": "Alice",
    "email": "alice@example.com",
    "created_at": "2025-11-19T10:30:00Z"
  }
}
```

---

## Architecture Comparison

### Current: Outbox Pattern

```
┌─────────────────────────────────────────────┐
│         Managed DBaaS PostgreSQL             │
│                                              │
│  ┌──────────┐      ┌──────────────────┐    │
│  │  users   │──┐   │                  │    │
│  │  books   │  │   │  outbox_events   │    │
│  │  orders  │  └──→│  (triggers)      │    │
│  └──────────┘      └──────────────────┘    │
│                             │                │
└─────────────────────────────┼────────────────┘
                              │
                    Poll every 1s
                              │
                              ▼
                   ┌──────────────────┐
                   │  Event Router    │
                   │  (App Worker)    │
                   └────┬──────┬──────┘
                        │      │
          ┌─────────────┘      └──────────┐
          ▼                                ▼
     ┌────────┐  ┌──────────┐  ┌─────────────┐
     │ Search │  │   Reco   │  │ Bestsellers │
     └────────┘  └──────────┘  └─────────────┘
```

**How it works:**
1. App writes to `users` table
2. Trigger fires, writes to `outbox_events`
3. Event Router polls outbox every 1 second
4. Routes events to handlers
5. Handlers update downstream systems

### Alternative: PostgreSQL Logical Decoding

```
┌─────────────────────────────────────────────┐
│         Managed DBaaS PostgreSQL             │
│                                              │
│  ┌──────────┐                               │
│  │  users   │────┐                          │
│  │  books   │    │                          │
│  │  orders  │    │ ALL writes               │
│  └──────────┘    │                          │
│                  ↓                          │
│            PostgreSQL WAL                   │
│        (Write-Ahead Log)                    │
│                  │                          │
│  ┌───────────────────────────────────┐     │
│  │  Logical Decoding Output Plugin   │     │
│  │  (pgoutput, wal2json, etc.)       │     │
│  └───────────────┬───────────────────┘     │
│                  │                          │
│  ┌───────────────────────────────────┐     │
│  │  Replication Slot                 │     │
│  │  "bookstore_slot"                 │     │
│  │  (holds WAL position)             │     │
│  └───────────────┬───────────────────┘     │
└──────────────────┼──────────────────────────┘
                   │ Stream changes
                   │ (via replication protocol)
                   ▼
         ┌──────────────────────┐
         │  WAL Consumer        │
         │  (Custom Worker)     │
         │                      │
         │  - Connects to slot  │
         │  - Reads WAL stream  │
         │  - Parses changes    │
         │  - Routes to handlers│
         └──────────┬───────────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
    ┌────────┐ ┌────────┐ ┌─────────┐
    │ Search │ │  Reco  │ │  Best   │
    └────────┘ └────────┘ └─────────┘
```

**How it works:**
1. App writes to `users` table
2. PostgreSQL writes to WAL (always happens)
3. Logical decoding plugin converts WAL to logical format
4. WAL consumer reads from replication slot
5. Consumer parses and routes to handlers
6. Handlers update downstream systems

---

## Detailed Comparison

### 1. Managed DBaaS Compatibility ⚠️

| Aspect | Outbox Pattern | Logical Decoding |
|--------|----------------|------------------|
| **Requirements** | CREATE TRIGGER (standard) | Replication privileges + slot creation |
| **Configuration** | None | `wal_level=logical` (PostgreSQL restart) |
| **Permissions** | Standard user | `REPLICATION` role or superuser |
| **DBaaS Support** | ✅ Universal | ⚠️ Often restricted |
| **Linode Managed** | ✅ Confirmed | ❓ Need to check |
| **Akamai Managed** | ✅ Confirmed | ❓ Need to check |

**Critical Question for Linode/Akamai:**
```sql
-- Can you run these commands on managed DBaaS?

-- 1. Check WAL level (must be 'logical')
SHOW wal_level;
-- If not 'logical', need: ALTER SYSTEM SET wal_level = 'logical';

-- 2. Create replication slot
SELECT * FROM pg_create_logical_replication_slot(
  'bookstore_slot',
  'pgoutput'
);

-- 3. Create publication
CREATE PUBLICATION bookstore_pub FOR TABLE users, books, orders;

-- 4. Grant replication permission
GRANT REPLICATION ON DATABASE bookstore TO app_user;
```

**If ANY of these fail → Logical Decoding is blocked → Must use Outbox** ❌

**Verdict: Outbox guaranteed to work** ✅

### 2. Implementation Complexity

| Aspect | Outbox Pattern | Logical Decoding |
|--------|----------------|------------------|
| **Code to Write** | ~500 lines total | ~1500 lines total |
| **Database Setup** | CREATE TABLE + TRIGGER | ALTER SYSTEM + SLOT + PUBLICATION |
| **Worker Logic** | Simple SQL polling | WAL protocol + parsing |
| **Error Handling** | Retry UPDATE | Replication slot management |
| **Libraries Needed** | `pg` (standard) | `pg-logical-replication` or custom |
| **Learning Curve** | Low (SQL + polling) | High (WAL internals) |
| **Debugging** | Query outbox table | Inspect WAL stream |

**Example: Outbox Polling (Simple)**
```typescript
// Poll outbox every 1 second
const events = await client.query(`
  SELECT id, event_type, payload
  FROM outbox_events
  WHERE processed_at IS NULL
  ORDER BY created_at ASC
  LIMIT 100
  FOR UPDATE SKIP LOCKED
`);

for (const event of events.rows) {
  await processEvent(event);
  await client.query(
    'UPDATE outbox_events SET processed_at = NOW() WHERE id = $1',
    [event.id]
  );
}
```

**Example: Logical Decoding (Complex)**
```typescript
import { LogicalReplicationService } from 'pg-logical-replication';

const service = new LogicalReplicationService({
  host: 'managed-postgres.linode.com',
  port: 5432,
  user: 'replication_user',
  password: process.env.DB_PASSWORD,
});

// Create replication slot if not exists
await service.createReplicationSlot('bookstore_slot', 'pgoutput');

// Subscribe to changes
service.on('data', async (lsn, log) => {
  if (log.tag === 'insert' || log.tag === 'update') {
    const { table, new: newRow } = log;

    if (table === 'users') {
      await handleUserChange(newRow);
    } else if (table === 'books') {
      await handleBookChange(newRow);
    } else if (table === 'orders') {
      await handleOrderChange(newRow);
    }

    // Acknowledge LSN to advance replication slot
    await service.acknowledge(lsn);
  }
});

// Start streaming
await service.subscribe('bookstore_pub', 'bookstore_slot');
```

**Issues with Logical Decoding:**
- Must handle LSN (Log Sequence Number) tracking
- Replication slot can grow indefinitely if consumer fails
- Need to manually filter tables (captures ALL changes)
- WAL protocol is low-level and brittle
- Reconnection logic is complex

**Verdict: Outbox is much simpler** ✅

### 3. Performance

| Aspect | Outbox Pattern | Logical Decoding |
|--------|----------------|------------------|
| **Latency** | 1-2 seconds (poll interval) | <100ms (real-time) |
| **Throughput** | ~10K events/sec | ~50K events/sec |
| **DB Load** | Polling SELECT + UPDATE | WAL streaming (minimal DB impact) |
| **Table Writes** | Extra INSERT to outbox | No extra writes |
| **Transaction Size** | +1 row per transaction | No overhead |
| **Filtering** | SQL WHERE clause | Must filter in application |

**Outbox Overhead:**
```sql
BEGIN;
  INSERT INTO orders (...);  -- Your data
  -- Trigger fires:
  INSERT INTO outbox_events (...);  -- +1 extra write
COMMIT;
```

**Logical Decoding (No Overhead):**
```sql
BEGIN;
  INSERT INTO orders (...);  -- Your data only
COMMIT;
-- WAL is written anyway (for crash recovery)
-- Logical decoding just reads existing WAL
```

**But...**
- For your use case: 1-2 second latency is **acceptable**
- Extra outbox INSERT is **negligible** for e-commerce scale
- Recommendations don't need <100ms updates

**Verdict: Logical Decoding faster, but outbox adequate** ⚖️

### 4. Operational Concerns

| Aspect | Outbox Pattern | Logical Decoding |
|--------|----------------|------------------|
| **Monitoring** | Query outbox table | Monitor replication lag + slot size |
| **Debugging** | SELECT * FROM outbox_events | Parse WAL stream |
| **Failed Events** | Visible in outbox table | Need custom tracking |
| **Backpressure** | Events queue in DB | WAL grows, disk pressure |
| **Recovery** | Re-process from outbox | Reset replication slot |
| **Cleanup** | DELETE old events | WAL auto-cleanup (if slot advancing) |
| **Disk Risk** | Outbox table growth | WAL disk full (critical!) |

**Major Risk with Logical Decoding:**

If your WAL consumer stops or falls behind:
```
PostgreSQL WAL keeps growing → Disk fills up → DATABASE STOPS ❌
```

You **must** monitor:
```sql
-- Check replication slot lag
SELECT
  slot_name,
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) as lag,
  active
FROM pg_replication_slots
WHERE slot_name = 'bookstore_slot';

-- If lag > 10GB → URGENT: Consumer is stuck
-- If lag > 50GB → CRITICAL: Disk filling up
```

**Outbox Risk (Much Lower):**
```sql
-- Worst case: outbox table grows
SELECT
  pg_size_pretty(pg_total_relation_size('outbox_events')) as size,
  COUNT(*) as pending_events
FROM outbox_events
WHERE processed_at IS NULL;

-- Fix: Scale worker, increase poll frequency, or manual cleanup
-- Database keeps running normally ✅
```

**Verdict: Outbox much safer operationally** ✅

### 5. Event Filtering & Transformation

| Aspect | Outbox Pattern | Logical Decoding |
|--------|----------------|------------------|
| **Filter Events** | SQL WHERE in trigger | Application code |
| **Transform Data** | In trigger or handler | Application code |
| **Event Types** | Custom (order_created) | Generic (INSERT/UPDATE/DELETE) |
| **Payload Format** | Custom JSON | Fixed schema (before/after) |
| **Metadata** | Custom fields | LSN, timestamp, transaction ID |

**Outbox: Semantic Events**
```sql
-- Trigger creates meaningful events
INSERT INTO outbox_events (event_type, aggregate_type, payload)
VALUES (
  'book_purchased',  -- Clear intent
  'order',
  jsonb_build_object(
    'userId', NEW.user_id,
    'bookId', NEW.book_id,
    'price', NEW.price,
    'purchaseDate', NEW.created_at
  )
);
```

**Logical Decoding: Technical Events**
```json
{
  "action": "INSERT",
  "schema": "public",
  "table": "orders",
  "columns": [
    {"name": "id", "type": "integer", "value": 123},
    {"name": "user_id", "type": "integer", "value": 456},
    {"name": "book_id", "type": "integer", "value": 789},
    {"name": "status", "type": "text", "value": "pending"},
    {"name": "created_at", "type": "timestamp", "value": "2025-11-19T10:30:00Z"}
  ]
}
```

Then you need to transform:
```typescript
// Application must derive intent
if (log.table === 'orders' && log.action === 'INSERT') {
  if (log.columns.find(c => c.name === 'status')?.value === 'completed') {
    // Infer this is a purchase event
    await handlePurchase({
      userId: log.columns.find(c => c.name === 'user_id').value,
      bookId: log.columns.find(c => c.name === 'book_id').value,
      // ... extract all fields manually
    });
  }
}
```

**Verdict: Outbox provides better event semantics** ✅

### 6. Transaction Boundaries

| Aspect | Outbox Pattern | Logical Decoding |
|--------|----------------|------------------|
| **Transactional** | ✅ Same TX as data | ✅ WAL is transactional |
| **Rollback Handling** | ✅ Auto (trigger in TX) | ✅ Auto (WAL only has commits) |
| **Multi-table TX** | ✅ Multiple events in one TX | ✅ Grouped by transaction ID |
| **Ordering** | ✅ By created_at | ✅ By LSN (WAL position) |

**Example: Multi-table Transaction**

```sql
BEGIN;
  INSERT INTO orders (...);                  -- Order created
  UPDATE books SET stock = stock - 1 ...;    -- Stock reduced
  INSERT INTO order_items (...);             -- Line items added
COMMIT;
```

**Outbox Result:**
```sql
-- All 3 events in outbox, same TX, atomic
outbox_events:
  id | event_type        | aggregate_id | created_at
  ---+-------------------+--------------+-------------------
  1  | order_created     | order-123    | 2025-11-19 10:30:00
  2  | book_stock_update | book-456     | 2025-11-19 10:30:00
  3  | line_item_added   | item-789     | 2025-11-19 10:30:00
```

**Logical Decoding Result:**
```
WAL Stream:
  LSN         | Table       | Action | TX ID
  ------------+-------------+--------+-------
  0/16B2C78  | orders      | INSERT | 1001
  0/16B2C90  | books       | UPDATE | 1001
  0/16B2CA8  | order_items | INSERT | 1001
```

Both preserve transaction boundaries ✅

### 7. Schema Evolution

| Aspect | Outbox Pattern | Logical Decoding |
|--------|----------------|------------------|
| **Add Column** | Update trigger | WAL auto-includes |
| **Remove Column** | Update trigger | WAL auto-excludes |
| **Rename Column** | Update trigger | Breaking change |
| **Change Type** | Update trigger | Breaking change |
| **Consumer Impact** | Controlled via payload | Must handle schema changes |

**Outbox: Controlled Schema**
```sql
-- Add column to orders table
ALTER TABLE orders ADD COLUMN discount DECIMAL;

-- Update trigger to include in event
CREATE OR REPLACE FUNCTION publish_order_event()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO outbox_events (payload)
  VALUES (jsonb_build_object(
    'userId', NEW.user_id,
    'discount', NEW.discount  -- Explicitly add
  ));
END;
$$ LANGUAGE plpgsql;
```

You control what goes into events → **Versioned events** possible

**Logical Decoding: Automatic Schema**
```
-- Add column
ALTER TABLE orders ADD COLUMN discount DECIMAL;

-- WAL stream automatically includes new column
-- All consumers immediately see it
-- No control over versioning ⚠️
```

**Verdict: Outbox gives better schema control** ✅

---

## Managed DBaaS Compatibility Deep Dive

### Typical Restrictions on Managed PostgreSQL

**What managed providers usually allow:**
- ✅ CREATE TABLE, INDEX, TRIGGER
- ✅ Standard user permissions
- ✅ Most extensions (pg_stat_statements, etc.)

**What managed providers often restrict:**
- ❌ ALTER SYSTEM (config changes)
- ❌ Superuser access
- ❌ REPLICATION role
- ❌ File system access
- ❌ Custom compiled extensions

### Logical Decoding Requirements

```sql
-- 1. Check if wal_level is logical
SHOW wal_level;
-- Expected: 'logical'
-- If 'replica' or 'minimal' → Need ALTER SYSTEM

-- 2. Try to create replication slot
SELECT * FROM pg_create_logical_replication_slot('test_slot', 'pgoutput');
-- If error "permission denied" → Not allowed

-- 3. Check if replication role exists
SELECT rolname, rolreplication FROM pg_roles WHERE rolname = current_user;
-- If rolreplication = false → Need REPLICATION privilege

-- 4. Try to create publication
CREATE PUBLICATION test_pub FOR TABLE users;
-- If error → Publications not allowed
```

### Linode Managed PostgreSQL Specifics

**Need to verify:**
```bash
# 1. Check Linode documentation
# https://www.linode.com/docs/products/databases/managed-databases/

# 2. Contact Linode support to ask:
- Is wal_level set to 'logical'?
- Can I create replication slots?
- Can I get REPLICATION role?
- Are publications supported?

# 3. Test on dev instance
# Create test managed DB and try the SQL above
```

**Likely answer**: Most managed providers **restrict** replication slots because:
- Security concern (replication can read all data)
- Operational risk (slots can fill disk)
- Backup/HA complexity

### Akamai Managed PostgreSQL

Same questions as Linode. Likely also restricted.

### If Logical Decoding is Blocked

**Your options:**
1. ✅ **Use Outbox Pattern** (recommended)
2. ❌ Self-host PostgreSQL (defeats purpose of managed DB)
3. ❌ Use different managed provider (AWS RDS, GCP CloudSQL support it)
4. ❌ Debezium with Kafka (adds huge complexity)

**Verdict: Outbox is the safe, portable choice** ✅

---

## Implementation Comparison

### Outbox Pattern Implementation

**Database Setup** (5 minutes):
```sql
-- Create outbox table
CREATE TABLE outbox_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP
);

CREATE INDEX idx_outbox_pending
  ON outbox_events(created_at)
  WHERE processed_at IS NULL;

-- Create trigger
CREATE OR REPLACE FUNCTION publish_order_event()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.status = 'completed') THEN
    INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
    VALUES (
      'book_purchased',
      'order',
      NEW.id::TEXT,
      jsonb_build_object(
        'userId', NEW.user_id,
        'bookId', NEW.book_id,
        'price', NEW.price
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_outbox
  AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION publish_order_event();
```

**Worker Implementation** (200 lines):
```typescript
// src/workers/outbox-event-router.ts
export class OutboxEventRouter {
  private handlers = new Map<string, IEventHandler[]>();

  registerHandler(handler: IEventHandler): void {
    // Register handlers for event types
  }

  async start(): void {
    setInterval(() => this.processEvents(), 1000);
  }

  private async processEvents(): Promise<void> {
    const events = await this.fetchPendingEvents();

    for (const event of events) {
      await this.routeEvent(event);
      await this.markProcessed(event.id);
    }
  }
}
```

**Total: ~500 lines of code, works everywhere** ✅

### Logical Decoding Implementation

**Database Setup** (30 minutes + permissions):
```sql
-- 1. Enable logical replication (requires restart)
ALTER SYSTEM SET wal_level = 'logical';
-- Requires PostgreSQL restart ⚠️

-- 2. Create publication
CREATE PUBLICATION bookstore_pub FOR TABLE users, books, orders;

-- 3. Create replication slot
SELECT * FROM pg_create_logical_replication_slot('bookstore_slot', 'pgoutput');

-- 4. Grant permissions
GRANT REPLICATION ON DATABASE bookstore TO app_user;
```

**Worker Implementation** (1000+ lines):
```typescript
// src/workers/wal-consumer.ts
import { LogicalReplicationService, PgoutputPlugin } from 'pg-logical-replication';

export class WALConsumer {
  private service: LogicalReplicationService;
  private handlers = new Map<string, IEventHandler[]>();
  private lastLSN: string;

  constructor() {
    this.service = new LogicalReplicationService({
      host: process.env.DB_HOST,
      port: 5432,
      database: process.env.DB_NAME,
      user: process.env.REPLICATION_USER,  // Needs REPLICATION role
      password: process.env.REPLICATION_PASSWORD,
    });
  }

  async start(): Promise<void> {
    // Ensure replication slot exists
    try {
      await this.service.createReplicationSlot('bookstore_slot', 'pgoutput');
    } catch (err) {
      if (!err.message.includes('already exists')) {
        throw err;
      }
    }

    // Subscribe to publication
    await this.service.subscribe('bookstore_pub', 'bookstore_slot');

    // Handle WAL messages
    this.service.on('data', async (lsn, log) => {
      await this.handleWALMessage(lsn, log);
    });

    // Handle errors
    this.service.on('error', (err) => {
      console.error('WAL stream error:', err);
      // Implement reconnection logic
    });

    // Heartbeat to advance slot
    setInterval(() => {
      if (this.lastLSN) {
        this.service.acknowledge(this.lastLSN);
      }
    }, 10000);
  }

  private async handleWALMessage(lsn: string, log: any): Promise<void> {
    try {
      if (log.tag === 'insert' || log.tag === 'update') {
        const tableName = log.relation.name;
        const rowData = log.new;

        // Route to handlers based on table
        if (tableName === 'orders') {
          await this.handleOrderChange(rowData);
        } else if (tableName === 'books') {
          await this.handleBookChange(rowData);
        } else if (tableName === 'users') {
          await this.handleUserChange(rowData);
        }
        // Ignore other tables
      }

      // Acknowledge LSN
      this.lastLSN = lsn;
      await this.service.acknowledge(lsn);
    } catch (err) {
      console.error('Error processing WAL message:', err);
      // Retry logic needed
      // If we don't acknowledge, slot won't advance
    }
  }

  private async handleOrderChange(row: any): Promise<void> {
    // Parse column values from WAL format
    const userId = this.parseColumn(row, 'user_id');
    const bookId = this.parseColumn(row, 'book_id');
    const status = this.parseColumn(row, 'status');

    if (status === 'completed') {
      // Derive semantic event from technical change
      const event = {
        type: 'book_purchased',
        payload: { userId, bookId, ... }
      };

      await this.routeEvent(event);
    }
  }

  private parseColumn(row: any, columnName: string): any {
    // Complex parsing logic
    const column = row.columns.find(c => c.name === columnName);
    if (!column) return null;

    // Handle different column types
    switch (column.type) {
      case 'integer':
        return parseInt(column.value);
      case 'json':
      case 'jsonb':
        return JSON.parse(column.value);
      // ... many more types
      default:
        return column.value;
    }
  }
}
```

**Additional Monitoring** (500 lines):
```typescript
// Replication slot monitoring
async function monitorReplicationLag(): Promise<void> {
  const result = await pool.query(`
    SELECT
      slot_name,
      active,
      pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) as lag_bytes,
      pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) as lag
    FROM pg_replication_slots
    WHERE slot_name = 'bookstore_slot'
  `);

  const lag = result.rows[0]?.lag_bytes;

  if (lag > 10 * 1024 * 1024 * 1024) {  // 10GB
    alert('CRITICAL: Replication lag > 10GB, WAL disk filling up!');
  }
}

// Run every minute
setInterval(monitorReplicationLag, 60000);
```

**Total: ~1500 lines of code, complex, fragile** ⚠️

---

## Cost Comparison

| Resource | Outbox Pattern | Logical Decoding |
|----------|----------------|------------------|
| **DB Storage** | Outbox table (~1GB) | WAL retention (~5-10GB) |
| **Compute** | Event Router (512Mi pod) | WAL Consumer (512Mi pod) |
| **Monitoring** | Simple (SQL queries) | Complex (replication lag, slot size) |
| **Risk** | Low (table growth) | High (disk full) |
| **Cleanup** | DELETE old events | Auto (if slot advancing) |
| **Monthly Cost** | ~$50 | ~$50 (if working), $∞ (if stuck) |

**Hidden cost of Logical Decoding:**
- Incident response for stuck replication slots
- Monitoring setup and alerts
- Training team on WAL internals
- Debugging complex failures

**Verdict: Outbox is operationally cheaper** ✅

---

## When to Use Each Approach

### Use Outbox Pattern When:

✅ **Using managed DBaaS** (Linode, Akamai, RDS, etc.)
✅ **Latency tolerance**: 1-10 seconds is fine
✅ **Moderate volume**: <10K events/second
✅ **Team experience**: SQL and application code
✅ **Semantic events**: Want custom event types
✅ **Simplicity**: Value operational simplicity
✅ **Low risk**: Can't afford database disk full
✅ **Quick start**: Need to ship features fast

### Use Logical Decoding When:

⚠️ **Self-hosted PostgreSQL** with full control
⚠️ **Low latency**: Need <100ms event propagation
⚠️ **High volume**: >50K events/second
⚠️ **Team expertise**: Deep PostgreSQL + replication knowledge
⚠️ **Generic events**: OK with INSERT/UPDATE/DELETE
⚠️ **Complexity tolerance**: Can handle operational complexity
⚠️ **Managed risk**: Have alerts, runbooks, on-call
⚠️ **Full CDC**: Need to capture ALL database changes

---

## Real-World Use Cases

### Companies Using Outbox Pattern

- **Uber**: Order events → downstream services
- **Netflix**: Microservices communication
- **Airbnb**: Booking events → analytics
- **Stripe**: Payment events → webhooks

**Why they choose Outbox:**
- Semantic events (business intent clear)
- Transactional guarantees
- Easy to understand and debug
- Works with any database

### Companies Using Logical Decoding

- **Amazon (DMS)**: Full database replication
- **Google (Datastream)**: CDC for BigQuery
- **Confluent (Debezium)**: Kafka integration
- **TimescaleDB**: Continuous aggregates

**Why they choose Logical Decoding:**
- Need EVERY change (audit logs, full replication)
- Real-time requirements (<100ms)
- Building infrastructure products
- Deep PostgreSQL expertise

---

## Recommendation for AWS Bookstore → Akamai

### Your Context:

1. **Managed DBaaS**: Linode/Akamai PostgreSQL (unknown if logical replication allowed)
2. **Use cases**: Search sync, recommendations, bestsellers
3. **Latency**: 1-2 seconds is perfectly fine
4. **Volume**: E-commerce scale (moderate)
5. **Team**: Application developers, not DB admins
6. **Infrastructure**: Kubernetes + managed services

### Decision Matrix:

| Criteria | Outbox | Logical Decoding | Winner |
|----------|--------|------------------|--------|
| Works on managed DBaaS | ✅ Always | ⚠️ Maybe | **Outbox** |
| Simplicity | ✅ Simple | ❌ Complex | **Outbox** |
| Latency requirement | ✅ 1-2s OK | ✅ <100ms | **Tie** |
| Throughput requirement | ✅ Adequate | ✅ High | **Tie** |
| Operational risk | ✅ Low | ❌ High | **Outbox** |
| Team expertise | ✅ Yes | ❌ No | **Outbox** |
| Time to market | ✅ Fast | ❌ Slow | **Outbox** |
| Cost | ✅ Low | ⚖️ Medium | **Outbox** |

### Final Recommendation: **Use Outbox Pattern** ✅

**Reasons:**
1. **Guaranteed compatibility** with managed DBaaS
2. **1-2 second latency is fine** for recommendations
3. **Much simpler** to implement and operate
4. **Lower risk** of database incidents
5. **Team can maintain** without deep PostgreSQL expertise
6. **Faster time to market** - ship features, not infrastructure

### Migration Path (if needed later):

If you eventually need logical decoding:

**Step 1**: Keep outbox running
**Step 2**: Add logical decoding consumer in parallel
**Step 3**: Compare outputs (shadow mode)
**Step 4**: Switch over gradually
**Step 5**: Deprecate outbox

The outbox table becomes a **migration safety net**.

---

## Summary

| Feature | Outbox Pattern | Logical Decoding |
|---------|----------------|------------------|
| **Managed DBaaS** | ✅ Works everywhere | ⚠️ Often blocked |
| **Complexity** | ⭐ Low | ⭐⭐⭐⭐⭐ Very High |
| **Latency** | 1-2 seconds | <100ms |
| **DB Impact** | +1 INSERT per event | Minimal (reads WAL) |
| **Operational Risk** | ⭐ Low | ⭐⭐⭐⭐ High |
| **Code to Write** | ~500 lines | ~1500 lines |
| **Learning Curve** | Easy | Steep |
| **Event Semantics** | ✅ Custom (book_purchased) | ❌ Generic (INSERT) |
| **Debugging** | ✅ Query table | ❌ Parse WAL |
| **Disk Risk** | Table growth | **WAL fills disk** 💥 |
| **Cost** | ~$50/month | ~$50/month + incident costs |
| **Best For** | Most applications | Infrastructure products |

---

## Conclusion

**For your AWS Bookstore → Akamai migration:**

### ✅ Use Outbox Pattern

It's:
- **Simpler** to implement and understand
- **Safer** operationally (no disk full risk)
- **Guaranteed** to work on managed DBaaS
- **Adequate** for your performance needs
- **Maintainable** by your team
- **Faster** to ship

**PostgreSQL Logical Decoding is powerful**, but it's **overkill and risky** for propagating book/order events to 3 destinations with 1-2 second latency tolerance.

**Keep it simple. Ship features. Scale when needed.**

---

## Testing Logical Decoding Support

If you want to verify whether Linode/Akamai supports logical decoding:

```sql
-- Run these on your managed DB:

-- 1. Check WAL level
SHOW wal_level;
-- Need: 'logical'

-- 2. Try creating replication slot
SELECT * FROM pg_create_logical_replication_slot('test_slot', 'pgoutput');
-- If error → Not supported

-- 3. Check permissions
SELECT
  current_user,
  pg_has_role(current_user, 'pg_read_all_data', 'member') as can_read,
  rolreplication
FROM pg_roles
WHERE rolname = current_user;
-- Need rolreplication = true

-- 4. Try creating publication
CREATE PUBLICATION test_pub FOR TABLE users;
-- If error → Not supported

-- Cleanup
DROP PUBLICATION IF EXISTS test_pub;
SELECT pg_drop_replication_slot('test_slot');
```

**If ALL pass**: Logical decoding is possible (but still more complex than outbox)
**If ANY fail**: Must use Outbox Pattern

---

## Further Reading

- [PostgreSQL Logical Decoding Docs](https://www.postgresql.org/docs/current/logicaldecoding.html)
- [Outbox Pattern (Chris Richardson)](https://microservices.io/patterns/data/transactional-outbox.html)
- [AWS Database Migration Service](https://aws.amazon.com/dms/) (uses logical decoding)
- [Debezium Architecture](https://debezium.io/documentation/reference/architecture.html) (uses logical decoding)
- [pg-logical-replication Library](https://github.com/kibae/pg-logical-replication)
