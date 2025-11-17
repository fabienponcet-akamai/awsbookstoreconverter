# 🔄 Guide de Migration des Données - AWS Bookstore vers APL/LKE

## Vue d'Ensemble

Ce document décrit la stratégie complète de migration des données depuis l'AWS Bookstore Demo vers l'infrastructure APL/LKE avec stack CNCF.

---

## 📊 Mapping des Services de Données

### Inventaire des Données à Migrer

| Service AWS | Données | Service Cible | Méthode de Migration |
|-------------|---------|---------------|----------------------|
| **DynamoDB** | Books, Cart, Orders | **CloudNative-PG (Main)** | DMS + Transformation |
| **Neptune** | Recommendations Graph | **Apache AGE (PostgreSQL)** | Export Gremlin → Cypher |
| **ElasticSearch** | Search Index | **PostgreSQL FTS** | Rebuild from source |
| **Cognito** | Users, Auth | **Keycloak** | Export → Import |
| **S3** | Book Covers, Assets | **Linode Object Storage** | s3cmd sync |
| **CloudWatch** | Logs (optionnel) | **Loki/Prometheus** | Rebuild (pas de migration) |

---

## 🎯 Stratégies de Migration

### Option 1 : Migration à Froid (Recommandée pour MVP)

**Downtime** : 2-4 heures

```
┌─────────────────────────────────────────────────────────────┐
│                    MIGRATION À FROID                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Freeze AWS App (maintenance mode)        [00:00]        │
│  2. Export DynamoDB → S3                      [00:15]        │
│  3. Export Neptune → RDF/Gremlin              [00:30]        │
│  4. Export Cognito Users → JSON               [00:05]        │
│  5. Transform & Load PostgreSQL               [01:00]        │
│  6. Transform & Load Apache AGE               [00:30]        │
│  7. Import Keycloak Users                     [00:15]        │
│  8. Sync S3 → Object Storage                  [00:30]        │
│  9. Validation & Testing                      [00:30]        │
│  10. Switch DNS to new infrastructure         [00:05]        │
│                                                              │
│  Total Downtime: ~3h30m                                      │
└─────────────────────────────────────────────────────────────┘
```

**Avantages** :
- ✅ Simple et prévisible
- ✅ Pas de synchronisation complexe
- ✅ Rollback facile (DNS switch back)

**Inconvénients** :
- ❌ Downtime de 2-4h
- ❌ Pression temporelle pendant la migration

### Option 2 : Migration Blue-Green (Zero Downtime)

**Downtime** : < 5 minutes

```
┌─────────────────────────────────────────────────────────────┐
│                  MIGRATION BLUE-GREEN                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Phase 1: Préparation (J-7 à J-1)                           │
│  ├─ Setup dual-write proxies                                │
│  ├─ Initial bulk data migration                             │
│  └─ Continuous replication (CDC)                            │
│                                                              │
│  Phase 2: Synchronisation (J-1)                             │
│  ├─ Catch-up replication                                    │
│  ├─ Data validation                                         │
│  └─ Performance testing                                     │
│                                                              │
│  Phase 3: Cutover (J-Day)                                   │
│  ├─ Stop writes to AWS (read-only)           [5 min]       │
│  ├─ Final sync                                [2 min]       │
│  ├─ Switch DNS to APL/LKE                     [1 min]       │
│  └─ Enable writes on new stack               [1 min]       │
│                                                              │
│  Total Downtime: ~5 minutes                                  │
└─────────────────────────────────────────────────────────────┘
```

**Avantages** :
- ✅ Downtime minimal (< 5 min)
- ✅ Rollback possible pendant toute la phase
- ✅ Validation progressive

**Inconvénients** :
- ❌ Complexité technique élevée
- ❌ Coût temporaire (2 infrastructures en parallèle)
- ❌ Nécessite dual-write logic

---

## 🔧 Migration Détaillée par Service

## 1. DynamoDB → PostgreSQL (CloudNative-PG)

### Tables DynamoDB à Migrer

| Table DynamoDB | Partition Key | Sort Key | Destination PostgreSQL |
|----------------|---------------|----------|------------------------|
| **Books** | id (String) | - | books(id, category, title, author, price, description, image_url) |
| **Cart** | userId (String) | bookId (String) | cart_items(id, user_id, book_id, quantity, added_at) |
| **Orders** | orderId (String) | - | orders(id, user_id, total, status, created_at, items JSONB) |

