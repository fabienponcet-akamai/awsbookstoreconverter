/**
 * Example OpenNext Akamai Configuration
 *
 * This file demonstrates all available configuration options
 * for deploying Next.js to the Akamai ecosystem.
 */

import { defineAkamaiConfig } from "@opennextjs/akamai";

export default defineAkamaiConfig({
  // =========================================================================
  // Basic Configuration
  // =========================================================================

  /**
   * Application name - used for resource naming
   */
  appName: "my-nextjs-app",

  /**
   * Custom build command (optional)
   * @default "npx next build"
   */
  buildCommand: "npm run build",

  /**
   * Output directory for build artifacts (optional)
   * @default ".open-next"
   */
  buildOutputPath: ".open-next",

  // =========================================================================
  // Middleware Configuration
  // =========================================================================

  middleware: {
    /**
     * Deploy middleware to EdgeWorkers (recommended)
     * When true, middleware runs at Akamai's edge with < 5ms latency
     */
    external: true,

    /**
     * EdgeWorkers-specific configuration
     */
    edgeworkers: {
      /**
       * EdgeWorker ID (for updates to existing EdgeWorker)
       * Leave undefined to create a new EdgeWorker
       */
      edgeworkerId: "12345",

      /**
       * EdgeWorker name
       */
      name: "my-app-middleware",

      /**
       * Resource tier for EdgeWorker pricing
       * - basic: Lower cost, limited resources
       * - dynamic: Standard resources
       * - enterprise: Maximum resources
       */
      resourceTier: "dynamic",

      /**
       * EdgeKV namespace for middleware state
       */
      edgekvNamespace: "my-app",

      /**
       * EdgeKV group for middleware state
       */
      edgekvGroup: "middleware-state",
    },
  },

  // =========================================================================
  // Server Function Configuration
  // =========================================================================

  default: {
    /**
     * Runtime for server function
     * - lke: Linode Kubernetes Engine (full Node.js, WebSocket support)
     * - fermyon: Fermyon Spin (WebAssembly, scale-to-zero, < 1ms cold start)
     * - node: Standard Node.js server
     */
    runtime: "lke",

    /**
     * Placement strategy
     * - regional: Deploy to single region
     * - global: Deploy to multiple regions
     */
    placement: "regional",

    /**
     * Environment variables for the server function
     */
    environment: {
      LOG_LEVEL: "info",
      ENABLE_METRICS: "true",
    },

    /**
     * Override handlers for cache, queue, and converters
     */
    override: {
      /**
       * Incremental cache handler
       * - edgekv: EdgeKV (ultra-low latency, 1MB limit)
       * - object-storage: Linode Object Storage (durable, unlimited)
       * - multi-tier: L1=EdgeKV, L2=Object Storage (recommended)
       * - redis: Redis-based cache
       * - fs-dev: Filesystem (development only)
       */
      incrementalCache: "multi-tier",

      /**
       * Tag cache handler for revalidateTag
       * - edgekv: EdgeKV-based tag storage
       * - redis: Redis-based tag storage
       */
      tagCache: "edgekv",

      /**
       * Revalidation queue handler
       * - redis-streams: Redis Streams (recommended)
       * - sqs: AWS SQS (if using hybrid)
       * - memory: In-memory (development only)
       */
      queue: "redis-streams",

      /**
       * Request/response converter
       * - akamai-cdn: Optimized for Akamai CDN headers
       * - node: Standard Node.js format
       * - edge: Edge runtime format
       */
      converter: "akamai-cdn",

      /**
       * Function wrapper
       * - node: Standard Node.js wrapper
       * - fermyon: Fermyon Spin wrapper
       * - edgeworkers: EdgeWorkers wrapper
       */
      wrapper: "node",
    },
  },

  // =========================================================================
  // Specialized Functions Configuration
  // =========================================================================

  functions: {
    /**
     * ISR Revalidation function
     * Handles background regeneration of static pages
     */
    revalidation: {
      /**
       * Runtime for revalidation
       * Fermyon is recommended for scale-to-zero behavior
       */
      runtime: "fermyon",

      /**
       * Handler entry point
       */
      handler: "revalidation.handler",
    },

    /**
     * Image optimization function
     */
    imageOptimization: {
      /**
       * Use Akamai Image Manager (recommended)
       * Provides automatic format selection, quality optimization
       */
      external: true,
      provider: "akamai-image-manager",

      /**
       * Image Manager policy configuration
       */
      imageManagerPolicy: {
        /**
         * Enable automatic format selection (WebP, AVIF)
         */
        autoFormat: true,

        /**
         * Default quality (1-100)
         */
        quality: 80,

        /**
         * Allowed widths for resizing
         */
        widths: [16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840],
      },

      /**
       * Alternative: Self-hosted on Fermyon
       * Uncomment to use instead of Image Manager
       */
      // external: false,
      // runtime: "fermyon",
      // handler: "image-optimization.handler",
    },

    /**
     * Warmer function (optional)
     * Pre-warms server instances to reduce cold starts
     */
    warmer: {
      enabled: true,
      runtime: "fermyon",
      concurrency: 5,
    },
  },

  // =========================================================================
  // CDN Configuration
  // =========================================================================

  cdn: {
    /**
     * Akamai Property Manager property name
     */
    propertyName: "my-nextjs-app-cdn",

    /**
     * Akamai contract ID (optional - uses default if not specified)
     */
    contractId: "ctr_1234",

    /**
     * Akamai group ID (optional - uses default if not specified)
     */
    groupId: "grp_5678",

    /**
     * Origin configurations
     */
    origins: {
      /**
       * Static assets origin (Object Storage or Netstorage)
       */
      static: {
        type: "object-storage",
        bucket: "my-app-assets",
        region: "us-east",

        /**
         * Alternative: Akamai Netstorage (for highest performance)
         */
        // type: "netstorage",
        // cpCode: "123456",
        // hostname: "my-app.upload.akamai.com",
      },

      /**
       * Dynamic content origin (LKE or Fermyon)
       */
      dynamic: {
        type: "lke",
        cluster: "my-lke-cluster",
        service: "nextjs-server",

        /**
         * Alternative: Fermyon
         */
        // type: "fermyon",
        // fermyonUrl: "https://my-app.fermyon.app",

        /**
         * Alternative: Custom origin
         */
        // type: "custom",
        // hostname: "origin.example.com",
        // port: 443,
      },
    },

    /**
     * Caching rules
     */
    caching: {
      /**
       * Static assets caching (hashed files)
       */
      staticAssets: {
        ttl: "365d",
        browserTtl: "365d",
      },

      /**
       * Page caching (ISR/SSG pages)
       */
      pages: {
        ttl: "1h",
        staleWhileRevalidate: "24h",
        cacheKey: {
          includeQueryParams: ["page", "sort", "filter"],
          includeHeaders: ["accept-language"],
          includeCookies: ["locale"],
        },
      },

      /**
       * API routes caching
       */
      api: {
        ttl: "0s", // No caching by default
        cacheKey: {
          includeQueryParams: true,
        },
      },
    },

    /**
     * Custom behaviors for specific paths
     */
    behaviors: [
      {
        path: "/api/webhook/*",
        behaviors: {
          caching: { behavior: "NO_STORE" },
          allowPost: { enabled: true },
        },
      },
      {
        path: "/blog/*",
        behaviors: {
          caching: { behavior: "MAX_AGE", ttl: "7d" },
          prefetch: { enabled: true },
        },
      },
    ],
  },

  // =========================================================================
  // Dangerous Options (use with caution)
  // =========================================================================

  dangerous: {
    /**
     * Disable edge caching entirely
     * Only use for debugging
     */
    disableEdgeCaching: false,

    /**
     * Enable debug mode
     * Adds verbose headers and logging
     */
    enableDebugMode: false,
  },
});
