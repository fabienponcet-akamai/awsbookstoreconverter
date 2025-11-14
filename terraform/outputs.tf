# ============================================================================
# Outputs
# ============================================================================

# ============================================================================
# Cluster Information
# ============================================================================

output "cluster_id" {
  description = "LKE Cluster ID"
  value       = module.lke.cluster_id
}

output "cluster_endpoint" {
  description = "LKE Cluster API endpoint"
  value       = module.lke.cluster_endpoint
}

output "kubeconfig" {
  description = "Kubeconfig for accessing the cluster"
  value       = module.lke.kubeconfig
  sensitive   = true
}

# ============================================================================
# Access URLs
# ============================================================================

output "istio_gateway_ip" {
  description = "Istio Gateway LoadBalancer IP (configure DNS to point here)"
  value       = module.apl_core.istio_gateway_ip
}

output "argocd_url" {
  description = "ArgoCD UI URL"
  value       = "https://${module.apl_core.argocd_ip}:443"
}

output "grafana_url" {
  description = "Grafana dashboard URL"
  value       = var.install_monitoring ? "http://${module.apl_core.grafana_ip}:80" : "Not installed"
}

output "frontend_bucket_url" {
  description = "Frontend Object Storage bucket URL"
  value       = module.object_storage.bucket_url
}

output "frontend_cdn_url" {
  description = "Frontend CDN URL (if enabled)"
  value       = var.enable_cdn ? module.object_storage.cdn_url : "CDN not enabled"
}

# ============================================================================
# Credentials
# ============================================================================

output "database_password" {
  description = "PostgreSQL database password"
  value       = local.db_password
  sensitive   = true
}

output "argocd_admin_password" {
  description = "ArgoCD admin password (retrieve from cluster)"
  value       = "Run: kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d"
}

output "grafana_admin_password" {
  description = "Grafana admin password"
  value       = var.install_monitoring ? local.grafana_password : "Not installed"
  sensitive   = true
}

output "keycloak_admin_password" {
  description = "Keycloak admin password"
  value       = local.keycloak_password
  sensitive   = true
}

# ============================================================================
# DNS Configuration Instructions
# ============================================================================

output "dns_configuration" {
  description = "DNS records to configure"
  value = {
    api_domain = {
      hostname = "api.${var.domain_name}"
      type     = "A"
      value    = module.apl_core.istio_gateway_ip
    }
    frontend_domain = {
      hostname = var.domain_name
      type     = "CNAME"
      value    = var.enable_cdn ? module.object_storage.cdn_url : module.object_storage.bucket_url
    }
    argocd_domain = {
      hostname = "argocd.${var.domain_name}"
      type     = "A"
      value    = module.apl_core.argocd_ip
    }
    grafana_domain = {
      hostname = "grafana.${var.domain_name}"
      type     = "A"
      value    = var.install_monitoring ? module.apl_core.grafana_ip : "Not installed"
    }
  }
}

# ============================================================================
# Next Steps
# ============================================================================

output "next_steps" {
  description = "Next steps to complete deployment"
  value = <<-EOT

  ========================================
  🎉 Bookstore Infrastructure Deployed!
  ========================================

  ✅ LKE Cluster:     ${local.cluster_name}
  ✅ Kubernetes:      v${var.kubernetes_version}
  ✅ Region:          ${var.region}
  ✅ Environment:     ${var.environment}

  📋 NEXT STEPS:

  1. Configure kubectl:
     export KUBECONFIG=$(terraform output -raw kubeconfig | base64 -d > kubeconfig.yaml && echo kubeconfig.yaml)

  2. Configure DNS records (see 'dns_configuration' output):
     terraform output dns_configuration

  3. Get credentials:
     # Database password
     terraform output -raw database_password

     # ArgoCD password
     kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d

     # Grafana password
     terraform output -raw grafana_admin_password

  4. Access services:
     # ArgoCD
     ${module.apl_core.argocd_ip != "" ? "kubectl port-forward svc/argocd-server -n argocd 8080:443" : "ArgoCD not ready yet"}

     # Grafana
     ${var.install_monitoring ? "kubectl port-forward svc/kube-prometheus-stack-grafana -n monitoring 3000:80" : "Monitoring not installed"}

  5. Build and push container images:
     export CONTAINER_REGISTRY="${var.container_registry}"
     docker build -t $CONTAINER_REGISTRY/bookstore-api:${var.image_tag} src/api/
     docker push $CONTAINER_REGISTRY/bookstore-api:${var.image_tag}

  6. Deploy frontend to Object Storage:
     cd src/frontend
     npm run build
     s3cmd sync dist/ s3://${module.object_storage.bucket_name}/

  7. Verify deployment:
     kubectl get ksvc -n ${local.namespace}
     kubectl get clusters -n ${local.namespace}

  📚 Documentation:
     - GitOps Guide:     docs/gitops-deployment.md
     - Monitoring Guide: docs/monitoring-guide.md
     - Terraform README: terraform/README.md

  ========================================
  EOT
}

# ============================================================================
# Resource Summary
# ============================================================================

output "resource_summary" {
  description = "Summary of deployed resources"
  value = {
    cluster = {
      name             = local.cluster_name
      region           = var.region
      kubernetes       = var.kubernetes_version
      nodes            = sum([for pool in var.node_pools : pool.count])
    }
    databases = {
      main_replicas   = var.postgres_replicas.main
      search_replicas = var.postgres_replicas.search
      graph_replicas  = var.postgres_replicas.graph
      storage_size    = var.postgres_storage_size
    }
    services = {
      knative_services = 5
      monitoring       = var.install_monitoring
      tracing          = var.install_tracing
    }
    storage = {
      frontend_bucket = module.object_storage.bucket_name
      cdn_enabled     = var.enable_cdn
    }
  }
}
