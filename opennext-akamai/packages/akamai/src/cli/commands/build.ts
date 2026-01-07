/**
 * Build Command
 *
 * Builds the Next.js application for Akamai deployment:
 * 1. Run next build
 * 2. Transform output with OpenNext
 * 3. Generate Akamai-specific artifacts
 */

import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import pc from "picocolors";
import { glob } from "glob";
import type { AkamaiOpenNextConfig } from "../../types/index.js";
import { generateLKEManifests, manifestsToYAML, generateDockerfile } from "../../adapters/lke.js";
import { generateSpinToml } from "../../wrappers/fermyon.js";
import { generatePropertyManagerRules, rulesToJson } from "../../converters/akamai-cdn.js";
import { generateEdgeWorkersBundle } from "../../wrappers/edgeworkers.js";

interface BuildOptions {
  config: string;
  output: string;
  skipBuild?: boolean;
  verbose?: boolean;
}

export async function buildCommand(options: BuildOptions): Promise<void> {
  const startTime = Date.now();

  console.log(pc.bold("\n🚀 OpenNext Akamai Build\n"));

  try {
    // Step 1: Load configuration
    console.log(pc.cyan("→ Loading configuration..."));
    const config = await loadConfig(options.config);
    console.log(pc.green(`  ✓ Loaded config for ${config.appName}`));

    // Step 2: Run Next.js build
    if (!options.skipBuild) {
      console.log(pc.cyan("\n→ Building Next.js application..."));
      await runNextBuild(config, options.verbose);
      console.log(pc.green("  ✓ Next.js build complete"));
    } else {
      console.log(pc.yellow("\n→ Skipping Next.js build"));
    }

    // Step 3: Run OpenNext build
    console.log(pc.cyan("\n→ Running OpenNext transformation..."));
    await runOpenNextBuild(options.output, options.verbose);
    console.log(pc.green("  ✓ OpenNext transformation complete"));

    // Step 4: Generate Akamai artifacts
    console.log(pc.cyan("\n→ Generating Akamai deployment artifacts..."));
    await generateAkamaiArtifacts(config, options.output);
    console.log(pc.green("  ✓ Akamai artifacts generated"));

    // Done
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(pc.bold(pc.green(`\n✅ Build complete in ${duration}s\n`)));

    // Print summary
    printBuildSummary(config, options.output);
  } catch (error) {
    console.error(pc.red("\n❌ Build failed:"), error);
    process.exit(1);
  }
}

