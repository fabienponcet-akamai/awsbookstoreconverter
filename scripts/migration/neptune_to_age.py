#!/usr/bin/env python3
"""
Transform Neptune Graph export to Apache AGE Cypher

Usage:
  python neptune_to_age.py \
    --vertices ./data/neptune/vertices.csv \
    --edges ./data/neptune/edges.csv \
    --db-host bookstore-graph-rw.bookstore.svc.cluster.local \
    --db-name bookstore_graph \
    --graph-name recommendations
"""
import csv
import argparse
import psycopg2
import os
import sys
from typing import Dict, Any, List


class NeptuneToAGEMigrator:
    def __init__(self, db_host: str, db_port: int, db_name: str,
                 db_user: str, db_password: str, graph_name: str):
        self.graph_name = graph_name
        self.conn = psycopg2.connect(
            host=db_host,
            port=db_port,
            database=db_name,
            user=db_user,
            password=db_password
        )
        self.conn.autocommit = True
        self.cur = self.conn.cursor()

        # Enable AGE extension
        self.cur.execute("CREATE EXTENSION IF NOT EXISTS age;")
        self.cur.execute("LOAD 'age';")
        self.cur.execute("SET search_path = ag_catalog, \"$user\", public;")

    def create_graph(self):
        """Create graph if not exists"""
        try:
            self.cur.execute(
                f"SELECT ag_catalog.create_graph('{self.graph_name}');"
            )
            print(f"✅ Created graph '{self.graph_name}'")
        except psycopg2.errors.DuplicateObject:
            print(f"ℹ️  Graph '{self.graph_name}' already exists")
            self.conn.rollback()

    def escape_cypher_string(self, value: str) -> str:
        """Escape string for Cypher"""
        return value.replace("\\", "\\\\").replace("'", "\\'").replace('"', '\\"')

    def import_vertices(self, csv_file: str):
        """Import vertices (nodes) from Neptune CSV export"""
        print(f"\n📊 Importing vertices from {csv_file}...")

        vertex_count = 0
        with open(csv_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)

            for row in reader:
                vertex_id = row.get('~id', '')
                label = row.get('~label', 'Node')

                # Extract properties (exclude system columns starting with ~)
                properties = {k: v for k, v in row.items()
                             if not k.startswith('~') and v}

                # Build properties string
                props_list = [f"{k}: '{self.escape_cypher_string(v)}'"
                             for k, v in properties.items()]
                props_str = ", ".join(props_list) if props_list else ""

                # Construct Cypher CREATE statement
                if props_str:
                    cypher = f"""
                    SELECT * FROM cypher('{self.graph_name}', $$
                        CREATE (n:{label} {{id: '{vertex_id}', {props_str}}})
                        RETURN n
                    $$) as (v agtype);
                    """
                else:
                    cypher = f"""
                    SELECT * FROM cypher('{self.graph_name}', $$
                        CREATE (n:{label} {{id: '{vertex_id}'}})
                        RETURN n
                    $$) as (v agtype);
                    """

                try:
                    self.cur.execute(cypher)
                    vertex_count += 1

                    if vertex_count % 100 == 0:
                        print(f"  ✓ Imported {vertex_count} vertices...")

                except Exception as e:
                    print(f"  ⚠️  Failed to import vertex {vertex_id}: {e}")
                    continue

        print(f"✅ Imported {vertex_count} vertices total")
        return vertex_count

    def import_edges(self, csv_file: str):
        """Import edges (relationships) from Neptune CSV export"""
        print(f"\n📊 Importing edges from {csv_file}...")

        edge_count = 0
        with open(csv_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)

            for row in reader:
                from_id = row.get('~from', '')
                to_id = row.get('~to', '')
                edge_label = row.get('~label', 'RELATED_TO')

                # Extract properties
                properties = {k: v for k, v in row.items()
                             if not k.startswith('~') and v}

                # Build properties string
                props_list = [f"{k}: '{self.escape_cypher_string(v)}'"
                             for k, v in properties.items()]
                props_str = ", ".join(props_list) if props_list else ""

                # Construct Cypher MATCH + CREATE statement
                if props_str:
                    cypher = f"""
                    SELECT * FROM cypher('{self.graph_name}', $$
                        MATCH (a {{id: '{from_id}'}}), (b {{id: '{to_id}'}})
                        CREATE (a)-[r:{edge_label} {{{props_str}}}]->(b)
                        RETURN r
                    $$) as (e agtype);
                    """
                else:
                    cypher = f"""
                    SELECT * FROM cypher('{self.graph_name}', $$
                        MATCH (a {{id: '{from_id}'}}), (b {{id: '{to_id}'}})
                        CREATE (a)-[r:{edge_label}]->(b)
                        RETURN r
                    $$) as (e agtype);
                    """

                try:
                    self.cur.execute(cypher)
                    edge_count += 1

                    if edge_count % 100 == 0:
                        print(f"  ✓ Imported {edge_count} edges...")

                except Exception as e:
                    print(f"  ⚠️  Failed to import edge {from_id} → {to_id}: {e}")
                    continue

        print(f"✅ Imported {edge_count} edges total")
        return edge_count

    def validate_migration(self):
        """Validate the migration by counting nodes and edges"""
        print("\n🔍 Validating migration...")

        # Count vertices
        self.cur.execute(f"""
        SELECT * FROM cypher('{self.graph_name}', $$
            MATCH (n)
            RETURN count(n)
        $$) as (count agtype);
        """)
        vertex_count = self.cur.fetchone()[0]
        print(f"  📊 Total vertices: {vertex_count}")

        # Count edges
        self.cur.execute(f"""
        SELECT * FROM cypher('{self.graph_name}', $$
            MATCH ()-[r]->()
            RETURN count(r)
        $$) as (count agtype);
        """)
        edge_count = self.cur.fetchone()[0]
        print(f"  📊 Total edges: {edge_count}")

        # Sample query: Find nodes with most connections
        print("\n  📊 Top 5 most connected nodes:")
        self.cur.execute(f"""
        SELECT * FROM cypher('{self.graph_name}', $$
            MATCH (n)-[r]-()
            RETURN n.id, count(r) as connections
            ORDER BY connections DESC
            LIMIT 5
        $$) as (node_id agtype, connections agtype);
        """)

        for row in self.cur.fetchall():
            print(f"     - Node {row[0]}: {row[1]} connections")

        return vertex_count, edge_count

    def close(self):
        """Close database connection"""
        self.cur.close()
        self.conn.close()


