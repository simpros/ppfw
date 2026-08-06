#!/usr/bin/env bun
import { startProxyServer } from "./proxy-server.ts";
import { RouteTable } from "./route-table.ts";

const args = process.argv.slice(2);

const routesText = flagValue(args, "--routes");
if (routesText === null) {
  console.error("usage: root-proxy --routes <json> [--port <port>]");
  process.exit(1);
}

const routes = RouteTable.fromJson(routesText);

const portText = flagValue(args, "--port");
const port = portText === null ? 80 : Number(portText);

console.error(`root-proxy: routes=${routesText} port=${port}`);
startProxyServer(routes, { port });
console.error(`root-proxy: serving on 127.0.0.1:${port}`);

process.stdin.resume();
process.stdin.on("end", () => {
  console.error("root-proxy: stdin closed, exiting");
  process.exit(0);
});

function flagValue(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  return value === undefined ? null : value;
}
