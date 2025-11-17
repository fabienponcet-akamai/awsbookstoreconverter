# 🔄 Data Migration Scripts

Scripts for migrating data from AWS Bookstore to APL/LKE infrastructure.

## Overview

These scripts facilitate the migration of all AWS Bookstore data to the new CNCF-based infrastructure:

| Script | Purpose | Input | Output |
|--------|---------|-------|--------|
| **transform_dynamodb_to_sql.py** | DynamoDB → PostgreSQL | DynamoDB JSON export | SQL statements |
| **neptune_to_age.py** | Neptune Graph → Apache AGE | CSV (vertices, edges) | Direct DB import |
| **cognito_to_keycloak.py** | Cognito Users → Keycloak | Cognito JSON export | Keycloak JSON import |
| **validate_migration.sh** | Validate migration | - | Validation report |

---

## Prerequisites

### System Requirements

```bash
# Python 3.9+
python3 --version

# AWS CLI
aws --version

# kubectl (connected to target cluster)
kubectl version --client

# s3cmd (for Object Storage)
s3cmd --version

# jq (JSON processor)
jq --version
```

### Python Dependencies

```bash
pip install -r requirements.txt
```

**requirements.txt**:
```
psycopg2-binary>=2.9.0
boto3>=1.26.0
requests>=2.28.0
```

---

## 1. DynamoDB → PostgreSQL Migration

### Step 1: Export from DynamoDB

```bash
# Export Books table
aws dynamodb export-table-to-point-in-time \
  --table-arn arn:aws:dynamodb:us-east-1:ACCOUNT:table/Books \
  --s3-bucket bookstore-migration \
  --s3-prefix dynamodb-exports/books/ \
  --export-format DYNAMODB_JSON

# Wait for export to complete
aws dynamodb describe-export \
  --export-arn <export-arn-from-above>

# Download export
aws s3 sync s3://bookstore-migration/dynamodb-exports/ ./data/dynamodb/
```

### Step 2: Transform to SQL

```bash
# Books table
python transform_dynamodb_to_sql.py \
  --input ./data/dynamodb/books/data/manifest-files.json \
  --output ./data/sql/books.sql \
  --table books

# Orders table
python transform_dynamodb_to_sql.py \
  --input ./data/dynamodb/orders/data/manifest-files.json \
  --output ./data/sql/orders.sql \
  --table orders

# Cart table
python transform_dynamodb_to_sql.py \
  --input ./data/dynamodb/cart/data/manifest-files.json \
  --output ./data/sql/cart.sql \
  --table cart
```

### Step 3: Import to PostgreSQL

```bash
# Copy SQL to pod
kubectl cp ./data/sql/books.sql bookstore/bookstore-main-1:/tmp/books.sql

# Import
kubectl exec -n bookstore bookstore-main-1 -- \
  psql -U postgres -d bookstore -f /tmp/books.sql

# Verify
kubectl exec -n bookstore bookstore-main-1 -- \
  psql -U postgres -d bookstore -c "SELECT COUNT(*) FROM books;"
```

**Options:**

- `--batch-size`: Number of INSERT statements per transaction (default: 1000)
  - Use smaller batches for memory-constrained environments
  - Use larger batches for faster imports

---

## 2. Neptune → Apache AGE Migration

### Step 1: Export from Neptune

```bash
# Create snapshot
aws neptune create-db-cluster-snapshot \
  --db-cluster-snapshot-identifier bookstore-graph-snapshot \
  --db-cluster-identifier bookstore-neptune-cluster

# Export to S3 as CSV
aws neptune-data export-graph \
  --graph-identifier bookstore-neptune-cluster \
  --s3-bucket bookstore-migration \
  --s3-prefix neptune-export/ \
  --format CSV

# Download export
aws s3 sync s3://bookstore-migration/neptune-export/ ./data/neptune/
```

### Step 2: Import to Apache AGE

