# Bookstore Terraform Infrastructure

One-click deployment for the AWS Bookstore Demo converted to Linode/Akamai Cloud Platform.

## Overview

This Terraform configuration deploys a complete, production-ready serverless bookstore application on Linode Kubernetes Engine (LKE) using the Akamai App Platform Core components.

**Architecture:**
- **Compute**: Knative Serving (serverless, scale-to-zero)
- **Database**: CloudNative-PG (PostgreSQL) with Apache AGE for graphs
- **Frontend**: Linode Object Storage (S3-compatible)
- **Service Mesh**: Istio
- **GitOps**: ArgoCD
- **CI/CD**: Tekton Pipelines
- **Monitoring**: Prometheus + Grafana + Loki + Jaeger
- **Security**: Cert-Manager + Sealed Secrets + Keycloak

## Prerequisites

1. **Linode API Token** with full permissions
   ```bash
   export LINODE_TOKEN="your-token-here"
   ```

2. **Required Tools:**
   - Terraform >= 1.5.0
   - kubectl >= 1.28
   - helm >= 3.12

3. **Container Registry:**
   - Docker Hub, GitHub Container Registry, or Linode Container Registry
   - Pre-built images for: `bookstore-api`

4. **Domain Name** (optional but recommended):
   - For TLS/HTTPS support
   - DNS access to configure A records

## Quick Start

### 1. Clone and Configure

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your values:

```hcl
linode_token        = "your-linode-api-token"
environment         = "production"
region              = "us-east"
domain_name         = "bookstore.yourdomain.com"
container_registry  = "docker.io/yourusername"
```

### 2. Initialize Terraform

```bash
terraform init
```

### 3. Review Plan

```bash
terraform plan
```

### 4. Deploy

```bash
terraform apply
```

This will take **15-25 minutes** to complete. Terraform will:
- ✅ Create LKE cluster (3-5 min)
- ✅ Install APL Core components (10-15 min)
- ✅ Deploy PostgreSQL clusters (3-5 min)
- ✅ Deploy Knative services (2-3 min)
- ✅ Configure monitoring (1-2 min)

### 5. Get Access Information

```bash
terraform output -json
```

This shows:
- Istio Gateway IP
- ArgoCD URL and credentials
- Grafana URL
- Database connection strings
- DNS configuration instructions

## Configuration

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `linode_token` | Linode API token | `"xxxxxxxxxxxxx"` |
| `region` | Linode region | `"us-east"` |
| `domain_name` | Your domain name | `"bookstore.example.com"` |
| `container_registry` | Container registry URL | `"docker.io/myuser"` |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `environment` | `"production"` | Environment name |
| `project_name` | `"bookstore"` | Project name |
| `kubernetes_version` | `"1.28"` | K8s version |
| `postgres_replicas` | `3` | PostgreSQL replicas |
| `install_monitoring` | `true` | Install monitoring stack |
| `install_tracing` | `true` | Install Jaeger tracing |
| `enable_tls` | `true` | Enable TLS certificates |

### Node Pools Configuration

Default configuration:

```hcl
node_pools = [
  { type = "g6-standard-4", count = 3 }  # 4 vCPUs, 8GB RAM
]
```

For production:

```hcl
node_pools = [
  { type = "g6-standard-4", count = 3 },   # General workload
  { type = "g6-standard-8", count = 2 }    # Database nodes
]
```

For development:

```hcl
node_pools = [
  { type = "g6-standard-2", count = 2 }    # 2 vCPUs, 4GB RAM
]
```

## Modules

### 1. LKE Module (`modules/lke`)

Creates Linode Kubernetes Engine cluster with:
- Auto-scaling node pools
- High availability (3+ nodes)
- Automatic upgrades
- Built-in load balancer

**Outputs:**
- `cluster_id`
- `cluster_endpoint`
- `kubeconfig`

### 2. Object Storage Module (`modules/object-storage`)

Creates Linode Object Storage for frontend:
- Public read access
- CORS configuration
- Versioning enabled
- CDN ready

