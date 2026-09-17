import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Shared temp-filesystem helpers for tests that touch real files. */

export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Write a `.ppfw.config` for one app inside a temp workspace root. */
export async function writeAppConfig(
  workspaceRoot: string,
  dir: string,
  yaml: string,
): Promise<void> {
  await mkdir(join(workspaceRoot, dir), { recursive: true });
  await writeFile(join(workspaceRoot, dir, ".ppfw.config"), yaml, "utf8");
}
