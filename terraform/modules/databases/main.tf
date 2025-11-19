# ============================================================================
# Databases Module
# Deploys CloudNative-PG PostgreSQL clusters
# ============================================================================

# Main Database (transactional data)
resource "kubectl_manifest" "main_database" {
  yaml_body = <<-YAML
    apiVersion: postgresql.cnpg.io/v1
    kind: Cluster
    metadata:
      name: bookstore-main
      namespace: ${var.namespace}
    spec:
      instances: ${var.main_db_replicas}
      imageName: ghcr.io/cloudnative-pg/postgresql:15

      postgresql:
        parameters:
          max_connections: "200"
          shared_buffers: "256MB"
          effective_cache_size: "1GB"
          work_mem: "4MB"
          maintenance_work_mem: "64MB"
          checkpoint_completion_target: "0.9"
          wal_buffers: "16MB"
          default_statistics_target: "100"
          random_page_cost: "1.1"
          effective_io_concurrency: "200"

      bootstrap:
        initdb:
          database: ${var.main_db_name}
          owner: ${var.main_db_user}
          postInitSQL:
            - CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
            - CREATE EXTENSION IF NOT EXISTS pg_trgm;

      storage:
        size: ${var.main_db_storage}
        storageClass: ${var.storage_class}

      backup:
        retentionPolicy: "30d"
        barmanObjectStore:
          destinationPath: s3://${var.backup_bucket}/bookstore-main
          endpointURL: https://${var.backup_region}.linodeobjects.com
          s3Credentials:
            accessKeyId:
              name: ${kubernetes_secret.backup_credentials.metadata[0].name}
              key: ACCESS_KEY_ID
            secretAccessKey:
              name: ${kubernetes_secret.backup_credentials.metadata[0].name}
              key: SECRET_ACCESS_KEY

      monitoring:
        enablePodMonitor: true

      resources:
        requests:
          memory: "512Mi"
          cpu: "250m"
        limits:
          memory: "2Gi"
          cpu: "1000m"
  YAML

  depends_on = [
    kubernetes_secret.backup_credentials
  ]
}

# Search Database (full-text search with pg_trgm)
resource "kubectl_manifest" "search_database" {
  yaml_body = <<-YAML
    apiVersion: postgresql.cnpg.io/v1
    kind: Cluster
    metadata:
      name: bookstore-search
      namespace: ${var.namespace}
    spec:
      instances: ${var.search_db_replicas}
      imageName: ghcr.io/cloudnative-pg/postgresql:15

      postgresql:
        parameters:
          max_connections: "200"
          shared_buffers: "512MB"
          effective_cache_size: "2GB"
          work_mem: "8MB"
          maintenance_work_mem: "128MB"
          # Optimized for full-text search
          random_page_cost: "1.1"
          effective_io_concurrency: "200"

      bootstrap:
        initdb:
          database: ${var.search_db_name}
          owner: ${var.search_db_user}
          postInitSQL:
            - CREATE EXTENSION IF NOT EXISTS pg_trgm;
            - CREATE EXTENSION IF NOT EXISTS unaccent;
            - CREATE EXTENSION IF NOT EXISTS btree_gin;

      storage:
        size: ${var.search_db_storage}
        storageClass: ${var.storage_class}

      backup:
        retentionPolicy: "30d"
        barmanObjectStore:
          destinationPath: s3://${var.backup_bucket}/bookstore-search
          endpointURL: https://${var.backup_region}.linodeobjects.com
          s3Credentials:
            accessKeyId:
              name: ${kubernetes_secret.backup_credentials.metadata[0].name}
              key: ACCESS_KEY_ID
            secretAccessKey:
              name: ${kubernetes_secret.backup_credentials.metadata[0].name}
              key: SECRET_ACCESS_KEY

      monitoring:
        enablePodMonitor: true

      resources:
        requests:
          memory: "512Mi"
          cpu: "250m"
        limits:
          memory: "4Gi"
          cpu: "2000m"
  YAML

  depends_on = [
    kubernetes_secret.backup_credentials
  ]
}

