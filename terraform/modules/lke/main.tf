# ============================================================================
# LKE Cluster Module
# Creates Linode Kubernetes Engine cluster
# ============================================================================

resource "linode_lke_cluster" "this" {
  label       = var.cluster_name
  k8s_version = var.kubernetes_version
  region      = var.region
  tags        = [for k, v in var.tags : "${k}:${v}"]

  dynamic "pool" {
    for_each = var.node_pools
    content {
      type  = pool.value.type
      count = pool.value.count

      autoscaler {
        min = pool.value.count
        max = pool.value.count * 3 # Allow 3x scaling
      }
    }
  }

  lifecycle {
    ignore_changes = [
      pool[0].count # Allow autoscaling to manage count
    ]
  }
}

# Decode kubeconfig
data "linode_lke_cluster" "this" {
  id = linode_lke_cluster.this.id
}
