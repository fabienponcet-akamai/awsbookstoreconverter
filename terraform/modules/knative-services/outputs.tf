output "services_deployed" {
  description = "List of deployed Knative services"
  value = [
    "products-api",
    "cart-api",
    "orders-api",
    "search-api",
    "recommendations-api"
  ]
}

output "products_service_url" {
  description = "Products service internal URL"
  value       = "http://products-api.${var.namespace}.svc.cluster.local"
}

output "cart_service_url" {
  description = "Cart service internal URL"
  value       = "http://cart-api.${var.namespace}.svc.cluster.local"
}

output "orders_service_url" {
  description = "Orders service internal URL"
  value       = "http://orders-api.${var.namespace}.svc.cluster.local"
}

output "search_service_url" {
  description = "Search service internal URL"
  value       = "http://search-api.${var.namespace}.svc.cluster.local"
}

output "recommendations_service_url" {
  description = "Recommendations service internal URL"
  value       = "http://recommendations-api.${var.namespace}.svc.cluster.local"
}
