"""Maps only measured coordinates in local run events. Never synthesizes attacks."""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone

def _position(value):
    if not isinstance(value, dict):
        return None
    lat = value.get("lat", value.get("latitude"))
    lon = value.get("lon", value.get("lng", value.get("longitude")))
    if isinstance(lat, bool) or isinstance(lon, bool):
        return None
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(v) for v in (lat, lon)) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return {"lat": lat, "lon": lon}

def observed_events(db, limit=250):
    rows = db.execute(
        "SELECT run,id,data FROM events ORDER BY rowid DESC LIMIT ?", (min(limit * 8, 2000),)
    ).fetchall()
    points = []
    for row in rows:
        try:
            event = json.loads(row["data"])
            data = event.get("data") if isinstance(event.get("data"), dict) else event
            geo = data.get("geo") if isinstance(data.get("geo"), dict) else {}
            source = _position(geo.get("source") or data.get("source_geo"))
            target = _position(geo.get("target") or geo.get("destination") or data.get("target_geo"))
            point = target or source or _position(geo)
            if not point:
                continue
            points.append({
                "id": str(row["id"])[:128], "run": str(row["run"])[:128],
                "type": str(event.get("type") or data.get("type") or "recorded-event")[:80],
                "timestamp": str(event.get("timestamp") or data.get("timestamp") or "")[:60],
                "source": source, "target": target, "point": point,
                "label": str(data.get("label") or event.get("type") or "Observed event")[:120]
            })
            if len(points) >= limit:
                break
        except (TypeError, ValueError, AttributeError):
            continue
    return {"source": "Atlas HQ recorded events with supplied coordinates",
            "received_at": datetime.now(timezone.utc).isoformat(),
            "events": points, "count": len(points), "synthetic_events": False}
