import { describe, expect, test } from "bun:test";
import { hasAlias, parseSshConfig } from "../../src/ssh/config.ts";

describe("parseSshConfig", () => {
  test("collects a literal Host alias", () => {
    expect(parseSshConfig("Host devbox-a\n").patterns).toEqual([["devbox-a"]]);
  });

  test("collects multiple aliases on one Host line", () => {
    expect(parseSshConfig("Host devbox-a devbox-b\n").patterns).toEqual([
      ["devbox-a", "devbox-b"],
    ]);
  });

  test("keeps each Host line as its own pattern list", () => {
    const config = parseSshConfig("Host a\nHost b\n");
    expect(config.patterns).toEqual([["a"], ["b"]]);
  });

  test("keyword is case-insensitive", () => {
    const config = parseSshConfig("hOsT devbox-a\n");
    expect(config.patterns).toEqual([["devbox-a"]]);
  });

  test("keyword=argument form is accepted", () => {
    const config = parseSshConfig("Host=devbox-a\n");
    expect(config.patterns).toEqual([["devbox-a"]]);
  });

  test("leading indentation is ignored", () => {
    expect(parseSshConfig("  Host  devbox-a\n").patterns).toEqual([["devbox-a"]]);
  });

  test("ignores comments and blank lines", () => {
    const config = parseSshConfig("# main config\n\n   \nHost devbox-a # a comment\n");
    expect(config.patterns).toEqual([["devbox-a"]]);
  });

  test("a # preceded by whitespace starts a comment", () => {
    expect(parseSshConfig("Host devbox-a # comment\n").patterns).toEqual([["devbox-a"]]);
  });

  test("mid-token # is literal, not a comment", () => {
    expect(parseSshConfig("Host mid#line\n").patterns).toEqual([["mid#line"]]);
  });

  test("quoted alias may contain a space", () => {
    expect(parseSshConfig('Host "my box"\n').patterns).toEqual([["my box"]]);
  });

  test("ignores non-Host keywords, including HostName", () => {
    const config = parseSshConfig(
      "HostName 10.0.0.1\nUser sim\nHostKeyAlgorithms ssh-ed25519\nHost devbox-a\n",
    );
    expect(config.patterns).toEqual([["devbox-a"]]);
  });

  test("hosts inside Match blocks are still collected", () => {
    const config = parseSshConfig(
      'Match host "gateway"\n  Host jumpbox\n    HostName gw\n',
    );
    expect(config.patterns).toEqual([["jumpbox"]]);
  });

  test("wildcard patterns are collected as-is", () => {
    expect(parseSshConfig("Host *.co.uk !dialup\n").patterns).toEqual([
      ["*.co.uk", "!dialup"],
    ]);
  });

  test("empty config has no patterns", () => {
    expect(parseSshConfig("").patterns).toEqual([]);
    expect(parseSshConfig("# only a comment\n").patterns).toEqual([]);
  });
});

describe("hasAlias", () => {
  test("literal alias is present", () => {
    expect(hasAlias(parseSshConfig("Host devbox-a\n"), "devbox-a")).toBe(true);
  });

  test("unlisted alias is absent", () => {
    expect(hasAlias(parseSshConfig("Host devbox-a\n"), "devbox-b")).toBe(false);
  });

  test("Host * matches any alias", () => {
    expect(hasAlias(parseSshConfig("Host *\n"), "devbox-a")).toBe(true);
  });

  test("? matches exactly one character", () => {
    expect(hasAlias(parseSshConfig("Host 192.168.0.?\n"), "192.168.0.5")).toBe(true);
    expect(hasAlias(parseSshConfig("Host 192.168.0.?\n"), "192.168.0.55")).toBe(false);
  });

  test("negated pattern excludes the alias", () => {
    expect(hasAlias(parseSshConfig("Host !neg\n"), "neg")).toBe(false);
  });

  test("first match in a pattern list wins", () => {
    expect(hasAlias(parseSshConfig("Host !neg devbox\n"), "neg")).toBe(false);
    expect(hasAlias(parseSshConfig("Host devbox !neg\n"), "neg")).toBe(false);
    expect(hasAlias(parseSshConfig("Host !neg devbox\n"), "devbox")).toBe(true);
  });

  test("an alias defined by any Host line is present", () => {
    const config = parseSshConfig("Host !devbox\nHost devbox\n");
    expect(hasAlias(config, "devbox")).toBe(true);
  });

  test("a negated match alone never yields a positive result", () => {
    expect(hasAlias(parseSshConfig("Host !a !b\n"), "c")).toBe(false);
  });
});
