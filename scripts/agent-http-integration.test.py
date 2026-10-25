"""Exercise the real HTTP handler and killable worker with local fixtures."""
from __future__ import annotations

import json
import sys
import tempfile
import threading
import time
import unittest
from http.client import HTTPConnection
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.hermes.server import create_http_server
from services.hermes.service import TaskManager
from services.hermes.store import TaskStore
from services.hermes.tests.helpers import fixture_worker


class AgentHttpIntegration(unittest.TestCase):
    def test_actual_http_admission_recovery_cancel_and_deletion(self):
        token = "fixture-only-auth-token-with-32-characters"
        with tempfile.TemporaryDirectory() as directory:
            manager = TaskManager(TaskStore(Path(directory) / "tasks.sqlite3"), worker_target=fixture_worker, timeout_seconds=5, cancel_grace_seconds=0.2)
            server = create_http_server("127.0.0.1", 0, manager, token)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()

            def request(method, path, value=None, auth=True):
                connection = HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
                try:
                    headers = {"Authorization": f"Bearer {token}"} if auth else {}
                    raw = json.dumps(value).encode() if value is not None else None
                    if raw is not None:
                        headers["Content-Type"] = "application/json"
                    connection.request(method, path, body=raw, headers=headers)
                    response = connection.getresponse()
                    body = response.read()
                    self.assertEqual(response.getheader("Cache-Control"), "no-store")
                    return response.status, json.loads(body) if body else None
                finally:
                    connection.close()

            def wait(task_id, states):
                until = time.monotonic() + 10
                while time.monotonic() < until:
                    status, task = request("GET", f"/v1/tasks/{task_id}")
                    if status == 200 and task["status"] in states:
                        return task
                    time.sleep(0.03)
                self.fail("fixture task did not reach expected terminal status")

            try:
                self.assertEqual(request("GET", "/health", auth=False)[0], 200)
                self.assertEqual(request("GET", "/v1/tasks", auth=False)[0], 401)
                self.assertEqual(request("GET", "/v1/capabilities")[1]["service"], "looi-hermes")
                task_id = str(uuid4())
                path = f"/v1/tasks/{task_id}"
                payload = {"query": "A fixture research request", "language": "en"}
                self.assertEqual(request("PUT", path, payload)[0], 202)
                # Simulate losing the first response and retrying that identity.
                self.assertEqual(request("PUT", path, payload)[0], 200)
                self.assertEqual(request("PUT", path, {**payload, "query": "Different request"})[0], 409)
                full = wait(task_id, {"completed"})
                self.assertTrue(full["answer"])
                listing = request("GET", "/v1/tasks")[1]
                self.assertIsNone(listing["tasks"][0]["answer"])
                self.assertIn("nextCursor", listing)
                self.assertEqual(request("DELETE", path)[0], 204)
                self.assertEqual(request("PUT", path, payload)[0], 410)
                self.assertEqual(request("DELETE", path)[0], 204)
                hanging_id = str(uuid4())
                hanging_path = f"/v1/tasks/{hanging_id}"
                self.assertEqual(request("PUT", hanging_path, {"query": "hang until explicitly cancelled", "language": "uk"})[0], 202)
                wait(hanging_id, {"running"})
                self.assertEqual(request("DELETE", hanging_path)[0], 409)
                # No JSON body: exercises the real app cancellation wire format.
                self.assertEqual(request("POST", hanging_path + "/cancel")[0], 200)
                self.assertEqual(wait(hanging_id, {"cancelled"})["status"], "cancelled")
                self.assertEqual(request("DELETE", hanging_path)[0], 204)
            finally:
                server.shutdown()
                server.server_close()
                manager.close()
                thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
