output "servicemonitors_created" {
  description = "Number of ServiceMonitors created"
  value       = var.install_monitoring ? 5 : 0
}

output "podmonitors_created" {
  description = "Number of PodMonitors created"
  value       = var.install_monitoring ? 3 : 0
}

output "monitoring_enabled" {
  description = "Whether monitoring is enabled"
  value       = var.install_monitoring
}

output "prometheus_alerts_configured" {
  description = "Whether Prometheus alerts are configured"
  value       = var.install_monitoring
}

output "grafana_dashboards_count" {
  description = "Number of Grafana dashboards deployed"
  value       = var.install_monitoring ? 3 : 0
}
