# 📊 Guide Complet d'Observabilité et Monitoring - APL/LKE Stack

## Vue d'Ensemble

Ce document décrit l'architecture complète d'observabilité pour la stack Bookstore sur APL/LKE, couvrant les trois piliers de l'observabilité :

- 📈 **Métriques** → Prometheus + Grafana
- 📝 **Logs** → Loki + Grafana
- 🔍 **Traces** → Jaeger + Grafana

---

## 🎯 Architecture Complète d'Observabilité

```
┌─────────────────────────────────────────────────────────────────────┐
│                    OBSERVABILITY ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    APPLICATIONS (Pool 3)                        │ │
│  │                                                                 │ │
│  │  Knative Services:                                             │ │
│  │  ├─ bookstore-api     → metrics:9090, logs, traces            │ │
│  │  ├─ products-svc      → metrics:9090, logs, traces            │ │
│  │  ├─ cart-svc          → metrics:9090, logs, traces            │ │
│  │  └─ orders-svc        → metrics:9090, logs, traces            │ │
│  │                                                                 │ │
│  │  Istio Sidecars (Envoy):                                       │ │
│  │  └─ metrics:15020, traces (auto-injected)                     │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                          │         │         │                       │
│                          │         │         │                       │
│              ┌───────────┴─────────┴─────────┴──────────┐           │
│              │                                           │           │
│              ▼                   ▼                       ▼           │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │
│  │   PROMETHEUS     │  │      LOKI        │  │     JAEGER       │ │
│  │   (Pool 6)       │  │   (Pool 6)       │  │   (Pool 6)       │ │
│  │                  │  │                  │  │                  │ │
│  │  Scrape metrics  │  │  Ingest logs     │  │  Collect traces  │ │
│  │  - /metrics      │  │  - Promtail      │  │  - OTLP          │ │
│  │  - ServiceMon    │  │  - stdout/stderr │  │  - Zipkin        │ │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘ │
│           │                     │                      │           │
│           └─────────────────────┼──────────────────────┘           │
│                                 │                                   │
│                                 ▼                                   │
│                      ┌──────────────────────┐                       │
│                      │      GRAFANA         │                       │
│                      │      (Pool 6)        │                       │
│                      │                      │                       │
│                      │  Data Sources:       │                       │
│                      │  ├─ Prometheus       │                       │
│                      │  ├─ Loki             │                       │
│                      │  └─ Jaeger           │                       │
│                      │                      │                       │
│                      │  Dashboards:         │                       │
│                      │  ├─ Cluster Health   │                       │
│                      │  ├─ Services         │                       │
│                      │  ├─ Databases        │                       │
│                      │  ├─ Istio Mesh       │                       │
│                      │  └─ Application      │                       │
│                      └──────────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1️⃣ Prometheus - Métriques

### Architecture Prometheus

Prometheus utilise un modèle **pull** : il scrape les endpoints `/metrics` des applications.

```
Prometheus
  │
  ├─ Service Discovery (Kubernetes API)
  │  ├─ Pods (auto-discovery)
  │  ├─ Services
  │  ├─ Endpoints
  │  └─ Nodes
  │
  ├─ ServiceMonitors (Prometheus Operator)
  │  ├─ Knative Services
  │  ├─ Istio (Envoy)
  │  ├─ CloudNative-PG
  │  └─ Kubernetes components
  │
  └─ Targets (scraped endpoints)
     ├─ :9090/metrics (application metrics)
     ├─ :15020/stats/prometheus (Istio sidecar)
     └─ :9187/metrics (PostgreSQL exporter)
```

### Installation Prometheus Stack (kube-prometheus-stack)

**Utilise Helm** pour installer Prometheus Operator + Grafana + Alertmanager :

```bash
# 1. Ajouter le repo Helm
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# 2. Créer namespace
kubectl create namespace monitoring

