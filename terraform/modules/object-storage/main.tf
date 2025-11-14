# ============================================================================
# Object Storage Module
# Creates Linode Object Storage bucket for frontend
# ============================================================================

resource "linode_object_storage_bucket" "frontend" {
  cluster = var.cluster
  label   = var.bucket_name
  acl     = "public-read" # Frontend needs to be publicly accessible

  lifecycle_rule {
    id      = "expire-old-versions"
    enabled = true

    abort_incomplete_multipart_upload_days = 7

    noncurrent_version_expiration {
      days = 90
    }
  }

  versioning {
    enabled = true
  }

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    max_age_seconds = 3600
  }
}

# Object Storage access key
resource "linode_object_storage_key" "frontend" {
  label = "${var.bucket_name}-key"

  bucket_access {
    bucket_name = linode_object_storage_bucket.frontend.label
    cluster     = linode_object_storage_bucket.frontend.cluster
    permissions = "read_write"
  }
}

# Static website hosting configuration (via Kubernetes ConfigMap for deployment script)
resource "kubernetes_config_map" "s3cmd_config" {
  metadata {
    name      = "s3cmd-config"
    namespace = "bookstore"
  }

  data = {
    access_key    = linode_object_storage_key.frontend.access_key
    secret_key    = linode_object_storage_key.frontend.secret_key
    bucket_name   = linode_object_storage_bucket.frontend.label
    bucket_url    = "https://${linode_object_storage_bucket.frontend.label}.${var.cluster}.linodeobjects.com"
    endpoint      = "${var.cluster}.linodeobjects.com"
  }
}
