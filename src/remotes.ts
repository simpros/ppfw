import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { AppConfig } from "./config/app.ts";
import { ConfigError, messageOf } from "./errors.ts";
import { expandPath } from "./paths.ts";
import { hasAlias, parseSshConfig, type SshConfig } from "./ssh/config.ts";

export interface ValidateRemotesOptions {
  apps: AppConfig[];
  defaultRemote: string | null;
  sshConfigPath?: string;
  homeDir?: string;
}

/**
 * Every remote this session may forward through: the default remote plus
 * each app's `remote:` override. Maps alias -> what references it.
 */
export function referencedRemotes(
  apps: AppConfig[],
  defaultRemote: string | null,
): Map<string, string> {
  const remotes = new Map<string, string>();
  if (defaultRemote !== null && defaultRemote !== "") {
    remotes.set(defaultRemote, "default remote");
  }
  for (const app of apps) {
    if (app.remote !== null && app.remote !== "") {
      remotes.set(app.remote, `${app.dir}/.ppfw.config`);
    }
  }
  return remotes;
}

/**
 * Fail-fast check that every referenced remote is a defined `~/.ssh/config`
 * host alias, naming each alias that is missing.
 */
export function validateRemotes(options: ValidateRemotesOptions): void {
  const homeDir = options.homeDir ?? homedir();
  const sshConfigPath =
    options.sshConfigPath ?? expandPath("~/.ssh/config", homeDir, process.cwd());
  const config = readSshConfig(sshConfigPath);

  const missing: string[] = [];
  for (const [alias, referrer] of referencedRemotes(options.apps, options.defaultRemote)) {
    if (!hasAlias(config, alias)) {
      missing.push(`remote alias \`${alias}\` (${referrer}) not found in ${sshConfigPath}`);
    }
  }

  if (missing.length > 0) {
    throw new ConfigError(missing.join("; "));
  }
}

function readSshConfig(path: string): SshConfig {
  if (!existsSync(path)) return { patterns: [] };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    throw new ConfigError(`cannot read ${path}: ${messageOf(cause)}`);
  }
  return parseSshConfig(text);
}
