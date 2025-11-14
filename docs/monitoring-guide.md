# Monitoring Guide - Bookstore Application

## 📊 Overview

Complete monitoring stack for Bookstore application using:
- **Prometheus** - Metrics collection and alerting
- **Grafana** - Visualization and dashboards
- **Loki** - Log aggregation
- **Jaeger** - Distributed tracing
- **OpenTelemetry** - Traces and metrics collection

All components are installed via APL Core bootstrap and configured automatically.

---

## 🚀 Quick Start

### 1. Deploy Monitoring Configuration

```bash
# Deploy via ArgoCD (recommended)
kubectl apply -f gitops/applications/bookstore-monitoring.yaml

# Or manually
kubectl apply -k kubernetes/base/monitoring/
```

### 2. Access Dashboards

#### Grafana
```bash
# Port-forward to access locally
kubectl port-forward svc/kube-prometheus-stack-grafana -n monitoring 3000:80

# Access: http://localhost:3000
# Default credentials:
#   Username: admin
#   Password: changeme  # CHANGE THIS!

# Get admin password
kubectl get secret -n monitoring kube-prometheus-stack-grafana -o jsonpath="{.data.admin-password}" | base64 -d
```

#### Prometheus
```bash
kubectl port-forward svc/kube-prometheus-stack-prometheus -n monitoring 9090:9090
# Access: http://localhost:9090
```

#### Jaeger UI
```bash
kubectl port-forward svc/bookstore-jaeger-query -n monitoring 16686:16686
# Access: http://localhost:16686
```

---

## 📈 Grafana Dashboards

### Pre-configured Dashboards

After deployment, the following dashboards are available:

#### 1. **Bookstore - Overview**
**URL**: Grafana → Dashboards → Bookstore - Overview

**Panels**:
- Request Rate (req/s) by service
- Error Rate (%) by service
- P95 Response Time (s)
- Active Pods count
- Database Connections by cluster
- Memory Usage (MB) per pod

**Use case**: High-level health check of entire application

#### 2. **Bookstore - Knative Services**
**URL**: Grafana → Dashboards → Bookstore - Knative Services

**Panels**:
- Autoscaler Desired Pods
- Actual Pods vs Desired
- Cold Start Duration (P95, P99)
- Concurrent Requests per service

**Use case**: Monitor serverless behavior and scaling

#### 3. **Bookstore - PostgreSQL Clusters**
**URL**: Grafana → Dashboards → Bookstore - PostgreSQL Clusters

**Panels**:
- Database Connections
- Transaction Rate (txn/s)
- Database Size (GB)
- Replication Lag (s)
- Cache Hit Ratio (%)
- Deadlocks rate

**Use case**: Database performance monitoring

### Import Additional Dashboards

```bash
# Knative Serving dashboard (community)
# ID: 14845
# In Grafana: Dashboards → Import → 14845

# PostgreSQL dashboard (community)
# ID: 9628
# In Grafana: Dashboards → Import → 9628

# Istio dashboard (community)
# ID: 7639
# In Grafana: Dashboards → Import → 7639
```

---

## 🔔 Alerts Configuration

### Alert Rules Deployed

All alerts are defined in `kubernetes/base/monitoring/prometheusrules/alerts.yaml`

#### API Alerts

| Alert | Threshold | Severity | Description |
|-------|-----------|----------|-------------|
| **HighErrorRate** | > 5% | Warning | Error rate exceeds 5% for 5 minutes |
| **HighResponseTime** | P95 > 1s | Warning | Response time too high for 10 minutes |
| **ServiceDown** | Up == 0 | Critical | Service is down for 2 minutes |
| **NoPodsAvailable** | Replicas == 0 | Critical | No pods available for 5 minutes |
| **HighMemoryUsage** | > 90% | Warning | Memory usage above 90% for 5 minutes |
| **HighCPUUsage** | > 90% | Warning | CPU usage above 90% for 10 minutes |

#### Database Alerts

| Alert | Threshold | Severity | Description |
|-------|-----------|----------|-------------|
| **PostgreSQLDown** | pg_up == 0 | Critical | Database unreachable for 1 minute |
| **PostgreSQLReplicationLag** | > 30s | Warning | Replication lag too high |
| **PostgreSQLTooManyConnections** | > 80% | Warning | Connection pool filling up |
| **PostgreSQLDiskUsageHigh** | > 80% | Warning | Disk usage above 80% |
| **PostgreSQLClusterNotHealthy** | In recovery | Warning | Cluster in recovery mode |

