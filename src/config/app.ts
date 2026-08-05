import { basename } from "node:path";
import { parse } from "yaml";
import { ConfigError } from "../errors.ts";

export interface PortEntry {
  name: string;
  port: number;
  forward: boolean;
  alias: string | null;
}

export interface AppConfig {
  name: string;
  dir: string;
  remote: string | null;
  ports: PortEntry[];
}

export interface ParseAppConfigOptions {
  dir: string;
  aliasSuffix: string;
}

const TOP_LEVEL_KEYS = new Set(["name", "remote", "ports"]);
const PORT_ENTRY_KEYS = new Set(["port", "forward", "alias"]);

export function parseAppConfig(
  yamlText: string,
  options: ParseAppConfigOptions,
): AppConfig {
  const where = `${options.dir}/.ppfw.config`;

  let doc: unknown;
  try {
    doc = parse(yamlText);
  } catch (cause) {
    throw fail(where, `invalid YAML: ${messageOf(cause)}`);
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw fail(where, "expected a mapping with a `ports` key");
  }

  const map = doc as Record<string, unknown>;
  for (const key of Object.keys(map)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      throw fail(where, `unknown key \`${key}\` (allowed: name, remote, ports)`);
    }
  }

  const name = optionalString(where, map.name, "name") ?? basename(options.dir);
  const remote = optionalString(where, map.remote, "remote");

  if (!("ports" in map)) {
    throw fail(where, "`ports` is required");
  }
  const portsRaw = map.ports;
  if (portsRaw === null || typeof portsRaw !== "object" || Array.isArray(portsRaw)) {
    throw fail(where, "`ports` must be a mapping of port-name to entry");
  }
  const portsMap = portsRaw as Record<string, unknown>;
  if (Object.keys(portsMap).length === 0) {
    throw fail(where, "`ports` must declare at least one named port");
  }

  const ports: PortEntry[] = [];
  for (const [portName, entry] of Object.entries(portsMap)) {
    ports.push(parsePortEntry(where, portName, entry, name, options.aliasSuffix));
  }

  return { name, dir: options.dir, remote, ports };
}

function parsePortEntry(
  where: string,
  portName: string,
  entry: unknown,
  appName: string,
  aliasSuffix: string,
): PortEntry {
  if (typeof entry === "number") {
    return {
      name: portName,
      port: validatePort(where, portName, entry),
      forward: true,
      alias: deriveAlias(portName, appName, aliasSuffix),
    };
  }

  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw fail(
      where,
      `port \`${portName}\` must be a port number or a mapping with a \`port\` key`,
    );
  }

  const map = entry as Record<string, unknown>;
  for (const key of Object.keys(map)) {
    if (!PORT_ENTRY_KEYS.has(key)) {
      throw fail(
        where,
        `port \`${portName}\`: unknown key \`${key}\` (allowed: port, forward, alias)`,
      );
    }
  }

  if (!("port" in map)) {
    throw fail(where, `port \`${portName}\` is missing its \`port\` number`);
  }
  const port = validatePort(where, portName, map.port);

  const forward = optionalBoolean(where, portName, map.forward, "forward");

  let alias: string | null;
  if (!("alias" in map) || map.alias === true) {
    alias = deriveAlias(portName, appName, aliasSuffix);
  } else if (map.alias === false) {
    alias = null;
  } else if (typeof map.alias === "string" && map.alias.trim() !== "") {
    alias = map.alias;
  } else {
    throw fail(
      where,
      `port \`${portName}\`: \`alias\` must be true, false, or a hostname string`,
    );
  }

  if (!forward && alias === null) {
    throw fail(
      where,
      `port \`${portName}\` has forward: false and alias: false — nothing to do`,
    );
  }

  return { name: portName, port, forward, alias };
}

function validatePort(where: string, portName: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw fail(
      where,
      `port \`${portName}\`: port number must be an integer between 1 and 65535`,
    );
  }
  return value;
}

function optionalString(
  where: string,
  value: unknown,
  key: string,
): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw fail(where, `\`${key}\` must be a non-empty string`);
  }
  return value;
}

function optionalBoolean(
  where: string,
  portName: string,
  value: unknown,
  key: string,
): boolean {
  if (value === undefined) return true;
  if (typeof value !== "boolean") {
    throw fail(where, `port \`${portName}\`: \`${key}\` must be true or false`);
  }
  return value;
}

function deriveAlias(portName: string, appName: string, suffix: string): string {
  return `${portName}.${appName}.${suffix}`;
}

function fail(where: string, message: string): ConfigError {
  return new ConfigError(`${where}: ${message}`);
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
