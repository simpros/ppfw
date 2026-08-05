#!/usr/bin/env bun
import { isAbsolute, resolve } from "node:path";
import { parseArgs, USAGE } from "./cli.ts";
import { loadGlobalConfig } from "./config/global.ts";
import { discoverApps } from "./discover.ts";
import { ConfigError, UsageError } from "./errors.ts";
import { runTui } from "./tui/app.ts";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const global = loadGlobalConfig();
  const workspace = args.workspace
    ? isAbsolute(args.workspace)
      ? args.workspace
      : resolve(process.cwd(), args.workspace)
    : global.workspace;
  const defaultRemote = args.remote ?? global.defaultRemote;

  const apps = discoverApps(workspace, { aliasSuffix: global.aliasSuffix });
  await runTui({ workspace, apps, defaultRemote });
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError || error instanceof UsageError) {
    console.error(`ppfw: ${error.message}`);
    process.exit(1);
  }
  throw error;
});