#### Knative Alerts

| Alert | Threshold | Severity | Description |
|-------|-----------|----------|-------------|
| **SlowColdStart** | P95 > 5s | Warning | Cold start time too slow |
| **ScaleToZeroFailures** | Rate < 0 | Warning | Issues with scale-to-zero |
| **KnativeRevisionNotReady** | Ready == 0 | Critical | Revision not ready for 5 min |

### Configure AlertManager

```bash
# Edit AlertManager configuration
kubectl edit secret alertmanager-kube-prometheus-stack-prometheus -n monitoring

# Example: Slack notifications
alertmanager.yaml: |
  global:
    resolve_timeout: 5m
    slack_api_url: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL'

  route:
    receiver: 'slack-notifications'
    group_by: ['alertname', 'cluster', 'service']
    group_wait: 10s
    group_interval: 10s
    repeat_interval: 12h
    routes:
      - match:
          severity: critical
        receiver: 'slack-critical'
      - match:
          severity: warning
        receiver: 'slack-warnings'

  receivers:
    - name: 'slack-notifications'
      slack_configs:
        - channel: '#bookstore-alerts'
          title: '{{ .GroupLabels.alertname }}'
          text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'

    - name: 'slack-critical'
      slack_configs:
        - channel: '#bookstore-critical'
          title: '🚨 CRITICAL: {{ .GroupLabels.alertname }}'
          text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'

    - name: 'slack-warnings'
      slack_configs:
        - channel: '#bookstore-warnings'
          title: '⚠️ WARNING: {{ .GroupLabels.alertname }}'
          text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'
```

---

## 📝 Logs with Loki

### Query Logs in Grafana

1. **Open Grafana** → Explore
2. **Select data source**: Loki
3. **Example queries**:

```logql
# All logs from bookstore namespace
{namespace="bookstore"}

# Logs from specific service
{namespace="bookstore", knative_service="products-api"}

# Error logs only
{namespace="bookstore"} |= "error"

# Logs with JSON parsing
{namespace="bookstore"} | json | level="error"

# Rate of errors
rate({namespace="bookstore"} |= "error"[5m])

# Top 10 error messages
topk(10, sum by (message) (count_over_time({namespace="bookstore"} |= "error"[1h])))
```

### Log Levels by Service

```logql
# Products API logs
{knative_service="products-api"}

# Cart API logs
{knative_service="cart-api"}

# Orders API logs (longer retention for audit)
{knative_service="orders-api"}

# Search API logs
{knative_service="search-api"}

# Recommendations API logs
{knative_service="recommendations-api"}

# PostgreSQL logs
{postgres_cluster=~"bookstore-.*"}
```

### Log Retention

Default retention: **31 days** (configured in Loki)

Adjust in `kubernetes/base/monitoring/loki-config.yaml`:
```yaml
limits_config:
  retention_period: 744h  # 31 days
```

---

## 🔍 Distributed Tracing with Jaeger

### Enable Tracing in Application

Add OpenTelemetry SDK to your Node.js application:

```typescript
// src/api/src/tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.SERVICE_NAME || 'bookstore-api',
    [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'bookstore',
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.IMAGE_TAG || 'dev',
  }),
  traceExporter: new OTLPTraceExporter({
    url: 'http://otel-collector.bookstore.svc.cluster.local:4317',
  }),
});

sdk.start();

export default sdk;
```

### View Traces in Jaeger UI

1. **Access Jaeger**: `kubectl port-forward svc/bookstore-jaeger-query -n monitoring 16686:16686`
2. **Open**: http://localhost:16686
3. **Select service**: bookstore-api, products-api, cart-api, etc.
4. **Find traces**: Search by operation, tags, duration

### Common Trace Queries

- **Find slow requests**: Duration > 1000ms
- **Find errors**: Tag `error=true`
- **Trace full request**: Follow from gateway → API → database
- **Compare versions**: Tag `version=v1.0.1` vs `version=v1.0.0`

---

## 🎯 Key Metrics to Monitor

### Golden Signals (SRE)

#### 1. Latency
```promql
# P95 latency by service
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket{namespace="bookstore"}[5m])) by (service, le)
)
```

#### 2. Traffic
```promql
# Requests per second by service
sum(rate(http_requests_total{namespace="bookstore"}[5m])) by (service)
```

