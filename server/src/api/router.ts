import { handleAuthRoute } from "./routes/auth";
import { handleApiNotFoundRoute, handleNotFoundRoute, handleOptionsRoute, handleStatusRoute } from "./routes/util";
import { handlePunishmentsRoute } from "./routes/punishments";
import { handleStaffRoute } from "./routes/staff";
import { handleDevicesRoute } from "./routes/devices";
import { handleMarketRoute } from "./routes/market";
import { handleUsersRoute } from "./routes/users";
import { handleProfileRoute } from "./routes/profile";

export function routeRequest(request: Request) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    return handleOptionsRoute(request);
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    return handleStatusRoute(request);
  }

  if (url.pathname.startsWith("/api/auth/")) {
    return handleAuthRoute(request);
  }

  if (url.pathname.startsWith("/api/punishments/")) {
    return handlePunishmentsRoute(request);
  }

  if (url.pathname.startsWith("/api/staff/")) {
    return handleStaffRoute(request);
  }

  if (url.pathname.startsWith('/api/devices')) {
    return handleDevicesRoute(request);
  }

  if (url.pathname.startsWith('/api/market')) {
    return handleMarketRoute(request);
  }

  if (url.pathname.startsWith('/api/profile/')) {
    return handleProfileRoute(request);
  }

  if (url.pathname.startsWith("/api/users/")) {
    return handleUsersRoute(request);
  }

  if (url.pathname.startsWith("/api/")) {
    return handleApiNotFoundRoute(request);
  }

  return handleNotFoundRoute(request);
}
