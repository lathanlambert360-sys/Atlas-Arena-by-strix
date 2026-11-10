"""Authenticated local gateway for Strix's published REST API.

No proxy URL is supplied by a caller. Operations are selected from a pinned,
reviewable OpenAPI manifest. Browser credentials never receive the bearer token.
"""
from __future__ import annotations

import base64
import json
import os
import re
from functools import lru_cache
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
BASE = "https://app.strix.ai/api/v1"
MAX_UPSTREAM_BYTES = 8 * 1024 * 1024
PATH_SEGMENT = re.compile(r"^[A-Za-z0-9._:@+-]{1,256}$")


@lru_cache(maxsize=1)
def catalog():
    return json.loads((ROOT / "strix_operations.json").read_text(encoding="utf-8"))


def connection():
    """Never disclose tokens; an upstream response proves live access."""
    return {
        "configured": bool(os.environ.get("STRIX_API_TOKEN") or os.environ.get("STRIX_TOKEN")),
        "base": BASE,
        "catalog_operations": len(catalog()["operations"]),
        "source": catalog()["source"],
        "spec_sha256": catalog()["sha256"],
    }


def execute(operation_id, supplied_params=None, body=None):
    token = os.environ.get("STRIX_API_TOKEN") or os.environ.get("STRIX_TOKEN")
    if not token:
        return 503, {"error": "strix_token_not_configured",
                     "action": "Set STRIX_API_TOKEN in the local backend environment; never enter it into the browser."}

    operations = {op["id"]: op for op in catalog()["operations"]}
    op = operations.get(operation_id)
    if op is None:
        return 404, {"error": "unknown_operation"}
    if not op["enabled"]:
        return 422, {"error": "unsupported_request_media_type", "formats": op["request_formats"]}

    params = supplied_params or {}
    if not isinstance(params, dict) or len(params) > 60:
        return 400, {"error": "invalid_parameters"}
    path = op["path"]
    qparams = {}
    for p in op["parameters"]:
        key = p["name"]
        value = params.get(key)
        if value is None or value == "":
            if p["required"]:
                return 422, {"error": "missing_required_parameter", "parameter": key}
            continue
        if p["in"] == "path":
            value = str(value)
            if not PATH_SEGMENT.fullmatch(value):
                return 422, {"error": "invalid_path_parameter", "parameter": key}
            path = path.replace("{" + key + "}", quote(value, safe=""))
        else:
            qparams[key] = value
    if "{" in path or "}" in path:
        return 422, {"error": "unresolved_path_parameter"}
    if op["method"] in ("GET", "DELETE") and body not in (None, {}):
        return 400, {"error": "body_not_allowed"}
    if body is not None and not isinstance(body, (dict, list)):
        return 400, {"error": "invalid_json_body"}

    url = BASE + path
    if qparams:
        url += "?" + urlencode(qparams, doseq=True)
    data = (json.dumps(body).encode("utf-8") if body is not None else None)
    if data is not None and len(data) > 512_000:
        return 413, {"error": "request_body_too_large"}
    req = Request(url, data=data, method=op["method"], headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/json, application/pdf, application/octet-stream",
        **({"Content-Type": "application/json"} if data is not None else {}),
        "User-Agent": "INFINITE-Strix-Dashboard/1",
    })
    try:
        with urlopen(req, timeout=25) as result:
            return _result(result)
    except HTTPError as exc:
        try:
            raw = exc.read(64_000)
            info = json.loads(raw)
            if not isinstance(info, dict):
                info = {"message": "Strix rejected this request"}
        except (ValueError, TypeError):
            info = {"message": "Strix returned an error"}
        return exc.code, {"error": "strix_api_error", "details": info, "status": exc.code}
    except (URLError, TimeoutError, OSError):
        return 502, {"error": "strix_api_unreachable"}


def _result(reply):
    raw = reply.read(MAX_UPSTREAM_BYTES + 1)
    if len(raw) > MAX_UPSTREAM_BYTES:
        return 502, {"error": "strix_response_too_large"}
    kind = reply.headers.get("Content-Type", "").lower().split(";", 1)[0]
    code = reply.status
    if not raw:
        return code, {"ok": True, "status": code}
    if kind in ("application/json", "application/problem+json") or kind.endswith("+json"):
        try:
            return code, json.loads(raw)
        except ValueError:
            return 502, {"error": "invalid_strix_json_response"}
    if kind in ("application/pdf", "application/zip", "application/octet-stream",
                "text/csv", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"):
        return code, {"binary": True, "content_type": kind,
                      "filename": reply.headers.get("Content-Disposition", "")[:180],
                      "base64": base64.b64encode(raw).decode("ascii")}
    return code, {"content_type": kind, "text": raw.decode("utf-8", "replace")[:100000]}