**Outputs:**
- `bucket_url`
- `cdn_url`
- `access_key`

### 3. APL Core Module (`modules/apl-core`)

Deploys Akamai App Platform Core via Helm:
- Cert-Manager (TLS)
- Sealed Secrets (encryption)
- Istio (service mesh)
- Knative Serving (serverless)
- CloudNative-PG (PostgreSQL operator)
- Keycloak (auth)
- ArgoCD (GitOps)
- Tekton (CI/CD)
- Prometheus + Grafana (monitoring)
- Loki (logs)
- Jaeger (tracing)

**Outputs:**
- `istio_gateway_ip`
- `argocd_ip`
- `grafana_ip`

### 4. Databases Module (`modules/databases`)

Deploys three PostgreSQL clusters via CloudNative-PG:
- **bookstore-main**: Transactional data (3 replicas)
- **bookstore-search**: Full-text search with pg_trgm (2 replicas)
- **bookstore-graph**: Apache AGE for recommendations (2 replicas)

Features:
- Automated backups to Object Storage
- Point-in-time recovery (30 days)
- Streaming replication
- PgBouncer connection pooling
- Prometheus metrics

**Outputs:**
- Connection strings for all databases
- Individual host/port/credentials

### 5. Knative Services Module (`modules/knative-services`)

Deploys 5 serverless microservices:

| Service | Purpose | Scale | Resources |
|---------|---------|-------|-----------|
| `products-api` | Product catalog | 0-10 | 256Mi-512Mi |
| `cart-api` | Shopping cart | 0-10 | 256Mi-512Mi |
| `orders-api` | Order processing | 0-15 | 512Mi-1Gi |
| `search-api` | Full-text search | 1-20 | 512Mi-1Gi |
| `recommendations-api` | Graph recommendations | 0-10 | 512Mi-1Gi |

All services:
- Scale to zero when idle
- Auto-scale based on requests (target: 100 req/s)
- Health checks (liveness + readiness)
- Prometheus metrics at `/metrics`

**Outputs:**
- Internal service URLs

### 6. Monitoring Module (`modules/monitoring`)

Deploys monitoring configurations:
- **ServiceMonitors**: 5 monitors for Knative services
- **PodMonitors**: 3 monitors for PostgreSQL clusters
- **PrometheusRules**: 17 alert rules
- **Grafana Dashboards**: 3 pre-configured dashboards

**Outputs:**
- Counts of deployed monitoring resources

## Post-Deployment Steps

### 1. Configure DNS

Get the Istio Gateway IP:

```bash
terraform output istio_gateway_ip
```

Create DNS A records:

```
bookstore.yourdomain.com        A    <istio_gateway_ip>
*.bookstore.yourdomain.com      A    <istio_gateway_ip>
argocd.yourdomain.com           A    <argocd_ip>
grafana.yourdomain.com          A    <grafana_ip>
```

### 2. Access ArgoCD

```bash
# Get ArgoCD password
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d

# Access ArgoCD UI
terraform output argocd_url
```

Login: `admin` / `<password>`

### 3. Access Grafana

```bash
# Get Grafana password (from terraform.tfvars)
echo $GRAFANA_PASSWORD

# Access Grafana UI
terraform output grafana_url
```

Login: `admin` / `<grafana_password>`

### 4. Deploy Frontend

```bash
# Build frontend
cd ../frontend
npm run build

# Deploy to Object Storage
export BUCKET_URL=$(terraform output -raw frontend_bucket_url)
aws s3 sync dist/ s3://${BUCKET_URL} \
  --endpoint-url=https://us-east-1.linodeobjects.com \
  --acl public-read
```

### 5. Initialize Databases

```bash
# Connect to main database
kubectl exec -it -n bookstore bookstore-main-1 -- psql -U bookstore

# Run migrations (if not using ArgoCD Jobs)
kubectl apply -f ../kubernetes/base/migrations/
```

## Accessing Services

### External Access (via Istio Gateway)

