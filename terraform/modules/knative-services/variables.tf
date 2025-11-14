variable "namespace" {
  description = "Kubernetes namespace for services"
  type        = string
}

variable "environment" {
  description = "Environment (dev/staging/prod)"
  type        = string
}

variable "container_registry" {
  description = "Container registry URL"
  type        = string
}

variable "image_tag" {
  description = "Container image tag"
  type        = string
  default     = "latest"
}

# Database connection strings
variable "main_db_url" {
  description = "Main database connection URL"
  type        = string
  sensitive   = true
}

variable "search_db_url" {
  description = "Search database connection URL"
  type        = string
  sensitive   = true
}

variable "graph_db_url" {
  description = "Graph database connection URL"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT secret for authentication"
  type        = string
  sensitive   = true
}

# Products Service Scaling
variable "products_min_scale" {
  description = "Minimum replicas for products service"
  type        = number
  default     = 0
}

variable "products_max_scale" {
  description = "Maximum replicas for products service"
  type        = number
  default     = 10
}

# Cart Service Scaling
variable "cart_min_scale" {
  description = "Minimum replicas for cart service"
  type        = number
  default     = 0
}

variable "cart_max_scale" {
  description = "Maximum replicas for cart service"
  type        = number
  default     = 10
}

# Orders Service Scaling
variable "orders_min_scale" {
  description = "Minimum replicas for orders service"
  type        = number
  default     = 0
}

variable "orders_max_scale" {
  description = "Maximum replicas for orders service"
  type        = number
  default     = 15
}

# Search Service Scaling
variable "search_min_scale" {
  description = "Minimum replicas for search service"
  type        = number
  default     = 1
}

variable "search_max_scale" {
  description = "Maximum replicas for search service"
  type        = number
  default     = 20
}

# Recommendations Service Scaling
variable "recommendations_min_scale" {
  description = "Minimum replicas for recommendations service"
  type        = number
  default     = 0
}

variable "recommendations_max_scale" {
  description = "Maximum replicas for recommendations service"
  type        = number
  default     = 10
}
