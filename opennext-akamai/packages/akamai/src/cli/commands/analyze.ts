/**
 * Analyze Command
 *
 * Analyzes a Next.js application for Akamai deployment compatibility:
 * - Detects Next.js version and features
 * - Identifies potential compatibility issues
 * - Provides recommendations for optimal deployment
 */

import * as fs from "fs";
import * as path from "path";
import pc from "picocolors";
import { glob } from "glob";
import type { AnalyzeResult, Recommendation } from "../../types/index.js";

interface AnalyzeOptions {
  directory: string;
  json?: boolean;
}

export async function analyzeCommand(options: AnalyzeOptions): Promise<void> {
  const projectDir = path.resolve(process.cwd(), options.directory);

  if (!options.json) {
    console.log(pc.bold("\n🔍 Analyzing Next.js Application\n"));
  }

  try {
    const result = await analyzeProject(projectDir);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printAnalysisResult(result);
    }
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.error(pc.red("Analysis failed:"), error);
    }
    process.exit(1);
  }
}

async function analyzeProject(projectDir: string): Promise<AnalyzeResult> {
  // Check for package.json
  const packageJsonPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error("No package.json found. Is this a Next.js project?");
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

  // Detect Next.js version
  const nextVersion = detectNextVersion(packageJson);

  // Detect features
  const features = await detectFeatures(projectDir, packageJson);

  // Generate recommendations
  const recommendations = generateRecommendations(features, nextVersion);

  return {
    nextVersion,
    features,
    recommendations,
  };
}

function detectNextVersion(packageJson: Record<string, unknown>): string {
  const deps = packageJson.dependencies as Record<string, string> || {};
  const devDeps = packageJson.devDependencies as Record<string, string> || {};

  const nextVersion = deps.next || devDeps.next || "unknown";

  // Clean version string
  return nextVersion.replace(/[\^~]/, "");
}

async function detectFeatures(
  projectDir: string,
  packageJson: Record<string, unknown>
): Promise<AnalyzeResult["features"]> {
  const features = {
    appRouter: false,
    pagesRouter: false,
    middleware: false,
    apiRoutes: false,
    imageOptimization: false,
    isr: false,
    serverActions: false,
  };

  // Check for App Router
  const appDir = path.join(projectDir, "app");
  const srcAppDir = path.join(projectDir, "src", "app");
  features.appRouter = fs.existsSync(appDir) || fs.existsSync(srcAppDir);

  // Check for Pages Router
  const pagesDir = path.join(projectDir, "pages");
  const srcPagesDir = path.join(projectDir, "src", "pages");
  features.pagesRouter = fs.existsSync(pagesDir) || fs.existsSync(srcPagesDir);

  // Check for middleware
  const middlewareFiles = await glob("middleware.{ts,js,tsx,jsx}", {
    cwd: projectDir,
  });
  const srcMiddlewareFiles = await glob("src/middleware.{ts,js,tsx,jsx}", {
    cwd: projectDir,
  });
  features.middleware = middlewareFiles.length > 0 || srcMiddlewareFiles.length > 0;

  // Check for API routes
  const apiRoutesPages = await glob("pages/api/**/*.{ts,js,tsx,jsx}", {
    cwd: projectDir,
  });
  const apiRoutesApp = await glob("app/**/route.{ts,js}", {
    cwd: projectDir,
  });
  features.apiRoutes = apiRoutesPages.length > 0 || apiRoutesApp.length > 0;

  // Check for image optimization
  const imageUsage = await findInFiles(
    projectDir,
    /next\/image|<Image/,
    "**/*.{ts,tsx,js,jsx}"
  );
  features.imageOptimization = imageUsage.length > 0;

  // Check for ISR (getStaticProps with revalidate, or revalidate export)
  const isrUsage = await findInFiles(
    projectDir,
    /revalidate\s*[:=]/,
    "**/*.{ts,tsx,js,jsx}"
  );
  features.isr = isrUsage.length > 0;

  // Check for Server Actions
  const serverActionsUsage = await findInFiles(
    projectDir,
    /"use server"|'use server'/,
    "**/*.{ts,tsx,js,jsx}"
  );
  features.serverActions = serverActionsUsage.length > 0;

  return features;
}

async function findInFiles(
  dir: string,
  pattern: RegExp,
  globPattern: string
): Promise<string[]> {
  const files = await glob(globPattern, {
    cwd: dir,
    ignore: ["node_modules/**", ".next/**", ".open-next/**"],
  });

  const matches: string[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), "utf-8");
      if (pattern.test(content)) {
        matches.push(file);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return matches;
}

