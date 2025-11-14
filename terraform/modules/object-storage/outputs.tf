output "bucket_name" {
  description = "Object Storage bucket name"
  value       = linode_object_storage_bucket.frontend.label
}

output "bucket_url" {
  description = "Object Storage bucket URL"
  value       = "https://${linode_object_storage_bucket.frontend.label}.${var.cluster}.linodeobjects.com"
}

output "cdn_url" {
  description = "CDN URL (if enabled)"
  value       = var.enable_cdn ? "https://${linode_object_storage_bucket.frontend.label}.${var.cluster}.cdn.linodeobjects.com" : ""
}

output "access_key" {
  description = "Object Storage access key"
  value       = linode_object_storage_key.frontend.access_key
  sensitive   = true
}

output "secret_key" {
  description = "Object Storage secret key"
  value       = linode_object_storage_key.frontend.secret_key
  sensitive   = true
}
