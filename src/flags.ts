import { UsageError } from "./errors.ts";

/** Value of `--flag <value>` in argv, or null if the flag is absent. */
export function argvOption(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  return value === undefined ? null : value;
}

/** Value of `--flag=value` or `--flag <next>`; throws UsageError when missing. */
export function parseRequiredFlag(arg: string, next: string | undefined): string {
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