function generateRecommendations(
  features: AnalyzeResult["features"],
  nextVersion: string
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // Version check
  const majorVersion = parseInt(nextVersion.split(".")[0], 10);

  if (majorVersion < 13) {
    recommendations.push({
      type: "error",
      message: `Next.js ${nextVersion} is not fully supported`,
      action: "Upgrade to Next.js 14 or 15 for best Akamai compatibility",
    });
  } else if (majorVersion < 14) {
    recommendations.push({
      type: "warning",
      message: "Next.js 13 has limited feature support",
      action: "Consider upgrading to Next.js 14+ for full feature support",
    });
  } else {
    recommendations.push({
      type: "info",
      message: `Next.js ${nextVersion} is fully supported`,
    });
  }

  // App Router recommendation
  if (features.appRouter && features.pagesRouter) {
    recommendations.push({
      type: "info",
      message: "Mixed App Router and Pages Router detected",
      action: "Both routers will work, but consider migrating to App Router for new features",
    });
  }

  // Middleware recommendation
  if (features.middleware) {
    recommendations.push({
      type: "info",
      message: "Middleware detected - will be deployed to EdgeWorkers",
      action: "Ensure middleware is compatible with Edge runtime (no Node.js APIs)",
    });
  }

  // Image optimization recommendation
  if (features.imageOptimization) {
    recommendations.push({
      type: "info",
      message: "Image optimization detected",
      action: "Configure Akamai Image Manager or use Fermyon Spin for image optimization",
    });
  }

  // ISR recommendation
  if (features.isr) {
    recommendations.push({
      type: "info",
      message: "ISR (Incremental Static Regeneration) detected",
      action: "ISR will use EdgeKV for cache storage and Redis Streams for revalidation",
    });
  }

  // Server Actions recommendation
  if (features.serverActions) {
    recommendations.push({
      type: "info",
      message: "Server Actions detected",
      action: "Server Actions require LKE or Fermyon Spin for execution",
    });
  }

  // API Routes recommendation
  if (features.apiRoutes) {
    recommendations.push({
      type: "info",
      message: `API routes detected`,
      action: "API routes will be deployed to LKE or Fermyon Spin",
    });
  }

  // General recommendations
  recommendations.push({
    type: "info",
    message: "Recommended deployment architecture:",
    action: features.middleware
      ? "EdgeWorkers (middleware) → Akamai CDN → LKE/Fermyon (server)"
      : "Akamai CDN → LKE/Fermyon (server)",
  });

  return recommendations;
}

function printAnalysisResult(result: AnalyzeResult): void {
  // Version
  console.log(pc.bold("Next.js Version"));
  console.log(`  ${result.nextVersion}\n`);

  // Features
  console.log(pc.bold("Detected Features"));
  const featureList = [
    { name: "App Router", enabled: result.features.appRouter },
    { name: "Pages Router", enabled: result.features.pagesRouter },
    { name: "Middleware", enabled: result.features.middleware },
    { name: "API Routes", enabled: result.features.apiRoutes },
    { name: "Image Optimization", enabled: result.features.imageOptimization },
    { name: "ISR", enabled: result.features.isr },
    { name: "Server Actions", enabled: result.features.serverActions },
  ];

  for (const feature of featureList) {
    const icon = feature.enabled ? pc.green("✓") : pc.gray("○");
    const name = feature.enabled ? feature.name : pc.gray(feature.name);
    console.log(`  ${icon} ${name}`);
  }
  console.log("");

  // Recommendations
  console.log(pc.bold("Recommendations\n"));
  for (const rec of result.recommendations) {
    let icon: string;
    let color: (s: string) => string;

    switch (rec.type) {
      case "error":
        icon = "❌";
        color = pc.red;
        break;
      case "warning":
        icon = "⚠️";
        color = pc.yellow;
        break;
      default:
        icon = "ℹ️";
        color = pc.blue;
    }

    console.log(`  ${icon} ${color(rec.message)}`);
    if (rec.action) {
      console.log(`     ${pc.gray("→")} ${rec.action}`);
    }
    console.log("");
  }

  // Next steps
  console.log(pc.bold("Next Steps\n"));
  console.log(`  1. Create ${pc.cyan("open-next.config.ts")} with your configuration`);
  console.log(`  2. Run ${pc.cyan("npx opennext-akamai build")}`);
  console.log(`  3. Run ${pc.cyan("npx opennext-akamai deploy")}`);
  console.log("");
}
