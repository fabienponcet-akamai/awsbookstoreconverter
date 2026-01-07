# OpenNext Akamai Adapter

[![npm version](https://badge.fury.io/js/@opennextjs%2Fakamai.svg)](https://www.npmjs.com/package/@opennextjs/akamai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Deploy Next.js applications to the Akamai ecosystem with optimal performance.

## Overview

This adapter transforms Next.js applications for deployment on Akamai's comprehensive cloud platform:

| Component | Akamai Service | Purpose |
|-----------|----------------|---------|
| **CDN** | Akamai CDN | Global edge caching, 4200+ PoPs |
| **Edge Compute** | EdgeWorkers | Middleware execution at the edge |
| **Edge Storage** | EdgeKV | Distributed key-value cache |
| **Container Platform** | LKE | Kubernetes for server functions |
| **Serverless** | Fermyon Spin | WebAssembly functions (< 1ms cold start) |
| **Object Storage** | Linode Object Storage | S3-compatible static asset hosting |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Request                             │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AKAMAI CDN (Edge Layer)                      │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              EdgeWorkers (Next.js Middleware)               ││
│  │  • Authentication  • Geo-routing  • A/B Testing             ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Static Cache │  │   EdgeKV     │  │  Property Manager      │ │
│  │ (1 year TTL) │  │ (ISR Cache)  │  │  (Cache Rules)         │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                 │
           ┌─────────────────────┼─────────────────────┐
           ▼                     ▼                     ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│   FERMYON SPIN   │  │   LKE CLUSTER    │  │  OBJECT STORAGE      │
│  (Scale-to-zero) │  │  (Kubernetes)    │  │  (S3-compatible)     │
│                  │  │                  │  │                      │
│ • ISR Revalidate │  │ • SSR Server     │  │ • Static Assets      │
│ • Image Optimize │  │ • API Routes     │  │ • Build Artifacts    │
│ • Light Compute  │  │ • WebSocket      │  │ • ISR Fallback       │
└──────────────────┘  └──────────────────┘  └──────────────────────┘
```

## Quick Start

### 1. Install

```bash
npm install @opennextjs/akamai
```

### 2. Configure

Create `open-next.config.ts` in your project root:

```typescript
import { defineAkamaiConfig } from "@opennextjs/akamai";

export default defineAkamaiConfig({
  appName: "my-nextjs-app",

  // Middleware runs on EdgeWorkers
  middleware: {
    external: true,
  },

  // Server function configuration
  default: {
    runtime: "lke", // or "fermyon"
    override: {
      incrementalCache: "edgekv",
      queue: "redis-streams",
      converter: "akamai-cdn",
    },
  },

  // CDN configuration
  cdn: {
    propertyName: "my-nextjs-app",
    origins: {
      static: {
        type: "object-storage",
        bucket: "my-app-assets",
        region: "us-east",
      },
      dynamic: {
        type: "lke",
        cluster: "my-lke-cluster",
        service: "nextjs-server",
      },
    },
  },
});
```

### 3. Build

```bash
npx opennext-akamai build
```

### 4. Deploy

```bash
npx opennext-akamai deploy
```

## Configuration Reference

### Runtime Options

| Runtime | Best For | Cold Start | Scaling |
|---------|----------|------------|---------|
| `lke` | Complex SSR, WebSocket, long-running API | ~100ms | HPA-based |
| `fermyon` | Light SSR, simple API, ISR | < 1ms | Scale-to-zero |

### Cache Handlers

```typescript
override: {
  // EdgeKV - Ultra-low latency at edge
  incrementalCache: "edgekv",

  // Object Storage - Durable, larger objects
  incrementalCache: "object-storage",

  // Multi-tier - Best of both (L1: EdgeKV, L2: Object Storage)
  incrementalCache: "multi-tier",

  // Custom implementation
  incrementalCache: () => import("./my-cache").then((m) => m.default),
}
```

### Queue Handlers

```typescript
override: {
  // Redis Streams on Linode Managed Database
  queue: "redis-streams",

  // Custom implementation
  queue: () => import("./my-queue").then((m) => m.default),
}
```

## Environment Variables

### Akamai EdgeKV

```env
AKAMAI_EDGEKV_NAMESPACE=your-namespace
AKAMAI_EDGEKV_GROUP=cache
AKAMAI_EDGEKV_ACCESS_TOKEN=your-token
AKAMAI_EDGEKV_ENV=production
```

### Linode Object Storage

```env
LINODE_OBJECT_STORAGE_ENDPOINT=us-east-1.linodeobjects.com
LINODE_OBJECT_STORAGE_BUCKET=my-app-assets
LINODE_OBJECT_STORAGE_ACCESS_KEY=your-access-key
LINODE_OBJECT_STORAGE_SECRET_KEY=your-secret-key
LINODE_OBJECT_STORAGE_REGION=us-east-1
```

### Redis (Linode Managed Database)

```env
REDIS_URL=redis://default:password@your-redis.linode.com:6379
REDIS_STREAM_NAME=opennext:revalidation
REDIS_CONSUMER_GROUP=revalidation-workers
```

## CLI Commands

### `opennext-akamai build`

Build Next.js application for Akamai deployment.

```bash
opennext-akamai build [options]

Options:
  -c, --config <path>   Configuration file (default: open-next.config.ts)
  -o, --output <path>   Output directory (default: .open-next)
  --skip-build          Skip Next.js build step
  -v, --verbose         Verbose output
```

### `opennext-akamai deploy`

Deploy to Akamai ecosystem.

```bash
opennext-akamai deploy [options]

Options:
  -c, --config <path>     Configuration file
  -e, --environment <env> Target environment (default: production)
  --assets-only           Deploy only static assets
  --server-only           Deploy only server function
  --cdn-only              Configure CDN only
  --dry-run               Show what would be deployed
  -y, --yes               Skip confirmation prompts
  -v, --verbose           Verbose output
```

### `opennext-akamai analyze`

Analyze Next.js application for compatibility.

```bash
opennext-akamai analyze [options]

Options:
  -d, --directory <path>  Project directory (default: .)
  --json                  Output as JSON
```

## Migration from Netlify

| Netlify Feature | Akamai Equivalent |
|-----------------|-------------------|
| Edge Functions | EdgeWorkers |
| Netlify Functions | Fermyon Spin / LKE |
| Netlify Blobs | Linode Object Storage |
| Deploy Previews | Branch deployments via CI/CD |
| Forms | Self-hosted / third-party |
| Identity | Keycloak / Auth0 |

### Migration Steps

1. **Analyze your application:**
   ```bash
   npx opennext-akamai analyze
   ```

2. **Create configuration:**
   ```bash
   # Use recommendations from analyze output
   ```

3. **Update environment variables:**
   ```bash
   # Replace Netlify env vars with Akamai equivalents
   ```

4. **Build and deploy:**
   ```bash
   npx opennext-akamai build
   npx opennext-akamai deploy
   ```

## Advanced Usage

### Custom Cache Handler

```typescript
// my-cache.ts
import type { IncrementalCacheHandler } from "@opennextjs/akamai";

const myCache: IncrementalCacheHandler = {
  name: "my-custom-cache",

  async get(key) {
    // Your implementation
  },

  async set(key, value) {
    // Your implementation
  },

  async delete(key) {
    // Your implementation
  },
};

export default myCache;
```

### Custom Middleware Wrapper

```typescript
// For advanced EdgeWorkers customization
import { createEdgeWorkersWrapper } from "@opennextjs/akamai";

const wrapper = createEdgeWorkersWrapper();
export default wrapper;
```

### Kubernetes Customization

The adapter generates Kubernetes manifests that can be customized:

```bash
# After build, modify manifests
vi .open-next/akamai/kubernetes/manifests.yaml

# Apply with kubectl
kubectl apply -f .open-next/akamai/kubernetes/manifests.yaml
```

## Performance

### Cold Start Comparison

| Platform | Cold Start |
|----------|------------|
| AWS Lambda | ~100-500ms |
| Cloudflare Workers | ~0-5ms |
| Akamai EdgeWorkers | < 5ms |
| Fermyon Spin | < 1ms |
| LKE (warm) | 0ms |

### Cache Performance

| Cache Layer | Latency | Capacity |
|-------------|---------|----------|
| EdgeKV | < 10ms | 1MB/item |
| Object Storage | 20-50ms | Unlimited |
| Multi-tier | < 10ms (L1 hit) | Best of both |

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT - see [LICENSE](./LICENSE) for details.

## Resources

- [OpenNext Documentation](https://opennext.js.org/)
- [Akamai EdgeWorkers](https://techdocs.akamai.com/edgeworkers/docs)
- [Akamai EdgeKV](https://techdocs.akamai.com/edgekv/docs)
- [Linode Kubernetes Engine](https://www.linode.com/docs/products/compute/kubernetes/)
- [Fermyon Spin](https://developer.fermyon.com/spin/)
- [Next.js Documentation](https://nextjs.org/docs)
