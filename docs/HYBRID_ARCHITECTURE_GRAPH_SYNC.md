# Hybrid Architecture: Managed DBaaS + CloudNativePG with Apache AGE

## Overview

This document describes the hybrid database architecture that combines:

1. **Managed DBaaS** (Linode/Akamai PostgreSQL) for transactional workload
2. **Self-managed CloudNativePG cluster** with Apache AGE for recommendation graph
3. **Outbox pattern** for real-time data synchronization

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Application Layer                            │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────┐ │
│  │ Orders API │  │ Books API  │  │ Users API  │  │ Recomm. API  │ │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └───────┬────────┘ │
└────────┼───────────────┼───────────────┼──────────────────┼──────────┘
         │               │               │                  │
         ▼               ▼               ▼                  │
┌─────────────────────────────────────────────┐             │
│      Managed DBaaS (Linode PostgreSQL)      │             │
│  ┌─────────────────────────────────────┐   │             │
│  │   Transactional Tables              │   │             │
│  │   - users                           │   │             │
│  │   - books                           │   │             │
│  │   - orders                          │   │             │
│  │   - order_items                     │   │             │
│  │   - cart                            │   │             │
│  └────────────┬────────────────────────┘   │             │
│               │ Triggers                    │             │
│  ┌────────────▼────────────────────────┐   │             │
│  │   graph_outbox (Outbox Table)      │   │             │
│  │   - user events                     │   │             │
│  │   - book events                     │   │             │
│  │   - purchase events                 │   │             │
│  └─────────────────────────────────────┘   │             │
└──────────────────┬──────────────────────────┘             │
                   │                                        │
                   │ Polls every 1s                         │
                   ▼                                        │
         ┌──────────────────────┐                          │
         │ Graph Outbox Worker  │                          │
         │  (Kubernetes Pod)    │                          │
         │  - Processes events  │                          │
         │  - Batch sync        │                          │
         │  - Retry logic       │                          │
         └──────────┬───────────┘                          │
                    │ Cypher queries                       │
                    ▼                                      │
         ┌────────────────────────────┐                   │
         │  CloudNativePG + AGE       │◄──────────────────┘
         │  (Self-managed K8s)        │    Direct queries
         │  ┌──────────────────────┐  │
         │  │  Apache AGE Graph    │  │
         │  │  - User vertices     │  │
         │  │  - Book vertices     │  │
         │  │  - Purchase edges    │  │
         │  │  - Rating edges      │  │
         │  └──────────────────────┘  │
         └────────────────────────────┘
```

## Components

### 1. Managed DBaaS (Transactional Database)

**Purpose**: Handle all transactional operations with ACID guarantees

**Provider**: Linode/Akamai Managed PostgreSQL

**Benefits**:
- ✅ Fully managed (backups, updates, monitoring)
- ✅ High availability built-in
- ✅ Automatic failover
- ✅ Cost-effective for transactional workload
- ✅ No operational overhead

**Tables**:
- `users` - User accounts
- `books` - Book catalog
- `orders` - Order transactions
- `order_items` - Order line items
- `cart` - Shopping cart
- `graph_outbox` - Outbox for graph sync

**Triggers**:
- `trg_users_to_graph_outbox` - Captures user changes
- `trg_books_to_graph_outbox` - Captures book changes
- `trg_orders_to_graph_outbox` - Captures completed orders as purchases

### 2. CloudNativePG Cluster with Apache AGE

**Purpose**: Provide graph database capabilities for recommendations

**Deployment**: Self-managed in Kubernetes via CloudNative-PG Operator

**Benefits**:
- ✅ Graph query capabilities with Cypher
- ✅ Optimized for relationship queries
- ✅ Runs in Kubernetes (no managed DBaaS dependency)
- ✅ Can use custom PostgreSQL image with AGE extension
- ✅ Full control over configuration and scaling

**Image**: `apache/age:PG15_latest`

**Graph Structure**:
- **Vertices**:
  - `User` - User nodes with properties (id, keycloakId, email, name)
  - `Book` - Book nodes with properties (id, isbn, title, author, category)

- **Edges**:
  - `PURCHASED` - User purchased a book (price, date, orderId)
  - `RATED` - User rated a book (rating, date)
  - `FRIENDS_WITH` - User friendship (for social recommendations)

**Cypher Queries**:
```cypher
// Personalized recommendations (collaborative filtering)
MATCH (user:User {id: $userId})-[:PURCHASED]->(book:Book)
      <-[:PURCHASED]-(other:User)-[:PURCHASED]->(rec:Book)
WHERE NOT (user)-[:PURCHASED]->(rec)
RETURN rec, COUNT(DISTINCT other) as score
ORDER BY score DESC
LIMIT 10

// Similar books ("customers who bought this also bought...")
MATCH (book:Book {id: $bookId})<-[:PURCHASED]-(u:User)
      -[:PURCHASED]->(rec:Book)
