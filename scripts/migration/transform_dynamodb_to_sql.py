#!/usr/bin/env python3
"""
Transform DynamoDB JSON export to PostgreSQL SQL

Usage:
  python transform_dynamodb_to_sql.py \
    --input ./data/dynamodb/books.json \
    --output ./data/sql/books.sql \
    --table books
"""
import json
import sys
import argparse
from typing import Any, Dict, List
from datetime import datetime


def dynamodb_to_postgres_value(value: Dict[str, Any]) -> str:
    """Convert DynamoDB typed value to PostgreSQL value"""
    if 'S' in value:  # String
        escaped = value['S'].replace("'", "''").replace("\\", "\\\\")
        return f"'{escaped}'"
    elif 'N' in value:  # Number
        return value['N']
    elif 'BOOL' in value:  # Boolean
        return 'TRUE' if value['BOOL'] else 'FALSE'
    elif 'NULL' in value:
        return 'NULL'
    elif 'M' in value:  # Map (convert to JSONB)
        # Recursively convert nested map
        converted = {k: dynamodb_to_postgres_value(v) for k, v in value['M'].items()}
        json_str = json.dumps(converted).replace("'", "''")
        return f"'{json_str}'::jsonb"
    elif 'L' in value:  # List (convert to JSONB)
        converted = [dynamodb_to_postgres_value(item) for item in value['L']]
        json_str = json.dumps(converted).replace("'", "''")
        return f"'{json_str}'::jsonb"
    elif 'SS' in value:  # String Set
        items = [f"'{s.replace(chr(39), chr(39)+chr(39))}'" for s in value['SS']]
        return f"ARRAY[{', '.join(items)}]"
    elif 'NS' in value:  # Number Set
        return f"ARRAY[{', '.join(value['NS'])}]"
    else:
        return 'NULL'


def transform_books_table(dynamodb_items: List[Dict[str, Any]]) -> List[str]:
    """Transform Books table from DynamoDB to PostgreSQL"""
    sql_statements = []

    for item in dynamodb_items:
        book_id = dynamodb_to_postgres_value(item.get('id', {'S': ''}))
        category = dynamodb_to_postgres_value(item.get('category', {'S': 'General'}))
        title = dynamodb_to_postgres_value(item.get('title', {'S': 'Untitled'}))
        author = dynamodb_to_postgres_value(item.get('author', {'S': 'Unknown'}))
        price = dynamodb_to_postgres_value(item.get('price', {'N': '0'}))
        description = dynamodb_to_postgres_value(item.get('description', {'S': ''}))
        image_url = dynamodb_to_postgres_value(item.get('cover', {'S': ''}))

        sql = f"""INSERT INTO books (id, category, title, author, price, description, image_url, created_at)
VALUES ({book_id}, {category}, {title}, {author}, {price}, {description}, {image_url}, NOW())
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  title = EXCLUDED.title,
  author = EXCLUDED.author,
  price = EXCLUDED.price,
  description = EXCLUDED.description,
  image_url = EXCLUDED.image_url,
  updated_at = NOW();"""

        sql_statements.append(sql)

    return sql_statements


def transform_orders_table(dynamodb_items: List[Dict[str, Any]]) -> List[str]:
    """Transform Orders table from DynamoDB to PostgreSQL"""
    sql_statements = []

    for item in dynamodb_items:
        order_id = dynamodb_to_postgres_value(item.get('orderId', {'S': ''}))
        user_id = dynamodb_to_postgres_value(item.get('userId', {'S': ''}))
        total = dynamodb_to_postgres_value(item.get('total', {'N': '0'}))
        status = dynamodb_to_postgres_value(item.get('status', {'S': 'pending'}))

        # Convert items list to JSONB
        items_list = item.get('items', {'L': []})
        items_jsonb = dynamodb_to_postgres_value(items_list)

        created_timestamp = item.get('createdAt', {'N': str(int(datetime.now().timestamp()))})
        created_at = f"to_timestamp({dynamodb_to_postgres_value(created_timestamp)})"

        sql = f"""INSERT INTO orders (id, user_id, total, status, items, created_at)
VALUES ({order_id}, {user_id}, {total}, {status}, {items_jsonb}, {created_at})
ON CONFLICT (id) DO UPDATE SET
  total = EXCLUDED.total,
  status = EXCLUDED.status,
  items = EXCLUDED.items,
  updated_at = NOW();"""

        sql_statements.append(sql)

    return sql_statements


