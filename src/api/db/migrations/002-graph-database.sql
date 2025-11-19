-- Graph Database Migration with Apache AGE
-- Execute this on the GRAPH_DATABASE_URL database

-- Load Apache AGE extension
CREATE EXTENSION IF NOT EXISTS age;

-- Load AGE into search path
SET search_path = ag_catalog, "$user", public;

-- Create the social network graph
SELECT create_graph('social_network');

-- Create vertex labels (similar to tables in graph DB)
SELECT * FROM cypher('social_network', $$
  CREATE VLABEL IF NOT EXISTS User
$$) as (v agtype);

SELECT * FROM cypher('social_network', $$
  CREATE VLABEL IF NOT EXISTS Book
$$) as (v agtype);

-- Create edge labels (relationships)
SELECT * FROM cypher('social_network', $$
  CREATE ELABEL IF NOT EXISTS PURCHASED
$$) as (e agtype);

SELECT * FROM cypher('social_network', $$
  CREATE ELABEL IF NOT EXISTS RATED
$$) as (e agtype);

SELECT * FROM cypher('social_network', $$
  CREATE ELABEL IF NOT EXISTS FRIENDS_WITH
$$) as (e agtype);

-- Create indexes for better query performance
-- Note: AGE uses internal table structure
CREATE INDEX IF NOT EXISTS idx_user_properties
  ON ag_catalog._ag_label_vertex
  USING GIN (properties)
  WHERE label = (SELECT id FROM ag_catalog.ag_label WHERE name = 'User' AND graph = (SELECT id FROM ag_catalog.ag_graph WHERE name = 'social_network'));

CREATE INDEX IF NOT EXISTS idx_book_properties
  ON ag_catalog._ag_label_vertex
  USING GIN (properties)
  WHERE label = (SELECT id FROM ag_catalog.ag_label WHERE name = 'Book' AND graph = (SELECT id FROM ag_catalog.ag_graph WHERE name = 'social_network'));

CREATE INDEX IF NOT EXISTS idx_purchased_properties
  ON ag_catalog._ag_label_edge
  USING GIN (properties)
  WHERE label = (SELECT id FROM ag_catalog.ag_label WHERE name = 'PURCHASED' AND graph = (SELECT id FROM ag_catalog.ag_graph WHERE name = 'social_network'));

-- Create helper functions for common queries

-- Function to add or update a user in the graph
CREATE OR REPLACE FUNCTION graph_upsert_user(
  p_user_id TEXT,
  p_keycloak_id TEXT,
  p_email TEXT,
  p_name TEXT
)
RETURNS void AS $$
BEGIN
  PERFORM * FROM cypher('social_network', $$
    MERGE (u:User {id: $user_id})
    SET u.keycloakId = $keycloak_id,
        u.email = $email,
        u.name = $name,
        u.updatedAt = timestamp()
  $$, $${
    "user_id": p_user_id,
    "keycloak_id": p_keycloak_id,
    "email": p_email,
    "name": p_name
  }$$::agtype) as (result agtype);
END;
$$ LANGUAGE plpgsql;

-- Function to add a book to the graph
CREATE OR REPLACE FUNCTION graph_upsert_book(
  p_book_id TEXT,
  p_isbn TEXT,
  p_title TEXT,
  p_author TEXT
)
RETURNS void AS $$
BEGIN
  PERFORM * FROM cypher('social_network', $$
    MERGE (b:Book {id: $book_id})
    SET b.isbn = $isbn,
        b.title = $title,
        b.author = $author,
        b.updatedAt = timestamp()
  $$, $${
    "book_id": p_book_id,
    "isbn": p_isbn,
    "title": p_title,
    "author": p_author
  }$$::agtype) as (result agtype);
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
  PERFORM * FROM cypher('social_network', $$
    MATCH (u:User {id: $user_id})
    MATCH (b:Book {id: $book_id})
    MERGE (u)-[p:PURCHASED]->(b)
    SET p.price = $price,
        p.date = $purchase_date,
        p.timestamp = timestamp()
  $$, $${
    "user_id": p_user_id,
    "book_id": p_book_id,
    "price": p_price,
    "purchase_date": p_purchase_date::text
  }$$::agtype) as (result agtype);