# Graph Database (Apache AGE for recommendations)
resource "kubectl_manifest" "graph_database" {
  yaml_body = <<-YAML
    apiVersion: postgresql.cnpg.io/v1
    kind: Cluster
    metadata:
      name: bookstore-graph
      namespace: ${var.namespace}
    spec:
      instances: ${var.graph_db_replicas}
      imageName: ghcr.io/cloudnative-pg/postgresql:15

      postgresql:
        parameters:
          max_connections: "200"
          shared_buffers: "512MB"
          effective_cache_size: "2GB"
          work_mem: "16MB"
          maintenance_work_mem: "256MB"
          # Apache AGE requirements
          shared_preload_libraries: "age"

      bootstrap:
        initdb:
          database: ${var.graph_db_name}
          owner: ${var.graph_db_user}
          postInitSQL:
            - CREATE EXTENSION IF NOT EXISTS age;
            - LOAD 'age';
            - SET search_path = ag_catalog, "$user", public;

      storage:
        size: ${var.graph_db_storage}
        storageClass: ${var.storage_class}

      backup:
        retentionPolicy: "30d"
        barmanObjectStore:
          destinationPath: s3://${var.backup_bucket}/bookstore-graph
          endpointURL: https://${var.backup_region}.linodeobjects.com
          s3Credentials:
            accessKeyId:
              name: ${kubernetes_secret.backup_credentials.metadata[0].name}
              key: ACCESS_KEY_ID
            secretAccessKey:
              name: ${kubernetes_secret.backup_credentials.metadata[0].name}
              key: SECRET_ACCESS_KEY

      monitoring:
        enablePodMonitor: true

      resources:
        requests:
          memory: "1Gi"
          cpu: "500m"
        limits:
          memory: "4Gi"
          cpu: "2000m"
  YAML

  depends_on = [
    kubernetes_secret.backup_credentials
  ]
}

# ============================================================================
# Backup Credentials Secret
# ============================================================================

resource "kubernetes_secret" "backup_credentials" {
  metadata {
    name      = "backup-credentials"
    namespace = var.namespace
  }

  data = {
    ACCESS_KEY_ID     = var.backup_access_key
    SECRET_ACCESS_KEY = var.backup_secret_key
  }

  type = "Opaque"
}

# ============================================================================
# Database Initialization Jobs
# ============================================================================

# Wait for main database to be ready
resource "null_resource" "wait_for_main_db" {
  provisioner "local-exec" {
    command = <<-EOT
      echo "Waiting for main database to be ready..."
      kubectl wait --for=condition=Ready cluster/bookstore-main -n ${var.namespace} --timeout=600s || true
    EOT
  }

  depends_on = [kubectl_manifest.main_database]
}

# Wait for search database to be ready
resource "null_resource" "wait_for_search_db" {
  provisioner "local-exec" {
    command = <<-EOT
      echo "Waiting for search database to be ready..."
      kubectl wait --for=condition=Ready cluster/bookstore-search -n ${var.namespace} --timeout=600s || true
    EOT
  }

  depends_on = [kubectl_manifest.search_database]
}

# Wait for graph database to be ready
resource "null_resource" "wait_for_graph_db" {
  provisioner "local-exec" {
    command = <<-EOT
      echo "Waiting for graph database to be ready..."
      kubectl wait --for=condition=Ready cluster/bookstore-graph -n ${var.namespace} --timeout=600s || true
    EOT
  }

  depends_on = [kubectl_manifest.graph_database]
}

# ============================================================================
# Database Passwords Secrets
# ============================================================================

resource "kubernetes_secret" "main_database_password" {
  metadata {
    name      = "bookstore-main-app"
    namespace = var.namespace
  }

  data = {
    username = var.main_db_user
    password = var.main_db_password
  }

  type = "kubernetes.io/basic-auth"
}

resource "kubernetes_secret" "search_database_password" {
  metadata {
    name      = "bookstore-search-app"
    namespace = var.namespace
  }

  data = {
    username = var.search_db_user
    password = var.search_db_password
  }

  type = "kubernetes.io/basic-auth"
}

resource "kubernetes_secret" "graph_database_password" {
  metadata {
    name      = "bookstore-graph-app"
    namespace = var.namespace
  }

  data = {
    username = var.graph_db_user
    password = var.graph_db_password
  }

  type = "kubernetes.io/basic-auth"
}
