import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOSTS_BEGIN_MARKER, HOSTS_END_MARKER } from "../src/hosts.ts";

const children: Bun.Subprocess[] = [];

afterEach(async () => {
  for (const child of children) {
    child.kill();
    await child.exited.catch(() => -1);
  }
  children.length = 0;
});

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForFile(path: string, predicate: (text: string) => boolean): Promise<string> {
  const deadline = Date.now() + 1_000;
  for (;;) {
    const text = await readFile(path, "utf8").catch(() => "");
    if (predicate(text)) return text;
    if (Date.now() > deadline) throw new Error("timed out waiting for hosts file");
    await tick();
  }
}

function spawnRootProxy(hostsPath: string): Bun.Subprocess {
  const child = Bun.spawn([
    process.execPath,
    join(import.meta.dir, "../src/root-proxy.ts"),
    "--routes",
    '{"new.kido.local":5173}',
    "--port",
    "0",
    "--hosts-path",
    hostsPath,
  ], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
  children.push(child);
  return child;
}

describe("root proxy hosts lifecycle", () => {
  test("reconciles stale entries and removes the block on stdin close", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ppfw-root-proxy-"));
    const hostsPath = join(dir, "hosts");
    await writeFile(
      hostsPath,
      [
        "127.0.0.1 localhost",
        HOSTS_BEGIN_MARKER,
        "127.0.0.1 old.kido.local",
        HOSTS_END_MARKER,
        "192.168.1.10 devbox",
        "",
      ].join("\n"),
      "utf8",
    );

    const child = spawnRootProxy(hostsPath);
    const reconciled = await waitForFile(
      hostsPath,
      (text) => text.includes("127.0.0.1 new.kido.local"),
    );
    expect(reconciled).not.toContain("old.kido.local");
    expect(reconciled).toContain("192.168.1.10 devbox");

    if (child.stdin === undefined || typeof child.stdin === "number") {
      throw new Error("root proxy stdin is not writable");
    }
    child.stdin.end();
    expect(await child.exited).toBe(0);
    expect(await readFile(hostsPath, "utf8")).toBe(
      "127.0.0.1 localhost\n192.168.1.10 devbox\n",
    );
  });
});
