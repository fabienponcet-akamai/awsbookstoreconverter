output "cluster_id" {
  description = "LKE cluster ID"
  value       = linode_lke_cluster.this.id
}

output "cluster_endpoint" {
  description = "Kubernetes API endpoint"
  value       = linode_lke_cluster.this.api_endpoints[0]
}

output "cluster_token" {
  description = "Kubernetes access token"
  value       = nonsensitive(data.linode_lke_cluster.this.kubeconfig)
  sensitive   = true
}

output "cluster_ca_certificate" {
  description = "Cluster CA certificate"
  value       = base64encode(data.linode_lke_cluster.this.kubeconfig)
  sensitive   = true
}

output "kubeconfig" {
  description = "Complete kubeconfig"
  value       = base64encode(data.linode_lke_cluster.this.kubeconfig)
  sensitive   = true
}