### Méthode 1 : AWS Data Pipeline + AWS DMS

```bash
# 1. Export DynamoDB vers S3 (Point-in-Time Export)
aws dynamodb export-table-to-point-in-time \
  --table-arn arn:aws:dynamodb:us-east-1:ACCOUNT:table/Books \
  --s3-bucket bookstore-migration \
  --s3-prefix dynamodb-exports/books/ \
  --export-format DYNAMODB_JSON

# 2. Télécharger les exports
aws s3 sync s3://bookstore-migration/dynamodb-exports/ ./data/dynamodb/

# 3. Transformer DynamoDB JSON → PostgreSQL SQL
python scripts/transform_dynamodb_to_sql.py \
  --input ./data/dynamodb/books/ \
  --output ./data/sql/books.sql \
  --table books
```

**Script de Transformation** : `scripts/transform_dynamodb_to_sql.py`

```python
#!/usr/bin/env python3
"""
Transform DynamoDB JSON export to PostgreSQL SQL
"""
import json
import sys
from typing import Any, Dict

def dynamodb_to_postgres_value(value: Dict[str, Any]) -> Any:
    """Convert DynamoDB typed value to PostgreSQL value"""
    if 'S' in value:  # String
        return f"'{value['S'].replace(\"'\", \"''\")}'"
    elif 'N' in value:  # Number
        return value['N']
    elif 'BOOL' in value:  # Boolean
        return 'TRUE' if value['BOOL'] else 'FALSE'
    elif 'NULL' in value:
        return 'NULL'
    elif 'M' in value:  # Map (convert to JSONB)
        return f"'{json.dumps(value['M'])}'"
    elif 'L' in value:  # List (convert to JSONB)
        return f"'{json.dumps(value['L'])}'"
    else:
        return 'NULL'

def transform_books_table(dynamodb_json: str) -> str:
    """Transform Books table from DynamoDB to PostgreSQL"""
    data = json.loads(dynamodb_json)

    sql_statements = []
    sql_statements.append("BEGIN;")
    sql_statements.append("TRUNCATE TABLE books CASCADE;")

    for item in data['Items']:
        book_id = dynamodb_to_postgres_value(item.get('id', {}))
        category = dynamodb_to_postgres_value(item.get('category', {}))
        title = dynamodb_to_postgres_value(item.get('title', {}))
        author = dynamodb_to_postgres_value(item.get('author', {}))
        price = dynamodb_to_postgres_value(item.get('price', {}))
        description = dynamodb_to_postgres_value(item.get('description', {}))
        image_url = dynamodb_to_postgres_value(item.get('cover', {}))

        sql = f"""
INSERT INTO books (id, category, title, author, price, description, image_url, created_at)
VALUES ({book_id}, {category}, {title}, {author}, {price}, {description}, {image_url}, NOW())
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  title = EXCLUDED.title,
  author = EXCLUDED.author,
  price = EXCLUDED.price,
  description = EXCLUDED.description,
  image_url = EXCLUDED.image_url;
"""
        sql_statements.append(sql.strip())

    sql_statements.append("COMMIT;")
    return "\n\n".join(sql_statements)

if __name__ == "__main__":
    with open(sys.argv[1], 'r') as f:
        dynamodb_data = f.read()

    sql_output = transform_books_table(dynamodb_data)

    with open(sys.argv[2], 'w') as f:
        f.write(sql_output)

    print(f"✅ Transformed {sys.argv[1]} → {sys.argv[2]}")
```

**Import dans PostgreSQL** :

```bash
# 4. Import SQL dans CloudNative-PG
kubectl exec -n bookstore bookstore-main-1 -- \
  psql -U postgres -d bookstore -f /tmp/books.sql

# 5. Vérifier les données
kubectl exec -n bookstore bookstore-main-1 -- \
  psql -U postgres -d bookstore -c "SELECT COUNT(*) FROM books;"
```

### Méthode 2 : AWS DMS (Database Migration Service)

Pour migration continue avec CDC (Change Data Capture) :

