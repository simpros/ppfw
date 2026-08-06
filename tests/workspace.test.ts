import { beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "../src/errors.ts";
import { Workspace } from "../src/workspace.ts";

let ws: string;
let sshConfigPath: string;

beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "ppfw-ws-"));
  sshConfigPath = join(await mkdtemp(join(tmpdir(), "ppfw-ssh-")), "config");
});

async function app(dir: string, yaml: string): Promise<void> {
  await mkdir(join(ws, dir), { recursive: true });
  await writeFile(join(ws, dir, ".ppfw.config"), yaml, "utf8");
}

function workspace(defaultRemote: string | null = null): Workspace {
  return new Workspace({
    workspaceRoot: ws,
    aliasSuffix: "local",
    defaultRemote,
    sshConfigPath,
  });
}

describe("Workspace", () => {
  test("exposes its root", () => {
    expect(workspace().root).toBe(ws);
  });

  test("scan discovers every app in the workspace", async () => {
    await app("kido", "ports:\n  frontend: 5173\n");
    await app("backend", "ports:\n  worker: 8080\n");
    const apps = workspace().scan();
    expect(apps.map((a) => a.name)).toEqual(["backend", "kido"]);
  });

  test("scan re-reads configs that changed on disk", async () => {
    await app("kido", "ports:\n  frontend: 5173\n");
    const scan = workspace();
    expect(scan.scan()[0]!.ports.map((p) => p.port)).toEqual([5173]);
    await app("kido", "ports:\n  frontend: 5174\n");
    expect(scan.scan()[0]!.ports.map((p) => p.port)).toEqual([5174]);
  });

  test("scan fails fast on an invalid app config", async () => {
    await app("broken", "ports: {}\n");
    expect(() => workspace().scan()).toThrow(ConfigError);
    expect(() => workspace().scan()).toThrow(/broken/);
  });

  test("scan fails fast on an unresolved remote", async () => {
    await writeFile(sshConfigPath, "Host other\n", "utf8");
    await app("kido", "remote: devbox-a\nports:\n  frontend: 5173\n");
    expect(() => workspace().scan()).toThrow(/devbox-a/);
  });

  test("scan passes when every remote resolves", async () => {
    await writeFile(sshConfigPath, "Host devbox-a\n", "utf8");
    await app("kido", "remote: devbox-a\nports:\n  frontend: 5173\n");
    expect(() => workspace().scan()).not.toThrow();
  });

  test("scan validates the default remote", async () => {
    await app("kido", "ports:\n  frontend: 5173\n");
    expect(() => workspace("devbox").scan()).toThrow(/devbox/);
  });
});