#### 3. Errors
```promql
# Error rate by service
sum(rate(http_requests_total{namespace="bookstore",status=~"5.."}[5m])) by (service)
/
sum(rate(http_requests_total{namespace="bookstore"}[5m])) by (service)
```

#### 4. Saturation
```promql
# Memory saturation
container_memory_working_set_bytes{namespace="bookstore"}
/
container_spec_memory_limit_bytes{namespace="bookstore"}

# CPU saturation
rate(container_cpu_usage_seconds_total{namespace="bookstore"}[5m])
/
container_spec_cpu_quota{namespace="bookstore"} * 100000
```

### Database Metrics

```promql
# Active connections
pg_stat_activity_count{namespace="bookstore"}

# Transaction rate
rate(pg_stat_database_xact_commit{namespace="bookstore"}[5m])

# Cache hit ratio
pg_stat_database_blks_hit / (pg_stat_database_blks_hit + pg_stat_database_blks_read)

# Replication lag
pg_replication_lag{namespace="bookstore"}
```

### Knative Metrics

```promql
# Autoscaler desired pods
autoscaler_desired_pods{namespace="bookstore"}

# Cold start duration
histogram_quantile(0.95,
  sum(rate(queue_proxy_request_duration_seconds_bucket{namespace="bookstore"}[5m])) by (le)
)

# Concurrent requests
queue_proxy_operations_in_flight{namespace="bookstore"}
```

---

## 🔧 Troubleshooting

### No Metrics Appearing

```bash
# Check ServiceMonitor is created
kubectl get servicemonitor -n bookstore

# Check Prometheus targets
kubectl port-forward svc/kube-prometheus-stack-prometheus -n monitoring 9090:9090
# Open: http://localhost:9090/targets

# Check if services have /metrics endpoint
kubectl port-forward svc/products-api -n bookstore 3000:80
curl http://localhost:3000/metrics
```

### No Logs in Loki

```bash
# Check Promtail pods
kubectl get pods -n monitoring -l app.kubernetes.io/name=promtail

# Check Promtail logs
kubectl logs -n monitoring -l app.kubernetes.io/name=promtail

# Test Loki query
kubectl port-forward svc/loki -n monitoring 3100:3100
curl 'http://localhost:3100/loki/api/v1/query?query={namespace="bookstore"}'
```

### No Traces in Jaeger

```bash
# Check OpenTelemetry Collector
kubectl get pods -n bookstore -l app=otel-collector
kubectl logs -n bookstore -l app=otel-collector

# Check Jaeger collector
kubectl get pods -n monitoring -l app.kubernetes.io/component=collector
kubectl logs -n monitoring -l app.kubernetes.io/component=collector

# Verify app is sending traces
kubectl logs -n bookstore -l serving.knative.dev/service=products-api | grep -i trace
```

### Alerts Not Firing

```bash
# Check PrometheusRule is loaded
kubectl get prometheusrule -n bookstore

# Check Prometheus rules
kubectl port-forward svc/kube-prometheus-stack-prometheus -n monitoring 9090:9090
# Open: http://localhost:9090/rules

# Check AlertManager
kubectl port-forward svc/kube-prometheus-stack-alertmanager -n monitoring 9093:9093
# Open: http://localhost:9093
```

---

## 📚 Additional Resources

- [Prometheus Query Basics](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Grafana Dashboard Best Practices](https://grafana.com/docs/grafana/latest/best-practices/best-practices-for-creating-dashboards/)
- [LogQL (Loki Query Language)](https://grafana.com/docs/loki/latest/logql/)
- [Jaeger Architecture](https://www.jaegertracing.io/docs/latest/architecture/)
- [OpenTelemetry Node.js](https://opentelemetry.io/docs/instrumentation/js/)

---

## 🎯 Best Practices

1. **Set meaningful SLOs** (Service Level Objectives)
   - Example: P95 latency < 500ms, Error rate < 1%

2. **Use structured logging** (JSON format)
   ```typescript
   logger.info({ userId, action: 'purchase', orderId, duration: 123 });
   ```

3. **Add custom metrics** for business KPIs
   ```typescript
   orderCounter.inc({ product: 'book', category: 'fiction' });
   ```

4. **Create runbooks** for each alert
   - What does this alert mean?
   - How to investigate?
   - How to fix?

5. **Review dashboards weekly**
   - Identify trends
   - Optimize slow queries
   - Plan capacity

---

**Need help?** Check the troubleshooting section or open an issue on GitHub.
