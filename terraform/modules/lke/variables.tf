variable "cluster_name" {
  description = "Name of the LKE cluster"
  type        = string
}

variable "region" {
  description = "Linode region"
  type        = string
}

variable "kubernetes_version" {
  description = "Kubernetes version"
  type        = string
}

variable "node_pools" {
  description = "Node pool configuration"
  type = list(object({
    type  = string
    count = number
  }))
}

variable "tags" {
  description = "Tags to apply to the cluster"
  type        = map(string)
  default     = {}
}
