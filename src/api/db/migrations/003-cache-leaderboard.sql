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
-- LEADERBOARD TABLE - Replaces Redis Sorted Set
-- ============================================================================

CREATE TABLE IF NOT EXISTS leaderboard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  score BIGINT NOT NULL DEFAULT 0,
  sales_count BIGINT NOT NULL DEFAULT 0,
  rating_avg NUMERIC(3, 2) DEFAULT 0.00,
  last_purchase_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT leaderboard_book_unique UNIQUE (book_id)
);

-- Indexes for fast leaderboard queries
CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard (score DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_sales ON leaderboard (sales_count DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_rating ON leaderboard (rating_avg DESC);

-- Function to increment book score (when purchased)
CREATE OR REPLACE FUNCTION leaderboard_increment_score(
  p_book_id UUID,
  p_increment BIGINT DEFAULT 1
)
RETURNS void AS $$
BEGIN
  INSERT INTO leaderboard (book_id, score, sales_count, last_purchase_at)
  VALUES (p_book_id, p_increment, 1, NOW())
  ON CONFLICT (book_id)
  DO UPDATE SET
    score = leaderboard.score + p_increment,
    sales_count = leaderboard.sales_count + 1,
    last_purchase_at = NOW(),
    updated_at = NOW();
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
  score BIGINT,
  sales_count BIGINT,
  rating_avg NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.book_id,
    p.title,
    p.author,
    l.score,
    l.sales_count,
    l.rating_avg
  FROM leaderboard l
  JOIN products p ON l.book_id = p.id
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
  recent_sales BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id as book_id,
    p.title,
    p.author,
    COUNT(oi.id) as recent_sales
  FROM products p
  JOIN order_items oi ON p.id = oi.product_id
  JOIN orders o ON oi.order_id = o.id
  WHERE o.created_at >= NOW() - (p_days || ' days')::INTERVAL
  GROUP BY p.id, p.title, p.author
  ORDER BY recent_sales DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to update book rating in leaderboard
CREATE OR REPLACE FUNCTION leaderboard_update_rating(
  p_book_id UUID,
  p_new_rating NUMERIC
)
RETURNS void AS $$
BEGIN
  INSERT INTO leaderboard (book_id, rating_avg)
  VALUES (p_book_id, p_new_rating)
  ON CONFLICT (book_id)
  DO UPDATE SET
    rating_avg = p_new_rating,
    updated_at = NOW();
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
-- PERIODIC CLEANUP (using pg_cron if available)
-- ============================================================================

-- Note: pg_cron needs to be installed and enabled
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

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

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE cache_entries IS 'Generic cache table replacing Redis cache functionality';
COMMENT ON TABLE leaderboard IS 'Bestseller leaderboard replacing Redis sorted set';
COMMENT ON TABLE sessions IS 'User session storage (optional)';

COMMENT ON FUNCTION cache_get IS 'Get cache value by key (returns NULL if expired or not found)';
COMMENT ON FUNCTION cache_set IS 'Set cache value with TTL in seconds (default 1 hour)';
COMMENT ON FUNCTION cache_delete IS 'Delete cache entry by key';
COMMENT ON FUNCTION cache_cleanup_expired IS 'Cleanup expired cache entries';

COMMENT ON FUNCTION leaderboard_increment_score IS 'Increment book score when purchased';
COMMENT ON FUNCTION leaderboard_get_top IS 'Get top N bestselling books';
COMMENT ON FUNCTION leaderboard_get_trending IS 'Get trending books in last N days';

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
SELECT leaderboard_increment_score('book-uuid-here'::uuid, 10);
SELECT * FROM leaderboard_get_top(20);
SELECT * FROM leaderboard_get_trending(7, 10);
SELECT leaderboard_update_rating('book-uuid-here'::uuid, 4.5);
*/