WHERE book.id <> rec.id
RETURN rec, COUNT(DISTINCT u) as count
ORDER BY count DESC
LIMIT 10
```

### 3. Outbox Pattern

**Purpose**: Reliably sync data from managed DBaaS to AGE cluster

**Implementation**: Event-driven architecture with polling

#### Outbox Table Schema

```sql
CREATE TABLE graph_outbox (
  id BIGSERIAL PRIMARY KEY,
  aggregate_type TEXT NOT NULL,      -- 'user', 'book', 'purchase'
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,          -- 'created', 'updated', 'deleted'
  payload JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP,
  retry_count INTEGER DEFAULT 0,
  last_error TEXT
);
```

#### Event Types

| Aggregate Type | Event Type | Trigger | AGE Operation |
|----------------|------------|---------|---------------|
| `user` | `created` | User inserted | Create User vertex |
| `user` | `updated` | User updated | Update User vertex properties |
| `user` | `deleted` | User deleted | Delete User vertex + edges |
| `book` | `created` | Book inserted | Create Book vertex |
| `book` | `updated` | Book updated | Update Book vertex properties |
| `book` | `deleted` | Book deleted | Delete Book vertex + edges |
| `purchase` | `created` | Order completed | Create PURCHASED edge |

#### Worker Architecture

**Graph Outbox Worker** (`graph-outbox-worker.ts`):
- Polls `graph_outbox` table every 1 second
- Processes events in batches (100 at a time)
- Uses `FOR UPDATE SKIP LOCKED` to avoid conflicts
- Implements retry logic (max 5 retries)
- Tracks processing time and errors

**Deployment**:
- 2 replicas for high availability
- PodDisruptionBudget ensures at least 1 running
- Pod anti-affinity spreads across nodes
- Graceful shutdown handling

**Error Handling**:
- Failed events are retried with exponential backoff
- After 5 retries, events are marked as failed
- Monitoring view shows failed events for manual intervention

## Data Flow

### 1. User Registration

```
1. POST /api/v1/users
2. API inserts into users table (managed DBaaS)
3. Trigger fires → inserts into graph_outbox
4. Worker polls outbox
5. Worker creates User vertex in AGE cluster
6. Outbox event marked as processed
```

### 2. Order Completion → Purchase Tracking

```
1. POST /api/v1/orders/{id}/complete
2. API updates order status to 'completed'
3. Trigger fires → inserts purchase events for each order item
4. Worker polls outbox
5. Worker creates PURCHASED edges in AGE cluster
6. Graph is now aware of purchases for recommendations
```

### 3. Getting Recommendations

```
1. GET /api/v1/recommendations/{userId}
2. API queries AGE cluster directly (not managed DBaaS)
3. Cypher query executes collaborative filtering
4. Returns personalized book recommendations
```

## Benefits of Hybrid Architecture

### Cost Optimization
- ✅ Use managed DBaaS for most workload (transactional)
- ✅ Only self-manage specialized graph database
- ✅ No need to pay for graph extension in managed service

### Operational Efficiency
- ✅ Managed DBaaS handles: backups, failover, monitoring, patching
- ✅ Self-managed AGE cluster: full control, custom extensions
- ✅ CloudNative-PG operator automates PostgreSQL operations

### Performance
- ✅ Graph queries don't impact transactional database
- ✅ Dedicated resources for recommendation workload
- ✅ Can scale AGE cluster independently

### Reliability
- ✅ Outbox pattern ensures eventual consistency
- ✅ Events are never lost (stored in managed DBaaS)
- ✅ Automatic retries on failures
- ✅ Multiple worker instances for availability

## Monitoring

### Outbox Stats View

```sql
SELECT * FROM graph_outbox_stats;
```

Returns:
- `pending_count` - Events waiting to be processed
- `processed_count` - Successfully processed events
- `retried_count` - Events that required retries
- `failed_count` - Events that failed after max retries
- `oldest_pending` - Timestamp of oldest unprocessed event
- `avg_processing_time_seconds` - Average processing time

### Kubernetes Metrics

```bash
# Check worker status
kubectl get pods -n bookstore -l component=graph-outbox-worker

# View worker logs
kubectl logs -n bookstore -l component=graph-outbox-worker -f

# Check worker stats
kubectl logs -n bookstore -l component=graph-outbox-worker | grep "Outbox Stats"
```

### Grafana Dashboards

Recommended metrics to monitor:
- Outbox queue depth (pending events)
- Processing rate (events/second)
- Error rate (failed events)
- Average processing latency
- Worker pod health

## Deployment Guide

### Prerequisites

1. **Managed DBaaS** configured with connection string in `DATABASE_URL`
2. **CloudNativePG operator** installed (part of apl-core)
3. **Apache AGE image** available: `apache/age:PG15_latest`

### Step 1: Deploy AGE Cluster

```bash
kubectl apply -f kubernetes/base/databases/postgres-graph.yaml
```

Wait for cluster to be ready:
```bash
kubectl wait --for=condition=Ready cluster/bookstore-graph -n bookstore --timeout=300s
```

### Step 2: Run Migrations

```bash
# On managed DBaaS (creates outbox tables and triggers)
kubectl run migration-outbox --rm -it --image=bookstore-api:latest -- \
  npm run migrate -- --file=003-outbox-for-graph.sql

