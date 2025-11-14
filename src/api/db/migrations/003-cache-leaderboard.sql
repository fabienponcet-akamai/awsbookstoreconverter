-- Cache and Leaderboard Migration for PostgreSQL
-- Execute this on the DATABASE_URL (main database)
-- This replaces Redis functionality with PostgreSQL

-- ============================================================================
-- CACHE TABLE - Replaces Redis Cache
-- ============================================================================

CREATE TABLE IF NOT EXISTS cache_entries (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient cleanup of expired entries
CREATE INDEX IF NOT EXISTS idx_cache_expires_at ON cache_entries (expires_at);

-- Function to get cache entry (only if not expired)
CREATE OR REPLACE FUNCTION cache_get(p_key TEXT)
RETURNS JSONB AS $$
DECLARE
  v_value JSONB;
BEGIN
  SELECT value INTO v_value
  FROM cache_entries
  WHERE key = p_key
    AND expires_at > NOW();

  RETURN v_value;
END;
$$ LANGUAGE plpgsql;

-- Function to set cache entry with TTL
CREATE OR REPLACE FUNCTION cache_set(
  p_key TEXT,
  p_value JSONB,
  p_ttl_seconds INT DEFAULT 3600
)
RETURNS void AS $$
BEGIN
  INSERT INTO cache_entries (key, value, expires_at)
  VALUES (p_key, p_value, NOW() + (p_ttl_seconds || ' seconds')::INTERVAL)
  ON CONFLICT (key)
  DO UPDATE SET
    value = EXCLUDED.value,
    expires_at = EXCLUDED.expires_at,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to delete cache entry
CREATE OR REPLACE FUNCTION cache_delete(p_key TEXT)
RETURNS void AS $$
BEGIN
  DELETE FROM cache_entries WHERE key = p_key;
END;
$$ LANGUAGE plpgsql;

-- Function to delete cache entries by pattern
CREATE OR REPLACE FUNCTION cache_delete_pattern(p_pattern TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM cache_entries WHERE key LIKE p_pattern;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- Cleanup expired cache entries (run periodically)
CREATE OR REPLACE FUNCTION cache_cleanup_expired()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM cache_entries WHERE expires_at <= NOW();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- LEADERBOARD MATERIALIZED VIEW - Replaces Redis Sorted Set
-- ============================================================================
-- Using Materialized View for automatic computation from orders
-- This is BETTER than manual table because:
-- - Single source of truth (orders table)
-- - No risk of getting out of sync
-- - Automatic computation via refresh
-- - Can refresh concurrently (non-blocking)
-- ============================================================================

-- Create materialized view for bestseller leaderboard
CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard AS
SELECT
  p.id as book_id,
  p.title,
  p.author,
  p.isbn,
  p.category,
  p.price,
  COUNT(DISTINCT o.id) as sales_count,
  COALESCE(SUM(oi.quantity), 0) as total_quantity,
  -- Score calculation: weighted by recency and quantity
  COALESCE(
    SUM(
      oi.quantity *
      -- More recent purchases have higher weight (exponential decay)
      EXTRACT(EPOCH FROM (NOW() - o.created_at)) / (86400.0 * 30) -- 30 days decay
    ),
    0
  )::BIGINT as score,
  COALESCE(AVG(r.rating), 0.0)::NUMERIC(3, 2) as rating_avg,
  COUNT(DISTINCT r.id) as review_count,
  MAX(o.created_at) as last_purchase_at,
  NOW() as updated_at
FROM products p
LEFT JOIN order_items oi ON p.id = oi.product_id
LEFT JOIN orders o ON oi.order_id = o.id AND o.status != 'cancelled'
LEFT JOIN reviews r ON p.id = r.product_id
GROUP BY p.id, p.title, p.author, p.isbn, p.category, p.price
HAVING COUNT(DISTINCT o.id) > 0 -- Only books with at least 1 sale
ORDER BY score DESC;

-- Create indexes on the materialized view for fast queries
CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_book_id ON leaderboard (book_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard (score DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_sales ON leaderboard (sales_count DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_rating ON leaderboard (rating_avg DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_category ON leaderboard (category, score DESC);

-- ============================================================================
-- LEADERBOARD REFRESH FUNCTIONS
-- ============================================================================

-- Function to refresh leaderboard (non-blocking with CONCURRENTLY)
-- Note: CONCURRENTLY requires unique index (created above)
CREATE OR REPLACE FUNCTION leaderboard_refresh()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard;
END;
$$ LANGUAGE plpgsql;

-- Function to get top N books from leaderboard
CREATE OR REPLACE FUNCTION leaderboard_get_top(
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  book_id UUID,
  title TEXT,
  author TEXT,
  isbn TEXT,
  category TEXT,
  price NUMERIC,
  score BIGINT,
  sales_count BIGINT,
  total_quantity BIGINT,
  rating_avg NUMERIC,
  review_count BIGINT,
  last_purchase_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.book_id,
    l.title,
    l.author,
    l.isbn,
    l.category,
    l.price,
    l.score,
    l.sales_count,
    l.total_quantity,
    l.rating_avg,
    l.review_count,
    l.last_purchase_at
  FROM leaderboard l
  ORDER BY l.score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to get top N books by category
CREATE OR REPLACE FUNCTION leaderboard_get_top_by_category(
  p_category TEXT,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  book_id UUID,
  title TEXT,
  author TEXT,
  score BIGINT,
  sales_count BIGINT,
  rating_avg NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.book_id,
    l.title,
    l.author,
    l.score,
    l.sales_count,
    l.rating_avg
  FROM leaderboard l
  WHERE l.category = p_category
  ORDER BY l.score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to get trending books (last N days)
CREATE OR REPLACE FUNCTION leaderboard_get_trending(
  p_days INT DEFAULT 7,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  book_id UUID,
  title TEXT,
  author TEXT,
  recent_sales BIGINT,
  recent_quantity BIGINT,
  trend_score BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id as book_id,
    p.title,
    p.author,
    COUNT(DISTINCT o.id) as recent_sales,
    COALESCE(SUM(oi.quantity), 0) as recent_quantity,
    COALESCE(SUM(oi.quantity * oi.price), 0)::BIGINT as trend_score
  FROM products p
  JOIN order_items oi ON p.id = oi.product_id
  JOIN orders o ON oi.order_id = o.id
  WHERE o.created_at >= NOW() - (p_days || ' days')::INTERVAL
    AND o.status != 'cancelled'
  GROUP BY p.id, p.title, p.author
  ORDER BY trend_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to get book rank in leaderboard
CREATE OR REPLACE FUNCTION leaderboard_get_book_rank(p_book_id UUID)
RETURNS TABLE (
  rank BIGINT,
  book_id UUID,
  title TEXT,
  score BIGINT,
  sales_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH ranked_books AS (
    SELECT
      ROW_NUMBER() OVER (ORDER BY score DESC) as rank,
      l.book_id,
      l.title,
      l.score,
      l.sales_count
    FROM leaderboard l
  )
  SELECT * FROM ranked_books WHERE ranked_books.book_id = p_book_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SESSION STORAGE TABLE (optional, for user sessions)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  user_id UUID,
  data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for cleanup
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);

-- Function to cleanup expired sessions
CREATE OR REPLACE FUNCTION sessions_cleanup_expired()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM sessions WHERE expires_at <= NOW();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PERIODIC REFRESH & CLEANUP (using pg_cron if available)
-- ============================================================================

-- Note: pg_cron needs to be installed and enabled
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule leaderboard refresh every minute (non-blocking with CONCURRENTLY)
-- SELECT cron.schedule('leaderboard-refresh', '* * * * *', 'SELECT leaderboard_refresh()');

-- Schedule cache cleanup every hour
-- SELECT cron.schedule('cache-cleanup', '0 * * * *', 'SELECT cache_cleanup_expired()');

-- Schedule session cleanup every hour
-- SELECT cron.schedule('session-cleanup', '0 * * * *', 'SELECT sessions_cleanup_expired()');

-- ============================================================================
-- TRIGGER for automatic cleanup (alternative to pg_cron)
-- ============================================================================

-- Trigger to cleanup expired cache on each write (alternative to cron)
CREATE OR REPLACE FUNCTION cache_cleanup_on_write()
RETURNS TRIGGER AS $$
BEGIN
  -- Every 100th write, cleanup expired entries
  IF random() < 0.01 THEN
    PERFORM cache_cleanup_expired();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cache_cleanup_trigger
  AFTER INSERT OR UPDATE ON cache_entries
  FOR EACH STATEMENT
  EXECUTE FUNCTION cache_cleanup_on_write();

-- Trigger to refresh leaderboard after orders (alternative to pg_cron)
-- Note: This is optional - scheduled refresh via pg_cron is preferred
CREATE OR REPLACE FUNCTION leaderboard_refresh_on_order()
RETURNS TRIGGER AS $$
BEGIN
  -- Every 10th order, refresh leaderboard
  -- This ensures near-real-time updates without too much overhead
  IF random() < 0.1 THEN
    PERFORM leaderboard_refresh();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leaderboard_refresh_trigger
  AFTER INSERT OR UPDATE ON orders
  FOR EACH STATEMENT
  EXECUTE FUNCTION leaderboard_refresh_on_order();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE cache_entries IS 'Generic cache table replacing Redis cache functionality';
COMMENT ON MATERIALIZED VIEW leaderboard IS 'Bestseller leaderboard (materialized view) replacing Redis sorted set - automatically computed from orders';
COMMENT ON TABLE sessions IS 'User session storage (optional)';

COMMENT ON FUNCTION cache_get IS 'Get cache value by key (returns NULL if expired or not found)';
COMMENT ON FUNCTION cache_set IS 'Set cache value with TTL in seconds (default 1 hour)';
COMMENT ON FUNCTION cache_delete IS 'Delete cache entry by key';
COMMENT ON FUNCTION cache_cleanup_expired IS 'Cleanup expired cache entries';

COMMENT ON FUNCTION leaderboard_refresh IS 'Refresh leaderboard materialized view (non-blocking with CONCURRENTLY)';
COMMENT ON FUNCTION leaderboard_get_top IS 'Get top N bestselling books from leaderboard';
COMMENT ON FUNCTION leaderboard_get_top_by_category IS 'Get top N bestselling books in a specific category';
COMMENT ON FUNCTION leaderboard_get_trending IS 'Get trending books in last N days (computed in real-time from orders)';
COMMENT ON FUNCTION leaderboard_get_book_rank IS 'Get rank of a specific book in leaderboard';

-- ============================================================================
-- SAMPLE USAGE
-- ============================================================================

/*
-- Cache examples:
SELECT cache_set('product:123', '{"title": "JavaScript Book", "price": 29.99}'::jsonb, 3600);
SELECT cache_get('product:123');
SELECT cache_delete('product:123');
SELECT cache_delete_pattern('product:%');
SELECT cache_cleanup_expired();

-- Leaderboard examples:
SELECT leaderboard_refresh(); -- Refresh materialized view (run periodically)
SELECT * FROM leaderboard_get_top(20); -- Get top 20 bestsellers
SELECT * FROM leaderboard_get_top_by_category('Programming', 10); -- Top 10 in category
SELECT * FROM leaderboard_get_trending(7, 10); -- Top 10 trending in last 7 days
SELECT * FROM leaderboard_get_book_rank('book-uuid-here'::uuid); -- Get specific book rank

-- Direct query on materialized view:
SELECT * FROM leaderboard WHERE category = 'Programming' ORDER BY score DESC LIMIT 10;

-- Setup pg_cron for automatic refresh (recommended):
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('leaderboard-refresh', '* * * * *', 'SELECT leaderboard_refresh()');
*/
