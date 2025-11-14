# ============================================================================
# Knative Services Module
# Deploys all serverless API services
# ============================================================================

# Application Secrets
resource "kubernetes_secret" "bookstore_api_secrets" {
  metadata {
    name      = "bookstore-api-secrets"
    namespace = var.namespace
  }

  data = {
    database-url       = var.main_db_url
    database-url-search = var.search_db_url
    database-url-graph = var.graph_db_url
    jwt-secret        = var.jwt_secret
  }

  type = "Opaque"
}

# ============================================================================
# Products Service
# ============================================================================

resource "kubectl_manifest" "products_service" {
  yaml_body = <<-YAML
    apiVersion: serving.knative.dev/v1
    kind: Service
    metadata:
      name: products-api
      namespace: ${var.namespace}
    spec:
      template:
        metadata:
          annotations:
            autoscaling.knative.dev/min-scale: "${var.products_min_scale}"
            autoscaling.knative.dev/max-scale: "${var.products_max_scale}"
            autoscaling.knative.dev/target: "100"
            autoscaling.knative.dev/scale-down-delay: "30s"
        spec:
          containers:
            - name: products-api
              image: ${var.container_registry}/bookstore-api:${var.image_tag}
              ports:
                - containerPort: 8080
                  protocol: TCP
              env:
                - name: NODE_ENV
                  value: "${var.environment}"
                - name: PORT
                  value: "8080"
                - name: DATABASE_URL
                  valueFrom:
                    secretKeyRef:
                      name: bookstore-api-secrets
                      key: database-url
                - name: SEARCH_DATABASE_URL
                  valueFrom:
                    secretKeyRef:
                      name: bookstore-api-secrets
                      key: database-url-search
                - name: GRAPH_DATABASE_URL
                  valueFrom:
                    secretKeyRef:
                      name: bookstore-api-secrets
                      key: database-url-graph
                - name: JWT_SECRET
                  valueFrom:
                    secretKeyRef:
                      name: bookstore-api-secrets
                      key: jwt-secret
                - name: KEYCLOAK_URL
                  value: "http://keycloak.${var.namespace}.svc.cluster.local:8080"
                - name: KEYCLOAK_REALM
                  value: "bookstore"
                - name: KEYCLOAK_CLIENT_ID
                  value: "bookstore-api"
              resources:
                requests:
                  memory: "256Mi"
                  cpu: "200m"
                limits:
                  memory: "512Mi"
                  cpu: "500m"
              livenessProbe:
                httpGet:
                  path: /health
                  port: 8080
                initialDelaySeconds: 10
                periodSeconds: 10
              readinessProbe:
                httpGet:
                  path: /ready
                  port: 8080
                initialDelaySeconds: 5
                periodSeconds: 5
  YAML

  depends_on = [kubernetes_secret.bookstore_api_secrets]
}

# ============================================================================
# Cart Service
# ============================================================================

resource "kubectl_manifest" "cart_service" {
  yaml_body = <<-YAML
    apiVersion: serving.knative.dev/v1
    kind: Service
    metadata:
      name: cart-api
      namespace: ${var.namespace}
    spec:
      template:
        metadata:
          annotations:
            autoscaling.knative.dev/min-scale: "${var.cart_min_scale}"
            autoscaling.knative.dev/max-scale: "${var.cart_max_scale}"
            autoscaling.knative.dev/target: "100"
            autoscaling.knative.dev/scale-down-delay: "30s"
        spec:
          containers:
            - name: cart-api
              image: ${var.container_registry}/bookstore-api:${var.image_tag}
              ports:
                - containerPort: 8080
                  protocol: TCP
              env:
                - name: NODE_ENV
                  value: "${var.environment}"
                - name: PORT
                  value: "8080"
                - name: SERVICE_NAME
                  value: "cart"
                - name: DATABASE_URL
                  valueFrom:
                    secretKeyRef:
                      name: bookstore-api-secrets
                      key: database-url
                - name: JWT_SECRET
                  valueFrom:
                    secretKeyRef:
                      name: bookstore-api-secrets
                      key: jwt-secret
                - name: KEYCLOAK_URL
                  value: "http://keycloak.${var.namespace}.svc.cluster.local:8080"
              resources:
                requests:
                  memory: "256Mi"
                  cpu: "200m"
                limits:
                  memory: "512Mi"
                  cpu: "500m"
              livenessProbe:
                httpGet:
                  path: /health
                  port: 8080
                initialDelaySeconds: 10
                periodSeconds: 10
              readinessProbe:
                httpGet:
                  path: /ready
                  port: 8080
                initialDelaySeconds: 5
                periodSeconds: 5
  YAML

  depends_on = [kubernetes_secret.bookstore_api_secrets]
}

# ============================================================================
# Orders Service
# ============================================================================