```bash
# 1. Créer un endpoint source DynamoDB
aws dms create-endpoint \
  --endpoint-identifier dynamodb-source \
  --endpoint-type source \
  --engine-name dynamodb \
  --service-access-role-arn arn:aws:iam::ACCOUNT:role/dms-dynamodb-role

# 2. Créer un endpoint target PostgreSQL
aws dms create-endpoint \
  --endpoint-identifier postgres-target \
  --endpoint-type target \
  --engine-name postgres \
  --server-name bookstore-main-1.bookstore.svc.cluster.local \
  --port 5432 \
  --database-name bookstore \
  --username postgres \
  --password $POSTGRES_PASSWORD

# 3. Créer une tâche de réplication
aws dms create-replication-task \
  --replication-task-identifier bookstore-migration \
  --source-endpoint-arn $SOURCE_ARN \
  --target-endpoint-arn $TARGET_ARN \
  --replication-instance-arn $INSTANCE_ARN \
  --migration-type full-load-and-cdc \
  --table-mappings file://dms-table-mappings.json

# 4. Démarrer la réplication
aws dms start-replication-task \
  --replication-task-arn $TASK_ARN \
  --start-replication-task-type start-replication
```

**Table Mappings** : `dms-table-mappings.json`

```json
{
  "rules": [
    {
      "rule-type": "selection",
      "rule-id": "1",
      "rule-name": "migrate-books",
      "object-locator": {
        "schema-name": "%",
        "table-name": "Books"
      },
      "rule-action": "include"
    },
    {
      "rule-type": "transformation",
      "rule-id": "2",
      "rule-name": "rename-books-table",
      "rule-target": "table",
      "object-locator": {
        "schema-name": "%",
        "table-name": "Books"
      },
      "rule-action": "rename",
      "value": "books"
    },
    {
      "rule-type": "transformation",
      "rule-id": "3",
      "rule-name": "convert-to-lowercase",
      "rule-target": "column",
      "object-locator": {
        "schema-name": "%",
        "table-name": "books"
      },
      "rule-action": "convert-lowercase"
    }
  ]
}
```

---

## 2. Neptune (Graph) → Apache AGE (PostgreSQL)

### Export Neptune Graph

Neptune utilise Gremlin/SPARQL. Apache AGE utilise Cypher (Neo4j-like).

**Export Neptune vers RDF** :

```bash
# 1. Export Neptune cluster
aws neptune create-db-cluster-snapshot \
  --db-cluster-snapshot-identifier bookstore-graph-snapshot \
  --db-cluster-identifier bookstore-neptune-cluster

# 2. Export snapshot vers S3
aws neptune-data export-graph \
  --graph-identifier bookstore-neptune-cluster \
  --s3-bucket bookstore-migration \
  --s3-prefix neptune-export/ \
  --format CSV
```

**Script de Transformation** : `scripts/neptune_to_age.py`

```python
#!/usr/bin/env python3
"""
Transform Neptune Gremlin graph to Apache AGE Cypher
"""
import csv
import psycopg2
from typing import List, Dict, Any

def import_vertices(conn, csv_file: str):
    """Import vertices (nodes) into Apache AGE"""
    cur = conn.cursor()

    # Create graph if not exists
    cur.execute("SELECT * FROM ag_catalog.create_graph('recommendations');")

    with open(csv_file, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            vertex_id = row['~id']
            label = row['~label']
            properties = {k: v for k, v in row.items()
                         if not k.startswith('~')}

            # Convert to Cypher CREATE statement
            props_str = ", ".join([f"{k}: '{v}'" for k, v in properties.items()])
            cypher = f"""
            SELECT * FROM cypher('recommendations', $$
                CREATE (n:{label} {{id: '{vertex_id}', {props_str}}})
            $$) as (v agtype);
            """
            cur.execute(cypher)

    conn.commit()
    print(f"✅ Imported vertices from {csv_file}")

def import_edges(conn, csv_file: str):
    """Import edges (relationships) into Apache AGE"""
    cur = conn.cursor()

    with open(csv_file, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            from_id = row['~from']
            to_id = row['~to']
            edge_label = row['~label']
            properties = {k: v for k, v in row.items()
                         if not k.startswith('~')}

            props_str = ", ".join([f"{k}: '{v}'" for k, v in properties.items()])
            cypher = f"""
            SELECT * FROM cypher('recommendations', $$
                MATCH (a {{id: '{from_id}'}}), (b {{id: '{to_id}'}})
                CREATE (a)-[r:{edge_label} {{{props_str}}}]->(b)
            $$) as (e agtype);
            """
            cur.execute(cypher)

    conn.commit()
    print(f"✅ Imported edges from {csv_file}")

if __name__ == "__main__":
    # Connect to CloudNative-PG graph database
    conn = psycopg2.connect(
        host="bookstore-graph-rw.bookstore.svc.cluster.local",
        port=5432,
        database="bookstore_graph",
        user="postgres",
        password=os.getenv("POSTGRES_PASSWORD")
    )

    # Import vertices and edges
    import_vertices(conn, "data/neptune/vertices.csv")
    import_edges(conn, "data/neptune/edges.csv")

    conn.close()
    print("✅ Neptune → Apache AGE migration completed")
```

