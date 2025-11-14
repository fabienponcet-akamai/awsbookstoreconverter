output "istio_gateway_ip" {
  description = "Istio Gateway LoadBalancer IP"
  value       = try(data.kubernetes_service.istio_gateway.status[0].load_balancer[0].ingress[0].ip, "")
}

output "argocd_ip" {
  description = "ArgoCD LoadBalancer IP"
  value       = try(data.kubernetes_service.argocd.status[0].load_balancer[0].ingress[0].ip, "")
}

output "grafana_ip" {
  description = "Grafana LoadBalancer IP"
  value       = var.install_monitoring ? try(data.kubernetes_service.grafana[0].status[0].load_balancer[0].ingress[0].ip, "") : ""
}

output "namespace" {
  description = "Application namespace"
  value       = kubernetes_namespace.bookstore.metadata[0].name
}
