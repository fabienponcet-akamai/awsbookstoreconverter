# ============================================================================
# Bookstore Application - Infrastructure as Code
# Terraform deployment for Linode using Akamai App Platform Core
# ============================================================================

# Generate random passwords if not provided
resource "random_password" "database" {
  count   = var.database_password == "" ? 1 : 0
  length  = 32
  special = true
}

resource "random_password" "grafana" {
  count   = var.grafana_admin_password == "" ? 1 : 0
  length  = 16
  special = false
}

resource "random_password" "keycloak" {
  count   = var.keycloak_admin_password == "" ? 1 : 0
  length  = 16
  special = false
}

resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

locals {
  db_password       = var.database_password != "" ? var.database_password : random_password.database[0].result
  grafana_password  = var.grafana_admin_password != "" ? var.grafana_admin_password : random_password.grafana[0].result
  keycloak_password = var.keycloak_admin_password != "" ? var.keycloak_admin_password : random_password.keycloak[0].result
  jwt_secret        = random_password.jwt_secret.result

  # Resource naming
  cluster_name = "${var.project_name}-${var.environment}"
  namespace    = var.project_name

  # Common labels
  common_labels = merge(var.tags, {
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}

# ============================================================================
# Module: LKE Cluster
# Creates Linode Kubernetes Engine cluster
# ============================================================================

module "lke" {
  source = "./modules/lke"

  cluster_name       = local.cluster_name
  region             = var.region
  kubernetes_version = var.kubernetes_version
  node_pools         = var.node_pools
  tags               = local.common_labels
}

# ============================================================================
# Wait for cluster to be ready
# ============================================================================

resource "null_resource" "wait_for_cluster" {
  depends_on = [module.lke]

  provisioner "local-exec" {
    command = "sleep 60" # Wait for cluster to stabilize
  }
}

# ============================================================================
# Module: Object Storage
# Creates Linode Object Storage bucket for frontend
# ============================================================================

module "object_storage" {
  source = "./modules/object-storage"

  bucket_name = "${var.project_name}-frontend-${var.environment}"
  cluster     = var.object_storage_cluster
  region      = var.region
  enable_cdn  = var.enable_cdn

  depends_on = [module.lke]
}

# ============================================================================
# Module: APL Core
# Deploys Akamai App Platform Core components via Helm
# ============================================================================

module "apl_core" {
  source = "./modules/apl-core"

  namespace           = local.namespace
  apl_core_repo       = var.apl_core_repo
  apl_core_version    = var.apl_core_version
  install_monitoring  = var.install_monitoring
  install_tracing     = var.install_tracing
  grafana_password    = local.grafana_password
  keycloak_password   = local.keycloak_password
  domain_name         = var.domain_name

  depends_on = [null_resource.wait_for_cluster]
}

# ============================================================================
# Module: PostgreSQL Databases
# Deploys CloudNative-PG clusters (main, search, graph)
# ============================================================================

module "databases" {
  source = "./modules/databases"

  namespace = local.namespace

  # Main database
  main_db_password = local.db_password
  main_db_replicas = var.postgres_replicas.main
  main_db_storage  = "50Gi"

  # Search database
  search_db_password = local.db_password
  search_db_replicas = var.postgres_replicas.search
  search_db_storage  = "30Gi"

  # Graph database
  graph_db_password = local.db_password
  graph_db_replicas = var.postgres_replicas.graph
  graph_db_storage  = "30Gi"

  # Backup configuration
  backup_bucket     = module.object_storage.bucket_name
  backup_region     = var.object_storage_cluster
  backup_access_key = module.object_storage.access_key
  backup_secret_key = module.object_storage.secret_key

  depends_on = [module.apl_core]
}

# ============================================================================
# Module: Knative Services
# Deploys serverless API services
# ============================================================================

module "knative_services" {
  source = "./modules/knative-services"

  namespace          = local.namespace
  container_registry = var.container_registry
  image_tag          = var.image_tag
  environment        = var.environment

  # Database connection strings from databases module
  main_db_url   = module.databases.main_db_connection_string
  search_db_url = module.databases.search_db_connection_string
  graph_db_url  = module.databases.graph_db_connection_string

  # JWT secret
  jwt_secret = local.jwt_secret

  depends_on = [module.databases]
}

# ============================================================================
# Module: Monitoring
# Deploys monitoring configuration (ServiceMonitors, Dashboards, Alerts)
# ============================================================================

module "monitoring" {
  count  = var.install_monitoring ? 1 : 0
  source = "./modules/monitoring"

  namespace          = local.namespace
  install_monitoring = var.install_monitoring

  depends_on = [module.knative_services]
}

# ============================================================================
# Configure DNS (manual step - outputs provided)
# ============================================================================

# Note: DNS configuration must be done manually or via separate provider
# See outputs for LoadBalancer IP addresses