END;
$$ LANGUAGE plpgsql;

-- Function to get personalized recommendations
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
  SELECT
    (rec->>'id')::TEXT as book_id,
    (rec->>'title')::TEXT as book_title,
    (rec->>'author')::TEXT as book_author,
    (rec->>'isbn')::TEXT as book_isbn,
    score::BIGINT as recommendation_score
  FROM cypher('social_network', $$
    MATCH (user:User {id: $user_id})-[:PURCHASED]->(book:Book)
          <-[:PURCHASED]-(other:User)-[:PURCHASED]->(rec:Book)
    WHERE NOT (user)-[:PURCHASED]->(rec)
    RETURN rec, COUNT(DISTINCT other) as score
    ORDER BY score DESC
    LIMIT $limit
  $$, $${
    "user_id": p_user_id,
    "limit": p_limit
  }$$::agtype) as (rec agtype, score agtype);
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
  SELECT
    (other->>'id')::TEXT as similar_user_id,
    (other->>'name')::TEXT as similar_user_name,
    count::BIGINT as common_books_count
  FROM cypher('social_network', $$
    MATCH (user:User {id: $user_id})-[:PURCHASED]->(book:Book)
          <-[:PURCHASED]-(other:User)
    WHERE user.id <> other.id
    RETURN other, COUNT(DISTINCT book) as count
    ORDER BY count DESC
    LIMIT $limit
  $$, $${
    "user_id": p_user_id,
    "limit": p_limit
  }$$::agtype) as (other agtype, count agtype);
END;
$$ LANGUAGE plpgsql;

-- Function to get user's purchase history from graph
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
    (book->>'id')::TEXT as book_id,
    (book->>'title')::TEXT as book_title,
    (book->>'author')::TEXT as book_author,
    (purchase->>'date')::TEXT as purchase_date,
    (purchase->>'price')::NUMERIC as purchase_price
  FROM cypher('social_network', $$
    MATCH (user:User {id: $user_id})-[p:PURCHASED]->(book:Book)
    RETURN book, p
    ORDER BY p.date DESC
  $$, $${
    "user_id": p_user_id
  }$$::agtype) as (book agtype, purchase agtype);
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON FUNCTION graph_upsert_user IS 'Add or update a user in the social network graph';
COMMENT ON FUNCTION graph_upsert_book IS 'Add or update a book in the graph database';
COMMENT ON FUNCTION graph_add_purchase IS 'Record a book purchase in the graph';
COMMENT ON FUNCTION graph_get_recommendations IS 'Get personalized book recommendations using collaborative filtering';
COMMENT ON FUNCTION graph_find_similar_users IS 'Find users with similar purchase patterns';
COMMENT ON FUNCTION graph_get_user_purchases IS 'Get user purchase history from the graph';

-- Sample data for testing (optional)
-- Uncomment to insert test data

/*
-- Insert test users
SELECT graph_upsert_user('user1', 'kc-001', 'alice@example.com', 'Alice');
SELECT graph_upsert_user('user2', 'kc-002', 'bob@example.com', 'Bob');
SELECT graph_upsert_user('user3', 'kc-003', 'carol@example.com', 'Carol');

-- Insert test books
SELECT graph_upsert_book('book1', '978-0-123-45678-1', 'JavaScript: The Good Parts', 'Douglas Crockford');
SELECT graph_upsert_book('book2', '978-0-123-45678-2', 'Clean Code', 'Robert C. Martin');
SELECT graph_upsert_book('book3', '978-0-123-45678-3', 'Design Patterns', 'Gang of Four');

-- Insert test purchases
SELECT graph_add_purchase('user1', 'book1', 29.99, NOW());
SELECT graph_add_purchase('user1', 'book2', 39.99, NOW());
SELECT graph_add_purchase('user2', 'book1', 29.99, NOW());
SELECT graph_add_purchase('user2', 'book3', 49.99, NOW());
SELECT graph_add_purchase('user3', 'book2', 39.99, NOW());
SELECT graph_add_purchase('user3', 'book3', 49.99, NOW());

-- Test recommendations for user1
SELECT * FROM graph_get_recommendations('user1', 5);
*/