```bash
# Set PostgreSQL password
export POSTGRES_PASSWORD=$(kubectl get secret -n bookstore bookstore-graph-superuser \
  -o jsonpath='{.data.password}' | base64 -d)

# Run migration
python neptune_to_age.py \
  --vertices ./data/neptune/vertices.csv \
  --edges ./data/neptune/edges.csv \
  --db-host bookstore-graph-rw.bookstore.svc.cluster.local \
  --db-name bookstore_graph \
  --graph-name recommendations

# Verify
kubectl exec -n bookstore bookstore-graph-1 -- \
  psql -U postgres -d bookstore_graph -c \
  "SELECT * FROM cypher('recommendations', \$\$ MATCH (n) RETURN count(n) \$\$) as (count agtype);"
```

**Notes:**

- The script automatically converts Gremlin graph structure to Cypher
- Handles vertex/edge properties and labels
- Creates the graph if it doesn't exist

---

## 3. Cognito → Keycloak Migration

### Step 1: Export from Cognito

```bash
# Export users (max 60 per call, paginate for more)
aws cognito-idp list-users \
  --user-pool-id us-east-1_XXXXXXXXX \
  --max-results 60 > cognito-users-page1.json

# For pagination
aws cognito-idp list-users \
  --user-pool-id us-east-1_XXXXXXXXX \
  --pagination-token <token-from-previous-call> \
  --max-results 60 > cognito-users-page2.json

# Merge multiple pages if needed
jq -s '{"Users": [.[].Users[]] }' cognito-users-*.json > cognito-users-all.json
```

### Step 2: Transform for Keycloak

```bash
# Transform users
python cognito_to_keycloak.py \
  --input cognito-users-all.json \
  --output keycloak-users.json \
  --realm bookstore

# With full realm export
python cognito_to_keycloak.py \
  --input cognito-users-all.json \
  --output keycloak-realm-export.json \
  --realm bookstore \
  --export-realm
```

### Step 3: Import to Keycloak

**Method 1: Via Admin API**

```bash
# Get admin token
KC_TOKEN=$(curl -X POST "https://auth.bookstore.example.com/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" \
  -d "username=admin" \
  -d "password=$KC_ADMIN_PASSWORD" \
  -d "grant_type=password" | jq -r '.access_token')

# Import users
jq -c '.users[]' keycloak-users.json | while read user; do
  curl -X POST "https://auth.bookstore.example.com/admin/realms/bookstore/users" \
    -H "Authorization: Bearer $KC_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$user"
done

# Verify
curl -X GET "https://auth.bookstore.example.com/admin/realms/bookstore/users/count" \
  -H "Authorization: Bearer $KC_TOKEN"
```

**Method 2: Via Admin Console**

1. Navigate to https://auth.bookstore.example.com/admin
2. Select realm: **bookstore**
3. Go to: **Manage** → **Import**
4. Upload: `keycloak-realm-export.json`
5. Select: **Overwrite** or **Skip** for existing users

**Important:** Users must reset passwords on first login (Cognito passwords cannot be exported).

---

## 4. Validate Migration

### Run Full Validation

```bash
# Set environment
export NAMESPACE=bookstore
export KC_ADMIN_PASSWORD=<keycloak-admin-password>
export AWS_BOOKS_TABLE=Books
export AWS_COGNITO_POOL=us-east-1_XXXXXXXXX

# Run validation
./validate_migration.sh
```

### Output Example

