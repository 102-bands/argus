"""Outbound allow-list, security headers, body limit, rate limiter (PRD §11)."""
from urllib.parse import urlsplit

from slowapi import Limiter
from slowapi.util import get_remote_address

ALLOWED_HTTPS_HOSTS = frozenset({
    "irsa.ipac.caltech.edu",
    "nasa-irsa-spherex.s3.us-east-1.amazonaws.com",
    "gea.esac.esa.int",
})
ALLOWED_S3_BUCKETS = frozenset({"nasa-irsa-spherex"})
MAX_BODY_BYTES = 16384  # the contact form allows 4000 characters of message


class OutboundBlocked(ValueError):
    pass


def check_outbound(url: str) -> str:
    """Raise unless url points at an allowed archive (SSRF guard, PRD §11.2)."""
    parts = urlsplit(url)
    if parts.scheme == "https" and parts.hostname in ALLOWED_HTTPS_HOSTS and not parts.username and parts.port in (None, 443):
        return url
    if parts.scheme == "s3" and parts.netloc in ALLOWED_S3_BUCKETS:
        return url
    raise OutboundBlocked(f"outbound URL not allowed: {parts.scheme}://{parts.hostname}")


limiter = Limiter(key_func=get_remote_address, headers_enabled=False)

SECURITY_HEADERS = [
    (b"strict-transport-security", b"max-age=63072000; includeSubDomains"),
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"permissions-policy", b"geolocation=(), camera=(), microphone=()"),
    (b"cross-origin-opener-policy", b"same-origin"),
    (b"cross-origin-resource-policy", b"same-site"),
]
API_CSP = b"frame-ancestors 'none'; default-src 'none'"
# The site's policy (PRD §11.3). /embed may be framed by other sites; nothing else may.
_SITE_CSP = ("default-src 'self'; script-src 'self' https://cloud.umami.is 'wasm-unsafe-eval'; "
             # data: — Aladin Lite inlines its wasm and fonts as data: URLs.
             "connect-src 'self' data: https://gateway.umami.is https://cloud.umami.is https://irsa.ipac.caltech.edu "
             "https://alasky.cds.unistra.fr; img-src 'self' data: blob: https://irsa.ipac.caltech.edu "
             "https://alasky.cds.unistra.fr; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; "
             "font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors ")
SITE_CSP = (_SITE_CSP + "'none'").encode()
EMBED_CSP = (_SITE_CSP + "*").encode()


def csp_for(path: str) -> bytes:
    if path.startswith("/api"):
        return API_CSP
    return EMBED_CSP if path == "/embed" or path.startswith("/embed/") else SITE_CSP


class SecurityMiddleware:
    """Pure ASGI so SSE streaming is untouched. Adds headers, drops Server, caps request bodies."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        for name, value in scope.get("headers", []):
            if name == b"content-length" and value.isdigit() and int(value) > MAX_BODY_BYTES:
                await send({"type": "http.response.start", "status": 413,
                            "headers": [(b"content-type", b"application/problem+json"), *SECURITY_HEADERS,
                                        (b"content-security-policy", API_CSP)]})
                await send({"type": "http.response.body",
                            "body": b'{"type":"about:blank","title":"Payload too large","status":413}'})
                return

        csp = csp_for(scope.get("path", ""))

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() not in (b"server", b"x-powered-by")]
                present = {k.lower() for k, _ in headers}
                headers += [h for h in SECURITY_HEADERS if h[0] not in present]
                if b"content-security-policy" not in present:
                    headers.append((b"content-security-policy", csp))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_wrapper)