# 3. Créer values personnalisés
cat > prometheus-values.yaml <<EOF
# prometheus-values.yaml
prometheus:
  prometheusSpec:
    # Retention
    retention: 30d
    retentionSize: "50GB"

    # Storage
    storageSpec:
      volumeClaimTemplate:
        spec:
          storageClassName: linode-block-storage-retain
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 100Gi

    # Resources
    resources:
      requests:
        cpu: 500m
        memory: 2Gi
      limits:
        cpu: 2000m
        memory: 4Gi

    # Node selection (Pool 6 - Monitoring)
    nodeSelector:
      workload.type: observability
    tolerations:
    - key: workload
      operator: Equal
      value: monitoring
      effect: NoSchedule

    # Service discovery
    serviceMonitorSelectorNilUsesHelmValues: false
    podMonitorSelectorNilUsesHelmValues: false

    # Additional scrape configs
    additionalScrapeConfigs:
    - job_name: 'istio-mesh'
      kubernetes_sd_configs:
      - role: endpoints
        namespaces:
          names:
          - istio-system
      relabel_configs:
      - source_labels: [__meta_kubernetes_service_name, __meta_kubernetes_endpoint_port_name]
        action: keep
        regex: istio-telemetry;prometheus

# Grafana
grafana:
  enabled: true
  adminPassword: changeme-secure-password

  persistence:
    enabled: true
    storageClassName: linode-block-storage-retain
    size: 10Gi

  resources:
    requests:
      cpu: 250m
      memory: 512Mi
    limits:
      cpu: 1000m
      memory: 1Gi

  nodeSelector:
    workload.type: observability
  tolerations:
  - key: workload
    operator: Equal
    value: monitoring
    effect: NoSchedule

  # Data sources (auto-configured)
  datasources:
    datasources.yaml:
      apiVersion: 1
      datasources:
      - name: Prometheus
        type: prometheus
        url: http://prometheus-kube-prometheus-prometheus.monitoring:9090
        access: proxy
        isDefault: true

      - name: Loki
        type: loki
        url: http://loki.monitoring:3100
        access: proxy

      - name: Jaeger
        type: jaeger
        url: http://jaeger-query.monitoring:16686
        access: proxy

  # Dashboards
  dashboardProviders:
    dashboardproviders.yaml:
      apiVersion: 1
      providers:
      - name: 'default'
        orgId: 1
        folder: ''
        type: file
        disableDeletion: false
        editable: true
        options:
          path: /var/lib/grafana/dashboards/default

  # Ingress
  ingress:
    enabled: true
    ingressClassName: istio
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
    hosts:
    - grafana.bookstore.example.com
    tls:
    - secretName: grafana-tls
      hosts:
      - grafana.bookstore.example.com

# Alertmanager
alertmanager:
  enabled: true
  alertmanagerSpec:
    storage:
      volumeClaimTemplate:
        spec:
          storageClassName: linode-block-storage-retain
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 10Gi

    nodeSelector:
      workload.type: observability
    tolerations:
    - key: workload
      operator: Equal
      value: monitoring
      effect: NoSchedule

# Node Exporter (metrics from nodes)
nodeExporter:
  enabled: true

# kube-state-metrics (K8s objects metrics)
kubeStateMetrics:
  enabled: true
EOF

# 4. Installer le stack
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --values prometheus-values.yaml \
  --version 55.0.0

# 5. Vérifier l'installation
kubectl get pods -n monitoring
kubectl get servicemonitors -n monitoring
```

### ServiceMonitors pour Knative Services

**ServiceMonitor** : Custom Resource qui dit à Prometheus où scraper.

```yaml
# kubernetes/base/monitoring/servicemonitor-knative.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: knative-services
  namespace: bookstore
  labels:
    app: bookstore
spec:
  # Sélectionner les services Knative
  selector:
    matchLabels:
      serving.knative.dev/service: ""  # Match all Knative services

  # Endpoints à scraper
  endpoints:
  - port: metrics  # Port nommé "metrics" dans le service
    path: /metrics
    interval: 30s
    scrapeTimeout: 10s

    # Relabeling pour ajouter metadata
    relabelings:
    - sourceLabels: [__meta_kubernetes_pod_name]
      targetLabel: pod
    - sourceLabels: [__meta_kubernetes_pod_label_serving_knative_dev_service]
      targetLabel: service
    - sourceLabels: [__meta_kubernetes_pod_label_serving_knative_dev_revision]
      targetLabel: revision

---
# ServiceMonitor pour Istio (Envoy sidecars)
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: istio-envoy
  namespace: bookstore
