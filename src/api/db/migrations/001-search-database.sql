-- Search Database Migration
-- Execute this on the SEARCH_DATABASE_URL database

-- Enable extensions for full-text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Create product_search table optimized for full-text search
CREATE TABLE IF NOT EXISTS product_search (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  description TEXT,
  category TEXT,
  isbn TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Generated column for full-text search
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(author, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(category, '')), 'D')
  ) STORED
);

-- Create indexes for fast search
CREATE INDEX IF NOT EXISTS idx_product_search_fts
  ON product_search USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_product_search_title_trigram
  ON product_search USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_product_search_author_trigram
  ON product_search USING GIN (author gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_product_search_category
  ON product_search (category);

CREATE INDEX IF NOT EXISTS idx_product_search_updated_at
  ON product_search (updated_at DESC);

-- Create a function for similarity search
CREATE OR REPLACE FUNCTION search_products(
  query_text TEXT,
  limit_count INT DEFAULT 20,
  offset_count INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  author TEXT,
  description TEXT,
  category TEXT,
  isbn TEXT,
  rank REAL,
  similarity REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.title,
    p.author,
    p.description,
    p.category,
    p.isbn,
    ts_rank(p.search_vector, websearch_to_tsquery('english', query_text)) as rank,
    GREATEST(
      similarity(p.title, query_text),
      similarity(p.author, query_text)
    ) as similarity
  FROM product_search p
  WHERE
    p.search_vector @@ websearch_to_tsquery('english', query_text)
    OR p.title % query_text
    OR p.author % query_text
  ORDER BY rank DESC, similarity DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql;

-- Create function for autocomplete suggestions
CREATE OR REPLACE FUNCTION autocomplete_products(
  prefix TEXT,
  limit_count INT DEFAULT 5
)
RETURNS TABLE (
  suggestion TEXT,
  type TEXT
) AS $$
BEGIN
  RETURN QUERY
  -- Title suggestions
  SELECT DISTINCT
    p.title as suggestion,
    'title'::TEXT as type
  FROM product_search p
  WHERE p.title ILIKE prefix || '%'
  LIMIT limit_count

  UNION ALL

  -- Author suggestions
  SELECT DISTINCT
    p.author as suggestion,
    'author'::TEXT as type
  FROM product_search p
  WHERE p.author ILIKE prefix || '%'
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_product_search_updated_at
  BEFORE UPDATE ON product_search
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE product_search IS 'Optimized table for full-text product search using PostgreSQL native features';
COMMENT ON COLUMN product_search.search_vector IS 'Generated tsvector column for full-text search with weighted fields';
COMMENT ON FUNCTION search_products IS 'Full-text search function with ranking and fuzzy matching';
COMMENT ON FUNCTION autocomplete_products IS 'Autocomplete function for search suggestions';
