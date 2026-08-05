import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseAppConfig, type AppConfig } from "./config/app.ts";
import { ConfigError } from "./errors.ts";

export const DEFAULT_MAX_DEPTH = 3;
const APP_CONFIG_FILE = ".ppfw.config";
const SKIPPED_DIRS = new Set(["node_modules"]);

export interface DiscoverOptions {
  aliasSuffix: string;
  maxDepth?: number;
}

export function discoverApps(
  workspace: string,
  options: DiscoverOptions,
): AppConfig[] {
  if (!existsSync(workspace)) {
    throw new ConfigError(`workspace ${workspace} does not exist`);
  }
  if (!statSync(workspace).isDirectory()) {
    throw new ConfigError(`workspace ${workspace} is not a directory`);
  }

  const apps: AppConfig[] = [];
  scan(workspace, 0, options.maxDepth ?? DEFAULT_MAX_DEPTH, options.aliasSuffix, apps);
  apps.sort(
    (a, b) => a.name.localeCompare(b.name) || a.dir.localeCompare(b.dir),
  );
  return apps;
}

function scan(
  dir: string,
  depth: number,
  maxDepth: number,
  aliasSuffix: string,
  apps: AppConfig[],
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (cause) {
    throw new ConfigError(`cannot read ${dir}: ${messageOf(cause)}`);
  }

  if (entries.some((e) => e.isFile() && e.name === APP_CONFIG_FILE)) {
    apps.push(
      parseAppConfig(readFileSync(join(dir, APP_CONFIG_FILE), "utf8"), {
        dir,
        aliasSuffix,
      }),
    );
  }

  if (depth >= maxDepth) return;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) continue;
    scan(join(dir, entry.name), depth + 1, maxDepth, aliasSuffix, apps);
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
