import { ConfigError, messageOf } from "./errors.ts";

export interface Route {
  host: string;
  port: number;
}

export class RouteTable {
  private readonly routes: ReadonlyMap<string, number>;

  constructor(routes: Iterable<Route>) {
    const map = new Map<string, number>();
    for (const route of routes) {
      const host = normalizeHost(route.host);
      if (host === null) {
        throw new ConfigError("alias host must be non-empty");
      }
      if (!Number.isInteger(route.port) || route.port < 1 || route.port > 65535) {
        throw new ConfigError(`alias ${route.host} has an invalid port ${route.port}`);
      }
      if (map.has(host)) {
        throw new ConfigError(`duplicate alias host: ${host}`);
      }
      map.set(host, route.port);
    }
    this.routes = map;
  }

  static fromJson(text: string): RouteTable {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (cause) {
      throw new ConfigError(`invalid route table JSON: ${messageOf(cause)}`);
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new ConfigError("route table JSON must be an object");
    }
    return new RouteTable(
      Object.entries(value as Record<string, unknown>).map(([host, port]) => ({
        host,
        port: typeof port === "number" ? port : Number.NaN,
      })),
    );
  }

  lookup(hostHeader: string | null): number | undefined {
    const host = normalizeHost(hostHeader);
    return host === null ? undefined : this.routes.get(host);
  }

  entries(): ReadonlyMap<string, number> {
    return this.routes;
  }

  toJson(): string {
    return JSON.stringify(Object.fromEntries(this.routes));
  }
}

export function normalizeHost(hostHeader: string | null): string | null {
  if (hostHeader === null) return null;
  const host = hostHeader.trim().toLowerCase();
  if (host === "") return null;
  return host.split(":")[0] ?? host;
}
