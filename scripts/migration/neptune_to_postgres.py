#!/usr/bin/env python3
"""
Transform Neptune Graph export to PostgreSQL relational schema

Usage:
  python neptune_to_postgres.py \
    --vertices ./data/neptune/vertices.csv \
    --edges ./data/neptune/edges.csv \
    --db-host bookstore-graph-rw.bookstore.svc.cluster.local \
    --db-name bookstore_graph \
    --db-user bookstore \
    --db-password <password>
"""
import csv
import argparse
import psycopg2
import os
import sys
from typing import Dict, Any, List
from datetime import datetime


class NeptuneToPostgresMigrator:
    def __init__(self, db_host: str, db_port: int, db_name: str,
                 db_user: str, db_password: str):
        self.conn = psycopg2.connect(
            host=db_host,
            port=db_port,
            database=db_name,
            user=db_user,
            password=db_password
        )
        self.conn.autocommit = False
        self.cur = self.conn.cursor()

    def migrate_vertices(self, vertices_file: str):
        """
        Migrate vertices from Neptune CSV to PostgreSQL tables

        Expected CSV format:
        ~id,~label,property1,property2,...
        """
        print(f"📖 Reading vertices from {vertices_file}")

        users_count = 0
        books_count = 0

        with open(vertices_file, 'r') as f:
            reader = csv.DictReader(f)

            for row in reader:
                vertex_id = row.get('~id')
                vertex_label = row.get('~label')

                if vertex_label == 'User':
                    # Extract user properties
                    keycloak_id = row.get('keycloakId', vertex_id)
                    email = row.get('email', '')
                    name = row.get('name', '')

                    self.cur.execute(
                        """
                        INSERT INTO graph_users (id, keycloak_id, email, name)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            keycloak_id = EXCLUDED.keycloak_id,
                            email = EXCLUDED.email,
                            name = EXCLUDED.name,
                            updated_at = CURRENT_TIMESTAMP
                        """,
                        (vertex_id, keycloak_id, email, name)
                    )
                    users_count += 1

                elif vertex_label == 'Book':
                    # Extract book properties
                    isbn = row.get('isbn', '')
                    title = row.get('title', '')
                    author = row.get('author', '')

                    self.cur.execute(
                        """
                        INSERT INTO graph_books (id, isbn, title, author)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            isbn = EXCLUDED.isbn,
                            title = EXCLUDED.title,
                            author = EXCLUDED.author,
                            updated_at = CURRENT_TIMESTAMP
                        """,
                        (vertex_id, isbn, title, author)
                    )
                    books_count += 1

        self.conn.commit()
        print(f"✅ Migrated {users_count} users")
        print(f"✅ Migrated {books_count} books")

    def migrate_edges(self, edges_file: str):
        """
        Migrate edges from Neptune CSV to PostgreSQL relationship tables

        Expected CSV format:
        ~id,~label,~from,~to,property1,property2,...
        """
        print(f"📖 Reading edges from {edges_file}")

        purchases_count = 0
        ratings_count = 0

        with open(edges_file, 'r') as f:
            reader = csv.DictReader(f)

            for row in reader:
                edge_label = row.get('~label')
                from_id = row.get('~from')
                to_id = row.get('~to')

                if edge_label == 'PURCHASED':
                    # Extract purchase properties
                    price = float(row.get('price', 0))
                    purchase_date_str = row.get('date', row.get('timestamp', ''))

                    # Parse date
                    try:
                        if purchase_date_str:
                            purchase_date = datetime.fromisoformat(purchase_date_str.replace('Z', '+00:00'))
                        else:
                            purchase_date = datetime.now()
                    except:
                        purchase_date = datetime.now()

                    self.cur.execute(
                        """
                        INSERT INTO graph_purchases (user_id, book_id, price, purchase_date)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (user_id, book_id, purchase_date) DO NOTHING
                        """,
                        (from_id, to_id, price, purchase_date)
                    )
                    purchases_count += 1

                elif edge_label == 'RATED':
                    # Extract rating properties
                    rating = int(row.get('rating', 0))

                    if rating >= 1 and rating <= 5:
                        self.cur.execute(
                            """
                            INSERT INTO graph_ratings (user_id, book_id, rating)
                            VALUES (%s, %s, %s)
                            ON CONFLICT (user_id, book_id) DO UPDATE SET
                                rating = EXCLUDED.rating,
                                updated_at = CURRENT_TIMESTAMP
                            """,
                            (from_id, to_id, rating)
                        )
                        ratings_count += 1

        self.conn.commit()
        print(f"✅ Migrated {purchases_count} purchases")
        print(f"✅ Migrated {ratings_count} ratings")

    def verify_migration(self):
        """Verify migration by counting records"""
        print("\n📊 Verification:")

        self.cur.execute("SELECT COUNT(*) FROM graph_users")
        users = self.cur.fetchone()[0]
        print(f"   Users: {users}")

        self.cur.execute("SELECT COUNT(*) FROM graph_books")
        books = self.cur.fetchone()[0]
        print(f"   Books: {books}")

        self.cur.execute("SELECT COUNT(*) FROM graph_purchases")
        purchases = self.cur.fetchone()[0]
        print(f"   Purchases: {purchases}")

        self.cur.execute("SELECT COUNT(*) FROM graph_ratings")
        ratings = self.cur.fetchone()[0]
        print(f"   Ratings: {ratings}")

    def close(self):
        """Close database connection"""
        self.cur.close()
        self.conn.close()


def main():
    parser = argparse.ArgumentParser(
        description='Migrate Neptune graph data to PostgreSQL relational schema'
    )
    parser.add_argument('--vertices', required=True, help='Path to vertices CSV file')
    parser.add_argument('--edges', required=True, help='Path to edges CSV file')
    parser.add_argument('--db-host', required=True, help='Database host')
    parser.add_argument('--db-port', type=int, default=5432, help='Database port')
    parser.add_argument('--db-name', required=True, help='Database name')
    parser.add_argument('--db-user', default='bookstore', help='Database user')
    parser.add_argument('--db-password', help='Database password (or set PGPASSWORD env var)')

    args = parser.parse_args()

    # Get password from env or args
    db_password = args.db_password or os.getenv('PGPASSWORD')
    if not db_password:
        print("❌ Error: Database password required (--db-password or PGPASSWORD env var)")
        sys.exit(1)

    print("🚀 Starting Neptune to PostgreSQL migration")
    print(f"   Host: {args.db_host}:{args.db_port}")
    print(f"   Database: {args.db_name}")
    print(f"   User: {args.db_user}")

    try:
        migrator = NeptuneToPostgresMigrator(
            db_host=args.db_host,
            db_port=args.db_port,
            db_name=args.db_name,
            db_user=args.db_user,
            db_password=db_password
        )

        # Migrate vertices
        migrator.migrate_vertices(args.vertices)

        # Migrate edges
        migrator.migrate_edges(args.edges)

        # Verify
        migrator.verify_migration()

        migrator.close()

        print("\n✅ Migration completed successfully!")

    except Exception as e:
        print(f"\n❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
