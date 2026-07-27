const securityHeaders = {
  "content-security-policy":
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-src https://unpkg.com; img-src 'self' data: https:; connect-src 'self'; upgrade-insecure-requests",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const worker = {
  async fetch(request, env) {
    if (!env.ASSETS) {
      return secure(
        new Response("Static asset binding is unavailable.", {
          status: 500,
        }),
      );
    }

    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return secure(response);

    const url = new URL(request.url);
    if (url.pathname.includes(".")) return secure(response);

    url.pathname = "/404.html";
    const notFound = await env.ASSETS.fetch(new Request(url, request));
    return secure(
      new Response(notFound.body, {
        status: 404,
        headers: notFound.headers,
      }),
    );
  },
};

function secure(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default worker;
