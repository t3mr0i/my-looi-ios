import unittest
from types import SimpleNamespace
from unittest.mock import patch

from services.hermes.nous_connections import NousConnections, NousConnectionError, dispatch_nous, _require_same_identity
from services.hermes.server import dispatch_request


class Portal:
    def __init__(self, available=True, accounts=None):
        self.available, self.accounts = available, accounts or []

    def catalog(self):
        return SimpleNamespace(model_dump=lambda: {"connectors": [{"slug": "gmail"}] if self.available else []})

    def list_accounts(self):
        return self.accounts


class Gateway:
    def __init__(self):
        self.calls = []
        self.url = "https://portal.nousresearch.com/example-authorization"

    def connections(self, providers):
        self.calls.append(providers)
        return {"results": [{"connector": "gmail", "status": "initiated", "connect_url": self.url}]}


class NousConnectionTests(unittest.TestCase):
    def setUp(self):
        self.gateway = Gateway()
        self.backend = NousConnections(Portal(), self.gateway, "owner:org", "Example owner")

    def test_catalog_gates_actual_availability(self):
        self.assertEqual(self.backend.snapshot()["providers"], ["gmail"])
        self.backend.portal.available = False
        self.assertEqual(self.backend.snapshot()["providers"], [])
        with self.assertRaises(NousConnectionError):
            self.backend.start("gmail", "owner:org")
        self.assertEqual(self.gateway.calls, [])

    def test_wrong_identity_cannot_mint_a_link(self):
        with self.assertRaises(NousConnectionError):
            self.backend.start("gmail", "someone-else:org")
        self.assertEqual(self.gateway.calls, [])

    def test_displayed_user_and_org_match_the_actual_gateway_bearer(self):
        info = SimpleNamespace(user_id="owner", org_id="org")
        _require_same_identity(info, {"sub": "owner", "org_id": "org"})
        for claims in [None, {"sub": "other", "org_id": "org"}, {"sub": "owner", "org_id": "other"}]:
            with self.assertRaises(NousConnectionError):
                _require_same_identity(info, claims)

    def test_one_deliberate_start_returns_only_a_link(self):
        result = self.backend.start("gmail", "owner:org")
        self.assertEqual(self.gateway.calls, [["gmail"]])
        self.assertEqual(set(result), {"provider", "subject", "url"})
        self.assertEqual(result["subject"], "owner:org")

    def test_fresh_sdk_account_uses_the_portal_authenticated_bearer_subject(self):
        info = SimpleNamespace(user_id=None, org_id="org")
        self.assertEqual(_require_same_identity(info, {"sub": "owner", "org_id": "org"}), "owner")
        for claims in [{"org_id": "org"}, {"sub": "", "org_id": "org"}, {"sub": "owner", "org_id": "other"}]:
            with self.assertRaises(NousConnectionError):
                _require_same_identity(info, claims)

    def test_existing_account_is_not_replaced_or_duplicated(self):
        self.backend.portal.accounts = [{"connector": "gmail", "connectionId": "existing", "label": "Example", "status": "active", "secret": "do not export"}]
        snapshot = self.backend.snapshot()
        self.assertEqual(snapshot["accounts"], [{"provider": "gmail", "id": "existing", "label": "Example", "connected": True}])
        with self.assertRaises(NousConnectionError):
            self.backend.start("gmail", "owner:org")
        self.assertEqual(self.gateway.calls, [])

    def test_unsafe_browser_link_is_rejected(self):
        for url in ["http://portal.nousresearch.com", "https://owner:key@portal.nousresearch.com", "javascript:alert(1)", "https://example.org:bad/"]:
            self.gateway.url = url
            with self.assertRaises(NousConnectionError):
                self.backend.start("gmail", "owner:org")

    def test_missing_login_and_sdk_failures_are_safe(self):
        with patch("services.hermes.nous_connections.make_nous_connections", return_value=None):
            self.assertEqual(dispatch_nous("GET", ["v1", "nous"], None), (200, {"status": "server_login_required"}))
        with patch("services.hermes.nous_connections.make_nous_connections", side_effect=RuntimeError("secret token and account content")):
            self.assertEqual(dispatch_nous("GET", ["v1", "nous"], None), (503, {"error": "E_NOUS_UNAVAILABLE"}))

    def test_app_auth_precedes_all_nous_work(self):
        with patch("services.hermes.nous_connections.make_nous_connections") as factory:
            status, _ = dispatch_request("GET", "/v1/nous", "", None, None, "a" * 64)
            self.assertEqual(status, 401)
            factory.assert_not_called()

    def test_validated_dispatch_does_not_expose_general_tools(self):
        with patch("services.hermes.nous_connections.make_nous_connections", return_value=self.backend):
            for body in [{"provider": [], "subject": "owner:org"}, {"provider": "gmail", "subject": "owner:org", "tool": "send_mail"}]:
                self.assertEqual(dispatch_nous("POST", ["v1", "nous", "connect"], body)[0], 400)
            self.assertEqual(dispatch_nous("DELETE", ["v1", "nous"], None)[0], 404)
            self.assertEqual(self.gateway.calls, [])


if __name__ == "__main__":
    unittest.main()
