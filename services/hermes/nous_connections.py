"""Account setup through the pinned Hermes Nous SDK, separate from agent tools.

This module cannot execute connector tools or read mail/calendar content.
"""
from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlsplit

PORTAL = "https://portal.nousresearch.com"
GATEWAY = "https://connector-gateway.nousresearch.com"
PROVIDERS = frozenset({"gmail", "googlecalendar"})


class NousConnectionError(Exception):
    def __init__(self, code: str, status: int = 503):
        self.code, self.status = code, status
        super().__init__(code)


class _Reply:
    def __init__(self, status: int, headers: Any, body: bytes):
        self.status_code, self.headers, self.body = status, headers, body

    def json(self):
        return json.loads(self.body)


class _Transport:
    def request(self, method, url, *, headers=None, json=None, timeout=None):
        import requests

        parsed = urlsplit(url)
        if f"{parsed.scheme}://{parsed.netloc}" not in {PORTAL, GATEWAY} or parsed.username or parsed.password:
            raise NousConnectionError("E_NOUS_ORIGIN")
        # Neither upstream redirects nor an overlarge reply may inherit the bearer.
        with requests.request(method, url, headers=headers, json=json, timeout=(5, 10), allow_redirects=False, stream=True) as response:
            chunks, length = [], 0
            for chunk in response.iter_content(16_384):
                length += len(chunk)
                if length > 1_000_000:
                    raise NousConnectionError("E_NOUS_RESPONSE")
                chunks.append(chunk)
            return _Reply(response.status_code, response.headers, b"".join(chunks))


def _text(value: Any, limit: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(ch) < 32 for ch in value):
        raise NousConnectionError("E_NOUS_RESPONSE")
    return value


def _browser_url(value: Any) -> str:
    value = _text(value, 4096)
    try:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError()
        parsed.port
    except ValueError:
        raise NousConnectionError("E_NOUS_RESPONSE") from None
    return value


def _require_same_identity(info: Any, claims: Any) -> str:
    # This is a binding check, not JWT authentication: Nous authenticates the
    # captured bearer on every catalog/account/connection request.
    if not isinstance(claims, dict):
        raise NousConnectionError("E_NOUS_IDENTITY", 409)
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject.strip() or len(subject) > 256 or any(ord(ch) < 32 for ch in subject):
        raise NousConnectionError("E_NOUS_IDENTITY", 409)
    # The installed SDK's fresh account normalizer leaves user_id empty. The
    # Portal has just authenticated this exact bearer; take its subject while
    # still checking any supplied user ID and the account's organisation.
    if (info.user_id is not None and subject != info.user_id) or (claims.get("org_id") or None) != (info.org_id or None):
        raise NousConnectionError("E_NOUS_IDENTITY", 409)
    return subject


class NousConnections:
    def __init__(self, portal, gateway, subject: str, label: str):
        self.portal, self.gateway = portal, gateway
        self.subject, self.label = _text(subject, 256), _text(label, 256)

    def snapshot(self) -> dict[str, Any]:
        catalog = self.portal.catalog().model_dump()
        available = {row["slug"] for row in catalog["connectors"] if row["slug"] in PROVIDERS}
        accounts = []
        for account in self.portal.list_accounts():
            if account.get("connector") not in PROVIDERS:
                continue
            if len(accounts) >= 50:
                raise NousConnectionError("E_NOUS_RESPONSE")
            accounts.append({
                "id": _text(account.get("connectionId"), 256),
                "provider": account["connector"],
                "label": _text(account.get("label"), 256),
                "connected": account.get("status") == "active" and account.get("disabled") is not True,
            })
        return {"status": "ready", "subject": self.subject, "label": self.label,
                "providers": sorted(available), "accounts": accounts}

    def start(self, provider: str, expected_subject: str) -> dict[str, Any]:
        if provider not in PROVIDERS or expected_subject != self.subject:
            raise NousConnectionError("E_NOUS_IDENTITY", 409)
        snapshot = self.snapshot()
        if provider not in snapshot["providers"]:
            raise NousConnectionError("E_NOUS_UNAVAILABLE", 409)
        # Existing account selection and reconnect stay in Nous; do not mint a
        # second account or silently replace the newest account for this provider.
        if any(account["provider"] == provider for account in snapshot["accounts"]):
            raise NousConnectionError("E_NOUS_ACCOUNT_EXISTS", 409)
        result = self.gateway.connections([provider])
        rows = result.get("results", [])
        if len(rows) != 1 or rows[0].get("connector") != provider:
            raise NousConnectionError("E_NOUS_RESPONSE")
        row = rows[0]
        if row.get("status") != "initiated":
            # Browser closure or an ambiguous response never becomes success.
            raise NousConnectionError("E_NOUS_REFRESH_REQUIRED", 409)
        return {"provider": provider, "subject": self.subject,
                "url": _browser_url(row.get("connect_url") or row.get("connectUrl"))}


