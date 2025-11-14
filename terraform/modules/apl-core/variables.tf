variable "namespace" {
  description = "Application namespace"
  type        = string
}

variable "apl_core_repo" {
  description = "APL Core repository URL"
  type        = string
}

variable "apl_core_version" {
  description = "APL Core version (branch or tag)"
  type        = string
}

variable "install_monitoring" {
  description = "Install monitoring stack"
  type        = bool
}

variable "install_tracing" {
  description = "Install tracing stack"
  type        = bool
}

variable "grafana_password" {
  description = "Grafana admin password"
  type        = string
  sensitive   = true
}

variable "keycloak_password" {
  description = "Keycloak admin password"
  type        = string
  sensitive   = true
}

variable "domain_name" {
  description = "Domain name for the application"
  type        = string
}
