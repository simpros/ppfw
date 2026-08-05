#!/usr/bin/env bun
import { homedir } from "node:os";
import { parseArgs, USAGE } from "./cli.ts";
import { loadGlobalConfig } from "./config/global.ts";
import { discoverApps } from "./discover.ts";
import { ConfigError, UsageError } from "./errors.ts";
import { expandPath } from "./paths.ts";
import { runTui } from "./tui/app.ts";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const global = loadGlobalConfig();
  const workspaceRoot = args.workspaceRoot
    ? expandPath(args.workspaceRoot, homedir(), process.cwd())
    : global.workspaceRoot;
  const defaultRemote = args.remote ?? global.defaultRemote;

  const apps = discoverApps(workspaceRoot, { aliasSuffix: global.aliasSuffix });
  await runTui({ workspaceRoot, apps, defaultRemote });
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError || error instanceof UsageError) {
    console.error(`ppfw: ${error.message}`);
    process.exit(1);
  }
  throw error;
});
