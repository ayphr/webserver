import type { Server } from "bun";
import { routeRequest } from "./router";
import { addCorsHeaders } from "./routes/util";

function getRequestBaseOrigin(request: Request): string {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || "localhost";

  if (forwardedProto === "http" || forwardedProto === "https") {
    return `${forwardedProto}://${host}`;
  }

  return request.url.startsWith("https://") ? `https://${host}` : `http://${host}`;
}

function normalizeRequest(request: Request): Request {
  const baseOrigin = getRequestBaseOrigin(request);

  try {
    return new Request(new URL(request.url, baseOrigin).toString(), request);
  } catch {
    return new Request(`${baseOrigin}/`, request);
  }
}

export function setupServer(port: number, callback: Function): Server<undefined> {
  const server = Bun.serve({
    port,

    fetch(request) {
      return addCorsHeaders(routeRequest(normalizeRequest(request)), request);
    },
  });

  callback();

  return server;
}
