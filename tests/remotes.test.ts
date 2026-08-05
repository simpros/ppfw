import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../src/config/app.ts";
import { ConfigError } from "../src/errors.ts";
import { referencedRemotes, validateRemotes } from "../src/remotes.ts";

const kido: AppConfig = {
  name: "kido",
  dir: "/ws/kido",
  remote: "devbox-a",
  ports: [{ name: "frontend", port: 5173, forward: true, alias: "frontend.kido.local" }],
};

const backend: AppConfig = {
  name: "backend",
  dir: "/ws/backend",
  remote: null,
  ports: [{ name: "worker", port: 8080, forward: true, alias: null }],
};

const api: AppConfig = {
  name: "api",
  dir: "/ws/api",
  remote: "devbox-b",
  ports: [{ name: "svc", port: 9001, forward: true, alias: null }],
};

const standalone: AppConfig = {
  name: "localtools",
  dir: "/ws/localtools",
  remote: "devbox-c",
  ports: [{ name: "ui", port: 9000, forward: false, alias: "ui.localtools.local" }],
};

let sshConfigPath: string;

beforeEach(async () => {
  sshConfigPath = join(await mkdtemp(join(tmpdir(), "ppfw-ssh-")), "config");
});

async function writeHosts(text: string): Promise<void> {
  await writeFile(sshConfigPath, text, "utf8");
}

describe("referencedRemotes", () => {
  test("collects the default remote", () => {
    expect(referencedRemotes([backend], "devbox").get("devbox")).toBe("default remote");
  });

  test("collects every app remote override", () => {
    const remotes = referencedRemotes([kido, backend, api], null);
    expect([...remotes.entries()]).toEqual([
      ["devbox-a", "/ws/kido/.ppfw.config"],
      ["devbox-b", "/ws/api/.ppfw.config"],
    ]);
  });

  test("dedupes an alias shared by default and app", () => {
    const remotes = referencedRemotes([kido], "devbox-a");
    expect(remotes.size).toBe(1);
  });
});

describe("validateRemotes", () => {
  test("passes when every referenced remote is defined", async () => {
    await writeHosts("Host devbox-a\nHost devbox-b devbox\n");
    expect(() =>
      validateRemotes({ apps: [kido, api, backend], defaultRemote: "devbox", sshConfigPath }),
    ).not.toThrow();
  });

  test("fails fast naming a missing app remote", async () => {
    await writeHosts("Host other\n");
    expect(() => validateRemotes({ apps: [kido], defaultRemote: null, sshConfigPath })).toThrow(
      ConfigError,
    );
    expect(() => validateRemotes({ apps: [kido], defaultRemote: null, sshConfigPath })).toThrow(
      /devbox-a/,
    );
  });

  test("fails fast naming a missing default remote", async () => {
    await writeHosts("Host devbox-a\n");
    expect(() => validateRemotes({ apps: [backend], defaultRemote: "devbox", sshConfigPath }))
      .toThrow(/devbox/);
    expect(() => validateRemotes({ apps: [backend], defaultRemote: "devbox", sshConfigPath }))
      .toThrow(/default remote/);
  });

  test("names the config file that referenced a missing alias", async () => {
    await writeHosts("Host other\n");
    expect(() => validateRemotes({ apps: [kido], defaultRemote: null, sshConfigPath })).toThrow(
      new RegExp(`/ws/kido/\\.ppfw\\.config`),
    );
  });

  test("names every missing alias, not just the first", async () => {
    await writeHosts("Host other\n");
    expect(() =>
      validateRemotes({ apps: [kido, api, backend], defaultRemote: "devbox", sshConfigPath }),
    ).toThrow(/devbox.*devbox-a.*devbox-b/s);
  });

  test("missing ssh config file means every remote is unresolved", async () => {
    expect(() => validateRemotes({ apps: [kido], defaultRemote: null, sshConfigPath })).toThrow(
      /devbox-a/,
    );
  });

  test("Host * satisfies any referenced remote", async () => {
    await writeHosts("Host *\n");
    expect(() =>
      validateRemotes({ apps: [kido, api, backend], defaultRemote: "devbox", sshConfigPath }),
    ).not.toThrow();
  });

  test("a wildcard pattern matches like ssh would", async () => {
    await writeHosts("Host *.co.uk\n");
    expect(() =>
      validateRemotes({ apps: [kido, api, backend], defaultRemote: "devbox", sshConfigPath }),
    ).toThrow(/devbox/);
  });

  test("standalone-alias-only apps still have their remote validated", async () => {
    await writeHosts("Host devbox-a\n");
    expect(() =>
      validateRemotes({ apps: [standalone], defaultRemote: null, sshConfigPath }),
    ).toThrow(/devbox-c/);
  });
});
