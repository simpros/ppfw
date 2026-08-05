import { RouteTable } from "./route-table.ts";

export interface ProxyServerOptions {
  port?: number;
}

export interface ProxyServer {
  port: number;
  stop(): void;
}

export function startProxyServer(
  routes: RouteTable,
  options: ProxyServerOptions = {},
): ProxyServer {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 80,
    fetch: (request) => proxyRequest(routes, request),
  });
  return {
    port: server.port ?? options.port ?? 80,
    stop: () => {
      void server.stop(true);
    },
  };
}

async function proxyRequest(
  routes: RouteTable,
  request: Request,
): Promise<Response> {
  const targetPort = routes.lookup(request.headers.get("host"));
  if (targetPort === undefined) {
    return new Response("unknown host", { status: 502 });
  }

  const url = new URL(request.url);
  const upstream = `http://127.0.0.1:${targetPort}${url.pathname}${url.search}`;
  try {
    return await fetch(upstream, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "manual",
    });
  } catch {
    return new Response("backend unreachable", { status: 502 });
  }
}
