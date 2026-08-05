import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { parse } from "yaml";
import { ConfigError } from "../errors.ts";

/**
 * Collision-safe default: `.localhost` is reserved for loopback (RFC 6761),
 * unlike bare `.local`, which macOS mDNS already owns.
 */
export const DEFAULT_ALIAS_SUFFIX = "ppfw.localhost";

export interface GlobalConfig {
  workspace: string;
  defaultRemote: string | null;
  aliasSuffix: string;
}

export interface LoadGlobalConfigOptions {
  configDir?: string;
  cwd?: string;
  homeDir?: string;
}

export function globalConfigDir(
  env: Record<string, string | undefined>,
  homeDir: string,
): string {
  const base = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME !== ""
    ? env.XDG_CONFIG_HOME
    : join(homeDir, ".config");
  return join(base, "ppfw");
}

export function loadGlobalConfig(options: LoadGlobalConfigOptions = {}): GlobalConfig {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();
  const dir = options.configDir ?? globalConfigDir(process.env, homeDir);
  const file = join(dir, "config.yaml");
  const config = defaults(cwd);

  if (!existsSync(file)) {
    return config;
  }

  const raw = readFileSync(file, "utf8");
  let doc: unknown;
  try {
    doc = parse(raw);
  } catch (cause) {
    throw new ConfigError(`invalid YAML in ${file}: ${messageOf(cause)}`);
  }
  if (doc === null || doc === undefined) {
    return config;
  }
  if (typeof doc !== "object" || Array.isArray(doc)) {
    throw new ConfigError(`${file}: expected a mapping of settings`);
  }

  const map = doc as Record<string, unknown>;
  if ("workspace" in map) {
    config.workspace = expandPath(stringSetting(file, "workspace", map.workspace), homeDir, cwd);
  }
  if ("default_remote" in map) {
    config.defaultRemote = stringSetting(file, "default_remote", map.default_remote);
  }
  if ("alias_suffix" in map) {
    config.aliasSuffix = stringSetting(file, "alias_suffix", map.alias_suffix);
  }
  return config;
}

function defaults(cwd: string): GlobalConfig {
  return { workspace: cwd, defaultRemote: null, aliasSuffix: DEFAULT_ALIAS_SUFFIX };
}

function stringSetting(file: string, key: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`${file}: \`${key}\` must be a non-empty string`);
  }
  return value;
}

function expandPath(value: string, homeDir: string, cwd: string): string {
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return join(homeDir, value.slice(2));
  return isAbsolute(value) ? value : resolve(cwd, value);
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
