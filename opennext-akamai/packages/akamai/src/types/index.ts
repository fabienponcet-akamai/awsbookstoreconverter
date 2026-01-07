/**
 * OpenNext Akamai Adapter - Type Definitions
 */

// ============================================================================
// Core Configuration Types
// ============================================================================

export interface AkamaiOpenNextConfig {
  /**
   * Build command for Next.js
   * @default "npx next build"
   */
  buildCommand?: string;

  /**
   * Output directory for OpenNext build artifacts
   * @default ".open-next"
   */
  buildOutputPath?: string;

  /**
   * Application name used for Akamai resources
   */
  appName: string;

  /**
   * Middleware configuration
   */
  middleware?: MiddlewareConfig;

  /**
   * Default server function configuration
   */
  default: ServerFunctionConfig;

  /**
   * Specialized functions configuration
   */
  functions?: FunctionsConfig;

  /**
   * Akamai CDN configuration
   */
  cdn: CdnConfig;

  /**
   * Dangerous flags - use with caution
   */
  dangerous?: DangerousConfig;
}

// ============================================================================
// Middleware Configuration
// ============================================================================

export interface MiddlewareConfig {
  /**
   * Whether middleware runs externally on EdgeWorkers
   * @default true
   */
  external?: boolean;

  /**
   * EdgeWorkers specific configuration
   */
  edgeworkers?: EdgeWorkersConfig;
}

export interface EdgeWorkersConfig {
  /**
   * EdgeWorker ID (if updating existing)
   */
  edgeworkerId?: string;

  /**
   * EdgeWorker name
   */
  name?: string;

  /**
   * Resource tier: basic, dynamic, or enterprise
   * @default "dynamic"
   */
  resourceTier?: "basic" | "dynamic" | "enterprise";

  /**
   * EdgeKV namespace for middleware state
   */
  edgekvNamespace?: string;

  /**
   * EdgeKV group for middleware state
   */
  edgekvGroup?: string;
}

// ============================================================================
// Server Function Configuration
// ============================================================================

export interface ServerFunctionConfig {
  /**
   * Runtime for the server function
   */
  runtime: "lke" | "fermyon" | "node";

  /**
   * Placement strategy
   */
  placement?: "regional" | "global";

  /**
   * Override handlers
   */
  override?: OverrideConfig;

  /**
   * Environment variables
   */
  environment?: Record<string, string>;
}

export interface OverrideConfig {
  /**
   * Incremental cache handler
   */
  incrementalCache?:
    | "edgekv"
    | "object-storage"
    | "multi-tier"
    | "redis"
    | "fs-dev"
    | LazyLoadedOverride<IncrementalCacheHandler>;

  /**
   * Tag cache handler for revalidateTag
   */
  tagCache?:
    | "edgekv"
    | "redis"
    | "dynamodb-lite"
    | LazyLoadedOverride<TagCacheHandler>;

  /**
   * Revalidation queue handler
   */
  queue?:
    | "redis-streams"
    | "sqs"
    | "memory"
    | LazyLoadedOverride<QueueHandler>;

  /**
   * Request/Response converter
   */
  converter?:
    | "akamai-cdn"
    | "node"
    | "edge"
    | LazyLoadedOverride<Converter>;

  /**
   * Function wrapper
   */
  wrapper?:
    | "node"
    | "fermyon"
    | "edgeworkers"
    | LazyLoadedOverride<Wrapper>;
}

// ============================================================================
// Functions Configuration
// ============================================================================

export interface FunctionsConfig {
  /**
   * ISR Revalidation function
   */
  revalidation?: RevalidationFunctionConfig;

  /**
   * Image optimization function
   */
  imageOptimization?: ImageOptimizationConfig;

  /**
   * Warmer function (optional)
   */
  warmer?: WarmerFunctionConfig;
}

export interface RevalidationFunctionConfig {
  /**
   * Runtime for revalidation
   * @default "fermyon"
   */
  runtime?: "fermyon" | "lke" | "node";

  /**
   * Handler entry point
   */
  handler?: string;
}

