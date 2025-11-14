# ============================================================================
# APL Core Module
# Deploys Akamai App Platform Core components via Helm
# Based on: https://github.com/linode/apl-core
# ============================================================================

# Create namespace
resource "kubernetes_namespace" "bookstore" {
  metadata {
    name = var.namespace
  }
}

resource "kubernetes_namespace" "argocd" {
  metadata {
    name = "argocd"
  }
}

resource "kubernetes_namespace" "monitoring" {
  count = var.install_monitoring ? 1 : 0
  metadata {
    name = "monitoring"
  }
}

# ============================================================================
# Cert-Manager (TLS certificates)
# ============================================================================

resource "helm_release" "cert_manager" {
  name       = "cert-manager"
  repository = "https://charts.jetstack.io"
  chart      = "cert-manager"
  version    = "v1.13.3"
  namespace  = "cert-manager"
  create_namespace = true

  set {
    name  = "installCRDs"
    value = "true"
  }

  wait    = true
  timeout = 600
}

# ============================================================================
# Sealed Secrets (secret encryption)
# ============================================================================

resource "helm_release" "sealed_secrets" {
  name       = "sealed-secrets"
  repository = "https://bitnami-labs.github.io/sealed-secrets"
  chart      = "sealed-secrets"
  version    = "2.13.2"
  namespace  = "kube-system"

  wait    = true
  timeout = 300

  depends_on = [cert_manager]
}

# ============================================================================
# Istio Service Mesh
# ============================================================================

resource "helm_release" "istio_base" {
  name       = "istio-base"
  repository = "https://istio-release.storage.googleapis.com/charts"
  chart      = "base"
  version    = "1.20.0"
  namespace  = "istio-system"
  create_namespace = true

  wait    = true
  timeout = 300
}

resource "helm_release" "istiod" {
  name       = "istiod"
  repository = "https://istio-release.storage.googleapis.com/charts"
  chart      = "istiod"
  version    = "1.20.0"
  namespace  = "istio-system"

  wait    = true
  timeout = 600

  depends_on = [helm_release.istio_base]
}

resource "helm_release" "istio_ingress" {
  name       = "istio-ingressgateway"
  repository = "https://istio-release.storage.googleapis.com/charts"
  chart      = "gateway"
  version    = "1.20.0"
  namespace  = "istio-system"

  wait    = true
  timeout = 600

  depends_on = [helm_release.istiod]
}

# ============================================================================
# Knative Serving (serverless platform)
# ============================================================================

resource "helm_release" "knative_serving" {
  name       = "knative-serving"
  repository = "https://charts.knative.dev/serving"
  chart      = "knative-serving"
  version    = "1.12.0"
  namespace  = "knative-serving"
  create_namespace = true

  set {
    name  = "istio.enabled"
    value = "true"
  }

  wait    = true
  timeout = 600

  depends_on = [helm_release.istio_ingress]
}

# ============================================================================
# CloudNative-PG Operator
# ============================================================================

resource "helm_release" "cloudnative_pg" {
  name       = "cloudnative-pg"
  repository = "https://cloudnative-pg.github.io/charts"
  chart      = "cloudnative-pg"
  version    = "0.20.0"
  namespace  = "cnpg-system"
  create_namespace = true

  wait    = true
  timeout = 300
}

# ============================================================================
# Keycloak (authentication)
# ============================================================================

resource "helm_release" "keycloak" {
  name       = "keycloak"
  repository = "https://charts.bitnami.com/bitnami"
  chart      = "keycloak"
  version    = "18.0.0"
  namespace  = var.namespace

  set {
    name  = "auth.adminUser"
    value = "admin"
  }

  set_sensitive {
    name  = "auth.adminPassword"
    value = var.keycloak_password
  }

  set {
    name  = "postgresql.enabled"
    value = "true"
  }

  set {
    name  = "postgresql.auth.password"
    value = var.keycloak_password
  }

  wait    = true
  timeout = 600

  depends_on = [kubernetes_namespace.bookstore]
}

