# ============================================================================
# General Configuration
# ============================================================================

variable "linode_token" {
  description = "Linode API token"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "project_name" {
  description = "Project name (used for resource naming)"
  type        = string
  default     = "bookstore"
}

variable "region" {
  description = "Linode region"
  type        = string
  default     = "us-east"
  # Available regions: us-east, us-central, us-west, eu-west, eu-central, ap-south, ap-northeast, etc.
}

# ============================================================================
# LKE Cluster Configuration
# ============================================================================

variable "kubernetes_version" {
  description = "Kubernetes version for LKE cluster"
  type        = string
  default     = "1.28"
}

variable "node_pools" {
  description = "LKE node pools configuration"
  type = list(object({
    type  = string
    count = number
  }))
  default = [
    {
      type  = "g6-standard-4" # 8GB RAM, 4 vCPUs
      count = 3
    }
  ]
}

# ============================================================================
# Object Storage Configuration
# ============================================================================

variable "object_storage_cluster" {
  description = "Object Storage cluster (us-east-1, eu-central-1, etc.)"
  type        = string
  default     = "us-east-1"
}

# ============================================================================
# Database Configuration
# ============================================================================

variable "postgres_version" {
  description = "PostgreSQL version"
  type        = string
  default     = "15"
}

variable "postgres_storage_size" {
  description = "Storage size for PostgreSQL clusters (Gi)"
  type        = string
  default     = "20Gi"
}

variable "postgres_replicas" {
  description = "Number of PostgreSQL replicas per cluster"
  type = object({
    main   = number
    search = number
    graph  = number
  })
  default = {
    main   = 3
    search = 2
    graph  = 2
  }
}

# ============================================================================
# Application Configuration
# ============================================================================

variable "container_registry" {
  description = "Container registry URL"
  type        = string
  default     = ""
  # Example: "lke-registry.linode.com/bookstore" or "docker.io/youruser"
}

variable "image_tag" {
  description = "Container image tag"
  type        = string
  default     = "latest"
}

variable "domain_name" {
  description = "Domain name for the application"
  type        = string
  default     = "bookstore.example.com"
}

variable "enable_tls" {
  description = "Enable TLS/HTTPS"
  type        = bool
  default     = true
}

# ============================================================================
# APL Core Configuration
# ============================================================================

variable "apl_core_repo" {
  description = "APL Core Git repository URL"
  type        = string
  default     = "https://github.com/linode/apl-core.git"
}

variable "apl_core_version" {
  description = "APL Core version (git branch or tag)"
  type        = string
  default     = "main"
}

variable "install_monitoring" {
  description = "Install monitoring stack (Prometheus, Grafana, Loki)"
  type        = bool
  default     = true
}

variable "install_tracing" {
  description = "Install tracing stack (Jaeger)"
  type        = bool
  default     = true
}

# ============================================================================
# Secrets Configuration
# ============================================================================

variable "database_password" {
  description = "PostgreSQL database password (leave empty to auto-generate)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "grafana_admin_password" {
  description = "Grafana admin password (leave empty to auto-generate)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "keycloak_admin_password" {
  description = "Keycloak admin password (leave empty to auto-generate)"
  type        = string
  default     = ""
  sensitive   = true
}

# ============================================================================
# Feature Flags
# ============================================================================

variable "enable_autoscaling" {
  description = "Enable cluster autoscaling"
  type        = bool
  default     = true
}

variable "enable_backups" {
  description = "Enable automated backups for databases"
  type        = bool
  default     = true
}

variable "enable_cdn" {
  description = "Enable Akamai CDN for frontend"
  type        = bool
  default     = true
}

# ============================================================================
# Tags
# ============================================================================

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default = {
    Project     = "bookstore"
    ManagedBy   = "terraform"
    Environment = "dev"
  }
}
