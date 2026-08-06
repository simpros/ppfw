import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOSTS_BEGIN_MARKER,
  HOSTS_END_MARKER,
  reconcileHosts,
  reconcileHostsText,
  removeHosts,
  removeHostsText,
} from "../src/hosts.ts";

describe("hosts block", () => {
  test("writes one loopback entry per alias", () => {
    expect(reconcileHostsText("127.0.0.1 localhost\n", ["Frontend.Kido.local"])).toBe(
      [
        "127.0.0.1 localhost",
        HOSTS_BEGIN_MARKER,
        "127.0.0.1 Frontend.Kido.local",
        HOSTS_END_MARKER,
        "",
      ].join("\n"),
    );
  });

  test("reconciles stale aliases without changing surrounding entries", () => {
    const existing = [
      "127.0.0.1 localhost",
      HOSTS_BEGIN_MARKER,
      "127.0.0.1 old.kido.local",
      HOSTS_END_MARKER,
      "192.168.1.10 devbox",
      "",
    ].join("\n");
    expect(reconcileHostsText(existing, ["new.kido.local"])).toBe([
      "127.0.0.1 localhost",
      HOSTS_BEGIN_MARKER,
      "127.0.0.1 new.kido.local",
      HOSTS_END_MARKER,
      "192.168.1.10 devbox",
      "",
    ].join("\n"));
  });

  test("removes the managed block and preserves entries outside it", () => {
    const existing = [
      "127.0.0.1 localhost",
      "",
      HOSTS_BEGIN_MARKER,
      "127.0.0.1 frontend.kido.local",
      HOSTS_END_MARKER,
      "",
      "192.168.1.10 devbox",
      "",
    ].join("\n");
    expect(removeHostsText(existing)).toBe([
      "127.0.0.1 localhost",
      "",
      "",
      "192.168.1.10 devbox",
      "",
    ].join("\n"));
  });

  test("collapses duplicate managed blocks while preserving their surroundings", () => {
    const existing = [
      "127.0.0.1 localhost",
      HOSTS_BEGIN_MARKER,
      "127.0.0.1 old-one.local",
      HOSTS_END_MARKER,
      "192.168.1.10 devbox",
      HOSTS_BEGIN_MARKER,
      "127.0.0.1 old-two.local",
      HOSTS_END_MARKER,
      "",
    ].join("\n");
    expect(reconcileHostsText(existing, ["new.local"])).toBe([
      "127.0.0.1 localhost",
      HOSTS_BEGIN_MARKER,
      "127.0.0.1 new.local",
      HOSTS_END_MARKER,
      "192.168.1.10 devbox",
      "",
    ].join("\n"));
  });

  test("rejects an incomplete managed block", () => {
    expect(() => reconcileHostsText(`${HOSTS_BEGIN_MARKER}\n`, ["a.local"])).toThrow(
      /malformed/,
    );
  });

  test("rejects aliases that cannot be hostnames", () => {
    expect(() => reconcileHostsText("", ["api.kido.local:8080"])).toThrow(
      /invalid alias host/,
    );
    expect(() => reconcileHostsText("", ["api kido.local"])).toThrow(/invalid alias host/);
  });

  test("does not add a block when there are no aliases", () => {
    const existing = "127.0.0.1 localhost\n";
    expect(reconcileHostsText(existing, [])).toBe(existing);
  });

  test("writes and removes the managed block through the file API", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ppfw-hosts-"));
    const path = join(dir, "hosts");
    await writeFile(path, "127.0.0.1 localhost\n", "utf8");

    reconcileHosts(path, ["frontend.kido.local"]);
    expect(await readFile(path, "utf8")).toContain("127.0.0.1 frontend.kido.local");

    removeHosts(path);
    expect(await readFile(path, "utf8")).toBe("127.0.0.1 localhost\n");
  });
});