```
========================================
  AWS Bookstore Migration Validation
========================================

1. Validating PostgreSQL Main Database
----------------------------------------
✅ PostgreSQL main pod found
✅ Database 'bookstore' exists
ℹ️  Books count in PostgreSQL: 1523
ℹ️  Books count in AWS DynamoDB: 1523
✅ Books count matches AWS DynamoDB
✅ Data sampling successful

2. Validating Apache AGE Graph Database
----------------------------------------
✅ PostgreSQL graph pod found
✅ Apache AGE extension installed
ℹ️  Graph vertices count: 2456
✅ Graph has 2456 vertices
ℹ️  Graph edges count: 8932
✅ Graph has 8932 edges

3. Validating Full-Text Search
----------------------------------------
✅ Full-text search index exists
✅ Full-text search working (342 results for 'book')

4. Validating Keycloak Users
----------------------------------------
✅ Keycloak admin token obtained
ℹ️  Keycloak users count: 487
ℹ️  Cognito users count: 487
✅ Keycloak users count matches Cognito

5. Validating Object Storage
----------------------------------------
✅ Object Storage bucket 'bookstore-assets' accessible
ℹ️  Object count in bucket: 1523
✅ Bucket has 1523 objects

========================================
  Validation Summary
========================================

✅ All validations passed! ✅

Migration appears successful with no issues detected.
```

---

## Troubleshooting

### DynamoDB Export Timeout

**Problem:** Export takes too long for large tables

**Solution:** Use parallel exports with filters

```bash
# Export by category
aws dynamodb scan --table-name Books \
  --filter-expression "category = :cat" \
  --expression-attribute-values '{":cat":{"S":"Fiction"}}' \
  --output json > books-fiction.json
```

### PostgreSQL Import Memory Issues

**Problem:** Out of memory during large imports

**Solution:** Reduce batch size

```bash
python transform_dynamodb_to_sql.py \
  --input data.json \
  --output data.sql \
  --table books \
  --batch-size 100  # Smaller batches
```

### Neptune Export Permission Denied

**Problem:** Cannot export Neptune to S3

**Solution:** Add IAM role to Neptune cluster

```bash
aws neptune add-role-to-db-cluster \
  --db-cluster-identifier bookstore-neptune-cluster \
  --role-arn arn:aws:iam::ACCOUNT:role/NeptuneS3ExportRole
```

### Keycloak User Import Rate Limit

**Problem:** Too many requests to Keycloak API

**Solution:** Add delays between requests

```bash
jq -c '.users[]' keycloak-users.json | while read user; do
  curl -X POST ... -d "$user"
  sleep 0.5  # Add 500ms delay
done
```

### AGE Graph Query Fails

**Problem:** Cypher queries timeout or fail

**Solution:** Increase statement timeout

```bash
kubectl exec -n bookstore bookstore-graph-1 -- \
  psql -U postgres -d bookstore_graph -c "SET statement_timeout = '1h';"
```

---

## Best Practices

### 1. Always Test in Staging First

```bash
# Run migration on staging environment
export NAMESPACE=bookstore-staging
./validate_migration.sh
```

### 2. Keep Backups

```bash
# Backup AWS data before migration
aws dynamodb create-backup --table-name Books --backup-name books-pre-migration
aws neptune create-db-cluster-snapshot --db-cluster-snapshot-identifier graph-pre-migration
```

### 3. Validate Data Integrity

```bash
# Sample and compare data
python -c "
import boto3, psycopg2
# Compare sample books from DynamoDB vs PostgreSQL
"
```

### 4. Monitor Performance

```bash
# Watch PostgreSQL during import
kubectl top pod -n bookstore bookstore-main-1

# Check import progress
kubectl logs -n bookstore bookstore-main-1 -f | grep INSERT
```

---

## Migration Checklist

- [ ] Export all DynamoDB tables
- [ ] Transform DynamoDB JSON to SQL
- [ ] Import to CloudNative-PG
- [ ] Export Neptune graph
- [ ] Import to Apache AGE
- [ ] Export Cognito users
- [ ] Import to Keycloak
- [ ] Sync S3 to Object Storage
- [ ] Run validation script
- [ ] Verify sample data
- [ ] Test application end-to-end
- [ ] Monitor for 24 hours
- [ ] Archive AWS resources

---

## Support

For issues or questions:

1. Check [MIGRATION_DATA_GUIDE.md](../../docs/MIGRATION_DATA_GUIDE.md) for detailed procedures
2. Review script output and error messages
3. Check Kubernetes logs: `kubectl logs -n bookstore <pod-name>`
4. Validate network connectivity to databases

## License

MIT
