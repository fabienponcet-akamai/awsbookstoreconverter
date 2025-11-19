-- Outbox Pattern Migration for Graph Database Sync
-- Execute this on the MAIN DATABASE (managed DBaaS)
-- This creates outbox tables and triggers to sync data to the CloudNativePG/AGE cluster

-- ============================================================================
-- Outbox Tables
-- ============================================================================

-- Outbox table for graph sync events
CREATE TABLE IF NOT EXISTS graph_outbox (
  id BIGSERIAL PRIMARY KEY,
  aggregate_type TEXT NOT NULL,  -- 'user', 'book', 'purchase', 'rating'
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,      -- 'created', 'updated', 'deleted'
  payload JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP,
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  INDEX idx_graph_outbox_unprocessed (created_at) WHERE processed_at IS NULL
);

-- Index for efficient polling
CREATE INDEX IF NOT EXISTS idx_graph_outbox_aggregate
  ON graph_outbox(aggregate_type, aggregate_id);

-- Index for cleanup of processed events
CREATE INDEX IF NOT EXISTS idx_graph_outbox_processed
  ON graph_outbox(processed_at) WHERE processed_at IS NOT NULL;

-- ============================================================================
-- Trigger Functions
-- ============================================================================

-- Function to publish user events to outbox
CREATE OR REPLACE FUNCTION publish_user_to_graph_outbox()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    INSERT INTO graph_outbox (aggregate_type, aggregate_id, event_type, payload)
    VALUES (
      'user',
      OLD.id,
      'deleted',
      jsonb_build_object(
        'id', OLD.id,
        'deleted_at', NOW()
      )
    );
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO graph_outbox (aggregate_type, aggregate_id, event_type, payload)
    VALUES (
      'user',
      NEW.id,
      'updated',
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
    INSERT INTO graph_outbox (aggregate_type, aggregate_id, event_type, payload)
    VALUES (
      'user',
      NEW.id,
      'created',
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

-- Function to publish book events to outbox
CREATE OR REPLACE FUNCTION publish_book_to_graph_outbox()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    INSERT INTO graph_outbox (aggregate_type, aggregate_id, event_type, payload)
    VALUES (
      'book',
      OLD.id,
      'deleted',
      jsonb_build_object(
        'id', OLD.id,
        'deleted_at', NOW()
      )
    );
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO graph_outbox (aggregate_type, aggregate_id, event_type, payload)
    VALUES (
      'book',
      NEW.id,
      'updated',
      jsonb_build_object(
        'id', NEW.id,
        'isbn', NEW.isbn,
        'title', NEW.title,
        'author', NEW.author,
        'category', NEW.category,
        'updated_at', NEW.updated_at
      )
    );
    RETURN NEW;
  ELSIF (TG_OP = 'INSERT') THEN
    INSERT INTO graph_outbox (aggregate_type, aggregate_id, event_type, payload)
    VALUES (
      'book',
      NEW.id,
      'created',
      jsonb_build_object(
        'id', NEW.id,
        'isbn', NEW.isbn,
        'title', NEW.title,
        'author', NEW.author,
        'category', NEW.category,
        'created_at', NEW.created_at
      )
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to publish order events as purchases to outbox
CREATE OR REPLACE FUNCTION publish_order_to_graph_outbox()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
BEGIN
  -- Only process completed orders
  IF (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status != 'completed')) THEN
    -- Insert purchase events for each order item
    FOR v_item IN
      SELECT book_id, price
      FROM order_items
      WHERE order_id = NEW.id
    LOOP
      INSERT INTO graph_outbox (aggregate_type, aggregate_id, event_type, payload)
      VALUES (
        'purchase',
        NEW.id || '-' || v_item.book_id,
        'created',
        jsonb_build_object(
          'user_id', NEW.user_id,
          'book_id', v_item.book_id,
          'price', v_item.price,
          'purchase_date', NEW.created_at,
          'order_id', NEW.id
        )
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Triggers
-- ============================================================================

-- Trigger for users table
DROP TRIGGER IF EXISTS trg_users_to_graph_outbox ON users;
CREATE TRIGGER trg_users_to_graph_outbox
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW
  EXECUTE FUNCTION publish_user_to_graph_outbox();

-- Trigger for books table
DROP TRIGGER IF EXISTS trg_books_to_graph_outbox ON books;
CREATE TRIGGER trg_books_to_graph_outbox
  AFTER INSERT OR UPDATE OR DELETE ON books
  FOR EACH ROW
  EXECUTE FUNCTION publish_book_to_graph_outbox();

-- Trigger for orders table
DROP TRIGGER IF EXISTS trg_orders_to_graph_outbox ON orders;
CREATE TRIGGER trg_orders_to_graph_outbox
  AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION publish_order_to_graph_outbox();

-- ============================================================================
-- Cleanup Function
-- ============================================================================

-- Function to clean up old processed outbox events
CREATE OR REPLACE FUNCTION cleanup_graph_outbox(retention_days INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM graph_outbox
  WHERE processed_at IS NOT NULL
    AND processed_at < NOW() - (retention_days || ' days')::INTERVAL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Monitoring Views
-- ============================================================================

-- View for outbox monitoring
CREATE OR REPLACE VIEW graph_outbox_stats AS
SELECT
  aggregate_type,
  COUNT(*) FILTER (WHERE processed_at IS NULL) as pending_count,
  COUNT(*) FILTER (WHERE processed_at IS NOT NULL) as processed_count,
  COUNT(*) FILTER (WHERE retry_count > 0) as retried_count,
  COUNT(*) FILTER (WHERE last_error IS NOT NULL) as failed_count,
  MAX(created_at) FILTER (WHERE processed_at IS NULL) as oldest_pending,
  AVG(EXTRACT(EPOCH FROM (processed_at - created_at))) FILTER (WHERE processed_at IS NOT NULL) as avg_processing_time_seconds
FROM graph_outbox
GROUP BY aggregate_type;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE graph_outbox IS 'Outbox pattern table for syncing data from managed DBaaS to CloudNativePG/AGE cluster';
COMMENT ON COLUMN graph_outbox.aggregate_type IS 'Type of entity: user, book, purchase, rating';
COMMENT ON COLUMN graph_outbox.aggregate_id IS 'ID of the entity being synced';
COMMENT ON COLUMN graph_outbox.event_type IS 'Event type: created, updated, deleted';
COMMENT ON COLUMN graph_outbox.payload IS 'JSON payload containing entity data';
COMMENT ON COLUMN graph_outbox.processed_at IS 'Timestamp when the event was processed by the outbox worker';
COMMENT ON COLUMN graph_outbox.retry_count IS 'Number of times this event has been retried';
COMMENT ON COLUMN graph_outbox.last_error IS 'Last error message if processing failed';

COMMENT ON FUNCTION cleanup_graph_outbox IS 'Clean up processed outbox events older than retention period';
COMMENT ON VIEW graph_outbox_stats IS 'Statistics view for monitoring outbox processing';
