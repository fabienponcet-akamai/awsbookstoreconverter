-- Main Database Extensions
-- This file is executed during PostgreSQL initialization

-- Enable required extensions for the main database
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Note: pg_trgm and other search extensions are installed in the search database
-- Note: Graph database uses standard relational tables for recommendations