spec:
  selector:
    matchLabels:
      # Pods avec sidecar Istio
      security.istio.io/tlsMode: istio

  endpoints:
  - port: http-envoy-prom  # Port 15020
    path: /stats/prometheus
    interval: 15s
    relabelings:
    - sourceLabels: [__meta_kubernetes_pod_container_name]
      action: keep
      regex: istio-proxy

---
# ServiceMonitor pour CloudNative-PG
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: cnpg-clusters
  namespace: bookstore
spec:
  selector:
    matchLabels:
      cnpg.io/cluster: ""  # Match all CNPG clusters

  endpoints:
  - port: metrics
    path: /metrics
    interval: 30s
```

### Exposer /metrics dans les Applications Node.js

**Exemple pour une API Node.js/Express** :

```javascript
// src/api/src/utils/metrics.js
const promClient = require('prom-client');

// Create a Registry
const register = new promClient.Registry();

// Add default metrics (CPU, memory, etc.)
promClient.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
});
register.registerMetric(httpRequestDuration);

const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});
register.registerMetric(httpRequestTotal);

const dbQueryDuration = new promClient.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['query_type', 'table'],
  buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1]
});
register.registerMetric(dbQueryDuration);

module.exports = {
  register,
  httpRequestDuration,
  httpRequestTotal,
  dbQueryDuration
};
```

```javascript
// src/api/src/middleware/metrics.js
const { httpRequestDuration, httpRequestTotal } = require('../utils/metrics');

function metricsMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route ? req.route.path : req.path;

    httpRequestDuration.observe(
      { method: req.method, route, status_code: res.statusCode },
      duration
    );

    httpRequestTotal.inc({
      method: req.method,
      route,
      status_code: res.statusCode
    });
  });

  next();
}

module.exports = metricsMiddleware;
```

```javascript
// src/api/src/app.js
const express = require('express');
const { register } = require('./utils/metrics');
const metricsMiddleware = require('./middleware/metrics');

const app = express();

// Apply metrics middleware
app.use(metricsMiddleware);

// Expose /metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Your routes...
app.use('/api/v1/products', productsRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/orders', ordersRoutes);

module.exports = app;
```

**Ajouter le port metrics dans le Knative Service** :

```yaml
# kubernetes/base/api/bookstore-api.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: bookstore-api
  namespace: bookstore
spec:
  template:
    metadata:
      annotations:
        # Enable Prometheus scraping
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
        prometheus.io/path: "/metrics"
    spec:
      containers:
      - image: bookstore-api:latest
        ports:
        - name: http1
          containerPort: 8080
        - name: metrics  # Port pour Prometheus
          containerPort: 9090
        env:
        - name: METRICS_PORT
          value: "9090"
```

### Queries Prometheus Utiles

```promql
# Requêtes par seconde par service
rate(http_requests_total[5m])

# Latence p95 par route
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route)
)

# Taux d'erreur (5xx)
sum(rate(http_requests_total{status_code=~"5.."}[5m])) by (service)
/
sum(rate(http_requests_total[5m])) by (service)

# CPU usage par pod
sum(rate(container_cpu_usage_seconds_total{namespace="bookstore"}[5m])) by (pod)

# Memory usage par pod
sum(container_memory_working_set_bytes{namespace="bookstore"}) by (pod) / 1024 / 1024

# PostgreSQL connections
cnpg_pg_stat_database_numbackends{namespace="bookstore"}