export interface ImageOptimizationConfig {
  /**
   * Use external Akamai Image Manager
   */
  external?: boolean;

  /**
   * Provider when external is true
   */
  provider?: "akamai-image-manager";

  /**
   * Runtime when self-hosted
   */
  runtime?: "fermyon" | "lke" | "node";

  /**
   * Handler entry point
   */
  handler?: string;

  /**
   * Image manager policy configuration
   */
  imageManagerPolicy?: ImageManagerPolicyConfig;
}

export interface ImageManagerPolicyConfig {
  /**
   * Enable automatic format selection (WebP, AVIF)
   */
  autoFormat?: boolean;

  /**
   * Default quality
   */
  quality?: number;

  /**
   * Allowed widths for resizing
   */
  widths?: number[];
}

export interface WarmerFunctionConfig {
  /**
   * Enable warmer function
   */
  enabled?: boolean;

  /**
   * Runtime
   */
  runtime?: "fermyon" | "lke";

  /**
   * Concurrency level
   */
  concurrency?: number;
}

// ============================================================================
// CDN Configuration
// ============================================================================

export interface CdnConfig {
  /**
   * Akamai Property Manager property name
   */
  propertyName: string;

  /**
   * Akamai contract ID
   */
  contractId?: string;

  /**
   * Akamai group ID
   */
  groupId?: string;

  /**
   * Origin configurations
   */
  origins: OriginsConfig;

  /**
   * Caching rules
   */
  caching?: CachingConfig;

  /**
   * Custom behaviors
   */
  behaviors?: BehaviorConfig[];
}

export interface OriginsConfig {
  /**
   * Static assets origin
   */
  static: StaticOriginConfig;

  /**
   * Dynamic content origin
   */
  dynamic: DynamicOriginConfig;
}

export interface StaticOriginConfig {
  /**
   * Origin type
   */
  type: "object-storage" | "netstorage";

  /**
   * Bucket name (for object-storage)
   */
  bucket?: string;

  /**
   * Region (for object-storage)
   */
  region?: string;

  /**
   * Netstorage CP code (for netstorage)
   */
  cpCode?: string;

  /**
   * Netstorage hostname
   */
  hostname?: string;
}

export interface DynamicOriginConfig {
  /**
   * Origin type
   */
  type: "lke" | "fermyon" | "custom";

  /**
   * LKE cluster name
   */
  cluster?: string;

  /**
   * Kubernetes service name
   */
  service?: string;

  /**
   * Fermyon application URL
   */
  fermyonUrl?: string;

  /**
   * Custom origin hostname
   */
  hostname?: string;

  /**
   * Origin port
   */
  port?: number;
}

export interface CachingConfig {
  /**
   * Static assets caching
   */
  staticAssets?: CacheRuleConfig;

  /**
   * Page caching
   */
  pages?: CacheRuleConfig;

  /**
   * API routes caching
   */
  api?: CacheRuleConfig;
}

export interface CacheRuleConfig {
  /**
   * Edge cache TTL
   */
  ttl?: string;

  /**
   * Browser cache TTL
   */
  browserTtl?: string;

  /**
   * Stale-while-revalidate duration
   */
  staleWhileRevalidate?: string;

  /**
   * Cache key configuration
   */
  cacheKey?: CacheKeyConfig;
}

export interface CacheKeyConfig {
  /**
   * Include query parameters in cache key
   */
  includeQueryParams?: boolean | string[];

  /**
   * Include headers in cache key
   */
  includeHeaders?: string[];

  /**
   * Include cookies in cache key
   */
  includeCookies?: string[];
}

export interface BehaviorConfig {
  /**
   * Path pattern to match
   */
  path: string;

  /**
   * Behaviors to apply
   */
  behaviors: Record<string, unknown>;
}

// ============================================================================
// Dangerous Configuration
// ============================================================================

export interface DangerousConfig {
  /**
   * Disable edge caching entirely
   */
  disableEdgeCaching?: boolean;

  /**
   * Enable debug mode
   */
  enableDebugMode?: boolean;
}

// ============================================================================
// Handler Interfaces
// ============================================================================

export interface BaseOverride {
  name: string;
}

