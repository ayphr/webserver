const DEFAULT_ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const DEFAULT_ALLOWED_HEADERS = 'Content-Type, Authorization';

function buildCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  const requestMethod = request.headers.get('access-control-request-method');
  const requestHeaders = request.headers.get('access-control-request-headers');

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': requestMethod ? `${requestMethod}, OPTIONS` : DEFAULT_ALLOWED_METHODS,
    'Access-Control-Allow-Headers': requestHeaders || DEFAULT_ALLOWED_HEADERS,
    'Access-Control-Max-Age': '600',
  };

  if (origin) {
    headers['Vary'] = 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers';
  }

  return headers;
}

export function addCorsHeaders(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  const corsHeaders = buildCorsHeaders(request);

  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function handleOptionsRoute(request: Request) {
  return addCorsHeaders(new Response(null, { status: 204 }), request);
}

export function handleStatusRoute(request: Request) {
  return addCorsHeaders(new Response('OK'), request);
}

export function handleApiNotFoundRoute(request: Request) {
  return addCorsHeaders(Response.json({ message: 'Not found' }, { status: 404 }), request);
}

export function handleNotFoundRoute(request: Request) {
  return addCorsHeaders(new Response('Not Found', { status: 404 }), request);
}
