#!/usr/bin/env bun
import { messageOf } from "./errors.ts";
import { reconcileHosts, removeHosts } from "./hosts.ts";
import { startProxyServer } from "./proxy-server.ts";
import { RouteTable } from "./route-table.ts";

const args = process.argv.slice(2);

const routesText = flagValue(args, "--routes");
if (routesText === null) {
  console.error("usage: root-proxy --routes <json> [--port <port>] [--hosts-path <path>]");
  process.exit(1);
}

const routes = RouteTable.fromJson(routesText);
const hostsPath = flagValue(args, "--hosts-path") ?? "/etc/hosts";

const portText = flagValue(args, "--port");
const port = portText === null ? 80 : Number(portText);

console.error(`root-proxy: routes=${routesText} port=${port}`);
try {
  reconcileHosts(hostsPath, routes.hosts());
} catch (cause) {
  console.error(`root-proxy: cannot reconcile ${hostsPath}: ${messageOf(cause)}`);
  process.exit(1);
}

let server: ReturnType<typeof startProxyServer>;
try {
  server = startProxyServer(routes, { port });
} catch (cause) {
  removeHostsAfterFailure(hostsPath);
  throw cause;
}
console.error(`root-proxy: serving on 127.0.0.1:${port}`);

process.stdin.resume();
let shuttingDown = false;

process.stdin.on("end", () => void shutdown("stdin closed"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

function shutdown(reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`root-proxy: ${reason}, exiting`);
  const error = removeHostsError(hostsPath);
  server.stop();
  if (error !== null) {
    console.error(`root-proxy: cannot remove ${hostsPath}: ${error}`);
    process.exit(1);
  }
  process.exit(0);
}

function removeHostsAfterFailure(path: string): void {
  const error = removeHostsError(path);
  if (error !== null) console.error(`root-proxy: cannot remove ${path}: ${error}`);
}

function removeHostsError(path: string): string | null {
  try {
    removeHosts(path);
    return null;
  } catch (cause) {
    return messageOf(cause);
  }
}

function flagValue(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  return value === undefined ? null : value;
}