**Exécution** :

```bash
# 1. Télécharger exports Neptune
aws s3 sync s3://bookstore-migration/neptune-export/ ./data/neptune/

# 2. Transformer et importer dans Apache AGE
python scripts/neptune_to_age.py

# 3. Vérifier les données
kubectl exec -n bookstore bookstore-graph-1 -- \
  psql -U postgres -d bookstore_graph -c \
  "SELECT * FROM cypher('recommendations', \$\$ MATCH (n) RETURN count(n) \$\$) as (count agtype);"
```

---

## 3. ElasticSearch → PostgreSQL Full-Text Search

### Rebuild Search Index

Plutôt que de migrer ElasticSearch, on rebuild l'index depuis PostgreSQL :

```sql
-- Create Full-Text Search index
CREATE INDEX idx_books_fts ON books
USING GIN(to_tsvector('english', title || ' ' || author || ' ' || description));

-- Create materialized view for search
CREATE MATERIALIZED VIEW books_search AS
SELECT
  id,
  category,
  title,
  author,
  description,
  price,
  image_url,
  to_tsvector('english', title || ' ' || author || ' ' || description) as search_vector,
  ts_rank(to_tsvector('english', title || ' ' || author || ' ' || description),
          plainto_tsquery('english', '')) as rank
FROM books;

CREATE INDEX idx_books_search_vector ON books_search USING GIN(search_vector);

-- Refresh materialized view (run periodically)
REFRESH MATERIALIZED VIEW CONCURRENTLY books_search;
```

**Performance** : PostgreSQL FTS est suffisant pour < 10M documents. Pour > 10M, considérer Meilisearch (CNCF sandbox).

---

## 4. Cognito → Keycloak

### Export Cognito Users

```bash
# 1. Export users from Cognito
aws cognito-idp list-users \
  --user-pool-id us-east-1_XXXXXXXXX \
  --max-results 60 > cognito-users.json

# 2. Transform to Keycloak format
python scripts/cognito_to_keycloak.py \
  --input cognito-users.json \
  --output keycloak-users.json
```

**Script de Transformation** : `scripts/cognito_to_keycloak.py`

```python
#!/usr/bin/env python3
"""
Transform Cognito users to Keycloak import format
"""
import json
import sys
import argparse
from typing import List, Dict, Any

def transform_cognito_user(cognito_user: Dict[str, Any]) -> Dict[str, Any]:
    """Transform single Cognito user to Keycloak format"""

    # Extract attributes
    attributes = {attr['Name']: attr['Value']
                 for attr in cognito_user.get('Attributes', [])}

    return {
        "username": cognito_user['Username'],
        "email": attributes.get('email', ''),
        "emailVerified": attributes.get('email_verified') == 'true',
        "enabled": cognito_user['Enabled'],
        "firstName": attributes.get('given_name', ''),
        "lastName": attributes.get('family_name', ''),
        "attributes": {
            "sub": attributes.get('sub', ''),
            "phone_number": attributes.get('phone_number', ''),
            "phone_number_verified": attributes.get('phone_number_verified', 'false')
        },
        "credentials": [],  # Passwords cannot be exported from Cognito
        "requiredActions": ["UPDATE_PASSWORD"],  # Force password reset
        "createdTimestamp": cognito_user.get('UserCreateDate', 0) * 1000
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()

    with open(args.input, 'r') as f:
        cognito_data = json.load(f)

    keycloak_users = [transform_cognito_user(user)
                     for user in cognito_data.get('Users', [])]

    keycloak_export = {
        "realm": "bookstore",
        "users": keycloak_users
    }

    with open(args.output, 'w') as f:
        json.dump(keycloak_export, f, indent=2)

    print(f"✅ Transformed {len(keycloak_users)} users")

if __name__ == "__main__":
    main()
```

**Import dans Keycloak** :