export type LazyLoadedOverride<T extends BaseOverride> = () => Promise<T>;

export interface IncrementalCacheHandler extends BaseOverride {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, value: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface CacheEntry {
  value: CacheValue;
  lastModified: number;
  tags?: string[];
  revalidate?: number;
}

export interface CacheValue {
  kind: "PAGE" | "FETCH" | "ROUTE" | "IMAGE" | "REDIRECT";
  html?: string;
  json?: Record<string, unknown>;
  body?: Buffer;
  status?: number;
  headers?: Record<string, string>;
}

export interface TagCacheHandler extends BaseOverride {
  getByTag(tag: string): Promise<string[]>;
  getByPath(path: string): Promise<string[]>;
  getLastModified(key: string, lastModified?: number): Promise<number>;
  writeTags(tags: { tag: string; path: string; revalidatedAt?: number }[]): Promise<void>;
}

export interface QueueHandler extends BaseOverride {
  send(message: RevalidationMessage): Promise<void>;
}

export interface RevalidationMessage {
  host: string;
  url: string;
  id: string;
}

export interface Converter extends BaseOverride {
  convertFrom(event: unknown): InternalEvent;
  convertTo(result: InternalResult): unknown;
}

export interface InternalEvent {
  type: "v1" | "v2";
  method: string;
  rawPath: string;
  url: string;
  body?: Buffer;
  headers: Record<string, string>;
  query: Record<string, string | string[]>;
  cookies: Record<string, string>;
  remoteAddress?: string;
}

export interface InternalResult {
  type: "v1" | "v2";
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
  isBase64Encoded: boolean;
}

export interface Wrapper extends BaseOverride {
  wrap(handler: RequestHandler): WrappedHandler;
}

export type RequestHandler = (
  event: InternalEvent,
  responseStream?: unknown
) => Promise<InternalResult>;

export type WrappedHandler = (
  event: unknown,
  context?: unknown
) => Promise<unknown>;

// ============================================================================
// Build Output Types
// ============================================================================

export interface OpenNextBuildOutput {
  /**
   * Path to assets directory
   */
  assetsPath: string;

  /**
   * Path to server function
   */
  serverFunctionPath: string;

  /**
   * Path to middleware (if external)
   */
  middlewarePath?: string;

  /**
   * Path to revalidation function
   */
  revalidationPath?: string;

  /**
   * Path to image optimization function
   */
  imageOptimizationPath?: string;

  /**
   * Path to warmer function
   */
  warmerPath?: string;

  /**
   * Generated Akamai configuration
   */
  akamaiConfig: AkamaiDeployConfig;
}

export interface AkamaiDeployConfig {
  /**
   * Property Manager JSON
   */
  propertyManager: Record<string, unknown>;

  /**
   * EdgeWorker bundle path
   */
  edgeworkerBundle?: string;

  /**
   * Kubernetes manifests
   */
  kubernetesManifests?: string[];

  /**
   * Fermyon Spin configuration
   */
  spinConfig?: string;
}

// ============================================================================
// CLI Types
// ============================================================================

export interface DeployOptions {
  /**
   * Target environment
   */
  environment?: "production" | "staging" | "development";

  /**
   * Skip confirmation prompts
   */
  yes?: boolean;

  /**
   * Dry run mode
   */
  dryRun?: boolean;

  /**
   * Verbose output
   */
  verbose?: boolean;
}

export interface AnalyzeResult {
  /**
   * Detected Next.js version
   */
  nextVersion: string;

  /**
   * Detected features
   */
  features: {
    appRouter: boolean;
    pagesRouter: boolean;
    middleware: boolean;
    apiRoutes: boolean;
    imageOptimization: boolean;
    isr: boolean;
    serverActions: boolean;
  };

  /**
   * Recommendations
   */
  recommendations: Recommendation[];
}

export interface Recommendation {
  type: "info" | "warning" | "error";
  message: string;
  action?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Define an Akamai OpenNext configuration with type safety
 */
export function defineAkamaiConfig(
  config: AkamaiOpenNextConfig
): AkamaiOpenNextConfig {
  return config;
}
