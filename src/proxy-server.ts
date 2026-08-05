export interface ProxyServerOptions {
  port?: number;
}

export interface ProxyServer {
  port: number;
  stop(): void;
}

export function startProxyServer(
  routes: ReadonlyMap<string, number>,
  options: ProxyServerOptions = {},
): ProxyServer {
  const normalized = new Map<string, number>();
  for (const [host, port] of routes) normalized.set(host.toLowerCase(), port);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 80,
    fetch: (request) => proxyRequest(normalized, request),
  });
  return {
    port: server.port ?? options.port ?? 80,
    stop: () => {
      void server.stop(true);
    },
  };
}

export function normalizeHost(hostHeader: string | null): string | null {
  if (hostHeader === null) return null;
  const host = hostHeader.trim().toLowerCase();
  if (host === "") return null;
  return host.split(":")[0] ?? host;
}

async function proxyRequest(
  routes: ReadonlyMap<string, number>,
  request: Request,
): Promise<Response> {
  const host = normalizeHost(request.headers.get("host"));
  const targetPort = host === null ? undefined : routes.get(host);
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
