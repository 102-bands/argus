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
MAX_BODY_BYTES = 4096


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
    (b"content-security-policy", b"frame-ancestors 'none'; default-src 'none'"),
]


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
                            "headers": [(b"content-type", b"application/problem+json"), *SECURITY_HEADERS]})
                await send({"type": "http.response.body",
                            "body": b'{"type":"about:blank","title":"Payload too large","status":413}'})
                return

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() not in (b"server", b"x-powered-by")]
                present = {k.lower() for k, _ in headers}
                headers += [h for h in SECURITY_HEADERS if h[0] not in present]
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_wrapper)
