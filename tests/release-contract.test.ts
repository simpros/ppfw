import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const INSTALL = join(ROOT, "install.sh");

type Target = { os: string; arch: string; asset: string; runner: string };

function loadTargets(): {
  checksumFile: string;
  installScript: string;
  targets: Target[];
} {
  return JSON.parse(
    readFileSync(join(ROOT, "scripts", "release-targets.json"), "utf8"),
  );
}

function readText(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Run install.sh with a stubbed `uname` returning the given -s/-m values. */
function runInstall(
  unameS: string,
  unameM: string,
  args: string[] = [],
  extraEnv: Record<string, string> = {},
): { status: number; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "ppfw-uname-"));
  writeFileSync(
    join(dir, "uname"),
    `#!/bin/sh\nif [ "$1" = "-m" ]; then echo "${unameM}"; else echo "${unameS}"; fi\n`,
    { mode: 0o755 },
  );
  chmodSync(join(dir, "uname"), 0o755);
  try {
    const stdout = execFileSync("sh", [INSTALL, ...args], {
      env: {
        ...process.env,
        ...extraEnv,
        PATH: `${dir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    } as never) as unknown as string;
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

describe("release artifact contract", () => {
  test("target matrix covers exactly the four supported local machines", () => {
    const { checksumFile, installScript, targets } = loadTargets();
    expect(checksumFile).toBe("SHA256SUMS.txt");
    expect(installScript).toBe("install.sh");
    expect(targets).toEqual([
      {
        os: "darwin",
        arch: "arm64",
        asset: "ppfw-darwin-arm64",
        runner: "macos-15",
      },
      {
        os: "darwin",
        arch: "x64",
        asset: "ppfw-darwin-x64",
        runner: "macos-15-intel",
      },
      {
        os: "linux",
        arch: "x64",
        asset: "ppfw-linux-x64",
        runner: "ubuntu-24.04",
      },
      {
        os: "linux",
        arch: "arm64",
        asset: "ppfw-linux-arm64",
        runner: "ubuntu-24.04-arm",
      },
    ]);
  });

  test("release workflow builds every target natively and publishes the contract assets", () => {
    const workflow = readText(".github/workflows/release.yml");
    const { targets } = loadTargets();
    for (const t of targets) {
      expect(workflow).toContain(t.asset);
      expect(workflow).toContain(t.runner);
    }
    expect(workflow).toContain("bun build --compile");
    expect(workflow).toContain("SHA256SUMS.txt");
    expect(workflow).toContain("sha256sum");
    // Canonical install script ships as a release asset from the tagged commit.
    expect(workflow).toContain("install.sh");
    // Hyphenated tags (vX.Y.Z-label) publish as prereleases.
    expect(workflow).toContain("--prerelease");
    expect(workflow).toContain("oven-sh/setup-bun");
  });

  test("release contract doc names the assets, checksums, and prerelease rule", () => {
    const doc = readText("docs/release-contract.md");
    const { targets } = loadTargets();
    for (const t of targets) {
      expect(doc).toContain(t.asset);
    }
    expect(doc).toContain("SHA256SUMS.txt");
    expect(doc).toContain("install.sh");
    expect(doc).toContain("releases/latest");
    expect(doc).toContain("prerelease");
  });

  test("install.sh maps each supported uname pair to its asset", () => {
    const cases: Array<[string, string, string]> = [
      ["Darwin", "arm64", "ppfw-darwin-arm64"],
      ["Darwin", "x86_64", "ppfw-darwin-x64"],
      ["Linux", "x86_64", "ppfw-linux-x64"],
      ["Linux", "aarch64", "ppfw-linux-arm64"],
      ["Linux", "arm64", "ppfw-linux-arm64"],
    ];
    for (const [s, m, asset] of cases) {
      const result = runInstall(s, m, ["--print-target"]);
      expect(`${s}/${m}: status ${result.status} stderr ${result.stderr}`).toBe(
        `${s}/${m}: status 0 stderr `,
      );
      expect(result.stdout.trim()).toBe(asset);
    }
  });

  test("install.sh rejects unsupported machines", () => {
    expect(runInstall("FreeBSD", "x86_64", ["--print-target"]).status).not.toBe(
      0,
    );
    expect(runInstall("Linux", "riscv64", ["--print-target"]).status).not.toBe(
      0,
    );
  });

  test("install.sh distinguishes stable, prerelease, and explicit-version channels", () => {
    const stable = runInstall("Linux", "x86_64", []);
    expect(stable.stdout).toContain("channel stable");

    const prerelease = runInstall("Linux", "x86_64", ["--prerelease"]);
    expect(prerelease.stdout).toContain("channel prerelease");

    const pinned = runInstall("Linux", "x86_64", ["--version", "v0.2.0-rc.1"]);
    expect(pinned.stdout).toContain("channel version:v0.2.0-rc.1");
  });
});