def make_nous_connections() -> NousConnections | None:
    """Only an existing named Nous login; never create a guest or grant tools."""
    try:
        from hermes_cli.auth import get_provider_auth_state, resolve_nous_access_token, _decode_jwt_claims
        from hermes_cli.anon_auth import is_guest_state
        from hermes_cli.nous_account import _info_from_account_payload
        from tools.connectors.portal.client import PortalConnectorClient
        from tools.connectors.gateway.client import ConnectorClient

        state = get_provider_auth_state("nous") or {}
        # Reject custom identity issuers before any credential refresh.
        if not state or is_guest_state(state):
            return None
        if (state.get("portal_base_url") or PORTAL).rstrip("/") != PORTAL:
            raise NousConnectionError("E_NOUS_ORIGIN")
        # Use this profile's OAuth resolver, never the process-wide gateway-token
        # override: it could represent a different user than the displayed one.
        token = resolve_nous_access_token(timeout_seconds=10)
        if not token:
            return None
        headers = lambda _url: {"Authorization": f"Bearer {token}"}
        transport = _Transport()
        identity = transport.request("GET", f"{PORTAL}/api/oauth/account", headers=headers(PORTAL))
        if identity.status_code in (401, 403):
            return None
        if identity.status_code != 200:
            raise NousConnectionError("E_NOUS_UNAVAILABLE")
        payload = identity.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("user"), dict) or not payload["user"] or payload.get("error"):
            raise NousConnectionError("E_NOUS_RESPONSE")
        info = _info_from_account_payload(payload, state=state, portal_base_url=PORTAL)
        if not info.logged_in or info.is_anonymous_tier:
            return None
        user_id = _require_same_identity(info, _decode_jwt_claims(token))
        return NousConnections(
            PortalConnectorClient(transport=transport, endpoint_resolver=lambda: PORTAL, header_provider=headers),
            ConnectorClient(transport=transport, endpoint_resolver=lambda: GATEWAY, header_provider=headers),
            f"{user_id}:{info.org_id or ''}", info.email or user_id,
        )
    except ImportError:
        raise NousConnectionError("E_NOUS_RUNTIME") from None


def dispatch_nous(method: str, parts: list[str], body: Any) -> tuple[int, dict[str, Any]]:
    try:
        backend = make_nous_connections()
        if backend is None:
            return (200, {"status": "server_login_required"}) if method == "GET" else (409, {"error": "E_NOUS_IDENTITY"})
        if method == "GET" and parts == ["v1", "nous"]:
            return 200, backend.snapshot()
        if method == "POST" and parts == ["v1", "nous", "connect"]:
            if not isinstance(body, dict) or set(body) != {"provider", "subject"} or not isinstance(body["provider"], str) or body["provider"] not in PROVIDERS or not isinstance(body["subject"], str):
                return 400, {"error": "E_INVALID_BODY"}
            return 200, backend.start(body["provider"], body["subject"])
        return 404, {"error": "E_NOT_FOUND"}
    except NousConnectionError as error:
        return error.status, {"error": error.code}
    except Exception:
        # SDK/network errors can contain account data, URLs and credentials.
        return 503, {"error": "E_NOUS_UNAVAILABLE"}