```bash
# 1. Import users via Keycloak Admin API
KC_TOKEN=$(curl -X POST "https://auth.bookstore.example.com/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" \
  -d "username=admin" \
  -d "password=$KC_ADMIN_PASSWORD" \
  -d "grant_type=password" | jq -r '.access_token')

# 2. Import each user
jq -c '.users[]' keycloak-users.json | while read user; do
  curl -X POST "https://auth.bookstore.example.com/admin/realms/bookstore/users" \
    -H "Authorization: Bearer $KC_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$user"
done

# 3. Vérifier l'import
curl -X GET "https://auth.bookstore.example.com/admin/realms/bookstore/users/count" \
  -H "Authorization: Bearer $KC_TOKEN"
```

**Note importante** : Les mots de passe Cognito ne peuvent pas être exportés. Les utilisateurs devront réinitialiser leur mot de passe.

**Alternative** : Utiliser Cognito comme Identity Provider fédéré dans Keycloak temporairement :

```yaml
# Keycloak Identity Provider configuration
apiVersion: v1
kind: ConfigMap
metadata:
  name: keycloak-cognito-idp
  namespace: bookstore
data:
  cognito-idp.json: |
    {
      "alias": "aws-cognito",
      "providerId": "oidc",
      "enabled": true,
      "config": {
        "authorizationUrl": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXX/oauth2/authorize",
        "tokenUrl": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXX/oauth2/token",
        "clientId": "COGNITO_CLIENT_ID",
        "clientSecret": "COGNITO_CLIENT_SECRET",
        "defaultScope": "openid email profile"
      }
    }
```

---

## 5. S3 Assets → Linode Object Storage

### Synchronisation S3

```bash
# 1. Configuration s3cmd pour source AWS S3
cat > ~/.s3cfg-aws <<EOF
[default]
access_key = $AWS_ACCESS_KEY
secret_key = $AWS_SECRET_KEY
host_base = s3.amazonaws.com
host_bucket = %(bucket)s.s3.amazonaws.com
use_https = True
EOF

# 2. Configuration s3cmd pour target Linode
cat > ~/.s3cfg-linode <<EOF
[default]
access_key = $LINODE_ACCESS_KEY
secret_key = $LINODE_SECRET_KEY
host_base = us-east-1.linodeobjects.com
host_bucket = %(bucket)s.us-east-1.linodeobjects.com
use_https = True
EOF

# 3. Sync AWS S3 → Linode Object Storage
s3cmd -c ~/.s3cfg-aws sync s3://aws-bookstore-assets/ /tmp/bookstore-assets/
s3cmd -c ~/.s3cfg-linode sync /tmp/bookstore-assets/ s3://bookstore-assets/

# 4. Verification
s3cmd -c ~/.s3cfg-linode ls -r s3://bookstore-assets/
```

**Alternative : Utilisation de rclone** (plus rapide pour gros volumes) :

```bash
# 1. Configuration rclone
rclone config create aws-s3 s3 \
  provider=AWS \
  access_key_id=$AWS_ACCESS_KEY \
  secret_access_key=$AWS_SECRET_KEY \
  region=us-east-1

rclone config create linode-s3 s3 \
  provider=Other \
  access_key_id=$LINODE_ACCESS_KEY \
  secret_access_key=$LINODE_SECRET_KEY \
  endpoint=us-east-1.linodeobjects.com

# 2. Sync avec parallélisation
rclone sync aws-s3:aws-bookstore-assets linode-s3:bookstore-assets \
  --progress \
  --transfers 32 \
  --checkers 16 \
  --fast-list

# 3. Vérification
rclone check aws-s3:aws-bookstore-assets linode-s3:bookstore-assets
```

---

## 📋 Checklist de Migration Complète

### Phase 1 : Préparation (J-14 à J-7)

- [ ] **Infrastructure cible prête**
  - [ ] Cluster LKE déployé avec APL Core
  - [ ] Node pools configurés (5-6 pools)
  - [ ] CloudNative-PG clusters créés (main, search, graph)
  - [ ] Keycloak configuré
  - [ ] Object Storage bucket créé
  - [ ] DNS configuré (mais pas encore pointé)

- [ ] **Scripts de migration testés**
  - [ ] Script DynamoDB → PostgreSQL validé
  - [ ] Script Neptune → Apache AGE validé
  - [ ] Script Cognito → Keycloak validé
  - [ ] Script S3 sync validé

