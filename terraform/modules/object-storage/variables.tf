variable "bucket_name" {
  description = "Name of the Object Storage bucket"
  type        = string
}

variable "cluster" {
  description = "Object Storage cluster (e.g., us-east-1)"
  type        = string
}

variable "region" {
  description = "Linode region"
  type        = string
}

variable "enable_cdn" {
  description = "Enable Akamai CDN"
  type        = bool
  default     = true
}
