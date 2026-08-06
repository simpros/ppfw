import type { AppConfig } from "./config/app.ts";
import { discoverApps } from "./discover.ts";
import type { FileSystem } from "./filesystem.ts";
import { validateRemotes } from "./remotes.ts";

export interface WorkspaceOptions {
  workspaceRoot: string;
  aliasSuffix: string;
  defaultRemote: string | null;
  fileSystem?: FileSystem;
  sshConfigPath?: string;
  homeDir?: string;
}

/**
 * The workspace as ppfw sees it: one `scan()` re-reads every `.ppfw.config`
 * and fails fast (ConfigError) on an invalid config or an unresolved remote.
 */
export class Workspace {
  private readonly options: WorkspaceOptions;

  constructor(options: WorkspaceOptions) {
    this.options = options;
  }

  get root(): string {
    return this.options.workspaceRoot;
  }

  scan(): AppConfig[] {
    const apps = discoverApps(this.options.workspaceRoot, {
      aliasSuffix: this.options.aliasSuffix,
      fileSystem: this.options.fileSystem,
    });
    validateRemotes({
      apps,
      defaultRemote: this.options.defaultRemote,
      sshConfigPath: this.options.sshConfigPath,
      homeDir: this.options.homeDir,
    });
    return apps;
  }
}
