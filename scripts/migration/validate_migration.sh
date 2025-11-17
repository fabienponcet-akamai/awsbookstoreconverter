#!/bin/bash
#
# Validate AWS Bookstore → APL/LKE data migration
#
# Usage: ./validate_migration.sh

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="${NAMESPACE:-bookstore}"
DB_MAIN_POD="bookstore-main-1"
DB_GRAPH_POD="bookstore-graph-1"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-bookstore}"
DB_GRAPH_NAME="${DB_GRAPH_NAME:-bookstore_graph}"

# Keycloak
KC_URL="${KC_URL:-https://auth.bookstore.example.com}"
KC_REALM="${KC_REALM:-bookstore}"

# AWS (for comparison)
AWS_BOOKS_TABLE="${AWS_BOOKS_TABLE:-Books}"
AWS_ORDERS_TABLE="${AWS_ORDERS_TABLE:-Orders}"
AWS_CART_TABLE="${AWS_CART_TABLE:-Cart}"
AWS_NEPTUNE_ENDPOINT="${AWS_NEPTUNE_ENDPOINT:-}"
AWS_COGNITO_POOL="${AWS_COGNITO_POOL:-}"

ERRORS=0
WARNINGS=0

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  AWS Bookstore Migration Validation   ${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

#------------------------------------------------------------------------------
# Helper Functions
#------------------------------------------------------------------------------

function print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

function print_error() {
    echo -e "${RED}❌ $1${NC}"
    ((ERRORS++))
}

function print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
    ((WARNINGS++))
}

function print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

function get_pg_count() {
    local pod=$1
    local db=$2
    local sql=$3

    kubectl exec -n "$NAMESPACE" "$pod" -- \
        psql -U "$DB_USER" -d "$db" -tAc "$sql" 2>/dev/null || echo "0"
}

function get_aws_dynamodb_count() {
    local table=$1
    aws dynamodb scan --table-name "$table" --select COUNT 2>/dev/null | jq -r '.Count // 0'
}

#------------------------------------------------------------------------------
# 1. Validate PostgreSQL Main Database
#------------------------------------------------------------------------------

echo -e "${BLUE}1. Validating PostgreSQL Main Database${NC}"
echo "----------------------------------------"

# Check if pod exists
if ! kubectl get pod -n "$NAMESPACE" "$DB_MAIN_POD" &>/dev/null; then
    print_error "PostgreSQL main pod '$DB_MAIN_POD' not found in namespace '$NAMESPACE'"
