import { hostnameOfHostHeader } from "./request-guard.js";

export interface HostBlockedCopy {
  title(host: string | null): string;
  body: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function wantsHostBlockedPage(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  return (request.headers.get("accept") ?? "").toLowerCase().includes("text/html");
}

export function hostBlockedResponse(request: Request, copy: HostBlockedCopy): Response {
  return noticePageResponse(request, {
    title: copy.title(hostnameOfHostHeader(request.headers.get("host"))),
    body: copy.body,
    status: 403,
  });
}

export function noticePageResponse(
  request: Request,
  notice: { title: string; body: string; status: number },
): Response {
  const title = escapeHtml(notice.title);
  const body = escapeHtml(notice.body);
  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<style>
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.5rem; box-sizing: border-box; background: Canvas; color: CanvasText; font-family: system-ui, sans-serif; }
main { max-width: 32rem; overflow-wrap: anywhere; }
h1 { margin: 0 0 0.5rem; font-size: 1.25rem; line-height: 1.4; }
p { margin: 0; line-height: 1.6; }
</style>
</head>
<body><main><h1>${title}</h1><p>${body}</p></main></body>
</html>
`;
  return new Response(request.method === "HEAD" ? null : html, {
    status: notice.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
    },
  });
}
