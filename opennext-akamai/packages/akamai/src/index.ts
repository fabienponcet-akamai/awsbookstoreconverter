/**
 * @opennextjs/akamai
 *
 * OpenNext adapter for deploying Next.js applications to the Akamai ecosystem.
 *
 * Features:
 * - Akamai CDN integration with Property Manager
 * - EdgeWorkers for middleware execution
 * - EdgeKV for distributed caching
 * - LKE (Linode Kubernetes Engine) for server functions
 * - Fermyon Spin for WebAssembly serverless
 * - Linode Object Storage for static assets
 *
 * @example
 * ```typescript
 * // open-next.config.ts
 * import { defineAkamaiConfig } from "@opennextjs/akamai";
 *
 * export default defineAkamaiConfig({
 *   appName: "my-nextjs-app",
 *   default: {
 *     runtime: "lke",
 *     override: {
 *       incrementalCache: "edgekv",
 *       queue: "redis-streams",
 *     },
 *   },
 *   cdn: {
 *     propertyName: "my-nextjs-app-cdn",
 *     origins: {
 *       static: {
 *         type: "object-storage",
 *         bucket: "my-app-assets",
 *         region: "us-east",
 *       },
 *       dynamic: {
 *         type: "lke",
 *         cluster: "my-lke-cluster",
 *         service: "nextjs-server",
 *       },
 *     },
 *   },
 * });
 * ```
 */

// ============================================================================
// Configuration
// ============================================================================

export { defineAkamaiConfig } from "./types/index.js";
export type {
  AkamaiOpenNextConfig,
  ServerFunctionConfig,
  MiddlewareConfig,
  CdnConfig,
  OverrideConfig,
  FunctionsConfig,
} from "./types/index.js";

// ============================================================================
// Cache Handlers
// ============================================================================

export { createEdgeKVCache, createEdgeKVTagCache } from "./cache/edgekv.js";
export { createObjectStorageCache } from "./cache/object-storage.js";
export { createMultiTierCache } from "./cache/multi-tier.js";

// ============================================================================
// Queue Handlers
// ============================================================================

export {
  createRedisStreamsQueue,
  startRevalidationWorker,
  processPendingMessages,
  closeRedisConnection,
} from "./queue/redis-streams.js";

// ============================================================================
// Wrappers
// ============================================================================

export {
  createEdgeWorkersWrapper,
  createEdgeWorkersConverter,
  generateEdgeWorkersBundle,
  createEdgeKVSession,
} from "./wrappers/edgeworkers.js";

export {
  createSpinWrapper,
  createSpinConverter,
  generateSpinToml,
  generateSpinEntryPoint,
  spinFetch,
  triggerRevalidation,
} from "./wrappers/fermyon.js";

// ============================================================================
// Converters
// ============================================================================

export {
  createAkamaiCdnConverter,
  generatePropertyManagerRules,
  rulesToJson,
} from "./converters/akamai-cdn.js";

// ============================================================================
// Adapters
// ============================================================================

export {
  generateLKEManifests,
  manifestsToYAML,
  generateDockerfile,
  generateSkaffoldConfig,
  generateNamespace,
  generateDeployment,
  generateService,
  generateHPA,
  generatePDB,
  generateIngress,
} from "./adapters/lke.js";

// ============================================================================
// Types
// ============================================================================

export type {
  IncrementalCacheHandler,
  TagCacheHandler,
  QueueHandler,
  Converter,
  Wrapper,
  InternalEvent,
  InternalResult,
  CacheEntry,
  CacheValue,
  RevalidationMessage,
  LazyLoadedOverride,
  BaseOverride,
} from "./types/index.js";
