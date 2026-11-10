"""Offline contract tests for authenticated Strix proxy and evidence-only geolocation."""
import io
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import geo_telemetry
import strix_gateway


class DummyHTTP:
    status = 200
    headers = {"Content-Type": "application/json"}
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def read(self, _: int): return b'{"items":[{"id":"from-real-upstream-shape"}]}'


class StrixGatewayTests(unittest.TestCase):
    def test_missing_api_token_fails_closed(self):
        with patch.dict(os.environ, {}, clear=True):
            status, body = strix_gateway.execute("listScans", {})
        self.assertEqual(status, 503)
        self.assertEqual(body["error"], "strix_token_not_configured")

    def test_unknown_operation_cannot_proxy_url(self):
        with patch.dict(os.environ, {"STRIX_API_TOKEN": "test-token"}, clear=True):
            status, body = strix_gateway.execute("https://evil.example/exfil")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"], "unknown_operation")

    def test_url_injection_rejected(self):
        with patch.dict(os.environ, {"STRIX_API_TOKEN": "test-token"}, clear=True):
            status, body = strix_gateway.execute("getScan", {"scanId": "../admin"})
        self.assertEqual(status, 422)
        self.assertEqual(body["error"], "invalid_path_parameter")

    def test_missing_required_path_fails(self):
        with patch.dict(os.environ, {"STRIX_API_TOKEN": "test-token"}, clear=True):
            status, body = strix_gateway.execute("getScan", {})
        self.assertEqual(status, 422)
        self.assertEqual(body["error"], "missing_required_parameter")

    def test_successful_read_calls_allowlisted_upstream(self):
        def check(req, timeout):
            self.assertEqual(req.full_url, "https://app.strix.ai/api/v1/scans")
            self.assertEqual(req.get_method(), "GET")
            self.assertTrue(req.headers["Authorization"].startswith("Bearer "))
            return DummyHTTP()
        with patch.dict(os.environ, {"STRIX_API_TOKEN": "test-token"}, clear=True):
            with patch.object(strix_gateway, "urlopen", side_effect=check):
                status, body = strix_gateway.execute("listScans", {})
        self.assertEqual(status, 200)
        self.assertEqual(body["items"][0]["id"], "from-real-upstream-shape")

    def test_get_body_denied(self):
        with patch.dict(os.environ, {"STRIX_API_TOKEN": "test-token"}, clear=True):
            status, body = strix_gateway.execute("listScans", {}, {"key": "value"})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "body_not_allowed")

    def test_manifest_contains_real_strix_operations(self):
        cat = strix_gateway.catalog()
        self.assertGreaterEqual(len(cat["operations"]), 200)
        self.assertTrue(all(x["path"].startswith("/") for x in cat["operations"]))
        self.assertEqual(len({x["id"] for x in cat["operations"]}), len(cat["operations"]))


class GeoEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.execute("CREATE TABLE events (run TEXT, id TEXT, data TEXT)")

    def tearDown(self): self.db.close()

    def record(self, identifier, value):
        self.db.execute("INSERT INTO events VALUES (?,?,?)", ("authorized-run", identifier, json.dumps(value)))

    def test_rejects_events_without_coordinates(self):
        self.record("no-geo", {"type": "attack", "data": {"source_ip": "203.0.113.1"}})
        result = geo_telemetry.observed_events(self.db)
        self.assertEqual(result["events"], [])
        self.assertFalse(result["synthetic_events"])

    def test_actual_coordinates_create_arc_evidence(self):
        self.record("observed-1", {"type": "observed", "data": {"geo": {
            "source": {"lat": -29.86, "lon": 31.03},
            "target": {"lat": 51.5, "lon": -0.12}
        }}})
        result = geo_telemetry.observed_events(self.db)
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["events"][0]["source"]["lat"], -29.86)
        self.assertEqual(result["events"][0]["target"]["lon"], -0.12)

    def test_out_of_range_coordinates_cannot_show_marker(self):
        self.record("impossible", {"type": "event", "data": {"geo": {"lat": 1234, "lon": 200}}})
        self.assertEqual(geo_telemetry.observed_events(self.db)["count"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