resource "kubectl_manifest" "orders_service" {
  yaml_body = <<-YAML
    apiVersion: serving.knative.dev/v1
    kind: Service
    metadata:
      name: orders-api
      namespace: ${var.namespace}
    spec:
      template:
        metadata:
          annotations:
            autoscaling.knative.dev/min-scale: "${var.orders_min_scale}"
            autoscaling.knative.dev/max-scale: "${var.orders_max_scale}"
            autoscaling.knative.dev/target: "100"
            autoscaling.knative.dev/scale-down-delay: "30s"
        spec:
          containers:
            - name: orders-api
              image: ${var.container_registry}/bookstore-api:${var.image_tag}
              ports:
                - containerPort: 8080
                  protocol: TCP
              env:
                - name: NODE_ENV
                  value: "${var.environment}"
                - name: PORT
                  value: "8080"
                - name: SERVICE_NAME
                  value: "orders"
                - name: DATABASE_URL
                  valueFrom:
                    secretKeyRef:
                      name: bookstore-api-secrets
                      key: database-url
                - name: JWT_SECRET
                  valueFrom:
                    secretKeyRef:
                      name: bookstore-api-secrets
                      key: jwt-secret
                - name: KEYCLOAK_URL
                  value: "http://keycloak.${var.namespace}.svc.cluster.local:8080"
              resources:
                requests:
                  memory: "512Mi"
                  cpu: "300m"
                limits:
                  memory: "1Gi"
                  cpu: "1000m"
              livenessProbe:
                httpGet:
                  path: /health
                  port: 8080
                initialDelaySeconds: 10
                periodSeconds: 10
              readinessProbe:
                httpGet:
                  path: /ready
                  port: 8080
                initialDelaySeconds: 5
                periodSeconds: 5
  YAML

  depends_on = [kubernetes_secret.bookstore_api_secrets]
}

# ============================================================================
# Search Service
# ============================================================================

resource "kubectl_manifest" "search_service" {
  yaml_body = <<-YAML
    apiVersion: serving.knative.dev/v1
    kind: Service
    metadata:
      name: search-api
      namespace: ${var.namespace}
    spec:
      template:
        metadata:
          annotations:
            autoscaling.knative.dev/min-scale: "${var.search_min_scale}"
            autoscaling.knative.dev/max-scale: "${var.search_max_scale}"
            autoscaling.knative.dev/target: "100"
            autoscaling.knative.dev/scale-down-delay: "15s"
        spec:
          containers:
            - name: search-api
              image: ${var.container_registry}/bookstore-api:${var.image_tag}
              ports:
                - containerPort: 8080
                  protocol: TCP
              env:
                - name: NODE_ENV
                  value: "${var.environment}"
                - name: PORT
                  value: "8080"
                - name: SERVICE_NAME
                  value: "search"
                - name: SEARCH_DATABASE_URL
                  valueFrom:
                    secretKeyRef:
                      name: bookstore-api-secrets
                      key: database-url-search
                - name: JWT_SECRET
                  valueFrom:
                    secretKeyRef:
                      name: bookstore-api-secrets
                      key: jwt-secret
              resources:
                requests:
                  memory: "512Mi"
                  cpu: "300m"
                limits:
                  memory: "1Gi"
                  cpu: "1000m"
              livenessProbe:
                httpGet:
                  path: /health
                  port: 8080
                initialDelaySeconds: 10
                periodSeconds: 10
              readinessProbe:
                httpGet:
                  path: /ready
                  port: 8080
                initialDelaySeconds: 5
                periodSeconds: 5
  YAML

  depends_on = [kubernetes_secret.bookstore_api_secrets]
}

# ============================================================================
# Recommendations Service
# ============================================================================

resource "kubectl_manifest" "recommendations_service" {
  yaml_body = <<-YAML
    apiVersion: serving.knative.dev/v1
    kind: Service
    metadata:
      name: recommendations-api
      namespace: ${var.namespace}
    spec:
      template:
        metadata:
          annotations:
            autoscaling.knative.dev/min-scale: "${var.recommendations_min_scale}"
            autoscaling.knative.dev/max-scale: "${var.recommendations_max_scale}"
            autoscaling.knative.dev/target: "100"
            autoscaling.knative.dev/scale-down-delay: "30s"
        spec:
          containers:
            - name: recommendations-api
              image: ${var.container_registry}/bookstore-api:${var.image_tag}
              ports:
                - containerPort: 8080
                  protocol: TCP
              env:
                - name: NODE_ENV
                  value: "${var.environment}"
                - name: PORT
                  value: "8080"
                - name: SERVICE_NAME
                  value: "recommendations"
                - name: GRAPH_DATABASE_URL
                  valueFrom:
                    secretKeyRef:
                      name: bookstore-api-secrets
                      key: database-url-graph
                - name: JWT_SECRET
                  valueFrom:
                    secretKeyRef:
                      name: bookstore-api-secrets
                      key: jwt-secret
              resources:
                requests:
                  memory: "512Mi"
                  cpu: "300m"
                limits:
                  memory: "1Gi"
                  cpu: "1000m"
              livenessProbe:
                httpGet:
                  path: /health
                  port: 8080
                initialDelaySeconds: 10
                periodSeconds: 10
              readinessProbe:
                httpGet:
                  path: /ready
                  port: 8080
                initialDelaySeconds: 5
                periodSeconds: 5
  YAML

  depends_on = [kubernetes_secret.bookstore_api_secrets]
}
