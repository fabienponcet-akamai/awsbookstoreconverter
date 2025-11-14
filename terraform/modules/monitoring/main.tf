# ============================================================================
# Monitoring Module
# Deploys ServiceMonitors, PodMonitors, Alerts, and Dashboards
# ============================================================================

# ============================================================================
# ServiceMonitors for Knative Services
# ============================================================================

resource "kubectl_manifest" "products_servicemonitor" {
  count = var.install_monitoring ? 1 : 0

  yaml_body = <<-YAML
    apiVersion: monitoring.coreos.com/v1
    kind: ServiceMonitor
    metadata:
      name: products-api
      namespace: ${var.namespace}
      labels:
        app: products-api
    spec:
      selector:
        matchLabels:
          serving.knative.dev/service: products-api
      endpoints:
        - port: http
          path: /metrics
          interval: 15s
  YAML
}

resource "kubectl_manifest" "cart_servicemonitor" {
  count = var.install_monitoring ? 1 : 0

  yaml_body = <<-YAML
    apiVersion: monitoring.coreos.com/v1
    kind: ServiceMonitor
    metadata:
      name: cart-api
      namespace: ${var.namespace}
      labels:
        app: cart-api
    spec:
      selector:
        matchLabels:
          serving.knative.dev/service: cart-api
      endpoints:
        - port: http
          path: /metrics
          interval: 15s
  YAML
}

resource "kubectl_manifest" "orders_servicemonitor" {
  count = var.install_monitoring ? 1 : 0

  yaml_body = <<-YAML
    apiVersion: monitoring.coreos.com/v1
    kind: ServiceMonitor
    metadata:
      name: orders-api
      namespace: ${var.namespace}
      labels:
        app: orders-api
    spec:
      selector:
        matchLabels:
          serving.knative.dev/service: orders-api
      endpoints:
        - port: http
          path: /metrics
          interval: 15s
  YAML
}

resource "kubectl_manifest" "search_servicemonitor" {
  count = var.install_monitoring ? 1 : 0

  yaml_body = <<-YAML
    apiVersion: monitoring.coreos.com/v1
    kind: ServiceMonitor
    metadata:
      name: search-api
      namespace: ${var.namespace}
      labels:
        app: search-api
    spec:
      selector:
        matchLabels:
          serving.knative.dev/service: search-api
      endpoints:
        - port: http
          path: /metrics
          interval: 15s
  YAML
}

resource "kubectl_manifest" "recommendations_servicemonitor" {
  count = var.install_monitoring ? 1 : 0

  yaml_body = <<-YAML
    apiVersion: monitoring.coreos.com/v1
    kind: ServiceMonitor
    metadata:
      name: recommendations-api
      namespace: ${var.namespace}
      labels:
        app: recommendations-api
    spec:
      selector:
        matchLabels:
          serving.knative.dev/service: recommendations-api
      endpoints:
        - port: http
          path: /metrics
          interval: 15s
  YAML
}

# ============================================================================
# PodMonitors for PostgreSQL Clusters
# ============================================================================

resource "kubectl_manifest" "main_db_podmonitor" {
  count = var.install_monitoring ? 1 : 0

  yaml_body = <<-YAML
    apiVersion: monitoring.coreos.com/v1
    kind: PodMonitor
    metadata:
      name: bookstore-main-db
      namespace: ${var.namespace}
      labels:
        app: bookstore-main-db
    spec:
      selector:
        matchLabels:
          postgresql: bookstore-main
      podMetricsEndpoints:
        - port: metrics
          interval: 15s
  YAML
}

resource "kubectl_manifest" "search_db_podmonitor" {
  count = var.install_monitoring ? 1 : 0

  yaml_body = <<-YAML
    apiVersion: monitoring.coreos.com/v1
    kind: PodMonitor
    metadata:
      name: bookstore-search-db
      namespace: ${var.namespace}
      labels:
        app: bookstore-search-db
    spec:
      selector:
        matchLabels:
          postgresql: bookstore-search
      podMetricsEndpoints:
        - port: metrics
          interval: 15s
  YAML
}

resource "kubectl_manifest" "graph_db_podmonitor" {
  count = var.install_monitoring ? 1 : 0

  yaml_body = <<-YAML
    apiVersion: monitoring.coreos.com/v1
    kind: PodMonitor
    metadata:
      name: bookstore-graph-db
      namespace: ${var.namespace}
      labels:
        app: bookstore-graph-db
    spec:
      selector:
        matchLabels:
          postgresql: bookstore-graph
      podMetricsEndpoints:
        - port: metrics
          interval: 15s
  YAML
}

# ============================================================================
# PrometheusRule - Alerts
# ============================================================================

resource "kubectl_manifest" "prometheus_alerts" {
  count = var.install_monitoring ? 1 : 0

  yaml_body = file("${path.module}/alerts.yaml")
}

# ============================================================================
# Grafana Dashboards
# ============================================================================

resource "kubernetes_config_map" "grafana_dashboard_overview" {
  count = var.install_monitoring ? 1 : 0

  metadata {
    name      = "grafana-dashboard-bookstore-overview"
    namespace = "monitoring"
    labels = {
      grafana_dashboard = "1"
    }
  }

  data = {
    "bookstore-overview.json" = file("${path.module}/dashboards/overview.json")
  }
}

resource "kubernetes_config_map" "grafana_dashboard_knative" {
  count = var.install_monitoring ? 1 : 0

  metadata {
    name      = "grafana-dashboard-knative-services"
    namespace = "monitoring"
    labels = {
      grafana_dashboard = "1"
    }
  }

  data = {
    "knative-services.json" = file("${path.module}/dashboards/knative.json")
  }
}

resource "kubernetes_config_map" "grafana_dashboard_postgres" {
  count = var.install_monitoring ? 1 : 0

  metadata {
    name      = "grafana-dashboard-postgres-clusters"
    namespace = "monitoring"
    labels = {
      grafana_dashboard = "1"
    }
  }

  data = {
    "postgres-clusters.json" = file("${path.module}/dashboards/postgres.json")
  }
}
