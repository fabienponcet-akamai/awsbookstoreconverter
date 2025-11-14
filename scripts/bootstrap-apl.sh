#!/usr/bin/env bash
#
# Bootstrap Akamai App Platform for Bookstore Application
# This script installs all required APL Core components using Helm charts
#
# Prerequisites:
# - LKE cluster provisioned and kubectl configured
# - Helm 3 installed
# - APL Core charts repository cloned or available
#
# Usage: ./scripts/bootstrap-apl.sh

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
APL_CHARTS_REPO="${APL_CHARTS_REPO:-https://github.com/linode/apl-core.git}"
APL_CHARTS_PATH="${APL_CHARTS_PATH:-./apl-core/charts}"
NAMESPACE="bookstore"
ARGOCD_NAMESPACE="argocd"

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $*"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARN:${NC} $*"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $*" >&2
}

check_prerequisites() {
    log "Checking prerequisites..."

    if ! command -v kubectl &> /dev/null; then
        error "kubectl not found. Please install kubectl."
        exit 1
    fi

    if ! command -v helm &> /dev/null; then
        error "helm not found. Please install Helm 3."
        exit 1
    fi

    if ! kubectl cluster-info &> /dev/null; then
        error "Cannot connect to Kubernetes cluster. Please configure kubectl."
        exit 1
    fi

    log "Prerequisites check passed ✅"
}

clone_apl_core() {
    if [ ! -d "$APL_CHARTS_PATH" ]; then
        log "Cloning APL Core charts repository..."
        git clone "$APL_CHARTS_REPO" apl-core
    else
        log "APL Core charts already available"
    fi
}

create_namespaces() {
    log "Creating namespaces..."
    kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
    kubectl create namespace "$ARGOCD_NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
    log "Namespaces created ✅"
}

install_cert_manager() {
    log "Installing Cert-Manager..."
    helm upgrade --install cert-manager "$APL_CHARTS_PATH/cert-manager" \
        --namespace cert-manager \
        --create-namespace \
        --set installCRDs=true \
        --wait
    log "Cert-Manager installed ✅"
}

install_sealed_secrets() {
    log "Installing Sealed Secrets for secret management..."
    helm upgrade --install sealed-secrets "$APL_CHARTS_PATH/sealed-secrets" \
        --namespace kube-system \
        --wait
    log "Sealed Secrets installed ✅"
}

install_istio() {
    log "Installing Istio service mesh..."

    # Install Istio operator
    helm upgrade --install istio-operator "$APL_CHARTS_PATH/istio-operator" \
        --namespace istio-operator \
        --create-namespace \
        --wait

    # Install Istio base
    helm upgrade --install istio-base "$APL_CHARTS_PATH/istio-base" \
        --namespace istio-system \
        --create-namespace \
        --wait

    # Install Istiod
    helm upgrade --install istiod "$APL_CHARTS_PATH/istiod" \
        --namespace istio-system \
        --wait

    # Install Istio Gateway
    helm upgrade --install istio-gateway "$APL_CHARTS_PATH/istio-gateway" \
        --namespace istio-system \
        --wait

    log "Istio installed ✅"
}

install_knative() {
    log "Installing Knative Serving..."
    helm upgrade --install knative-operator "$APL_CHARTS_PATH/knative-operator" \
        --namespace knative-serving \
        --create-namespace \
        --set serving.enabled=true \
        --wait
    log "Knative Serving installed ✅"
}

install_cloudnative_pg() {
    log "Installing CloudNative-PG operator..."
    helm upgrade --install cloudnative-pg "$APL_CHARTS_PATH/cloudnative-pg" \
        --namespace cnpg-system \
        --create-namespace \
        --wait
    log "CloudNative-PG installed ✅"
}

install_keycloak() {
    log "Installing Keycloak for authentication..."
    helm upgrade --install keycloak "$APL_CHARTS_PATH/keycloak" \
        --namespace "$NAMESPACE" \
        --set auth.adminUser=admin \
        --set auth.adminPassword=changeme \
        --set postgresql.enabled=true \
        --wait
    log "Keycloak installed ✅"
    warn "Default Keycloak admin password is 'changeme' - CHANGE IT!"
}

install_monitoring() {
    log "Installing monitoring stack (Prometheus + Grafana)..."
    helm upgrade --install kube-prometheus-stack "$APL_CHARTS_PATH/kube-prometheus-stack" \
        --namespace monitoring \
        --create-namespace \
        --set prometheus.prometheusSpec.retention=30d \
        --set grafana.adminPassword=changeme \
        --wait
    log "Monitoring stack installed ✅"
    warn "Default Grafana admin password is 'changeme' - CHANGE IT!"
}