- [ ] **Environnement de staging**
  - [ ] Migration test exécutée sur staging
  - [ ] Performance testing validé
  - [ ] Load testing réussi

### Phase 2 : Migration des Données (J-1 à J-Day)

- [ ] **Backup AWS (J-1)**
  - [ ] Snapshot DynamoDB tables
  - [ ] Snapshot Neptune cluster
  - [ ] Export Cognito users
  - [ ] Backup S3 assets

- [ ] **Migration initiale (J-Day - 4h avant cutover)**
  - [ ] Export DynamoDB → S3
  - [ ] Transform DynamoDB → SQL
  - [ ] Import PostgreSQL (main DB)
  - [ ] Export Neptune → CSV
  - [ ] Transform Neptune → AGE
  - [ ] Import Apache AGE (graph DB)
  - [ ] Export Cognito users
  - [ ] Import Keycloak users
  - [ ] Sync S3 → Object Storage

### Phase 3 : Cutover (J-Day)

- [ ] **Freeze AWS App** [T-30min]
  - [ ] Enable maintenance mode on AWS
  - [ ] Stop all writes to DynamoDB
  - [ ] Notify users (email, banner)

- [ ] **Final Sync** [T-20min]
  - [ ] Incremental sync DynamoDB (last changes)
  - [ ] Incremental sync S3 assets
  - [ ] Validate data integrity

- [ ] **Switch DNS** [T-5min]
  - [ ] Update bookstore.example.com → Linode Object Storage
  - [ ] Update api.bookstore.example.com → LKE NodeBalancer
  - [ ] Update auth.bookstore.example.com → LKE NodeBalancer

- [ ] **Enable New Stack** [T-0]
  - [ ] Start Knative services
  - [ ] Enable writes on PostgreSQL
  - [ ] Disable maintenance mode
  - [ ] Monitor logs and metrics

### Phase 4 : Validation Post-Migration (J-Day + 24h)

- [ ] **Smoke Tests**
  - [ ] User login works
  - [ ] Browse books works
  - [ ] Search works
  - [ ] Add to cart works
  - [ ] Checkout works
  - [ ] Recommendations work

- [ ] **Data Validation**
  - [ ] Row counts match (DynamoDB vs PostgreSQL)
  - [ ] Graph node counts match (Neptune vs AGE)
  - [ ] User counts match (Cognito vs Keycloak)
  - [ ] Asset counts match (S3 vs Object Storage)

- [ ] **Performance Validation**
  - [ ] Response times < 200ms (p95)
  - [ ] No errors in logs
  - [ ] Database connections healthy
  - [ ] Auto-scaling works

### Phase 5 : Cleanup (J+7)