async function loadConfig(configPath: string): Promise<AkamaiOpenNextConfig> {
  const fullPath = path.resolve(process.cwd(), configPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  // Dynamic import of TypeScript config
  // In production, use esbuild to transpile first
  const configModule = await import(fullPath);
  return configModule.default;
}

async function runNextBuild(
  config: AkamaiOpenNextConfig,
  verbose?: boolean
): Promise<void> {
  const buildCommand = config.buildCommand || "npx next build";

  return new Promise((resolve, reject) => {
    const child = spawn(buildCommand, {
      shell: true,
      cwd: process.cwd(),
      stdio: verbose ? "inherit" : "pipe",
    });

    let stderr = "";

    if (!verbose && child.stderr) {
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    }

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Next.js build failed with code ${code}\n${stderr}`));
      } else {
        resolve();
      }
    });

    child.on("error", reject);
  });
}

async function runOpenNextBuild(
  outputDir: string,
  verbose?: boolean
): Promise<void> {
  // Use @opennextjs/aws as the base builder
  const command = `npx open-next build --output ${outputDir}`;

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: process.cwd(),
      stdio: verbose ? "inherit" : "pipe",
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`OpenNext build failed with code ${code}`));
      } else {
        resolve();
      }
    });

    child.on("error", reject);
  });
}

async function generateAkamaiArtifacts(
  config: AkamaiOpenNextConfig,
  outputDir: string
): Promise<void> {
  const akamaiDir = path.join(outputDir, "akamai");

  // Create akamai directory
  fs.mkdirSync(akamaiDir, { recursive: true });

  // Generate based on runtime
  if (config.default.runtime === "lke") {
    await generateLKEArtifacts(config, akamaiDir);
  } else if (config.default.runtime === "fermyon") {
    await generateFermyonArtifacts(config, akamaiDir);
  }

  // Generate EdgeWorkers bundle if middleware is external
  if (config.middleware?.external) {
    await generateEdgeWorkersArtifacts(config, outputDir, akamaiDir);
  }

  // Generate Property Manager rules
  await generateCDNArtifacts(config, akamaiDir);

  // Generate deployment scripts
  await generateDeploymentScripts(config, akamaiDir);
}

async function generateLKEArtifacts(
  config: AkamaiOpenNextConfig,
  akamaiDir: string
): Promise<void> {
  const kubernetesDir = path.join(akamaiDir, "kubernetes");
  fs.mkdirSync(kubernetesDir, { recursive: true });

  // Generate manifests
  const manifests = generateLKEManifests(config, {
    image: `${config.appName}:latest`,
  });

  // Write manifests
  const yamlContent = manifestsToYAML(manifests);
  fs.writeFileSync(path.join(kubernetesDir, "manifests.yaml"), yamlContent);

  // Generate Dockerfile
  const dockerfile = generateDockerfile();
  fs.writeFileSync(path.join(akamaiDir, "Dockerfile"), dockerfile);

  console.log(pc.gray("    - Generated Kubernetes manifests"));
  console.log(pc.gray("    - Generated Dockerfile"));
}

async function generateFermyonArtifacts(
  config: AkamaiOpenNextConfig,
  akamaiDir: string
): Promise<void> {
  const spinDir = path.join(akamaiDir, "spin");
  fs.mkdirSync(spinDir, { recursive: true });

  // Generate spin.toml
  const spinToml = generateSpinToml({
    appName: config.appName,
    components: [
      {
        id: "server",
        source: "../server-function/index.wasm",
        route: "/...",
        allowedHosts: ["https://*"],
        keyValueStores: ["default"],
      },
    ],
  });

  fs.writeFileSync(path.join(spinDir, "spin.toml"), spinToml);

  console.log(pc.gray("    - Generated Spin configuration"));
}

async function generateEdgeWorkersArtifacts(
  config: AkamaiOpenNextConfig,
  outputDir: string,
  akamaiDir: string
): Promise<void> {
  const edgeworkersDir = path.join(akamaiDir, "edgeworkers");
  fs.mkdirSync(edgeworkersDir, { recursive: true });

  // Read middleware code
  const middlewarePath = path.join(outputDir, "middleware", "handler.mjs");
  let middlewareCode = "";

  if (fs.existsSync(middlewarePath)) {
    middlewareCode = fs.readFileSync(middlewarePath, "utf-8");
  }

  // Generate EdgeWorkers bundle
  const bundleCode = generateEdgeWorkersBundle(middlewareCode);
  fs.writeFileSync(path.join(edgeworkersDir, "main.js"), bundleCode);

  // Generate bundle.json
  const bundleJson = {
    "edgeworker-version": "1.0.0",
    description: `${config.appName} Next.js middleware`,
  };
  fs.writeFileSync(
    path.join(edgeworkersDir, "bundle.json"),
    JSON.stringify(bundleJson, null, 2)
  );

  console.log(pc.gray("    - Generated EdgeWorkers bundle"));
}

async function generateCDNArtifacts(
  config: AkamaiOpenNextConfig,
  akamaiDir: string
): Promise<void> {
  const cdnDir = path.join(akamaiDir, "property-manager");
  fs.mkdirSync(cdnDir, { recursive: true });

  // Determine origin hostname
  let originHostname = "localhost";
  if (config.cdn.origins.dynamic.type === "lke") {
    originHostname = `${config.cdn.origins.dynamic.cluster}.lke.linode.com`;
  } else if (config.cdn.origins.dynamic.hostname) {
    originHostname = config.cdn.origins.dynamic.hostname;
  }

  // Generate Property Manager rules
  const rules = generatePropertyManagerRules({
    originHostname,
    cpCode: 12345, // Placeholder - should come from config
  });

  fs.writeFileSync(
    path.join(cdnDir, "rules.json"),
    rulesToJson(rules)
  );

  console.log(pc.gray("    - Generated Property Manager rules"));
}

async function generateDeploymentScripts(
  config: AkamaiOpenNextConfig,
  akamaiDir: string
): Promise<void> {
  // Generate deploy.sh script
  const deployScript = `#!/bin/bash
# Generated by @opennextjs/akamai
# Deploy Next.js application to Akamai ecosystem

set -e

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="${config.appName}"

echo "🚀 Deploying $APP_NAME to Akamai ecosystem..."

# 1. Deploy static assets to Linode Object Storage
echo "📦 Uploading static assets..."
if command -v linode-cli &> /dev/null; then
  linode-cli obj sync \${SCRIPT_DIR}/../assets/ s3://\${LINODE_BUCKET}/
else
  echo "  ⚠️  linode-cli not found. Install with: pip install linode-cli"
  echo "  Manual upload: Upload .open-next/assets/ to your Object Storage bucket"
fi

# 2. Deploy server function
${config.default.runtime === "lke" ? `
echo "☸️  Deploying to LKE..."
if command -v kubectl &> /dev/null; then
  kubectl apply -f \${SCRIPT_DIR}/kubernetes/manifests.yaml
else
  echo "  ⚠️  kubectl not found"
fi
` : `
echo "🔧 Deploying to Fermyon Spin..."
if command -v spin &> /dev/null; then
  cd \${SCRIPT_DIR}/spin && spin deploy
else
  echo "  ⚠️  spin CLI not found. Install from: https://developer.fermyon.com/spin"
fi
`}

# 3. Deploy EdgeWorkers (if middleware is external)
${config.middleware?.external ? `
echo "⚡ Deploying EdgeWorkers..."
if command -v akamai &> /dev/null; then
  cd \${SCRIPT_DIR}/edgeworkers
  akamai edgeworkers upload --bundle .
else
  echo "  ⚠️  akamai CLI not found. Install with: pip install edgegrid-python"
fi
` : ""}

# 4. Update Property Manager
echo "🌐 Updating CDN configuration..."
echo "  ℹ️  Import \${SCRIPT_DIR}/property-manager/rules.json into Property Manager"

echo ""
echo "✅ Deployment complete!"
echo "  📊 Monitor at: https://control.akamai.com"
`;

  fs.writeFileSync(path.join(akamaiDir, "deploy.sh"), deployScript);
  fs.chmodSync(path.join(akamaiDir, "deploy.sh"), "755");

  console.log(pc.gray("    - Generated deployment scripts"));
}

function printBuildSummary(
  config: AkamaiOpenNextConfig,
  outputDir: string
): void {
  console.log(pc.bold("Build Output:\n"));

  console.log(`  ${pc.cyan("Application:")} ${config.appName}`);
  console.log(`  ${pc.cyan("Runtime:")} ${config.default.runtime}`);
  console.log(`  ${pc.cyan("Output:")} ${outputDir}/`);
  console.log("");

  console.log(pc.bold("  Generated Artifacts:"));
  console.log(`    ${pc.gray("•")} ${outputDir}/assets/ - Static files`);
  console.log(`    ${pc.gray("•")} ${outputDir}/server-function/ - Server code`);

  if (config.middleware?.external) {
    console.log(`    ${pc.gray("•")} ${outputDir}/akamai/edgeworkers/ - EdgeWorkers bundle`);
  }

  if (config.default.runtime === "lke") {
    console.log(`    ${pc.gray("•")} ${outputDir}/akamai/kubernetes/ - K8s manifests`);
    console.log(`    ${pc.gray("•")} ${outputDir}/akamai/Dockerfile - Container image`);
  } else if (config.default.runtime === "fermyon") {
    console.log(`    ${pc.gray("•")} ${outputDir}/akamai/spin/ - Spin configuration`);
  }

  console.log(`    ${pc.gray("•")} ${outputDir}/akamai/property-manager/ - CDN rules`);
  console.log("");

  console.log(pc.bold("  Next Steps:"));
  console.log(`    1. Review generated artifacts in ${outputDir}/akamai/`);
  console.log(`    2. Configure environment variables for your target`);
  console.log(`    3. Run: ${pc.cyan("npx opennext-akamai deploy")}`);
  console.log("");
}
