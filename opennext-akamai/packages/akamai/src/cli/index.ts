#!/usr/bin/env node
/**
 * OpenNext Akamai CLI
 *
 * Commands:
 * - build: Build Next.js app for Akamai deployment
 * - deploy: Deploy to Akamai ecosystem
 * - analyze: Analyze Next.js app for compatibility
 */

import { Command } from "commander";
import pc from "picocolors";
import { buildCommand } from "./commands/build.js";
import { deployCommand } from "./commands/deploy.js";
import { analyzeCommand } from "./commands/analyze.js";

const program = new Command();

program
  .name("opennext-akamai")
  .description("OpenNext adapter for Akamai ecosystem")
  .version("0.1.0");

// Build command
program
  .command("build")
  .description("Build Next.js application for Akamai deployment")
  .option("-c, --config <path>", "Path to open-next.config.ts", "open-next.config.ts")
  .option("-o, --output <path>", "Output directory", ".open-next")
  .option("--skip-build", "Skip Next.js build step")
  .option("-v, --verbose", "Verbose output")
  .action(buildCommand);

// Deploy command
program
  .command("deploy")
  .description("Deploy to Akamai ecosystem")
  .option("-c, --config <path>", "Path to open-next.config.ts", "open-next.config.ts")
  .option("-e, --environment <env>", "Target environment", "production")
  .option("--assets-only", "Deploy only static assets")
  .option("--server-only", "Deploy only server function")
  .option("--cdn-only", "Deploy only CDN configuration")
  .option("--dry-run", "Show what would be deployed without deploying")
  .option("-y, --yes", "Skip confirmation prompts")
  .option("-v, --verbose", "Verbose output")
  .action(deployCommand);

// Analyze command
program
  .command("analyze")
  .description("Analyze Next.js application for Akamai compatibility")
  .option("-d, --directory <path>", "Path to Next.js project", ".")
  .option("--json", "Output as JSON")
  .action(analyzeCommand);

// Parse arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  console.log(`
${pc.bold(pc.cyan("OpenNext Akamai Adapter"))}

Deploy Next.js applications to the Akamai ecosystem:
  • ${pc.green("Akamai CDN")} - Global edge caching
  • ${pc.green("EdgeWorkers")} - Edge middleware execution
  • ${pc.green("LKE")} - Kubernetes-based server functions
  • ${pc.green("Fermyon Spin")} - WebAssembly serverless

${pc.bold("Quick Start:")}

  1. Add configuration:
     ${pc.gray("$ npx opennext-akamai init")}

  2. Build your app:
     ${pc.gray("$ npx opennext-akamai build")}

  3. Deploy to Akamai:
     ${pc.gray("$ npx opennext-akamai deploy")}

${pc.bold("Commands:")}

  ${pc.cyan("build")}     Build Next.js for Akamai deployment
  ${pc.cyan("deploy")}    Deploy to Akamai ecosystem
  ${pc.cyan("analyze")}   Analyze app for compatibility

Run ${pc.cyan("opennext-akamai <command> --help")} for command options.
`);
}