install_loki() {
    log "Installing Loki for log aggregation..."
    helm upgrade --install loki "$APL_CHARTS_PATH/loki" \
        --namespace monitoring \
        --wait
    log "Loki installed ✅"
}

install_argocd() {
    log "Installing ArgoCD for GitOps..."
    helm upgrade --install argocd "$APL_CHARTS_PATH/argocd" \
        --namespace "$ARGOCD_NAMESPACE" \
        --set server.service.type=LoadBalancer \
        --wait

    # Get ArgoCD admin password
    log "Fetching ArgoCD admin password..."
    sleep 10  # Wait for secret to be created
    ARGOCD_PASSWORD=$(kubectl -n "$ARGOCD_NAMESPACE" get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" 2>/dev/null | base64 -d || echo "Password not ready yet")

    log "ArgoCD installed ✅"
    log "ArgoCD URL will be available via LoadBalancer"
    log "ArgoCD admin password: $ARGOCD_PASSWORD"
    warn "Save this password! The secret will be deleted after first login."
}

install_tekton() {
    log "Installing Tekton Pipelines for CI/CD..."

    # Install Tekton Pipelines
    helm upgrade --install tekton-pipelines "$APL_CHARTS_PATH/tekton-pipelines" \
        --namespace tekton-pipelines \
        --create-namespace \
        --wait

    # Install Tekton Triggers
    helm upgrade --install tekton-triggers "$APL_CHARTS_PATH/tekton-triggers" \
        --namespace tekton-pipelines \
        --wait

    # Install Tekton Dashboard
    helm upgrade --install tekton-dashboard "$APL_CHARTS_PATH/tekton-dashboard" \
        --namespace tekton-pipelines \
        --set service.type=LoadBalancer \
        --wait

    log "Tekton installed ✅"
}

deploy_databases() {
    log "Deploying PostgreSQL clusters..."
    kubectl apply -k kubernetes/base/databases/
    log "Waiting for PostgreSQL clusters to be ready (this may take 2-3 minutes)..."
    kubectl wait --for=condition=Ready cluster/bookstore-main -n "$NAMESPACE" --timeout=300s || warn "Main DB not ready yet"
    kubectl wait --for=condition=Ready cluster/bookstore-search -n "$NAMESPACE" --timeout=300s || warn "Search DB not ready yet"
    kubectl wait --for=condition=Ready cluster/bookstore-graph -n "$NAMESPACE" --timeout=300s || warn "Graph DB not ready yet"
    log "PostgreSQL clusters deployed ✅"
}

display_summary() {
    log ""
    log "=================================="
    log "APL Bootstrap Complete! 🎉"
    log "=================================="
    log ""
    log "Installed components:"
    log "  ✅ Cert-Manager (TLS certificates)"
    log "  ✅ Sealed Secrets (secret encryption)"
    log "  ✅ Istio (service mesh)"
    log "  ✅ Knative Serving (serverless)"
    log "  ✅ CloudNative-PG (PostgreSQL operator)"
    log "  ✅ Keycloak (authentication)"
    log "  ✅ ArgoCD (GitOps)"
    log "  ✅ Tekton (CI/CD)"
    log "  ✅ Prometheus + Grafana (monitoring)"
    log "  ✅ Loki (logs)"
    log "  ✅ 3x PostgreSQL clusters"
    log ""
    log "Next steps:"
    log "  1. Get ArgoCD URL: kubectl -n argocd get svc argocd-server"
    log "  2. Login to ArgoCD with admin/$ARGOCD_PASSWORD"
    log "  3. Deploy ArgoCD Applications: kubectl apply -f gitops/applications/"
    log "  4. Configure container registry secrets"
    log "  5. Update database passwords in secrets"
    log ""
    log "To access services:"
    log "  ArgoCD:   kubectl port-forward svc/argocd-server -n argocd 8080:443"
    log "  Grafana:  kubectl port-forward svc/kube-prometheus-stack-grafana -n monitoring 3000:80"
    log "  Tekton:   kubectl port-forward svc/tekton-dashboard -n tekton-pipelines 9097:9097"
    log ""
}

main() {
    log "Starting Akamai App Platform bootstrap for Bookstore..."

    check_prerequisites
    clone_apl_core
    create_namespaces

    install_cert_manager
    install_sealed_secrets
    install_istio
    install_knative
    install_cloudnative_pg
    install_keycloak
    install_argocd
    install_tekton
    install_monitoring
    install_loki

    deploy_databases

    display_summary
}

# Run main function
main "$@"
