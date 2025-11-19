-- Unified Outbox Pattern for Event-Driven Data Propagation
-- Execute this on the MAIN DATABASE (managed DBaaS)
--
-- This creates a SINGLE outbox table and triggers to sync data to ALL destinations:
-- - CloudNativePG/AGE (recommendations graph)
-- - Redis (bestsellers cache)
-- - OpenSearch (full-text search)
--
-- Benefits:
-- - One table instead of multiple outbox tables
-- - One worker (Event Router) instead of multiple workers
-- - Unified monitoring and error handling
-- - Easy to add new consumers

-- ============================================================================
-- Unified Outbox Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS outbox_events (
  id BIGSERIAL PRIMARY KEY,

  -- Event identification
  event_type TEXT NOT NULL,           -- 'book_created', 'order_completed', 'user_updated', etc.
  aggregate_type TEXT NOT NULL,       -- 'book', 'order', 'user', etc.
  aggregate_id TEXT NOT NULL,

  -- Event payload
  payload JSONB NOT NULL,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP,

  -- Error handling
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,

  -- Performance indexes
  INDEX idx_outbox_unprocessed (created_at) WHERE processed_at IS NULL,
  INDEX idx_outbox_aggregate (aggregate_type, aggregate_id),
  INDEX idx_outbox_event_type (event_type),
  INDEX idx_outbox_processed (processed_at) WHERE processed_at IS NOT NULL
);

COMMENT ON TABLE outbox_events IS 'Unified outbox for event-driven data propagation to Redis, OpenSearch, and AGE cluster';
COMMENT ON COLUMN outbox_events.event_type IS 'Specific event: book_created, order_completed, user_updated, etc.';
COMMENT ON COLUMN outbox_events.aggregate_type IS 'Entity type: book, order, user, etc.';
COMMENT ON COLUMN outbox_events.payload IS 'Full event data in JSON format';

-- ============================================================================
-- Trigger Functions for Different Entities
-- ============================================================================

-- -------------------------
-- USERS Events
-- -------------------------

CREATE OR REPLACE FUNCTION publish_user_event()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
    VALUES (
      'user_deleted',
      'user',
      OLD.id,
      jsonb_build_object(
        'id', OLD.id,
        'deleted_at', NOW()
      )
    );
    RETURN OLD;

  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
    VALUES (
      'user_updated',
      'user',
      NEW.id,
      jsonb_build_object(
        'id', NEW.id,
        'keycloak_id', NEW.keycloak_id,
        'email', NEW.email,
        'name', NEW.name,
        'updated_at', NEW.updated_at
      )
    );
    RETURN NEW;

  ELSIF (TG_OP = 'INSERT') THEN
    INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
    VALUES (
      'user_created',
      'user',
      NEW.id,
      jsonb_build_object(
        'id', NEW.id,
        'keycloak_id', NEW.keycloak_id,
        'email', NEW.email,
        'name', NEW.name,
        'created_at', NEW.created_at
      )
    );
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- -------------------------
-- BOOKS Events
-- -------------------------

CREATE OR REPLACE FUNCTION publish_book_event()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
    VALUES (
      'book_deleted',
      'book',
      OLD.id,
      jsonb_build_object(
        'id', OLD.id,
        'deleted_at', NOW()
      )
    );
    RETURN OLD;

  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
    VALUES (
      'book_updated',
      'book',
      NEW.id,
      jsonb_build_object(
        'id', NEW.id,
        'isbn', NEW.isbn,
        'title', NEW.title,
        'author', NEW.author,
        'category', NEW.category,
        'price', NEW.price,
        'description', NEW.description,
        'cover_url', NEW.cover_url,
        'updated_at', NEW.updated_at
      )
    );
    RETURN NEW;

  ELSIF (TG_OP = 'INSERT') THEN
    INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
    VALUES (
      'book_created',
      'book',
      NEW.id,
      jsonb_build_object(
        'id', NEW.id,
        'isbn', NEW.isbn,
        'title', NEW.title,
        'author', NEW.author,
        'category', NEW.category,
        'price', NEW.price,
        'description', NEW.description,
        'cover_url', NEW.cover_url,
        'created_at', NEW.created_at
      )
    );
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- -------------------------
-- ORDERS Events (for purchases and bestsellers)
-- -------------------------

