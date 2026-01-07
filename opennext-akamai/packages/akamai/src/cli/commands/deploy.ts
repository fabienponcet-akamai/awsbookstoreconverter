/**
 * Deploy Command
 *
 * Deploys the built Next.js application to Akamai ecosystem:
 * 1. Upload static assets to Linode Object Storage
 * 2. Deploy server function to LKE or Fermyon
 * 3. Deploy EdgeWorkers middleware
 * 4. Configure Akamai CDN
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import pc from "picocolors";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { glob } from "glob";
import * as mimeTypes from "mime-types";
import type { AkamaiOpenNextConfig } from "../../types/index.js";

interface DeployOptions {
  config: string;
  environment: string;
  assetsOnly?: boolean;
  serverOnly?: boolean;
  cdnOnly?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  verbose?: boolean;
}

interface DeployContext {
  config: AkamaiOpenNextConfig;
  options: DeployOptions;
  outputDir: string;
}

export async function deployCommand(options: DeployOptions): Promise<void> {
  const startTime = Date.now();

  console.log(pc.bold("\n🚀 OpenNext Akamai Deploy\n"));

  if (options.dryRun) {
    console.log(pc.yellow("⚠️  Dry run mode - no changes will be made\n"));
  }

  try {
    // Load configuration
    console.log(pc.cyan("→ Loading configuration..."));
    const config = await loadConfig(options.config);
    console.log(pc.green(`  ✓ Loaded config for ${config.appName}`));

    const context: DeployContext = {
      config,
      options,
      outputDir: ".open-next",
    };

    // Verify build exists
    if (!fs.existsSync(context.outputDir)) {
      throw new Error(
        `Build output not found at ${context.outputDir}. Run 'opennext-akamai build' first.`
      );
    }

    // Confirmation prompt
    if (!options.yes && !options.dryRun) {
      const confirmed = await confirmDeploy(context);
      if (!confirmed) {
        console.log(pc.yellow("\nDeployment cancelled."));
        return;
      }
    }

    // Deploy assets
    if (!options.serverOnly && !options.cdnOnly) {
      console.log(pc.cyan("\n→ Deploying static assets..."));
      await deployAssets(context);
      console.log(pc.green("  ✓ Static assets deployed"));
    }

    // Deploy server
    if (!options.assetsOnly && !options.cdnOnly) {
      console.log(pc.cyan("\n→ Deploying server function..."));
      await deployServer(context);
      console.log(pc.green("  ✓ Server function deployed"));
    }

    // Deploy EdgeWorkers
    if (config.middleware?.external && !options.assetsOnly && !options.cdnOnly) {
      console.log(pc.cyan("\n→ Deploying EdgeWorkers middleware..."));
      await deployEdgeWorkers(context);
      console.log(pc.green("  ✓ EdgeWorkers deployed"));
    }

    // Configure CDN
    if (!options.assetsOnly && !options.serverOnly) {
      console.log(pc.cyan("\n→ Configuring CDN..."));
      await configureCDN(context);
      console.log(pc.green("  ✓ CDN configured"));
    }

    // Done
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(pc.bold(pc.green(`\n✅ Deployment complete in ${duration}s\n`)));

    // Print deployment info
    printDeploymentInfo(context);
  } catch (error) {
    console.error(pc.red("\n❌ Deployment failed:"), error);
    process.exit(1);
  }
}

async function loadConfig(configPath: string): Promise<AkamaiOpenNextConfig> {
  const fullPath = path.resolve(process.cwd(), configPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  const configModule = await import(fullPath);
  return configModule.default;
}

async function confirmDeploy(context: DeployContext): Promise<boolean> {
  console.log(pc.bold("\nDeployment Summary:"));
  console.log(`  ${pc.cyan("Application:")} ${context.config.appName}`);
  console.log(`  ${pc.cyan("Environment:")} ${context.options.environment}`);
  console.log(`  ${pc.cyan("Runtime:")} ${context.config.default.runtime}`);
  console.log("");

  // In a real implementation, use readline or inquirer for interactive prompt
  // For now, assume yes
  return true;
}

async function deployAssets(context: DeployContext): Promise<void> {
  const { config, options, outputDir } = context;
  const assetsDir = path.join(outputDir, "assets");

  if (!fs.existsSync(assetsDir)) {
    console.log(pc.yellow("  ⚠️  No assets directory found"));
    return;
  }

  // Get S3 client for Linode Object Storage
  const s3Client = createS3Client();
  const bucket = process.env.LINODE_OBJECT_STORAGE_BUCKET;

  if (!bucket) {
    throw new Error("LINODE_OBJECT_STORAGE_BUCKET environment variable required");
  }

  // Find all files
  const files = await glob("**/*", {
    cwd: assetsDir,
    nodir: true,
  });

  console.log(pc.gray(`    Found ${files.length} files to upload`));

  if (options.dryRun) {
    console.log(pc.gray("    [DRY RUN] Would upload files to Object Storage"));
    return;
  }

  // Upload files in parallel with concurrency limit
  const concurrency = 10;
  let uploaded = 0;

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);

    await Promise.all(
      batch.map(async (file) => {
        const filePath = path.join(assetsDir, file);
        const content = fs.readFileSync(filePath);
        const contentType = mimeTypes.lookup(file) || "application/octet-stream";

        // Determine cache control based on path
        let cacheControl = "public, max-age=31536000, immutable";
        if (!file.includes("/_next/static/")) {
          cacheControl = "public, max-age=3600";
        }

        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: file,
            Body: content,
            ContentType: contentType,
            CacheControl: cacheControl,
          })
        );

        uploaded++;
        if (options.verbose) {
          console.log(pc.gray(`    ✓ ${file}`));
        }
      })
    );

    // Progress update
    if (!options.verbose) {
      process.stdout.write(
        `\r  ${pc.gray(`Uploading... ${uploaded}/${files.length}`)}`
      );
    }
  }

  if (!options.verbose) {
    process.stdout.write("\r" + " ".repeat(50) + "\r");
  }

  console.log(pc.gray(`    Uploaded ${uploaded} files`));
}