# Istio request rate
sum(rate(istio_requests_total{destination_namespace="bookstore"}[5m])) by (destination_service)
```

---

## 2️⃣ Loki - Logs

### Architecture Loki

Loki utilise un modèle **push** : Promtail (agent) pousse les logs vers Loki.

```
Application Pods
  │
  ├─ stdout/stderr → Kubelet
  │                     │
  │                     ▼
  │              /var/log/pods/*
  │                     │
  │                     │
  ▼                     ▼
Promtail (DaemonSet) ──┘
  │
  │ (push logs with labels)
  │
  ▼
Loki (StatefulSet)
  │
  ├─ Ingester (write path)
  ├─ Querier (read path)
  └─ Storage (Object Storage or PVC)
```

### Installation Loki + Promtail

```bash
# 1. Ajouter repo Helm
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

# 2. Créer values
cat > loki-values.yaml <<EOF
# loki-values.yaml
loki:
  auth_enabled: false

  # Storage configuration
  storage:
    type: filesystem
    filesystem:
      directory: /var/loki

  # Retention
  limits_config:
    retention_period: 744h  # 31 days

  # Resources
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: 2000m
      memory: 2Gi

  # Persistence
  persistence:
    enabled: true
    storageClassName: linode-block-storage-retain
    size: 50Gi

  # Node selection
  nodeSelector:
    workload.type: observability
  tolerations:
  - key: workload
    operator: Equal
    value: monitoring
    effect: NoSchedule

# Promtail (log shipper)
promtail:
  enabled: true

  config:
    # Loki endpoint
    clients:
    - url: http://loki.monitoring:3100/loki/api/v1/push

    # Scrape configs
    scrapeConfigs:
    # Kubernetes pods logs
    - job_name: kubernetes-pods
      kubernetes_sd_configs:
      - role: pod

      relabel_configs:
      # Only scrape pods in bookstore namespace
      - source_labels: [__meta_kubernetes_namespace]
        action: keep
        regex: bookstore|monitoring|istio-system

      # Add pod labels as Loki labels
      - source_labels: [__meta_kubernetes_pod_name]
        target_label: pod
      - source_labels: [__meta_kubernetes_namespace]
        target_label: namespace
      - source_labels: [__meta_kubernetes_pod_label_app]
        target_label: app
      - source_labels: [__meta_kubernetes_pod_container_name]
        target_label: container

      # Add Knative-specific labels
      - source_labels: [__meta_kubernetes_pod_label_serving_knative_dev_service]
        target_label: knative_service
      - source_labels: [__meta_kubernetes_pod_label_serving_knative_dev_revision]
        target_label: knative_revision

  # DaemonSet configuration
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 256Mi

  # Run on all nodes (including monitoring pool)
  tolerations:
  - operator: Exists

# Service
service:
  type: ClusterIP
  port: 3100
EOF

# 3. Installer Loki stack
helm install loki grafana/loki-stack \
  --namespace monitoring \
  --values loki-values.yaml \
  --version 2.9.11

# 4. Vérifier
kubectl get pods -n monitoring -l app=loki
kubectl get pods -n monitoring -l app=promtail
kubectl get daemonsets -n monitoring promtail
```

### Structured Logging dans Applications

**Node.js avec Winston** :

```javascript
// src/api/src/utils/logger.js
const winston = require('winston');

// Format for Loki (JSON with proper labels)
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: process.env.SERVICE_NAME || 'bookstore-api',
    version: process.env.VERSION || '1.0.0',
    env: process.env.NODE_ENV || 'production'
  },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

module.exports = logger;
```

```javascript
// Usage dans routes
const logger = require('../utils/logger');

app.get('/api/v1/products', async (req, res) => {
  logger.info('Fetching products', {
    userId: req.user?.id,
    category: req.query.category,
    requestId: req.id
  });

  try {
    const products = await getProducts(req.query);

    logger.info('Products fetched successfully', {
      count: products.length,
      requestId: req.id
    });

    res.json(products);
  } catch (error) {
    logger.error('Failed to fetch products', {
      error: error.message,
      stack: error.stack,
      requestId: req.id
    });

    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### LogQL Queries (Loki Query Language)

```logql
# Tous les logs du service products-svc
{knative_service="products-svc"}

# Logs d'erreur
{namespace="bookstore"} |= "ERROR" or "error" or "Error"

# Logs d'un pod spécifique
{pod="bookstore-api-00001-deployment-7d8c9f5b-xh2j9"}

# Logs avec regex pattern
{app="bookstore-api"} |~ "failed to connect.*database"

# Rate de logs d'erreur par service
sum(rate({namespace="bookstore"} |= "ERROR" [5m])) by (knative_service)

# Top 10 erreurs
topk(10, sum by (error) (count_over_time({namespace="bookstore"} |= "ERROR" [1h])))

# Logs par niveau (si structured logging)
{namespace="bookstore"} | json | level="error"

# Logs avec latence > 1s
{app="bookstore-api"} | json | duration > 1000
```

---

## 3️⃣ Jaeger - Distributed Tracing

### Architecture Jaeger

Jaeger collecte les traces distribuées pour suivre les requêtes à travers les microservices.

```
Application (instrumented)
  │
  ├─ Span created (trace ID)
  │
  ▼
Jaeger Agent (sidecar or DaemonSet)
  │
  ├─ Batches spans
  │
  ▼
Jaeger Collector
  │
  ├─ Validates & stores
  │
  ▼
Storage Backend (Elasticsearch or Cassandra or BadgerDB)
  │
  ▼
Jaeger Query (UI)
```

### Installation Jaeger Operator

```bash
# 1. Installer Jaeger Operator
kubectl create namespace observability
kubectl create -f https://github.com/jaegertracing/jaeger-operator/releases/download/v1.51.0/jaeger-operator.yaml -n observability

# 2. Vérifier operator
kubectl get deployment jaeger-operator -n observability

# 3. Créer instance Jaeger
cat > jaeger-instance.yaml <<EOF
apiVersion: jaegertracing.io/v1
kind: Jaeger
metadata:
  name: jaeger
  namespace: monitoring
spec:
  # Strategy: all-in-one, production, streaming
  strategy: production

  # Storage backend
  storage:
    type: elasticsearch
    options:
      es:
        server-urls: http://elasticsearch.monitoring:9200
        index-prefix: jaeger

    # Alternative: Badger (embedded DB)
    # type: badger
    # badger:
    #   ephemeral: false
    #   directory: /badger/data

  # Collector
  collector:
    replicas: 2
    resources:
      requests:
        cpu: 500m
        memory: 1Gi
      limits:
        cpu: 2000m
        memory: 2Gi

    nodeSelector:
      workload.type: observability
    tolerations:
    - key: workload
      operator: Equal
      value: monitoring
      effect: NoSchedule

  # Query (UI)
  query:
    replicas: 2
    resources:
      requests:
        cpu: 250m
        memory: 512Mi
      limits:
        cpu: 1000m
        memory: 1Gi

    nodeSelector:
      workload.type: observability
    tolerations:
    - key: workload
      operator: Equal
      value: monitoring
      effect: NoSchedule

  # Agent (optional, can use collector directly)
  agent:
    strategy: DaemonSet
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        cpu: 500m
        memory: 256Mi

  # Ingress for UI
  ingress:
    enabled: true
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
    hosts:
    - jaeger.bookstore.example.com
    tls:
    - secretName: jaeger-tls
      hosts:
      - jaeger.bookstore.example.com
EOF

kubectl apply -f jaeger-instance.yaml

# 4. Vérifier
kubectl get jaeger -n monitoring
kubectl get pods -n monitoring -l app.kubernetes.io/instance=jaeger
```

### Instrumentation des Applications (OpenTelemetry)

**Node.js avec OpenTelemetry** :

```javascript
// src/api/src/utils/tracing.js
const opentelemetry = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

// Configure Jaeger exporter
const jaegerExporter = new JaegerExporter({
  endpoint: process.env.JAEGER_ENDPOINT || 'http://jaeger-collector.monitoring:14268/api/traces',
});

// Initialize SDK
const sdk = new opentelemetry.NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.SERVICE_NAME || 'bookstore-api',
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.VERSION || '1.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'production',
  }),
  traceExporter: jaegerExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Auto-instrument HTTP, Express, PostgreSQL, etc.
      '@opentelemetry/instrumentation-http': {},
      '@opentelemetry/instrumentation-express': {},
      '@opentelemetry/instrumentation-pg': {},
      '@opentelemetry/instrumentation-redis': {},
    }),
  ],
});

// Start SDK
sdk.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error) => console.log('Error terminating tracing', error))
    .finally(() => process.exit(0));
});

module.exports = sdk;
```

```javascript
// src/api/src/index.js
// MUST be first import!
require('./utils/tracing');

const express = require('express');
const app = require('./app');

// Rest of your application...
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
```

**Custom Spans** :

```javascript
// src/api/src/services/products.service.js
const opentelemetry = require('@opentelemetry/api');

async function getProducts(filters) {
  // Get current tracer
  const tracer = opentelemetry.trace.getTracer('bookstore-api');

  // Create custom span
  return tracer.startActiveSpan('getProducts', async (span) => {
    try {
      // Add attributes
      span.setAttribute('filters.category', filters.category);
      span.setAttribute('filters.limit', filters.limit);

      // Your business logic
      const products = await db.query(`
        SELECT * FROM products
        WHERE category = $1
        LIMIT $2
      `, [filters.category, filters.limit]);

      // Add result metadata
      span.setAttribute('results.count', products.length);

      // Add event
      span.addEvent('products_fetched', {
        count: products.length,
        category: filters.category
      });

      return products;

    } catch (error) {
      // Record error
      span.recordException(error);
      span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
      throw error;

    } finally {
      // End span
      span.end();
    }
  });
}
```

### Intégration Istio + Jaeger

Istio peut automatiquement générer des traces pour tout le trafic :

```yaml
# kubernetes/base/istio/telemetry.yaml
apiVersion: telemetry.istio.io/v1alpha1
kind: Telemetry
metadata:
  name: mesh-default
  namespace: istio-system
spec:
  # Enable tracing
  tracing:
  - providers:
    - name: jaeger
    randomSamplingPercentage: 100.0  # Sample 100% in dev, 1-10% in prod
    customTags:
      # Add custom tags to traces
      cluster:
        literal:
          value: bookstore-lke
      environment:
        environment:
          name: NODE_ENV
          defaultValue: production
---
# Configure Jaeger provider
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
metadata:
  name: istio-config
  namespace: istio-system
spec:
  meshConfig:
    extensionProviders:
    - name: jaeger
      zipkin:
        service: jaeger-collector.monitoring.svc.cluster.local
        port: 9411
```

---

## 4️⃣ Grafana - Visualisation Unifiée

### Dashboards Pré-configurés

Grafana peut afficher des données de Prometheus, Loki et Jaeger dans un seul dashboard.

#### Dashboard : Cluster Overview

```json
{
  "dashboard": {
    "title": "Bookstore Cluster Overview",
    "panels": [
      {
        "title": "CPU Usage by Node Pool",
        "targets": [{
          "expr": "sum(rate(container_cpu_usage_seconds_total[5m])) by (node)",
          "datasource": "Prometheus"
        }],
        "type": "graph"
      },
      {
        "title": "Memory Usage by Namespace",
        "targets": [{
          "expr": "sum(container_memory_working_set_bytes) by (namespace) / 1024 / 1024 / 1024",
          "datasource": "Prometheus"
        }],
        "type": "graph"
      },
      {
        "title": "Pod Count by Status",
        "targets": [{
          "expr": "sum(kube_pod_status_phase) by (phase)",
          "datasource": "Prometheus"
        }],
        "type": "stat"
      }
    ]
  }
}
```

#### Dashboard : Knative Services

```yaml
# kubernetes/base/monitoring/grafana-dashboard-knative.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-dashboard-knative
  namespace: monitoring
  labels:
    grafana_dashboard: "1"
data:
  knative-services.json: |
    {
      "title": "Knative Services",
      "panels": [
        {
          "title": "Request Rate",
          "targets": [{
            "expr": "sum(rate(http_requests_total{namespace='bookstore'}[5m])) by (knative_service)",
            "legendFormat": "{{knative_service}}"
          }]
        },
        {
          "title": "P95 Latency",
          "targets": [{
            "expr": "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, knative_service))",
            "legendFormat": "{{knative_service}}"
          }]
        },
        {
          "title": "Error Rate (%)",
          "targets": [{
            "expr": "sum(rate(http_requests_total{status_code=~'5..'}[5m])) by (knative_service) / sum(rate(http_requests_total[5m])) by (knative_service) * 100"
          }]
        },
        {
          "title": "Replicas Count",
          "targets": [{
            "expr": "sum(kube_deployment_status_replicas{namespace='bookstore'}) by (deployment)"
          }]
        },
        {
          "title": "Recent Error Logs",
          "targets": [{
            "expr": "{namespace='bookstore'} |= 'ERROR'",
            "datasource": "Loki"
          }],
          "type": "logs"
        }
      ]
    }
```

### Dashboards Communautaires

Importer des dashboards existants :

```bash
# 1. Kubernetes Cluster Monitoring (ID: 7249)
# 2. Istio Mesh Dashboard (ID: 7639)
# 3. PostgreSQL Database (ID: 9628)
# 4. Node Exporter Full (ID: 1860)

# Importer via Grafana UI:
# Settings → Dashboards → Import → Enter dashboard ID
```

---

## 5️⃣ Alerting avec Prometheus Alertmanager

### Alertes PrometheusRules

```yaml
# kubernetes/base/monitoring/prometheus-rules.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: bookstore-alerts
  namespace: monitoring
spec:
  groups:
  - name: bookstore.rules
    interval: 30s
    rules:

    # High error rate
    - alert: HighErrorRate
      expr: |
        sum(rate(http_requests_total{status_code=~"5..", namespace="bookstore"}[5m])) by (service)
        /
        sum(rate(http_requests_total{namespace="bookstore"}[5m])) by (service)
        > 0.05
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: "High error rate on {{ $labels.service }}"
        description: "Service {{ $labels.service }} has error rate {{ $value | humanizePercentage }}"

    # High latency
    - alert: HighLatency
      expr: |
        histogram_quantile(0.95,
          sum(rate(http_request_duration_seconds_bucket{namespace="bookstore"}[5m])) by (le, service)
        ) > 1
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "High latency on {{ $labels.service }}"
        description: "P95 latency is {{ $value }}s on {{ $labels.service }}"

    # Pod down
    - alert: PodDown
      expr: kube_pod_status_phase{namespace="bookstore", phase!="Running"} == 1
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "Pod {{ $labels.pod }} is down"
        description: "Pod {{ $labels.pod }} in namespace {{ $labels.namespace }} is in phase {{ $labels.phase }}"

    # Database connection pool exhausted
    - alert: DatabaseConnectionPoolExhausted
      expr: |
        cnpg_pg_stat_database_numbackends{namespace="bookstore"}
        /
        cnpg_pg_settings_max_connections{namespace="bookstore"}
        > 0.8
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "Database connection pool almost exhausted"
        description: "{{ $labels.datname }} is using {{ $value | humanizePercentage }} of max connections"

    # High memory usage
    - alert: HighMemoryUsage
      expr: |
        sum(container_memory_working_set_bytes{namespace="bookstore"}) by (pod)
        /
        sum(container_spec_memory_limit_bytes{namespace="bookstore"}) by (pod)
        > 0.9
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "High memory usage on {{ $labels.pod }}"
        description: "Pod {{ $labels.pod }} is using {{ $value | humanizePercentage }} of memory limit"
```

### Configuration Alertmanager

```yaml
# alertmanager-config.yaml
apiVersion: v1
kind: Secret
metadata:
  name: alertmanager-config
  namespace: monitoring
stringData:
  alertmanager.yaml: |
    global:
      resolve_timeout: 5m

    # Routes
    route:
      group_by: ['alertname', 'cluster', 'service']
      group_wait: 10s
      group_interval: 10s
      repeat_interval: 12h
      receiver: 'team-emails'

      routes:
      # Critical alerts to PagerDuty
      - match:
          severity: critical
        receiver: pagerduty
        continue: true

      # Warnings to Slack
      - match:
          severity: warning
        receiver: slack

    # Receivers
    receivers:
    - name: 'team-emails'
      email_configs:
      - to: 'ops-team@bookstore.com'
        from: 'alertmanager@bookstore.com'
        smarthost: smtp.example.com:587
        auth_username: alertmanager@bookstore.com
        auth_password: ${SMTP_PASSWORD}

    - name: 'slack'
      slack_configs:
      - api_url: ${SLACK_WEBHOOK_URL}
        channel: '#alerts'
        title: '{{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'

    - name: 'pagerduty'
      pagerduty_configs:
      - service_key: ${PAGERDUTY_SERVICE_KEY}
```

---

## 📋 Checklist Complète de Déploiement

### Phase 1 : Installation (J-7)

- [ ] **Installer Prometheus Stack**
  - [ ] Helm install kube-prometheus-stack
  - [ ] Vérifier Prometheus pods running
  - [ ] Vérifier Grafana accessible
  - [ ] Configurer storage (PVC)

- [ ] **Installer Loki Stack**
  - [ ] Helm install loki-stack
  - [ ] Vérifier Loki pods running
  - [ ] Vérifier Promtail DaemonSet sur tous les nodes
  - [ ] Tester ingestion logs

- [ ] **Installer Jaeger**
  - [ ] Deploy Jaeger Operator
  - [ ] Créer instance Jaeger
  - [ ] Configurer storage backend
  - [ ] Vérifier UI accessible

### Phase 2 : Configuration (J-3)

- [ ] **ServiceMonitors**
  - [ ] Créer ServiceMonitor pour Knative services
  - [ ] Créer ServiceMonitor pour Istio
  - [ ] Créer ServiceMonitor pour CloudNative-PG
  - [ ] Vérifier targets dans Prometheus UI

- [ ] **Instrumentation Applications**
  - [ ] Ajouter prom-client aux apps Node.js
  - [ ] Exposer /metrics endpoint
  - [ ] Ajouter structured logging (Winston)
  - [ ] Ajouter OpenTelemetry tracing
  - [ ] Rebuild et redéployer images

- [ ] **Grafana Data Sources**
  - [ ] Configurer Prometheus datasource
  - [ ] Configurer Loki datasource
  - [ ] Configurer Jaeger datasource
  - [ ] Tester queries

### Phase 3 : Dashboards (J-1)

- [ ] **Importer Dashboards**
  - [ ] Cluster overview
  - [ ] Knative services
  - [ ] Istio mesh
  - [ ] PostgreSQL databases
  - [ ] Application-specific

- [ ] **Configurer Alertes**
  - [ ] Créer PrometheusRules
  - [ ] Configurer Alertmanager receivers
  - [ ] Tester alertes (simuler erreurs)

### Phase 4 : Validation (J-Day)

- [ ] **Tests Fonctionnels**
  - [ ] Metrics visibles dans Prometheus
  - [ ] Logs visibles dans Loki
  - [ ] Traces visibles dans Jaeger
  - [ ] Dashboards Grafana fonctionnels
  - [ ] Alertes déclenchées correctement

- [ ] **Tests de Charge**
  - [ ] Générer trafic (k6, Locust)
  - [ ] Vérifier métriques sous charge
  - [ ] Vérifier logs sous charge
  - [ ] Vérifier traces complètes

---

## 🎯 Résumé de l'Architecture

| Composant | Rôle | Port | Storage | Namespace |
|-----------|------|------|---------|-----------|
| **Prometheus** | Collecte métriques (pull) | 9090 | 100Gi PVC | monitoring |
| **Loki** | Collecte logs (push via Promtail) | 3100 | 50Gi PVC | monitoring |
| **Jaeger Collector** | Collecte traces | 14268 | Elasticsearch | monitoring |
| **Jaeger Query** | UI traces | 16686 | - | monitoring |
| **Grafana** | Visualisation unifiée | 3000 | 10Gi PVC | monitoring |
| **Alertmanager** | Gestion alertes | 9093 | 10Gi PVC | monitoring |
| **Promtail** | Agent logs (DaemonSet) | - | - | monitoring |

**Flux de Données** :
```
Applications
  ├─ Metrics → Prometheus → Grafana
  ├─ Logs → Promtail → Loki → Grafana
  └─ Traces → Jaeger Collector → Jaeger Query → Grafana
```

**Coût Total Monitoring (Pool 6)** :
- Nodes (2× g6-standard-2) : $72/mois
- Storage (170Gi PVC) : $17/mois
- **Total** : ~$89/mois

---

## 🔗 Ressources

- [Prometheus Docs](https://prometheus.io/docs/)
- [Loki Docs](https://grafana.com/docs/loki/)
- [Jaeger Docs](https://www.jaegertracing.io/docs/)
- [OpenTelemetry Node.js](https://opentelemetry.io/docs/instrumentation/js/)
- [Grafana Dashboards](https://grafana.com/grafana/dashboards/)

Tout est maintenant prêt pour une observabilité complète de votre stack APL/LKE ! 🚀