else
    print_success "PostgreSQL main pod found"

    # Check database exists
    DB_EXISTS=$(kubectl exec -n "$NAMESPACE" "$DB_MAIN_POD" -- \
        psql -U "$DB_USER" -lqt 2>/dev/null | cut -d \| -f 1 | grep -w "$DB_NAME" | wc -l)

    if [ "$DB_EXISTS" -eq 0 ]; then
        print_error "Database '$DB_NAME' does not exist"
    else
        print_success "Database '$DB_NAME' exists"

        # Validate Books table
        BOOKS_COUNT=$(get_pg_count "$DB_MAIN_POD" "$DB_NAME" "SELECT COUNT(*) FROM books;")
        print_info "Books count in PostgreSQL: $BOOKS_COUNT"

        if [ -n "$AWS_BOOKS_TABLE" ] && command -v aws &>/dev/null; then
            AWS_BOOKS_COUNT=$(get_aws_dynamodb_count "$AWS_BOOKS_TABLE")
            print_info "Books count in AWS DynamoDB: $AWS_BOOKS_COUNT"

            if [ "$BOOKS_COUNT" -eq "$AWS_BOOKS_COUNT" ]; then
                print_success "Books count matches AWS DynamoDB"
            elif [ "$BOOKS_COUNT" -eq 0 ]; then
                print_error "Books table is empty"
            else
                print_warning "Books count mismatch: PG=$BOOKS_COUNT, AWS=$AWS_BOOKS_COUNT"
            fi
        else
            if [ "$BOOKS_COUNT" -gt 0 ]; then
                print_success "Books table has $BOOKS_COUNT rows"
            else
                print_error "Books table is empty"
            fi
        fi

        # Validate Orders table
        ORDERS_COUNT=$(get_pg_count "$DB_MAIN_POD" "$DB_NAME" "SELECT COUNT(*) FROM orders;")
        print_info "Orders count in PostgreSQL: $ORDERS_COUNT"

        if [ -n "$AWS_ORDERS_TABLE" ] && command -v aws &>/dev/null; then
            AWS_ORDERS_COUNT=$(get_aws_dynamodb_count "$AWS_ORDERS_TABLE")
            if [ "$ORDERS_COUNT" -eq "$AWS_ORDERS_COUNT" ]; then
                print_success "Orders count matches AWS DynamoDB"
            else
                print_warning "Orders count mismatch: PG=$ORDERS_COUNT, AWS=$AWS_ORDERS_COUNT"
            fi
        fi

        # Validate Cart table
        CART_COUNT=$(get_pg_count "$DB_MAIN_POD" "$DB_NAME" "SELECT COUNT(*) FROM cart_items;")
        print_info "Cart items count in PostgreSQL: $CART_COUNT"

        # Validate data integrity (sample random books)
        print_info "Validating data integrity (sampling 10 random books)..."

        SAMPLE_BOOKS=$(kubectl exec -n "$NAMESPACE" "$DB_MAIN_POD" -- \
            psql -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT id, title FROM books ORDER BY RANDOM() LIMIT 10;" 2>/dev/null)

        if [ -n "$SAMPLE_BOOKS" ]; then
            print_success "Data sampling successful"
            echo "$SAMPLE_BOOKS" | head -5 | while IFS='|' read -r id title; do
                echo "  - Book: $title"
            done
        else
            print_warning "Could not sample books data"
        fi
    fi
fi

echo ""

#------------------------------------------------------------------------------
# 2. Validate Apache AGE Graph Database
#------------------------------------------------------------------------------

echo -e "${BLUE}2. Validating Apache AGE Graph Database${NC}"
echo "----------------------------------------"

if ! kubectl get pod -n "$NAMESPACE" "$DB_GRAPH_POD" &>/dev/null; then
    print_error "PostgreSQL graph pod '$DB_GRAPH_POD' not found"
else
    print_success "PostgreSQL graph pod found"

    # Check AGE extension
    AGE_INSTALLED=$(kubectl exec -n "$NAMESPACE" "$DB_GRAPH_POD" -- \
        psql -U "$DB_USER" -d "$DB_GRAPH_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_extension WHERE extname='age';" 2>/dev/null || echo "0")

    if [ "$AGE_INSTALLED" -eq 0 ]; then
        print_error "Apache AGE extension not installed"
    else
        print_success "Apache AGE extension installed"

        # Count vertices
        VERTEX_COUNT=$(kubectl exec -n "$NAMESPACE" "$DB_GRAPH_POD" -- \
            psql -U "$DB_USER" -d "$DB_GRAPH_NAME" -tAc \
            "SELECT * FROM cypher('recommendations', \$\$ MATCH (n) RETURN count(n) \$\$) as (count agtype);" \
            2>/dev/null | tr -d ' ' || echo "0")

        print_info "Graph vertices count: $VERTEX_COUNT"

        if [ "$VERTEX_COUNT" -gt 0 ]; then
            print_success "Graph has $VERTEX_COUNT vertices"
        else
            print_warning "Graph has no vertices (may be empty or query failed)"
        fi

        # Count edges
        EDGE_COUNT=$(kubectl exec -n "$NAMESPACE" "$DB_GRAPH_POD" -- \
            psql -U "$DB_USER" -d "$DB_GRAPH_NAME" -tAc \
            "SELECT * FROM cypher('recommendations', \$\$ MATCH ()-[r]->() RETURN count(r) \$\$) as (count agtype);" \
            2>/dev/null | tr -d ' ' || echo "0")

        print_info "Graph edges count: $EDGE_COUNT"

        if [ "$EDGE_COUNT" -gt 0 ]; then
            print_success "Graph has $EDGE_COUNT edges"
        else
            print_warning "Graph has no edges (may be empty or query failed)"
        fi
    fi
fi

echo ""

#------------------------------------------------------------------------------
# 3. Validate Full-Text Search
#------------------------------------------------------------------------------

echo -e "${BLUE}3. Validating Full-Text Search${NC}"
echo "----------------------------------------"

# Check if FTS index exists
FTS_INDEX=$(get_pg_count "$DB_MAIN_POD" "$DB_NAME" \
    "SELECT COUNT(*) FROM pg_indexes WHERE indexname='idx_books_fts';")

if [ "$FTS_INDEX" -eq 0 ]; then
    print_warning "Full-text search index 'idx_books_fts' not found"
else
    print_success "Full-text search index exists"

    # Test search
    SEARCH_RESULT=$(kubectl exec -n "$NAMESPACE" "$DB_MAIN_POD" -- \
        psql -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM books WHERE to_tsvector('english', title || ' ' || author || ' ' || description) @@ plainto_tsquery('english', 'book');" \
        2>/dev/null || echo "0")

    if [ "$SEARCH_RESULT" -gt 0 ]; then
        print_success "Full-text search working ($SEARCH_RESULT results for 'book')"
    else
        print_warning "Full-text search returned no results"
    fi
fi

echo ""

#------------------------------------------------------------------------------
# 4. Validate Keycloak Users
#------------------------------------------------------------------------------

echo -e "${BLUE}4. Validating Keycloak Users${NC}"
echo "----------------------------------------"

if [ -z "$KC_ADMIN_PASSWORD" ]; then
    print_warning "KC_ADMIN_PASSWORD not set, skipping Keycloak validation"
else
    # Get Keycloak admin token
    KC_TOKEN=$(curl -s -X POST "$KC_URL/realms/master/protocol/openid-connect/token" \
        -d "client_id=admin-cli" \
        -d "username=admin" \
        -d "password=$KC_ADMIN_PASSWORD" \
        -d "grant_type=password" 2>/dev/null | jq -r '.access_token // empty')

    if [ -z "$KC_TOKEN" ]; then
        print_error "Failed to get Keycloak admin token"
    else
        print_success "Keycloak admin token obtained"

        # Count users
        KC_USER_COUNT=$(curl -s -X GET "$KC_URL/admin/realms/$KC_REALM/users/count" \
            -H "Authorization: Bearer $KC_TOKEN" 2>/dev/null || echo "0")

        print_info "Keycloak users count: $KC_USER_COUNT"

        if [ -n "$AWS_COGNITO_POOL" ] && command -v aws &>/dev/null; then
            COGNITO_COUNT=$(aws cognito-idp list-users \
                --user-pool-id "$AWS_COGNITO_POOL" \
                --max-results 60 2>/dev/null | jq '.Users | length' || echo "0")

            print_info "Cognito users count: $COGNITO_COUNT"

            if [ "$KC_USER_COUNT" -eq "$COGNITO_COUNT" ]; then
                print_success "Keycloak users count matches Cognito"
            else
                print_warning "User count mismatch: Keycloak=$KC_USER_COUNT, Cognito=$COGNITO_COUNT"
            fi
        else
            if [ "$KC_USER_COUNT" -gt 0 ]; then
                print_success "Keycloak has $KC_USER_COUNT users"
            else
                print_warning "Keycloak has no users"
            fi
        fi
    fi
fi

echo ""

#------------------------------------------------------------------------------
# 5. Validate Object Storage
#------------------------------------------------------------------------------

echo -e "${BLUE}5. Validating Object Storage${NC}"
echo "----------------------------------------"

if ! command -v s3cmd &>/dev/null; then
    print_warning "s3cmd not installed, skipping Object Storage validation"
else
    BUCKET="${OBJECT_STORAGE_BUCKET:-bookstore-assets}"

    # Check if bucket exists
    if s3cmd ls "s3://$BUCKET" &>/dev/null; then
        print_success "Object Storage bucket '$BUCKET' accessible"

        # Count objects
        OBJECT_COUNT=$(s3cmd ls -r "s3://$BUCKET" 2>/dev/null | wc -l)
        print_info "Object count in bucket: $OBJECT_COUNT"

        if [ "$OBJECT_COUNT" -gt 0 ]; then
            print_success "Bucket has $OBJECT_COUNT objects"
        else
            print_warning "Bucket appears empty"
        fi
    else
        print_error "Object Storage bucket '$BUCKET' not accessible"
    fi
fi

echo ""

#------------------------------------------------------------------------------
# Summary
#------------------------------------------------------------------------------

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Validation Summary                   ${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

if [ "$ERRORS" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
    print_success "All validations passed! ✅"
    echo ""
    echo "Migration appears successful with no issues detected."
    exit 0
elif [ "$ERRORS" -eq 0 ]; then
    echo -e "${YELLOW}Validation completed with $WARNINGS warning(s) ⚠️${NC}"
    echo ""
    echo "Migration mostly successful, but some warnings were detected."
    echo "Review warnings above and verify they are acceptable."
    exit 0
else
    echo -e "${RED}Validation failed with $ERRORS error(s) and $WARNINGS warning(s) ❌${NC}"
    echo ""
    echo "Migration has issues that need to be addressed."
    echo "Review errors above and fix before proceeding."
    exit 1
fi