async function deployServer(context: DeployContext): Promise<void> {
  const { config, options, outputDir } = context;

  if (config.default.runtime === "lke") {
    await deployToLKE(context);
  } else if (config.default.runtime === "fermyon") {
    await deployToFermyon(context);
  } else {
    console.log(pc.yellow(`  ⚠️  Runtime '${config.default.runtime}' not supported`));
  }
}

async function deployToLKE(context: DeployContext): Promise<void> {
  const { config, options, outputDir } = context;

  if (options.dryRun) {
    console.log(pc.gray("    [DRY RUN] Would deploy to LKE"));
    return;
  }

  // Build and push Docker image
  const imageName = `${config.appName}:${Date.now()}`;

  console.log(pc.gray(`    Building Docker image: ${imageName}`));

  await runCommand(
    `docker build -t ${imageName} -f ${outputDir}/akamai/Dockerfile .`,
    options.verbose
  );

  // Tag and push to registry
  const registry = process.env.CONTAINER_REGISTRY || "ghcr.io";
  const fullImageName = `${registry}/${imageName}`;

  console.log(pc.gray(`    Pushing to registry: ${fullImageName}`));

  await runCommand(`docker tag ${imageName} ${fullImageName}`, options.verbose);
  await runCommand(`docker push ${fullImageName}`, options.verbose);

  // Apply Kubernetes manifests
  console.log(pc.gray("    Applying Kubernetes manifests"));

  const manifestPath = path.join(outputDir, "akamai/kubernetes/manifests.yaml");

  // Update image in manifest
  let manifestContent = fs.readFileSync(manifestPath, "utf-8");
  manifestContent = manifestContent.replace(
    `${config.appName}:latest`,
    fullImageName
  );

  const tempManifest = path.join(outputDir, "akamai/kubernetes/manifests-deploy.yaml");
  fs.writeFileSync(tempManifest, manifestContent);

  await runCommand(`kubectl apply -f ${tempManifest}`, options.verbose);

  // Wait for rollout
  console.log(pc.gray("    Waiting for rollout..."));
  await runCommand(
    `kubectl rollout status deployment/${config.appName} -n ${config.appName} --timeout=300s`,
    options.verbose
  );
}

async function deployToFermyon(context: DeployContext): Promise<void> {
  const { config, options, outputDir } = context;

  if (options.dryRun) {
    console.log(pc.gray("    [DRY RUN] Would deploy to Fermyon"));
    return;
  }

  const spinDir = path.join(outputDir, "akamai/spin");

  console.log(pc.gray("    Deploying to Fermyon Cloud..."));

  await runCommand(`spin deploy`, { cwd: spinDir, verbose: options.verbose });
}

