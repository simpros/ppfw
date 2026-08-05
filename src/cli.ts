import { UsageError } from "./errors.ts";

export interface CliOptions {
  workspace: string | null;
  remote: string | null;
  help: boolean;
}

export const USAGE = `usage: ppfw [--workspace <dir>] [--remote <alias>]

options:
  --workspace <dir>    directory to scan for .ppfw.config files (default: from
                       ~/.config/ppfw/config.yaml, else the current directory)
  --remote <alias>     default ~/.ssh/config host alias for apps that do not
                       override it
  -h, --help           show this help`;

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { workspace: null, remote: null, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--workspace" || arg.startsWith("--workspace=")) {
      options.workspace = flagValue(arg, argv[i + 1]);
      if (!arg.includes("=")) i++;
    } else if (arg === "--remote" || arg.startsWith("--remote=")) {
      options.remote = flagValue(arg, argv[i + 1]);
      if (!arg.includes("=")) i++;
    } else {
      throw new UsageError(`unknown argument: ${arg}\n\n${USAGE}`);
    }
  }

  return options;
}

function flagValue(arg: string, next: string | undefined): string {
  if (arg.includes("=")) {
    const value = arg.slice(arg.indexOf("=") + 1);
    if (value === "") throw new UsageError(`${arg.split("=")[0]} needs a value`);
    return value;
  }
  if (next === undefined || next.startsWith("--")) {
    throw new UsageError(`${arg} needs a value`);
  }
  return next;
}