CREATE OR REPLACE FUNCTION publish_order_event()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
BEGIN
  -- Only process when order is completed
  IF (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed'))) THEN

    -- 1. Publish order_completed event (for general tracking)
    INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
    VALUES (
      'order_completed',
      'order',
      NEW.id,
      jsonb_build_object(
        'order_id', NEW.id,
        'user_id', NEW.user_id,
        'total_amount', NEW.total_amount,
        'completed_at', NEW.updated_at
      )
    );

    -- 2. Publish events for each book purchased
    FOR v_item IN
      SELECT oi.book_id, oi.quantity, oi.price, b.title, b.author, b.isbn
      FROM order_items oi
      LEFT JOIN books b ON oi.book_id = b.id
      WHERE oi.order_id = NEW.id
    LOOP
      -- Event for recommendations (purchase tracking)
      INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
      VALUES (
        'book_purchased',
        'purchase',
        NEW.id || '-' || v_item.book_id,
        jsonb_build_object(
          'order_id', NEW.id,
          'user_id', NEW.user_id,
          'book_id', v_item.book_id,
          'quantity', v_item.quantity,
          'price', v_item.price,
          'purchase_date', NEW.created_at,
          'book_title', v_item.title,
          'book_author', v_item.author,
          'book_isbn', v_item.isbn
        )
      );

      -- Event for bestsellers (Redis ZINCRBY)
      INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
      VALUES (
        'bestseller_increment',
        'bestseller',
        v_item.book_id,
        jsonb_build_object(
          'book_id', v_item.book_id,
          'quantity', v_item.quantity,
          'order_id', NEW.id,
          'timestamp', NEW.created_at
        )
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Install Triggers
-- ============================================================================

DROP TRIGGER IF EXISTS trg_users_outbox ON users;
CREATE TRIGGER trg_users_outbox
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW
  EXECUTE FUNCTION publish_user_event();

DROP TRIGGER IF EXISTS trg_books_outbox ON books;
CREATE TRIGGER trg_books_outbox
  AFTER INSERT OR UPDATE OR DELETE ON books
  FOR EACH ROW
  EXECUTE FUNCTION publish_book_event();

DROP TRIGGER IF EXISTS trg_orders_outbox ON orders;
CREATE TRIGGER trg_orders_outbox
  AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION publish_order_event();

-- ============================================================================
-- Cleanup Function
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_outbox_events(retention_days INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM outbox_events
  WHERE processed_at IS NOT NULL
    AND processed_at < NOW() - (retention_days || ' days')::INTERVAL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_outbox_events IS 'Clean up processed events older than retention period (default 7 days)';

-- ============================================================================
-- Monitoring Views
-- ============================================================================

CREATE OR REPLACE VIEW outbox_stats AS
SELECT
  event_type,
  COUNT(*) FILTER (WHERE processed_at IS NULL) as pending_count,
  COUNT(*) FILTER (WHERE processed_at IS NOT NULL) as processed_count,
  COUNT(*) FILTER (WHERE retry_count > 0) as retried_count,
  COUNT(*) FILTER (WHERE last_error IS NOT NULL AND processed_at IS NULL) as failed_count,
  MAX(created_at) FILTER (WHERE processed_at IS NULL) as oldest_pending,
  AVG(EXTRACT(EPOCH FROM (processed_at - created_at))) FILTER (WHERE processed_at IS NOT NULL) as avg_processing_time_seconds
FROM outbox_events
GROUP BY event_type;

COMMENT ON VIEW outbox_stats IS 'Statistics for monitoring outbox event processing by event type';

-- View for aggregate statistics
CREATE OR REPLACE VIEW outbox_aggregate_stats AS
SELECT
  aggregate_type,
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE processed_at IS NULL) as pending_count,
  COUNT(*) FILTER (WHERE processed_at IS NOT NULL) as processed_count,
  MAX(created_at) as last_event_at
FROM outbox_events
GROUP BY aggregate_type;

COMMENT ON VIEW outbox_aggregate_stats IS 'Statistics by aggregate type (book, order, user, etc.)';

-- ============================================================================
-- Example Event Types and Their Consumers
-- ============================================================================

/*
Event Type Mapping to Handlers:

1. book_created / book_updated / book_deleted
   → SearchHandler: Sync to OpenSearch for full-text search
   → RecommendationsHandler: Upsert Book vertex in AGE cluster

2. user_created / user_updated / user_deleted
   → RecommendationsHandler: Upsert User vertex in AGE cluster

3. book_purchased
   → RecommendationsHandler: Create PURCHASED edge in AGE cluster

4. bestseller_increment
   → BestsellersHandler: ZINCRBY in Redis sorted set

5. order_completed
   → (Optional) Analytics, notifications, etc.

Each event is processed by the Event Router which routes it to
all registered handlers that support that event type.
*/