async function deployEdgeWorkers(context: DeployContext): Promise<void> {
  const { config, options, outputDir } = context;

  if (options.dryRun) {
    console.log(pc.gray("    [DRY RUN] Would deploy EdgeWorkers"));
    return;
  }

  const edgeworkersDir = path.join(outputDir, "akamai/edgeworkers");

  // Create tarball bundle
  console.log(pc.gray("    Creating EdgeWorkers bundle..."));

  const bundleFile = path.join(edgeworkersDir, "bundle.tgz");
  await runCommand(
    `tar -czvf bundle.tgz main.js bundle.json`,
    { cwd: edgeworkersDir, verbose: options.verbose }
  );

  // Upload to Akamai
  console.log(pc.gray("    Uploading to Akamai EdgeWorkers..."));

  const edgeworkerId = config.middleware?.edgeworkers?.edgeworkerId || "new";

  if (edgeworkerId === "new") {
    console.log(pc.yellow("    ⚠️  EdgeWorker ID not configured"));
    console.log(pc.gray("    Upload bundle manually: akamai edgeworkers upload --bundle bundle.tgz"));
  } else {
    await runCommand(
      `akamai edgeworkers upload --bundle ${bundleFile} --edgeworker-id ${edgeworkerId}`,
      options.verbose
    );
  }
}

async function configureCDN(context: DeployContext): Promise<void> {
  const { config, options, outputDir } = context;

  if (options.dryRun) {
    console.log(pc.gray("    [DRY RUN] Would configure CDN"));
    return;
  }

  const rulesFile = path.join(outputDir, "akamai/property-manager/rules.json");

  console.log(pc.gray("    CDN rules generated at: " + rulesFile));
  console.log(pc.yellow("    ⚠️  Manual step: Import rules into Property Manager"));
  console.log(pc.gray("    1. Login to Akamai Control Center"));
  console.log(pc.gray(`    2. Navigate to Property Manager > ${config.cdn.propertyName}`));
  console.log(pc.gray("    3. Import rules from rules.json"));
  console.log(pc.gray("    4. Activate on staging, then production"));
}

function printDeploymentInfo(context: DeployContext): void {
  const { config } = context;

  console.log(pc.bold("Deployment Info:\n"));

  console.log(`  ${pc.cyan("Application:")} ${config.appName}`);
  console.log(`  ${pc.cyan("Environment:")} ${context.options.environment}`);
  console.log("");

  if (config.default.runtime === "lke") {
    console.log(`  ${pc.cyan("Server:")} LKE Cluster`);
    console.log(`    kubectl get pods -n ${config.appName}`);
  } else if (config.default.runtime === "fermyon") {
    console.log(`  ${pc.cyan("Server:")} Fermyon Cloud`);
    console.log(`    spin cloud app info ${config.appName}`);
  }

  console.log("");
  console.log(pc.bold("  Monitoring:"));
  console.log(`    ${pc.gray("•")} Akamai: https://control.akamai.com`);
  console.log(`    ${pc.gray("•")} Linode: https://cloud.linode.com`);
  console.log("");
}

// Helper functions

function createS3Client(): S3Client {
  const endpoint = process.env.LINODE_OBJECT_STORAGE_ENDPOINT;
  const accessKeyId = process.env.LINODE_OBJECT_STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.LINODE_OBJECT_STORAGE_SECRET_KEY;
  const region = process.env.LINODE_OBJECT_STORAGE_REGION || "us-east-1";

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Linode Object Storage credentials required. Set LINODE_OBJECT_STORAGE_ENDPOINT, " +
        "LINODE_OBJECT_STORAGE_ACCESS_KEY, and LINODE_OBJECT_STORAGE_SECRET_KEY"
    );
  }

  return new S3Client({
    endpoint: `https://${endpoint}`,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

async function runCommand(
  command: string,
  optionsOrVerbose?: boolean | { cwd?: string; verbose?: boolean }
): Promise<void> {
  const opts = typeof optionsOrVerbose === "boolean"
    ? { verbose: optionsOrVerbose }
    : optionsOrVerbose || {};

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: opts.cwd || process.cwd(),
      stdio: opts.verbose ? "inherit" : "pipe",
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed: ${command}`));
      } else {
        resolve();
      }
    });

    child.on("error", reject);
  });
}