- [ ] **AWS Resources** (si tout OK)
  - [ ] Archive DynamoDB tables (don't delete yet)
  - [ ] Archive Neptune cluster
  - [ ] Archive Cognito user pool
  - [ ] Keep S3 backup (delete after J+30)

- [ ] **Documentation**
  - [ ] Update runbooks
  - [ ] Document lessons learned
  - [ ] Update monitoring dashboards

---

## 🔄 Stratégie de Rollback

### Si problème détecté pendant les 24h post-migration

**Rollback complet** :

```bash
# 1. Switch DNS back to AWS (< 5 minutes)
# bookstore.example.com → AWS CloudFront
# api.bookstore.example.com → AWS API Gateway

# 2. Re-enable AWS infrastructure
aws dynamodb update-table --table-name Books --billing-mode PAY_PER_REQUEST
aws neptune start-db-cluster --db-cluster-identifier bookstore-neptune

# 3. Disable APL/LKE services
kubectl scale deployment --all --replicas=0 -n bookstore

# 4. Notify users
# Email: "We experienced an issue and rolled back to the previous system"
```

**Rollback partiel** (si seul un composant pose problème) :

```bash
# Exemple: Problème avec Keycloak, fallback vers Cognito
kubectl patch virtualservice bookstore-api -n bookstore \
  --type merge \
  -p '{"spec":{"http":[{"match":[{"uri":{"prefix":"/auth"}}],"route":[{"destination":{"host":"cognito-proxy.bookstore.svc.cluster.local"}}]}]}}'
```

---

## 📊 Validation des Données

### Scripts de Validation

**Validation DynamoDB → PostgreSQL** :

```bash
#!/bin/bash
# validate_migration.sh

echo "=== Validating Books Migration ==="
AWS_COUNT=$(aws dynamodb scan --table-name Books --select COUNT | jq '.Count')
PG_COUNT=$(kubectl exec -n bookstore bookstore-main-1 -- \
  psql -U postgres -d bookstore -tAc "SELECT COUNT(*) FROM books;")

echo "AWS DynamoDB Books: $AWS_COUNT"
echo "PostgreSQL Books: $PG_COUNT"

if [ "$AWS_COUNT" -eq "$PG_COUNT" ]; then
  echo "✅ Books count matches"
else
  echo "❌ Books count mismatch: $AWS_COUNT != $PG_COUNT"
  exit 1
fi

echo "=== Validating Data Integrity ==="
# Sample 100 random books and compare
for i in {1..100}; do
  BOOK_ID=$(kubectl exec -n bookstore bookstore-main-1 -- \
    psql -U postgres -d bookstore -tAc \
    "SELECT id FROM books ORDER BY RANDOM() LIMIT 1;")

  # Get from DynamoDB
  AWS_BOOK=$(aws dynamodb get-item \
    --table-name Books \
    --key "{\"id\":{\"S\":\"$BOOK_ID\"}}" \
    | jq -r '.Item.title.S')

  # Get from PostgreSQL
  PG_BOOK=$(kubectl exec -n bookstore bookstore-main-1 -- \
    psql -U postgres -d bookstore -tAc \
    "SELECT title FROM books WHERE id='$BOOK_ID';")

  if [ "$AWS_BOOK" != "$PG_BOOK" ]; then
    echo "❌ Data mismatch for book $BOOK_ID"
    echo "  AWS: $AWS_BOOK"
    echo "  PG: $PG_BOOK"
    exit 1
  fi
done

echo "✅ Data integrity validated (100 random samples)"
```

---

## 🎯 Résumé des Méthodes Recommandées

| Migration | Outil Recommandé | Complexité | Downtime | Notes |
|-----------|------------------|------------|----------|-------|
| **DynamoDB → PostgreSQL** | Python scripts + psql | Moyenne | 1-2h | Transformation manuelle requise |
| **Neptune → Apache AGE** | Python + Cypher | Élevée | 2-3h | Export CSV puis import Cypher |
| **ElasticSearch → PG FTS** | Rebuild from source | Faible | 30min | Rebuild index depuis PostgreSQL |
| **Cognito → Keycloak** | Keycloak Admin API | Moyenne | 30min | Mots de passe doivent être réinitialisés |
| **S3 → Object Storage** | rclone | Faible | 1-2h | Sync parallèle rapide |

**Recommandation Finale** :

Pour un MVP avec downtime acceptable (2-4h) :
- ✅ **Migration à froid** avec scripts Python
- ✅ Validation extensive en staging
- ✅ Rollback plan prêt
- ✅ Fenêtre de maintenance annoncée (weekend, off-peak hours)

Pour production avec downtime minimal (< 5min) :
- ✅ **Migration blue-green** avec CDC
- ✅ Dual-write proxy temporaire
- ✅ Coût plus élevé (2 infrastructures en parallèle)
- ✅ Validation progressive

---

## 📞 Support et Troubleshooting

### Problèmes Courants

**1. Timeout lors de l'import PostgreSQL**

```bash
# Augmenter le timeout
kubectl exec -n bookstore bookstore-main-1 -- \
  psql -U postgres -d bookstore -c "SET statement_timeout = '1h';"
```

**2. Erreur de connexion Keycloak**

```bash
# Vérifier les logs
kubectl logs -n bookstore -l app=keycloak --tail=100
```

**3. Synchronisation S3 lente**

```bash
# Utiliser rclone avec plus de workers
rclone sync source:bucket target:bucket --transfers 64
```

### Contacts d'Escalade

- **Database Issues** : DBA Team
- **Network/DNS Issues** : Infrastructure Team
- **Application Issues** : Development Team

---

## ✅ Conclusion

Cette migration nécessite :
- **Préparation** : 1-2 semaines
- **Execution** : 2-4 heures (à froid) ou 5 minutes (blue-green)
- **Validation** : 24-48 heures

**Prochaines étapes** :
1. Valider l'approche (à froid vs blue-green)
2. Créer l'environnement de staging
3. Tester les scripts de migration
4. Planifier la fenêtre de maintenance
5. Exécuter la migration