# ============================================================================
# ArgoCD (GitOps)
# ============================================================================

resource "helm_release" "argocd" {
  name       = "argocd"
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argo-cd"
  version    = "5.51.6"
  namespace  = "argocd"

  set {
    name  = "server.service.type"
    value = "LoadBalancer"
  }

  set {
    name  = "server.extraArgs[0]"
    value = "--insecure"
  }

  wait    = true
  timeout = 600

  depends_on = [kubernetes_namespace.argocd]
}

# ============================================================================
# Tekton Pipelines (CI/CD)
# ============================================================================

resource "helm_release" "tekton_pipelines" {
  name       = "tekton-pipelines"
  repository = "https://charts.cd.tekton.dev"
  chart      = "pipelines"
  version    = "0.56.0"
  namespace  = "tekton-pipelines"
  create_namespace = true

  wait    = true
  timeout = 600
}

resource "helm_release" "tekton_dashboard" {
  name       = "tekton-dashboard"
  repository = "https://charts.cd.tekton.dev"
  chart      = "dashboard"
  version    = "0.42.0"
  namespace  = "tekton-pipelines"

  set {
    name  = "service.type"
    value = "LoadBalancer"
  }

  wait    = true
  timeout = 300

  depends_on = [helm_release.tekton_pipelines]
}

# ============================================================================
# Monitoring Stack (Prometheus + Grafana)
# ============================================================================

resource "helm_release" "kube_prometheus_stack" {
  count      = var.install_monitoring ? 1 : 0
  name       = "kube-prometheus-stack"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  version    = "55.0.0"
  namespace  = "monitoring"

  set {
    name  = "prometheus.prometheusSpec.retention"
    value = "30d"
  }

  set {
    name  = "prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.resources.requests.storage"
    value = "50Gi"
  }

  set {
    name  = "grafana.adminPassword"
    value = var.grafana_password
  }

  set {
    name  = "grafana.persistence.enabled"
    value = "true"
  }

  set {
    name  = "grafana.persistence.size"
    value = "10Gi"
  }

  wait    = true
  timeout = 900

  depends_on = [kubernetes_namespace.monitoring]
}

# ============================================================================
# Loki (log aggregation)
# ============================================================================

resource "helm_release" "loki" {
  count      = var.install_monitoring ? 1 : 0
  name       = "loki"
  repository = "https://grafana.github.io/helm-charts"
  chart      = "loki-stack"
  version    = "2.10.0"
  namespace  = "monitoring"

  set {
    name  = "promtail.enabled"
    value = "true"
  }

  set {
    name  = "loki.persistence.enabled"
    value = "true"
  }

  set {
    name  = "loki.persistence.size"
    value = "10Gi"
  }

  wait    = true
  timeout = 600

  depends_on = [helm_release.kube_prometheus_stack]
}

# ============================================================================
# Jaeger (distributed tracing)
# ============================================================================

resource "helm_release" "jaeger_operator" {
  count      = var.install_tracing ? 1 : 0
  name       = "jaeger-operator"
  repository = "https://jaegertracing.github.io/helm-charts"
  chart      = "jaeger-operator"
  version    = "2.49.0"
  namespace  = "monitoring"

  wait    = true
  timeout = 600

  depends_on = [kubernetes_namespace.monitoring]
}

# ============================================================================
# Get LoadBalancer IPs
# ============================================================================

data "kubernetes_service" "istio_gateway" {
  metadata {
    name      = "istio-ingressgateway"
    namespace = "istio-system"
  }

  depends_on = [helm_release.istio_ingress]
}

data "kubernetes_service" "argocd" {
  metadata {
    name      = "argocd-server"
    namespace = "argocd"
  }

  depends_on = [helm_release.argocd]
}

data "kubernetes_service" "grafana" {
  count = var.install_monitoring ? 1 : 0
  metadata {
    name      = "kube-prometheus-stack-grafana"
    namespace = "monitoring"
  }

  depends_on = [helm_release.kube_prometheus_stack]
}