def main():
    parser = argparse.ArgumentParser(description='Migrate Neptune graph to Apache AGE')
    parser.add_argument('--vertices', required=True,
                       help='Path to vertices CSV file from Neptune export')
    parser.add_argument('--edges', required=True,
                       help='Path to edges CSV file from Neptune export')
    parser.add_argument('--db-host', required=True,
                       help='PostgreSQL host (e.g., bookstore-graph-rw.bookstore.svc.cluster.local)')
    parser.add_argument('--db-port', type=int, default=5432,
                       help='PostgreSQL port (default: 5432)')
    parser.add_argument('--db-name', default='bookstore_graph',
                       help='Database name (default: bookstore_graph)')
    parser.add_argument('--db-user', default='postgres',
                       help='Database user (default: postgres)')
    parser.add_argument('--db-password',
                       default=os.getenv('POSTGRES_PASSWORD', ''),
                       help='Database password (or set POSTGRES_PASSWORD env var)')
    parser.add_argument('--graph-name', default='recommendations',
                       help='Graph name in AGE (default: recommendations)')

    args = parser.parse_args()

    if not args.db_password:
        print("❌ Database password required (use --db-password or POSTGRES_PASSWORD env var)")
        sys.exit(1)

    # Initialize migrator
    migrator = NeptuneToAGEMigrator(
        db_host=args.db_host,
        db_port=args.db_port,
        db_name=args.db_name,
        db_user=args.db_user,
        db_password=args.db_password,
        graph_name=args.graph_name
    )

    print(f"🚀 Starting Neptune → Apache AGE migration")
    print(f"   Graph: {args.graph_name}")
    print(f"   Database: {args.db_name}@{args.db_host}")

    try:
        # Create graph
        migrator.create_graph()

        # Import vertices
        vertex_count = migrator.import_vertices(args.vertices)

        # Import edges
        edge_count = migrator.import_edges(args.edges)

        # Validate
        migrator.validate_migration()

        print(f"\n✅ Migration completed successfully!")
        print(f"   📊 Imported {vertex_count} vertices and {edge_count} edges")

    except Exception as e:
        print(f"\n❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    finally:
        migrator.close()


if __name__ == "__main__":
    main()
