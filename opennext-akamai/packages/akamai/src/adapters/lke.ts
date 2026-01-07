/**
 * LKE (Linode Kubernetes Engine) Adapter
 *
 * This adapter generates Kubernetes manifests for deploying Next.js
 * server functions on LKE. It includes:
 * - Deployment with auto-scaling
 * - Service and Ingress configuration
 * - ConfigMaps and Secrets
 * - Health checks and readiness probes
 * - Integration with Akamai CDN as ingress
 */

import type { AkamaiOpenNextConfig } from "../types/index.js";

// ============================================================================
// Kubernetes Manifest Types
// ============================================================================

interface KubernetesManifest {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: Record<string, unknown>;
  data?: Record<string, string>;
  stringData?: Record<string, string>;
}

interface DeploymentSpec {
  replicas: number;
  selector: {
    matchLabels: Record<string, string>;
  };
  template: {
    metadata: {
      labels: Record<string, string>;
      annotations?: Record<string, string>;
    };
    spec: {
      containers: ContainerSpec[];
      volumes?: VolumeSpec[];
      serviceAccountName?: string;
      nodeSelector?: Record<string, string>;
      tolerations?: TolerationSpec[];
      affinity?: AffinitySpec;
    };
  };
  strategy?: DeploymentStrategy;
}

interface ContainerSpec {
  name: string;
  image: string;
  ports: { containerPort: number; name?: string }[];
  env?: EnvVar[];
  envFrom?: EnvFromSource[];
  resources: ResourceRequirements;
  livenessProbe?: Probe;
  readinessProbe?: Probe;
  volumeMounts?: VolumeMount[];
}

interface EnvVar {
  name: string;
  value?: string;
  valueFrom?: {
    secretKeyRef?: { name: string; key: string };
    configMapKeyRef?: { name: string; key: string };
  };
}

interface EnvFromSource {
  configMapRef?: { name: string };
  secretRef?: { name: string };
}

interface ResourceRequirements {
  requests: { cpu: string; memory: string };
  limits: { cpu: string; memory: string };
}

interface Probe {
  httpGet?: { path: string; port: number | string };
  tcpSocket?: { port: number | string };
  initialDelaySeconds: number;
  periodSeconds: number;
  timeoutSeconds?: number;
  failureThreshold?: number;
}

interface VolumeSpec {
  name: string;
  configMap?: { name: string };
  secret?: { secretName: string };
  emptyDir?: Record<string, unknown>;
}

interface VolumeMount {
  name: string;
  mountPath: string;
  readOnly?: boolean;
}

interface TolerationSpec {
  key: string;
  operator: string;
  value?: string;
  effect: string;
}

interface AffinitySpec {
  podAntiAffinity?: {
    preferredDuringSchedulingIgnoredDuringExecution?: {
      weight: number;
      podAffinityTerm: {
        labelSelector: { matchLabels: Record<string, string> };
        topologyKey: string;
      };
    }[];
  };
}

interface DeploymentStrategy {
  type: string;
  rollingUpdate?: {
    maxSurge: string | number;
    maxUnavailable: string | number;
  };
}

// ============================================================================
// Manifest Generators
// ============================================================================

/**
 * Generate Namespace manifest
 */
export function generateNamespace(name: string): KubernetesManifest {
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      name,
      labels: {
        "app.kubernetes.io/managed-by": "opennext-akamai",
      },
    },
  };
}

/**
 * Generate ConfigMap for application configuration
 */
export function generateConfigMap(
  name: string,
  namespace: string,
  config: AkamaiOpenNextConfig
): KubernetesManifest {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: `${name}-config`,
      namespace,
      labels: {
        app: name,
        "app.kubernetes.io/managed-by": "opennext-akamai",
      },
    },
    data: {
      NODE_ENV: "production",
      PORT: "3000",
      CACHE_HANDLER: config.default.override?.incrementalCache?.toString() || "edgekv",
      // Add more configuration as needed
    },
  };
}

/**
 * Generate Secret for sensitive configuration
 */
