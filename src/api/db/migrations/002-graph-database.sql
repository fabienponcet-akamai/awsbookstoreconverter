-- Relational Recommendation Database Migration
-- Execute this on the GRAPH_DATABASE_URL database
-- Replaces Apache AGE with standard PostgreSQL relational schema

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Users table for the recommendation system
CREATE TABLE IF NOT EXISTS graph_users (
  id TEXT PRIMARY KEY,
  keycloak_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Books table for the recommendation system
CREATE TABLE IF NOT EXISTS graph_books (
  id TEXT PRIMARY KEY,
  isbn TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Purchases table (relationship between users and books)
CREATE TABLE IF NOT EXISTS graph_purchases (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES graph_users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES graph_books(id) ON DELETE CASCADE,
  price NUMERIC(10, 2) NOT NULL,
  purchase_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, book_id, purchase_date)
);

-- Ratings table (optional, for future enhancements)
CREATE TABLE IF NOT EXISTS graph_ratings (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES graph_users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES graph_books(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, book_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_graph_users_keycloak_id ON graph_users(keycloak_id);
CREATE INDEX IF NOT EXISTS idx_graph_users_email ON graph_users(email);
CREATE INDEX IF NOT EXISTS idx_graph_books_isbn ON graph_books(isbn);
CREATE INDEX IF NOT EXISTS idx_graph_books_title ON graph_books(title);
CREATE INDEX IF NOT EXISTS idx_graph_books_author ON graph_books(author);
CREATE INDEX IF NOT EXISTS idx_graph_purchases_user_id ON graph_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_graph_purchases_book_id ON graph_purchases(book_id);
CREATE INDEX IF NOT EXISTS idx_graph_purchases_date ON graph_purchases(purchase_date);
CREATE INDEX IF NOT EXISTS idx_graph_ratings_user_id ON graph_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_graph_ratings_book_id ON graph_ratings(book_id);

-- Composite indexes for collaborative filtering queries
CREATE INDEX IF NOT EXISTS idx_graph_purchases_user_book ON graph_purchases(user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_graph_purchases_book_user ON graph_purchases(book_id, user_id);

-- Function to add or update a user in the database
CREATE OR REPLACE FUNCTION graph_upsert_user(
  p_user_id TEXT,
  p_keycloak_id TEXT,
  p_email TEXT,
  p_name TEXT
)
RETURNS void AS $$
BEGIN
  INSERT INTO graph_users (id, keycloak_id, email, name, updated_at)
  VALUES (p_user_id, p_keycloak_id, p_email, p_name, CURRENT_TIMESTAMP)
  ON CONFLICT (id) DO UPDATE SET
    keycloak_id = EXCLUDED.keycloak_id,
    email = EXCLUDED.email,
    name = EXCLUDED.name,
    updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Function to add or update a book in the database
CREATE OR REPLACE FUNCTION graph_upsert_book(
  p_book_id TEXT,
  p_isbn TEXT,
  p_title TEXT,
  p_author TEXT
)
RETURNS void AS $$
BEGIN
  INSERT INTO graph_books (id, isbn, title, author, updated_at)
  VALUES (p_book_id, p_isbn, p_title, p_author, CURRENT_TIMESTAMP)
  ON CONFLICT (id) DO UPDATE SET
    isbn = EXCLUDED.isbn,
    title = EXCLUDED.title,
    author = EXCLUDED.author,
    updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Function to record a purchase
CREATE OR REPLACE FUNCTION graph_add_purchase(
  p_user_id TEXT,
  p_book_id TEXT,
  p_price NUMERIC,
  p_purchase_date TIMESTAMP
)
RETURNS void AS $$
BEGIN
  -- Ensure user exists (create if needed)
  INSERT INTO graph_users (id, keycloak_id, email, name)
  VALUES (p_user_id, p_user_id, '', '')
  ON CONFLICT (id) DO NOTHING;

  -- Ensure book exists (create if needed)
  INSERT INTO graph_books (id, isbn, title, author)
  VALUES (p_book_id, '', '', '')
  ON CONFLICT (id) DO NOTHING;

  -- Insert purchase
  INSERT INTO graph_purchases (user_id, book_id, price, purchase_date)
  VALUES (p_user_id, p_book_id, p_price, p_purchase_date)
  ON CONFLICT (user_id, book_id, purchase_date) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Function to get personalized recommendations using collaborative filtering
-- Algorithm: Find books purchased by users who bought similar books to the target user
CREATE OR REPLACE FUNCTION graph_get_recommendations(
  p_user_id TEXT,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  book_id TEXT,
  book_title TEXT,
  book_author TEXT,
  book_isbn TEXT,
  recommendation_score BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH user_purchases AS (
    -- Books purchased by the target user
    SELECT book_id
    FROM graph_purchases
    WHERE user_id = p_user_id
  ),
  similar_users AS (
    -- Find users who purchased the same books
    SELECT DISTINCT gp.user_id
    FROM graph_purchases gp
    INNER JOIN user_purchases up ON gp.book_id = up.book_id
    WHERE gp.user_id != p_user_id
  ),
  recommended_books AS (
    -- Find books purchased by similar users that the target user hasn't purchased
    SELECT
      gp.book_id,
      COUNT(DISTINCT gp.user_id) as score
    FROM graph_purchases gp
    INNER JOIN similar_users su ON gp.user_id = su.user_id
    LEFT JOIN user_purchases up ON gp.book_id = up.book_id
    WHERE up.book_id IS NULL  -- Exclude books already purchased
    GROUP BY gp.book_id
    ORDER BY score DESC
    LIMIT p_limit
  )
  SELECT
    rb.book_id,
    gb.title as book_title,
    gb.author as book_author,
    gb.isbn as book_isbn,
    rb.score as recommendation_score
  FROM recommended_books rb
  INNER JOIN graph_books gb ON rb.book_id = gb.id
  ORDER BY rb.score DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to find similar users (collaborative filtering)
CREATE OR REPLACE FUNCTION graph_find_similar_users(
  p_user_id TEXT,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  similar_user_id TEXT,
  similar_user_name TEXT,
  common_books_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH user_books AS (
    -- Books purchased by the target user
    SELECT book_id
    FROM graph_purchases
    WHERE user_id = p_user_id
  )
  SELECT
    gp.user_id as similar_user_id,
    gu.name as similar_user_name,
    COUNT(DISTINCT gp.book_id) as common_books_count
  FROM graph_purchases gp
  INNER JOIN user_books ub ON gp.book_id = ub.book_id
  INNER JOIN graph_users gu ON gp.user_id = gu.id
  WHERE gp.user_id != p_user_id
  GROUP BY gp.user_id, gu.name
  ORDER BY common_books_count DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to get user's purchase history
CREATE OR REPLACE FUNCTION graph_get_user_purchases(
  p_user_id TEXT
)
RETURNS TABLE (
  book_id TEXT,
  book_title TEXT,
  book_author TEXT,
  purchase_date TEXT,
  purchase_price NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    gb.id as book_id,
    gb.title as book_title,
    gb.author as book_author,
    gp.purchase_date::TEXT as purchase_date,
    gp.price as purchase_price
  FROM graph_purchases gp
  INNER JOIN graph_books gb ON gp.book_id = gb.id
  WHERE gp.user_id = p_user_id
  ORDER BY gp.purchase_date DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to get trending books based on recent purchases
CREATE OR REPLACE FUNCTION graph_get_trending_books(
  p_days INT DEFAULT 7,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  book_id TEXT,
  book_title TEXT,
  book_author TEXT,
  book_isbn TEXT,
  purchase_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    gb.id as book_id,
    gb.title as book_title,
    gb.author as book_author,
    gb.isbn as book_isbn,
    COUNT(*) as purchase_count
  FROM graph_purchases gp
  INNER JOIN graph_books gb ON gp.book_id = gb.id
  WHERE gp.purchase_date >= CURRENT_TIMESTAMP - (p_days || ' days')::INTERVAL
  GROUP BY gb.id, gb.title, gb.author, gb.isbn
  ORDER BY purchase_count DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to get similar books (books purchased by users who also bought this book)
CREATE OR REPLACE FUNCTION graph_get_similar_books(
  p_book_id TEXT,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  book_id TEXT,
  book_title TEXT,
  book_author TEXT,
  book_isbn TEXT,
  similarity_score BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH book_purchasers AS (
    -- Users who purchased the target book
    SELECT user_id
    FROM graph_purchases
    WHERE book_id = p_book_id
  )
  SELECT
    gb.id as book_id,
    gb.title as book_title,
    gb.author as book_author,
    gb.isbn as book_isbn,
    COUNT(DISTINCT gp.user_id) as similarity_score
  FROM graph_purchases gp
  INNER JOIN book_purchasers bp ON gp.user_id = bp.user_id
  INNER JOIN graph_books gb ON gp.book_id = gb.id
  WHERE gp.book_id != p_book_id
  GROUP BY gb.id, gb.title, gb.author, gb.isbn
  ORDER BY similarity_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE graph_users IS 'Users in the recommendation system';
COMMENT ON TABLE graph_books IS 'Books catalog for recommendations';
COMMENT ON TABLE graph_purchases IS 'Purchase history - relationship between users and books';
COMMENT ON TABLE graph_ratings IS 'User ratings for books (optional, for future enhancements)';

COMMENT ON FUNCTION graph_upsert_user IS 'Add or update a user in the recommendation database';
COMMENT ON FUNCTION graph_upsert_book IS 'Add or update a book in the recommendation database';
COMMENT ON FUNCTION graph_add_purchase IS 'Record a book purchase';
COMMENT ON FUNCTION graph_get_recommendations IS 'Get personalized book recommendations using collaborative filtering';
COMMENT ON FUNCTION graph_find_similar_users IS 'Find users with similar purchase patterns';
COMMENT ON FUNCTION graph_get_user_purchases IS 'Get user purchase history';
COMMENT ON FUNCTION graph_get_trending_books IS 'Get trending books based on recent purchases';
COMMENT ON FUNCTION graph_get_similar_books IS 'Get similar books based on co-purchase patterns';

-- Sample data for testing (commented out)
/*
-- Insert test users
SELECT graph_upsert_user('user1', 'kc-001', 'alice@example.com', 'Alice');
SELECT graph_upsert_user('user2', 'kc-002', 'bob@example.com', 'Bob');
SELECT graph_upsert_user('user3', 'kc-003', 'carol@example.com', 'Carol');

-- Insert test books
SELECT graph_upsert_book('book1', '978-0-123-45678-1', 'JavaScript: The Good Parts', 'Douglas Crockford');
SELECT graph_upsert_book('book2', '978-0-123-45678-2', 'Clean Code', 'Robert C. Martin');
SELECT graph_upsert_book('book3', '978-0-123-45678-3', 'Design Patterns', 'Gang of Four');
SELECT graph_upsert_book('book4', '978-0-123-45678-4', 'The Pragmatic Programmer', 'Hunt & Thomas');

-- Insert test purchases
SELECT graph_add_purchase('user1', 'book1', 29.99, NOW() - INTERVAL '5 days');
SELECT graph_add_purchase('user1', 'book2', 39.99, NOW() - INTERVAL '4 days');
SELECT graph_add_purchase('user2', 'book1', 29.99, NOW() - INTERVAL '3 days');
SELECT graph_add_purchase('user2', 'book3', 49.99, NOW() - INTERVAL '2 days');
SELECT graph_add_purchase('user3', 'book2', 39.99, NOW() - INTERVAL '1 day');
SELECT graph_add_purchase('user3', 'book3', 49.99, NOW());

-- Test recommendations for user1 (should recommend book3 since user2 and user3 bought it with book1/book2)
SELECT * FROM graph_get_recommendations('user1', 5);

-- Test similar users for user1 (should find user2 and user3)
SELECT * FROM graph_find_similar_users('user1', 5);

-- Test trending books
SELECT * FROM graph_get_trending_books(7, 10);

-- Test similar books for book1 (should find book2 and book3)
SELECT * FROM graph_get_similar_books('book1', 5);
*/
