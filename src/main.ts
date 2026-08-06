#!/usr/bin/env bun
import { homedir } from "node:os";
import { parseArgs, USAGE } from "./cli.ts";
import { loadGlobalConfig } from "./config/global.ts";
import { ConfigError, UsageError } from "./errors.ts";
import { expandPath } from "./paths.ts";
import { ForwardEngine } from "./forward.ts";
import { RootProxy, routesForApps } from "./proxy.ts";
import { createRuntime } from "./runtime.ts";
import { runTui } from "./tui/app.ts";
import { Workspace } from "./workspace.ts";

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

  const workspace = new Workspace({
    workspaceRoot,
    aliasSuffix: global.aliasSuffix,
    defaultRemote,
  });
  const apps = workspace.scan();
  const engine = new ForwardEngine({ apps, defaultRemote });
  const proxy = new RootProxy({ routes: routesForApps(apps) });
  const runtime = createRuntime({ engine, proxy, workspace, apps });
  try {
    await runtime.start();
    if (runtime.proxyStatus().phase !== "up") {
      console.error(
        `ppfw: root proxy failed to start — bare-hostname aliases will not resolve` +
          (runtime.proxyStatus().lastError
            ? `\n${runtime.proxyStatus().lastError}`
            : ""),
      );
    }
    await runTui({ workspaceRoot, defaultRemote, runtime });
  } finally {
    await runtime.stop();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError || error instanceof UsageError) {
    console.error(`ppfw: ${error.message}`);
    process.exit(1);
  }
  throw error;
});