# On AGE cluster (creates graph schema)
kubectl run migration-graph --rm -it --image=bookstore-api:latest -- \
  npm run migrate:graph -- --file=002-graph-database.sql
```

### Step 3: Deploy Outbox Worker

```bash
kubectl apply -f kubernetes/base/workers/graph-outbox-worker.yaml
```

Verify worker is running:
```bash
kubectl get pods -n bookstore -l component=graph-outbox-worker
kubectl logs -n bookstore -l component=graph-outbox-worker --tail=50
```

### Step 4: Verify Sync

```bash
# Check outbox stats
kubectl exec -n bookstore deployment/bookstore-api -- \
  psql $DATABASE_URL -c "SELECT * FROM graph_outbox_stats;"

# Check AGE cluster
kubectl exec -n bookstore bookstore-graph-1 -- \
  psql -U bookstore -d bookstore_graph -c "
    LOAD 'age';
    SET search_path = ag_catalog, \"\$user\", public;
    SELECT * FROM cypher('social_network', \$\$
      MATCH (u:User)
      RETURN count(u)
    \$\$) as (count agtype);
  "
```

## Maintenance

### Outbox Cleanup

Old processed events should be cleaned up regularly:

```sql
-- Manual cleanup (keep last 7 days)
SELECT cleanup_graph_outbox(7);
```

Or via worker (automatic):
```bash
# Cleanup runs automatically every 24 hours in the worker
# Configurable via OUTBOX_RETENTION_DAYS env var
```

### Backfilling AGE Cluster

If the AGE cluster needs to be rebuilt:

```bash
# 1. Clear AGE cluster
kubectl exec -n bookstore bookstore-graph-1 -- \
  psql -U bookstore -d bookstore_graph -c "
    SELECT drop_graph('social_network', true);
    SELECT create_graph('social_network');
  "

# 2. Reset outbox processed_at
kubectl exec -n bookstore deployment/bookstore-api -- \
  psql $DATABASE_URL -c "
    UPDATE graph_outbox
    SET processed_at = NULL,
        retry_count = 0,
        last_error = NULL;
  "

# 3. Worker will reprocess all events
```

### Scaling

#### Scale Worker Replicas

```bash
kubectl scale deployment/graph-outbox-worker -n bookstore --replicas=4
```

#### Scale AGE Cluster

```bash
kubectl patch cluster/bookstore-graph -n bookstore --type=merge \
  -p '{"spec":{"instances":3}}'
```

## Troubleshooting

### Events Not Processing

**Check**: Worker logs
```bash
kubectl logs -n bookstore -l component=graph-outbox-worker --tail=100
```

**Check**: Outbox stats
```bash
kubectl exec -n bookstore deployment/bookstore-api -- \
  psql $DATABASE_URL -c "SELECT * FROM graph_outbox_stats;"
```

### High Retry Count

**Investigate**: Failed events
```bash
kubectl exec -n bookstore deployment/bookstore-api -- \
  psql $DATABASE_URL -c "
    SELECT id, aggregate_type, event_type, retry_count, last_error
    FROM graph_outbox
    WHERE retry_count > 3
    LIMIT 10;
  "
```

### AGE Cluster Connection Issues

**Check**: Network connectivity
```bash
kubectl run -it --rm debug --image=postgres:15 --restart=Never -- \
  psql -h bookstore-graph-rw.bookstore.svc.cluster.local \
       -U bookstore -d bookstore_graph
```

**Check**: AGE extension loaded
```bash
kubectl exec -n bookstore bookstore-graph-1 -- \
  psql -U bookstore -d bookstore_graph -c "
    SELECT * FROM pg_extension WHERE extname = 'age';
  "
```

## Future Enhancements

1. **Metrics Endpoint**: Export Prometheus metrics from worker
2. **Dead Letter Queue**: Separate storage for permanently failed events
3. **Batching Optimization**: Batch multiple Cypher operations
4. **Change Data Capture**: Use PostgreSQL logical replication instead of triggers
5. **GraphQL API**: Direct GraphQL over AGE for advanced queries

## References

- [Apache AGE Documentation](https://age.apache.org/)
- [CloudNative-PG](https://cloudnative-pg.io/)
- [Outbox Pattern](https://microservices.io/patterns/data/transactional-outbox.html)
- [Cypher Query Language](https://neo4j.com/docs/cypher-manual/current/)
