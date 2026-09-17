import type { AppConfig, PortEntry } from "../../src/config/app.ts";

/** Shared named-port fixtures. Factories return fresh copies per call. */

export const frontendPort: PortEntry = {
  name: "frontend",
  port: 5173,
  forward: true,
  alias: "frontend.kido.local",
};

export const apiPort: PortEntry = {
  name: "api",
  port: 3232,
  forward: true,
  alias: "api-v2.kido.local",
};

export const dbPort: PortEntry = {
  name: "db",
  port: 5432,
  forward: true,
  alias: null,
};

export const localuiPort: PortEntry = {
  name: "localui",
  port: 9000,
  forward: false,
  alias: "localui.kido.local",
};

export const workerPort: PortEntry = {
  name: "worker",
  port: 8080,
  forward: true,
  alias: "worker.backend.local",
};

export function makeApp(
  name: string,
  dir: string,
  remote: string | null,
  ports: PortEntry[],
): AppConfig {
  return { name, dir, remote, ports: ports.map((port) => ({ ...port })) };
}

/** Standard kido app; pass explicit ports for shapes that differ (e.g. view). */
export function kidoApp(ports: PortEntry[] = [frontendPort, dbPort, localuiPort]): AppConfig {
  return makeApp("kido", "/ws/kido", "devbox-a", ports);
}

export function backendApp(): AppConfig {
  return makeApp("backend", "/ws/backend", null, [workerPort]);
}