export function generateSecretTemplate(
  name: string,
  namespace: string
): KubernetesManifest {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: `${name}-secrets`,
      namespace,
      labels: {
        app: name,
        "app.kubernetes.io/managed-by": "opennext-akamai",
      },
    },
    stringData: {
      // These should be populated during deployment
      AKAMAI_EDGEKV_NAMESPACE: "${AKAMAI_EDGEKV_NAMESPACE}",
      AKAMAI_EDGEKV_ACCESS_TOKEN: "${AKAMAI_EDGEKV_ACCESS_TOKEN}",
      LINODE_OBJECT_STORAGE_ACCESS_KEY: "${LINODE_OBJECT_STORAGE_ACCESS_KEY}",
      LINODE_OBJECT_STORAGE_SECRET_KEY: "${LINODE_OBJECT_STORAGE_SECRET_KEY}",
      REDIS_URL: "${REDIS_URL}",
    },
  };
}

/**
 * Generate Deployment manifest
 */
export function generateDeployment(
  name: string,
  namespace: string,
  config: AkamaiOpenNextConfig,
  options: {
    image: string;
    replicas?: number;
    resources?: ResourceRequirements;
  }
): KubernetesManifest {
  const labels = {
    app: name,
    "app.kubernetes.io/name": name,
    "app.kubernetes.io/component": "server",
    "app.kubernetes.io/managed-by": "opennext-akamai",
  };

  const resources = options.resources || {
    requests: { cpu: "250m", memory: "256Mi" },
    limits: { cpu: "1000m", memory: "512Mi" },
  };

  const deployment: KubernetesManifest = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name,
      namespace,
      labels,
    },
    spec: {
      replicas: options.replicas || 2,
      selector: {
        matchLabels: { app: name },
      },
      strategy: {
        type: "RollingUpdate",
        rollingUpdate: {
          maxSurge: "25%",
          maxUnavailable: 0,
        },
      },
      template: {
        metadata: {
          labels,
          annotations: {
            "prometheus.io/scrape": "true",
            "prometheus.io/port": "3000",
            "prometheus.io/path": "/metrics",
          },
        },
        spec: {
          containers: [
            {
              name: "server",
              image: options.image,
              ports: [
                { containerPort: 3000, name: "http" },
              ],
              envFrom: [
                { configMapRef: { name: `${name}-config` } },
                { secretRef: { name: `${name}-secrets` } },
              ],
              resources,
              livenessProbe: {
                httpGet: { path: "/api/health", port: 3000 },
                initialDelaySeconds: 10,
                periodSeconds: 30,
                timeoutSeconds: 5,
                failureThreshold: 3,
              },
              readinessProbe: {
                httpGet: { path: "/api/health", port: 3000 },
                initialDelaySeconds: 5,
                periodSeconds: 10,
                timeoutSeconds: 3,
                failureThreshold: 3,
              },
            },
          ],
          affinity: {
            podAntiAffinity: {
              preferredDuringSchedulingIgnoredDuringExecution: [
                {
                  weight: 100,
                  podAffinityTerm: {
                    labelSelector: { matchLabels: { app: name } },
                    topologyKey: "kubernetes.io/hostname",
                  },
                },
              ],
            },
          },
        },
      },
    } as DeploymentSpec,
  };

  return deployment;
}

/**
 * Generate Service manifest
 */
export function generateService(
  name: string,
  namespace: string
): KubernetesManifest {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name,
      namespace,
      labels: {
        app: name,
        "app.kubernetes.io/managed-by": "opennext-akamai",
      },
    },
    spec: {
      type: "ClusterIP",
      ports: [
        {
          name: "http",
          port: 80,
          targetPort: 3000,
          protocol: "TCP",
        },
      ],
      selector: {
        app: name,
      },
    },
  };
}

/**
 * Generate HorizontalPodAutoscaler manifest
 */
export function generateHPA(
  name: string,
  namespace: string,
  options: {
    minReplicas?: number;
    maxReplicas?: number;
    targetCPU?: number;
    targetMemory?: number;
  } = {}
): KubernetesManifest {
  const {
    minReplicas = 2,
    maxReplicas = 20,
    targetCPU = 70,
    targetMemory = 80,
  } = options;

  return {
    apiVersion: "autoscaling/v2",
    kind: "HorizontalPodAutoscaler",
    metadata: {
      name: `${name}-hpa`,
      namespace,
      labels: {
        app: name,
        "app.kubernetes.io/managed-by": "opennext-akamai",
      },
    },
    spec: {
      scaleTargetRef: {
        apiVersion: "apps/v1",
        kind: "Deployment",
        name,
      },
      minReplicas,
      maxReplicas,
      metrics: [
        {
          type: "Resource",
          resource: {
            name: "cpu",
            target: {
              type: "Utilization",
              averageUtilization: targetCPU,
            },
          },
        },
        {
          type: "Resource",
          resource: {
            name: "memory",
            target: {
              type: "Utilization",
              averageUtilization: targetMemory,
            },
          },
        },
      ],
    },
  };
}