```bash
# Get Gateway IP
export GATEWAY_IP=$(terraform output -raw istio_gateway_ip)

# Products API
curl http://${GATEWAY_IP}/api/products

# Search API
curl http://${GATEWAY_IP}/api/search?q=kubernetes

# Frontend (if deployed)
open http://${GATEWAY_IP}
```

### Internal Access (within cluster)

Services are accessible via Kubernetes DNS:

```
http://products-api.bookstore.svc.cluster.local
http://cart-api.bookstore.svc.cluster.local
http://orders-api.bookstore.svc.cluster.local
http://search-api.bookstore.svc.cluster.local
http://recommendations-api.bookstore.svc.cluster.local
```

## Monitoring

### Prometheus Alerts

View alerts in Grafana:
- Go to Alerting → Alert Rules
- Filter by `bookstore` namespace

### Grafana Dashboards

Three pre-configured dashboards:
1. **Bookstore - Overview**: Request rate, errors, latency, pods
2. **Bookstore - Knative Services**: Replicas, cold starts, scale-to-zero
3. **Bookstore - PostgreSQL Clusters**: Connections, queries, replication lag

### Loki Logs

Query logs in Grafana Explore:

```logql
{namespace="bookstore"} |= "error"
{namespace="bookstore", app="products-api"} | json
```

### Jaeger Tracing

Access Jaeger UI:

```bash
kubectl port-forward -n monitoring svc/bookstore-jaeger-query 16686:16686
open http://localhost:16686
```

## Scaling

### Scale Node Pools

Edit `terraform.tfvars`:

```hcl
node_pools = [
  { type = "g6-standard-4", count = 5 }  # Scale from 3 to 5
]
```

Apply:

```bash
terraform apply
```

### Scale PostgreSQL Replicas

Edit `terraform.tfvars`:

```hcl
postgres_replicas = 5  # Scale from 3 to 5
```

Apply:

```bash
terraform apply
```

### Scale Knative Services

Knative auto-scales based on traffic. To adjust limits:

Edit `modules/knative-services/variables.tf` or pass variables:

```hcl
products_max_scale = 20  # Default: 10
search_max_scale   = 50  # Default: 20
```

## Backup and Recovery

### Database Backups

Backups are automatic via CloudNative-PG:
- **Frequency**: Every 6 hours
- **Retention**: 30 days
- **Storage**: Linode Object Storage
- **Type**: Physical backups (pg_basebackup + WAL)

### List Backups

```bash
kubectl cnpg backup list bookstore-main -n bookstore
```

### Restore from Backup

```bash
kubectl apply -f - <<EOF
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: bookstore-main-restored
  namespace: bookstore
spec:
  instances: 3
  bootstrap:
    recovery:
      backup:
        name: bookstore-main-20250114-120000
EOF
```

## Troubleshooting

### Pods Not Starting

```bash
# Check pod status
kubectl get pods -n bookstore

# Check events
kubectl get events -n bookstore --sort-by='.lastTimestamp'

# Check logs
kubectl logs -n bookstore <pod-name>
```

### Database Connection Issues

```bash
# Check PostgreSQL cluster status
kubectl get cluster -n bookstore

# Check database logs
kubectl logs -n bookstore bookstore-main-1 -c postgres

# Test connection
kubectl exec -it -n bookstore bookstore-main-1 -- psql -U bookstore -c "\conninfo"
```

### Knative Service Not Scaling

```bash
# Check Knative service status
kubectl get ksvc -n bookstore

# Check revisions
kubectl get revisions -n bookstore

# Check autoscaler logs
kubectl logs -n knative-serving -l app=autoscaler
```

### Istio Gateway Not Working

```bash
# Check gateway status
kubectl get gateway -n bookstore

# Check virtual services
kubectl get virtualservice -n bookstore

# Check Istio logs
kubectl logs -n istio-system -l app=istio-ingressgateway
```

## Cost Estimation

**Monthly Costs** (approximate, us-east region):

