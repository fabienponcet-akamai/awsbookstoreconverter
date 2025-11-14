variable "namespace" {
  description = "Kubernetes namespace for databases"
  type        = string
}

# Main Database Variables
variable "main_db_name" {
  description = "Main database name"
  type        = string
  default     = "bookstore"
}

variable "main_db_user" {
  description = "Main database user"
  type        = string
  default     = "bookstore"
}

variable "main_db_password" {
  description = "Main database password"
  type        = string
  sensitive   = true
}

variable "main_db_replicas" {
  description = "Number of main database replicas"
  type        = number
  default     = 3
}

variable "main_db_storage" {
  description = "Main database storage size"
  type        = string
  default     = "50Gi"
}

# Search Database Variables
variable "search_db_name" {
  description = "Search database name"
  type        = string
  default     = "bookstore_search"
}

variable "search_db_user" {
  description = "Search database user"
  type        = string
  default     = "bookstore_search"
}

variable "search_db_password" {
  description = "Search database password"
  type        = string
  sensitive   = true
}

variable "search_db_replicas" {
  description = "Number of search database replicas"
  type        = number
  default     = 2
}

variable "search_db_storage" {
  description = "Search database storage size"
  type        = string
  default     = "30Gi"
}

# Graph Database Variables
variable "graph_db_name" {
  description = "Graph database name"
  type        = string
  default     = "bookstore_graph"
}

variable "graph_db_user" {
  description = "Graph database user"
  type        = string
  default     = "bookstore_graph"
}

variable "graph_db_password" {
  description = "Graph database password"
  type        = string
  sensitive   = true
}

variable "graph_db_replicas" {
  description = "Number of graph database replicas"
  type        = number
  default     = 2
}

variable "graph_db_storage" {
  description = "Graph database storage size"
  type        = string
  default     = "30Gi"
}

# Storage Variables
variable "storage_class" {
  description = "Storage class for persistent volumes"
  type        = string
  default     = "linode-block-storage-retain"
}

# Backup Variables
variable "backup_bucket" {
  description = "Object storage bucket for backups"
  type        = string
}

variable "backup_region" {
  description = "Object storage region for backups"
  type        = string
}

variable "backup_access_key" {
  description = "Object storage access key for backups"
  type        = string
  sensitive   = true
}

variable "backup_secret_key" {
  description = "Object storage secret key for backups"
  type        = string
  sensitive   = true
}