/**
 * Generate PodDisruptionBudget manifest
 */
export function generatePDB(
  name: string,
  namespace: string
): KubernetesManifest {
  return {
    apiVersion: "policy/v1",
    kind: "PodDisruptionBudget",
    metadata: {
      name: `${name}-pdb`,
      namespace,
      labels: {
        app: name,
        "app.kubernetes.io/managed-by": "opennext-akamai",
      },
    },
    spec: {
      minAvailable: 1,
      selector: {
        matchLabels: {
          app: name,
        },
      },
    },
  };
}

/**
 * Generate Ingress manifest for Akamai CDN integration
 */
export function generateIngress(
  name: string,
  namespace: string,
  config: AkamaiOpenNextConfig
): KubernetesManifest {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: {
      name: `${name}-ingress`,
      namespace,
      labels: {
        app: name,
        "app.kubernetes.io/managed-by": "opennext-akamai",
      },
      annotations: {
        // Akamai-specific annotations
        "akamai.com/property": config.cdn.propertyName,
        "akamai.com/origin-type": "dynamic",
        // Standard ingress annotations
        "kubernetes.io/ingress.class": "nginx",
        "nginx.ingress.kubernetes.io/proxy-body-size": "10m",
        "nginx.ingress.kubernetes.io/proxy-read-timeout": "60",
        "nginx.ingress.kubernetes.io/proxy-send-timeout": "60",
      },
    },
    spec: {
      rules: [
        {
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  service: {
                    name,
                    port: { number: 80 },
                  },
                },
              },
            ],
          },
        },
      ],
    },
  };
}

// ============================================================================
// Full Stack Generator
// ============================================================================

export interface LKEManifests {
  namespace: KubernetesManifest;
  configMap: KubernetesManifest;
  secret: KubernetesManifest;
  deployment: KubernetesManifest;
  service: KubernetesManifest;
  hpa: KubernetesManifest;
  pdb: KubernetesManifest;
  ingress: KubernetesManifest;
}

/**
 * Generate all Kubernetes manifests for LKE deployment
 */
export function generateLKEManifests(
  config: AkamaiOpenNextConfig,
  options: {
    namespace?: string;
    image: string;
    replicas?: number;
  }
): LKEManifests {
  const namespace = options.namespace || config.appName;
  const name = config.appName;

  return {
    namespace: generateNamespace(namespace),
    configMap: generateConfigMap(name, namespace, config),
    secret: generateSecretTemplate(name, namespace),
    deployment: generateDeployment(name, namespace, config, {
      image: options.image,
      replicas: options.replicas,
    }),
    service: generateService(name, namespace),
    hpa: generateHPA(name, namespace),
    pdb: generatePDB(name, namespace),
    ingress: generateIngress(name, namespace, config),
  };
}

/**
 * Convert manifests to YAML string
 */
export function manifestsToYAML(manifests: LKEManifests): string {
  const yaml = Object.values(manifests)
    .map((manifest) => JSON.stringify(manifest, null, 2))
    .join("\n---\n");

  // Note: In production, use a proper YAML library like js-yaml
  return `# Generated by @opennextjs/akamai
# Deploy with: kubectl apply -f manifests.yaml

${yaml}`;
}

/**
 * Generate Dockerfile for LKE deployment
 */
export function generateDockerfile(): string {
  return `# Generated by @opennextjs/akamai
# Multi-stage build for optimized image size

# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY .open-next ./open-next

# Install dependencies
RUN npm ci --only=production

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.open-next ./.open-next

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start server
CMD ["node", ".open-next/server-function/index.mjs"]
`;
}

/**
 * Generate skaffold.yaml for local development
 */
export function generateSkaffoldConfig(appName: string): string {
  return `# Generated by @opennextjs/akamai
apiVersion: skaffold/v4beta6
kind: Config
metadata:
  name: ${appName}

build:
  artifacts:
    - image: ${appName}
      docker:
        dockerfile: Dockerfile

deploy:
  kubectl:
    manifests:
      - kubernetes/*.yaml

profiles:
  - name: dev
    build:
      local:
        push: false
    deploy:
      kubectl:
        defaultNamespace: ${appName}-dev

  - name: prod
    build:
      artifacts:
        - image: ${appName}
          docker:
            dockerfile: Dockerfile
            buildArgs:
              NODE_ENV: production
`;
}
