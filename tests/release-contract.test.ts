import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

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

type WorkflowStep = {
  name?: string;
  uses?: string;
  with?: Record<string, string>;
  run?: string;
};

function loadWorkflowSteps(): WorkflowStep[] {
  const doc = parse(readText(".github/workflows/release.yml")) as {
    jobs?: { build?: { steps?: WorkflowStep[] }; release?: { steps?: WorkflowStep[] } };
  };
  return [
    ...(doc.jobs?.build?.steps ?? []),
    ...(doc.jobs?.release?.steps ?? []),
  ];
}

function loadMatrix(): Array<{ asset: string; runner: string }> {
  const doc = parse(readText(".github/workflows/release.yml")) as {
    jobs?: {
      build?: { strategy?: { matrix?: { include?: Array<{ asset: string; runner: string }> } } };
    };
  };
  const include = doc.jobs?.build?.strategy?.matrix?.include;
  expect(include).toBeDefined();
  return include ?? [];
}

function stepByName(steps: WorkflowStep[], name: string): WorkflowStep {
  const step = steps.find((s) => s.name === name);
  expect(step, `workflow step "${name}" exists`).toBeDefined();
  return step ?? {};
}

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
  const result = spawnSync("sh", [INSTALL, ...args], {
    env: {
      ...process.env,
      ...extraEnv,
      PATH: `${dir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    },
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function unameProbes(t: Target): Array<[string, string]> {
  const s = t.os === "darwin" ? "Darwin" : "Linux";
  const m = t.arch === "arm64"
    ? (t.os === "darwin" ? ["arm64"] : ["aarch64", "arm64"])
    : ["x86_64"];
  return m.map((arch) => [s, arch] as [string, string]);
}

describe("release artifact contract", () => {
  test("target matrix covers exactly the four supported platforms", () => {
    const { checksumFile, installScript, targets } = loadTargets();
    expect(checksumFile).toBe("SHA256SUMS.txt");
    expect(installScript).toBe("install.sh");
    expect(targets.map((t) => `${t.os}/${t.arch}`).sort()).toEqual([
      "darwin/arm64",
      "darwin/x64",
      "linux/arm64",
      "linux/x64",
    ]);
    for (const t of targets) {
      expect(t.asset).toBe(`ppfw-${t.os}-${t.arch}`);
    }
    const runners = targets.map((t) => t.runner);
    expect(new Set(runners).size).toBe(targets.length);
    for (const runner of runners) {
      expect(runner.length).toBeGreaterThan(0);
    }
  });

  test("release workflow matrix matches the contract pin exactly", () => {
    const { targets } = loadTargets();
    expect(loadMatrix()).toEqual(
      targets.map(({ asset, runner }) => ({ asset, runner })),
    );
  });

  test("release workflow builds natively with a pinned toolchain", () => {
    const steps = loadWorkflowSteps();
    const setupBun = steps.find((s) => s.uses?.includes("oven-sh/setup-bun"));
    expect(setupBun, "release workflow pins oven-sh/setup-bun").toBeDefined();
    const pinned = setupBun?.with?.["bun-version"] ?? "";
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pinned).toBe(readText(".bun-version").trim());
    const workflow = readText(".github/workflows/release.yml");
    expect(workflow).toContain("bun build --compile");
    expect(workflow).toContain("matrix.asset");
  });

  test("release job derives checksums and uploads from the contract, not a hardcoded list", () => {
    const steps = loadWorkflowSteps();
    const checksumStep = stepByName(steps, "Generate SHA256SUMS.txt");
    expect(checksumStep.run ?? "").toContain("scripts/release-targets.json");
    expect(checksumStep.run ?? "").toContain("sha256sum");
    expect(checksumStep.run ?? "").toContain("SHA256SUMS.txt");
    for (const asset of loadTargets().targets.map((t) => t.asset)) {
      expect(checksumStep.run ?? "").not.toContain(asset);
    }
    const uploadStep = stepByName(steps, "Create GitHub Release");
    // Glob upload: a matrix asset cannot silently drop out of the release, and no orphan can sneak in.
    expect(uploadStep.run ?? "").toContain("dist/ppfw-*");
    expect(uploadStep.run ?? "").toContain("SHA256SUMS.txt");
    expect(uploadStep.run ?? "").toContain("install.sh");
    for (const asset of loadTargets().targets.map((t) => t.asset)) {
      expect(uploadStep.run ?? "").not.toContain(`dist/${asset}`);
    }
    expect(uploadStep.run ?? "").toContain("*-*)");
    expect(uploadStep.run ?? "").toContain("--prerelease");
  });

  test("release contract doc tracks the matrix pairings", () => {
    const doc = readText("docs/release-contract.md");
    const { targets } = loadTargets();
    const lines = doc.split("\n");
    for (const t of targets) {
      // Same-line pairing: catches swapped asset<->runner rows that independent substring checks would miss.
      const paired = lines.some(
        (line) => line.includes(t.asset) && line.includes(t.runner),
      );
      expect(paired, `doc pairs ${t.asset} with ${t.runner}`).toBe(true);
    }
    expect(doc).toContain("SHA256SUMS.txt");
    expect(doc).toContain("install.sh");
    expect(doc).toContain("releases/latest");
    expect(doc).toContain("prerelease");
  });

  test("install.sh maps each contract target to its asset", () => {
    const { targets } = loadTargets();
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      for (const [s, m] of unameProbes(t)) {
        const result = runInstall(s, m, ["--print-target"]);
        expect(`${s}/${m}: status ${result.status} stderr ${result.stderr}`).toBe(
          `${s}/${m}: status 0 stderr `,
        );
        expect(result.stdout.trim()).toBe(t.asset);
      }
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