def transform_cart_table(dynamodb_items: List[Dict[str, Any]]) -> List[str]:
    """Transform Cart table from DynamoDB to PostgreSQL"""
    sql_statements = []

    for item in dynamodb_items:
        user_id = dynamodb_to_postgres_value(item.get('userId', {'S': ''}))
        book_id = dynamodb_to_postgres_value(item.get('bookId', {'S': ''}))
        quantity = dynamodb_to_postgres_value(item.get('quantity', {'N': '1'}))

        sql = f"""INSERT INTO cart_items (user_id, book_id, quantity, added_at)
VALUES ({user_id}, {book_id}, {quantity}, NOW())
ON CONFLICT (user_id, book_id) DO UPDATE SET
  quantity = EXCLUDED.quantity,
  added_at = NOW();"""

        sql_statements.append(sql)

    return sql_statements


def main():
    parser = argparse.ArgumentParser(description='Transform DynamoDB JSON to PostgreSQL SQL')
    parser.add_argument('--input', required=True, help='Input DynamoDB JSON file')
    parser.add_argument('--output', required=True, help='Output SQL file')
    parser.add_argument('--table', required=True, choices=['books', 'orders', 'cart'],
                       help='Table name to transform')
    parser.add_argument('--batch-size', type=int, default=1000,
                       help='Number of INSERT statements per transaction (default: 1000)')
    args = parser.parse_args()

    # Read DynamoDB export
    with open(args.input, 'r', encoding='utf-8') as f:
        dynamodb_data = json.load(f)

    items = dynamodb_data.get('Items', [])
    print(f"📦 Loaded {len(items)} items from {args.input}")

    # Transform based on table type
    if args.table == 'books':
        sql_statements = transform_books_table(items)
        truncate_sql = "TRUNCATE TABLE books CASCADE;"
    elif args.table == 'orders':
        sql_statements = transform_orders_table(items)
        truncate_sql = "TRUNCATE TABLE orders CASCADE;"
    elif args.table == 'cart':
        sql_statements = transform_cart_table(items)
        truncate_sql = "TRUNCATE TABLE cart_items CASCADE;"
    else:
        print(f"❌ Unknown table: {args.table}")
        sys.exit(1)

    # Write SQL file with batching
    with open(args.output, 'w', encoding='utf-8') as f:
        f.write("-- Auto-generated from DynamoDB export\n")
        f.write(f"-- Source: {args.input}\n")
        f.write(f"-- Table: {args.table}\n")
        f.write(f"-- Generated: {datetime.now().isoformat()}\n\n")

        # Truncate table
        f.write(f"{truncate_sql}\n\n")

        # Write in batches
        for i in range(0, len(sql_statements), args.batch_size):
            batch = sql_statements[i:i + args.batch_size]

            f.write("BEGIN;\n\n")
            f.write("\n".join(batch))
            f.write("\n\nCOMMIT;\n\n")

            print(f"✅ Batch {i // args.batch_size + 1}/{(len(sql_statements) + args.batch_size - 1) // args.batch_size} written")

    print(f"✅ Transformed {len(sql_statements)} statements → {args.output}")
    print(f"\n📊 Import with:")
    print(f"   kubectl exec -n bookstore bookstore-main-1 -- \\")
    print(f"     psql -U postgres -d bookstore -f /tmp/{args.output.split('/')[-1]}")


if __name__ == "__main__":
    main()
