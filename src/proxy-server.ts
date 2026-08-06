import { RouteTable } from "./route-table.ts";

export interface ProxyServerOptions {
  port?: number;
}

export interface ProxyServer {
  port: number;
  stop(): void;
}

interface ProxySocketData {
  upstreamUrl: string;
  host: string;
  protocol: string | null;
  upstream: WebSocket | null;
  pending: Array<string | Buffer<ArrayBuffer>>;
}

export function startProxyServer(
  routes: RouteTable,
  options: ProxyServerOptions = {},
): ProxyServer {
  const server = Bun.serve<ProxySocketData>({
    hostname: "127.0.0.1",
    port: options.port ?? 80,
    fetch: (request, server) => {
      const targetPort = routes.lookup(request.headers.get("host"));
      if (targetPort === undefined) {
        return new Response("unknown host", { status: 502 });
      }

      if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const upgraded = server.upgrade(request, {
          data: {
            upstreamUrl: websocketUrl(targetPort, request),
            host: request.headers.get("host") ?? "",
            protocol: request.headers.get("sec-websocket-protocol"),
            upstream: null,
            pending: [],
          },
        });
        return upgraded
          ? undefined
          : new Response("websocket upgrade failed", { status: 400 });
      }

      return proxyRequest(targetPort, request);
    },
    websocket: {
      open: (socket) => {
        const upstream = new WebSocket(socket.data.upstreamUrl, {
          headers: {
            Host: socket.data.host,
            ...(socket.data.protocol === null
              ? {}
              : { "Sec-WebSocket-Protocol": socket.data.protocol }),
          },
        });
        socket.data.upstream = upstream;
        upstream.addEventListener("open", () => {
          for (const message of socket.data.pending) upstream.send(message);
          socket.data.pending.length = 0;
        });
        upstream.addEventListener("message", (event) => socket.send(event.data));
        upstream.addEventListener("error", () => socket.terminate());
        upstream.addEventListener("close", (event) => socket.close(event.code, event.reason));
      },
      message: (socket, message) => {
        const upstream = socket.data.upstream;
        if (upstream?.readyState === WebSocket.OPEN) upstream.send(message);
        else socket.data.pending.push(message);
      },
      close: (socket) => {
        socket.data.upstream?.close();
      },
    },
  });
  return {
    port: server.port ?? options.port ?? 80,
    stop: () => {
      void server.stop(true);
    },
  };
}

async function proxyRequest(
  targetPort: number,
  request: Request,
): Promise<Response> {
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

function websocketUrl(targetPort: number, request: Request): string {
  const url = new URL(request.url);
  return `ws://127.0.0.1:${targetPort}${url.pathname}${url.search}`;
}
