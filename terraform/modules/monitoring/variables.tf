variable "namespace" {
  description = "Application namespace"
  type        = string
}

variable "install_monitoring" {
  description = "Install monitoring configurations"
  type        = bool
  default     = true
}

variable "monitoring_namespace" {
  description = "Monitoring stack namespace"
  type        = string
  default     = "monitoring"
}
