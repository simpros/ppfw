import { join } from "node:path";
import { parseAppConfig, type AppConfig } from "./config/app.ts";
import { ConfigError, messageOf } from "./errors.ts";
import { nodeFileSystem, type FileSystem } from "./filesystem.ts";

export const DEFAULT_MAX_DEPTH = 3;
const APP_CONFIG_FILE = ".ppfw.config";
const SKIPPED_DIRS = new Set(["node_modules"]);

export interface DiscoverOptions {
  aliasSuffix: string;
  maxDepth?: number;
  fileSystem?: FileSystem;
}

export function discoverApps(
  workspaceRoot: string,
  options: DiscoverOptions,
): AppConfig[] {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  if (!fileSystem.exists(workspaceRoot)) {
    throw new ConfigError(`workspace root ${workspaceRoot} does not exist`);
  }
  if (!fileSystem.isDirectory(workspaceRoot)) {
    throw new ConfigError(`workspace root ${workspaceRoot} is not a directory`);
  }

  const apps: AppConfig[] = [];
  scan(
    workspaceRoot,
    0,
    options.maxDepth ?? DEFAULT_MAX_DEPTH,
    options.aliasSuffix,
    fileSystem,
    apps,
  );
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
  fileSystem: FileSystem,
  apps: AppConfig[],
): void {
  let entries;
  try {
    entries = fileSystem.readDirectory(dir);
  } catch (cause) {
    throw new ConfigError(`cannot read ${dir}: ${messageOf(cause)}`);
  }

  if (entries.some((e) => e.isFile() && e.name === APP_CONFIG_FILE)) {
    apps.push(
      parseAppConfig(fileSystem.readFile(join(dir, APP_CONFIG_FILE)), {
        dir,
        aliasSuffix,
      }),
    );
  }

  if (depth >= maxDepth) return;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) continue;
    scan(join(dir, entry.name), depth + 1, maxDepth, aliasSuffix, fileSystem, apps);
  }
}