| Resource | Configuration | Cost |
|----------|---------------|------|
| LKE Cluster (3x g6-standard-4) | 4 vCPU, 8GB RAM each | $108 |
| Block Storage (PostgreSQL) | 110GB (50+30+30) | $11 |
| Object Storage | 10GB + 50GB transfer | $1 |
| Load Balancers (NodeBalancers) | 3 (Istio, ArgoCD, Grafana) | $30 |
| **Total** | | **~$150/month** |

**Production** (recommended):
- 5x g6-standard-4 + 2x g6-standard-8: ~$300/month
- With larger storage (300GB): ~$330/month

**Development** (minimal):
- 2x g6-standard-2: ~$50/month

## Cleanup

**⚠️ WARNING**: This will delete ALL resources including data!

```bash
# Destroy all infrastructure
terraform destroy

# Confirm with: yes
```

To preserve data, backup databases first:

```bash
# Backup all databases
kubectl cnpg backup bookstore-main -n bookstore
kubectl cnpg backup bookstore-search -n bookstore
kubectl cnpg backup bookstore-graph -n bookstore
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Linode Cloud                            │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │           LKE Cluster (Kubernetes)                  │  │
│  │                                                     │  │
│  │  ┌──────────────────────────────────────────┐     │  │
│  │  │       Istio Service Mesh                 │     │  │
│  │  │  ┌────────────────────────────────┐     │     │  │
│  │  │  │   Knative Serving              │     │     │  │
│  │  │  │                                │     │     │  │
│  │  │  │  ┌──────────┐  ┌──────────┐  │     │     │  │
│  │  │  │  │ Products │  │   Cart   │  │     │     │  │
│  │  │  │  │   API    │  │   API    │  │     │     │  │
│  │  │  │  └──────────┘  └──────────┘  │     │     │  │
│  │  │  │  ┌──────────┐  ┌──────────┐  │     │     │  │
│  │  │  │  │  Orders  │  │  Search  │  │     │     │  │
│  │  │  │  │   API    │  │   API    │  │     │     │  │
│  │  │  │  └──────────┘  └──────────┘  │     │     │  │
│  │  │  │  ┌──────────────────┐        │     │     │  │
│  │  │  │  │ Recommendations  │        │     │     │  │
│  │  │  │  │      API         │        │     │     │  │
│  │  │  │  └──────────────────┘        │     │     │  │
│  │  │  └────────────────────────────────┘     │     │  │
│  │  └──────────────────────────────────────────┘     │  │
│  │                                                     │  │
│  │  ┌──────────────────────────────────────────┐     │  │
│  │  │     CloudNative-PG (PostgreSQL)          │     │  │
│  │  │  ┌──────┐  ┌──────┐  ┌───────┐          │     │  │
│  │  │  │ Main │  │Search│  │ Graph │          │     │  │
│  │  │  │  DB  │  │  DB  │  │  DB   │          │     │  │
│  │  │  └──────┘  └──────┘  └───────┘          │     │  │
│  │  └──────────────────────────────────────────┘     │  │
│  │                                                     │  │
│  │  ┌──────────────────────────────────────────┐     │  │
│  │  │        GitOps & CI/CD                    │     │  │
│  │  │   ArgoCD  │  Tekton  │  Sealed Secrets   │     │  │
│  │  └──────────────────────────────────────────┘     │  │
│  │                                                     │  │
│  │  ┌──────────────────────────────────────────┐     │  │
│  │  │      Observability Stack                 │     │  │
│  │  │  Prometheus │ Grafana │ Loki │ Jaeger    │     │  │
│  │  └──────────────────────────────────────────┘     │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │       Linode Object Storage (Frontend)              │  │
│  │          React SPA + Static Assets                  │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Support

For issues and questions:
- **Terraform Issues**: Check `terraform.log`
- **Kubernetes Issues**: `kubectl get events`
- **APL Core Docs**: https://github.com/linode/apl-core
- **Linode Docs**: https://linode.com/docs

## License

MIT License - See [LICENSE](../LICENSE) file.
