#!/usr/bin/env python3
"""Unified single-pane operational snapshot for token management."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, List

from guard_contracts import entry_reason, entry_session_key, entry_type
from ops_alerts import alert_status, evaluate_alerts
from ops_sources import (
    COST_DIR,
    STATE_DIR,
    cost_json,
    load_cost_config,
    local_day_window,
    parse_ts,
    read_json,
    read_jsonl_with_stats,
    source_freshness,
    utc_now_iso,
    write_json,
)
from ops_trends import build_trends

AUDIT_LOG = STATE_DIR / "audit.jsonl"
METRICS_LOG = STATE_DIR / "agent-metrics.jsonl"
HEAL_LOG = STATE_DIR / "self-heal.jsonl"
SNAPSHOT_CACHE = COST_DIR / "ops-snapshot-cache.json"


def _window_filter(
    rows: List[Dict[str, Any]], since: datetime, until: datetime
) -> List[Dict[str, Any]]:
    out = []
    for e in rows:
        dt = parse_ts(e.get("ts") or e.get("timestamp"))
        if dt and since <= dt <= until:
            out.append(e)
    return out


def _read_logs(since: datetime, until: datetime) -> Dict[str, Any]:
    audit_all, audit_stats = read_jsonl_with_stats(AUDIT_LOG)
    metrics_all, metrics_stats = read_jsonl_with_stats(METRICS_LOG)
    heal_all, heal_stats = read_jsonl_with_stats(HEAL_LOG)
    audit = _window_filter(audit_all, since, until)
    metrics = _window_filter(metrics_all, since, until)
    heal = _window_filter(heal_all, since, until)
    return {
        "audit": audit,
        "metrics": metrics,
        "self_heal": heal,
        "data_quality": {
            "audit": audit_stats,
            "metrics": metrics_stats,
            "self_heal": heal_stats,
        },
    }


def _build_timeline(
    audit: List[Dict[str, Any]],
    metrics: List[Dict[str, Any]],
    heal: List[Dict[str, Any]],
    alerts_recent: List[Dict[str, Any]],
    limit: int = 30,
) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    for e in audit[-200:]:
        events.append(
            {
                "ts": e.get("ts"),
                "source": "audit",
                "event": e.get("event"),
                "session_key": e.get("session_key") or e.get("session"),
                "rule_id": e.get("rule_id"),
                "message": e.get("message") or e.get("reason_code") or e.get("reason"),
            }
        )
    for e in metrics[-200:]:
        events.append(
            {
                "ts": e.get("ts"),
                "source": "metrics",
                "event": e.get("event") or e.get("record_type"),
                "session_key": e.get("session_key") or e.get("session"),
                "message": f"{e.get('agent_type', 'unknown')} tokens={e.get('total_tokens', 0)} cost={e.get('cost_usd', 0)}"
                if (
                    e.get("event") == "agent_completed"
                    or e.get("record_type") == "usage"
                )
                else str(e.get("agent_type") or ""),
            }
        )
    for e in heal[-100:]:
        events.append(
            {
                "ts": e.get("ts") or e.get("timestamp"),
                "source": "self_heal",
                "event": e.get("event") or e.get("phase") or "self_heal",
                "message": e.get("message") or e.get("summary") or "",
            }
        )
    for e in alerts_recent[-50:]:
        events.append(
            {
                "ts": e.get("ts"),
                "source": "alerts",
                "event": e.get("category"),
                "message": e.get("message"),
                "severity": e.get("severity"),
            }
        )
    events.sort(key=lambda x: str(x.get("ts") or ""))
    return events[-limit:]


def _build_snapshot(
    evaluate_alerts_now: bool = False,
    deliver_alerts: bool = False,
    use_cache: bool = True,
) -> Dict[str, Any]:
    cfg = load_cost_config()
    ttl = int(cfg.get("ops_snapshot_cache_ttl_seconds", 60) or 60)
    if use_cache:
        cached = read_json(SNAPSHOT_CACHE, {}) or {}
        if isinstance(cached, dict):
            ts = parse_ts(cached.get("generated_at"))
            if ts:
                age = (datetime.now(timezone.utc) - ts).total_seconds()
                if age <= ttl:
                    return cached

    since, until = local_day_window()
    logs = _read_logs(since, until)
    audit = logs["audit"]
    metrics = logs["metrics"]
    heal = logs["self_heal"]

    if evaluate_alerts_now:
        evaluate_alerts(trigger_source="ops_today", deliver=deliver_alerts)
    alerts_doc = alert_status(limit=50)
    alerts_recent = alerts_doc.get("recent") or []

    rc_summary, cost_summary, summary_err = cost_json(
        ["summary", "--window", "today"], timeout=12
    )
    rc_budget, budget, budget_err = cost_json(
        ["budget-status", "--period", "daily"], timeout=8
    )
    rc_burn, burn, burn_err = cost_json(["burn-rate-check"], timeout=8)
    rc_anom, anomaly, anom_err = cost_json(["anomaly-check"], timeout=8)
    trends = build_trends(
        window_days=int(cfg.get("trends_default_window_days", 7) or 7)
    )

    blocks = [e for e in audit if e.get("event") == "block"]
    warns = [e for e in audit if e.get("event") in {"warn", "shadow"}]
    allows = [e for e in audit if e.get("event") in {"allow", "allow_team"}]
    usage_rows = [
        e
        for e in metrics
        if (e.get("record_type") == "usage" or e.get("event") == "agent_completed")
    ]
    sessions = Counter(entry_session_key(e) for e in audit + metrics)

    snapshot: Dict[str, Any] = {
        "schema_version": 1,
        "generated_at": utc_now_iso(),
        "time_window": {
            "kind": "today",
            "since": since.isoformat().replace("+00:00", "Z"),
            "until": until.isoformat().replace("+00:00", "Z"),
        },
        "budget": budget
        if isinstance(budget, dict)
        else {"error": budget_err or "budget-status unavailable"},
        "spend": cost_summary
        if isinstance(cost_summary, dict)
        else {"error": summary_err or "summary unavailable"},
        "alerts": {
            "recent_count": len(alerts_recent),
            "recent": alerts_recent[-10:],
            "suppressed": alerts_doc.get("suppressed") or {},
            "active": alerts_doc.get("active") or {},
        },
        "blocks": {
            "count": len(blocks),
            "top_rules": dict(
                Counter(
                    (e.get("rule_id") or entry_reason(e) or "unknown") for e in blocks
                ).most_common(10)
            ),
            "warnings": len(warns),
            "shadow_near_misses": len([e for e in warns if e.get("would_block")]),
        },
        "agents": {
            "spawn_attempts_allowed": len(allows),
            "usage_records": len(usage_rows),
            "completed": len(usage_rows),
            "tokens": sum(int(e.get("total_tokens") or 0) for e in usage_rows),
            "cost_usd": round(
                sum(float(e.get("cost_usd") or 0) for e in usage_rows), 4
            ),
            "types": dict(
                Counter(entry_type(e) for e in usage_rows or allows).most_common(10)
            ),
        },
        "sessions": {
            "active_count_estimate": len([s for s in sessions if s and s != "unknown"]),
            "top": [
                {"session_key": k, "events": v} for k, v in sessions.most_common(10)
            ],
        },
        "self_heal": {
            "events": len(heal),
            "recent": heal[-10:],
        },
        "anomalies": {
            "burn_rate": burn if isinstance(burn, dict) else {"error": burn_err},
            "cost_anomaly": anomaly
            if isinstance(anomaly, dict)
            else {"error": anom_err},
            "trends": trends,
        },
        "data_quality": logs["data_quality"],
        "sources": source_freshness(
            [
                AUDIT_LOG,
                METRICS_LOG,
                HEAL_LOG,
                COST_DIR / "cache.json",
                COST_DIR / "usage-index.json",
                COST_DIR / "budgets.json",
                COST_DIR / "alerts.jsonl",
            ]
        ),
    }
    snapshot["timeline"] = _build_timeline(audit, metrics, heal, alerts_recent)
    write_json(SNAPSHOT_CACHE, snapshot)
    return snapshot


def _render_text(doc: Dict[str, Any]) -> str:
    budget = doc.get("budget") or {}
    spend = doc.get("spend") or {}
    totals = (spend.get("totals") or {}) if isinstance(spend, dict) else {}
    lines = [
        "Token Management Ops Today",
        f"Generated: {doc.get('generated_at')}",
        f"Budget: level={(budget.get('level') or 'unknown')} pct={budget.get('pct')} current=${budget.get('currentUSD')} / limit=${budget.get('limitUSD')}",
        f"Spend: total=${(totals.get('totalUSD') or totals.get('localCostUSD') or 0)} msgs={totals.get('messages', 0)} in={totals.get('inputTokens', 0)} out={totals.get('outputTokens', 0)}",
        f"Blocks: {doc.get('blocks', {}).get('count', 0)} (shadow near-misses: {doc.get('blocks', {}).get('shadow_near_misses', 0)})",
        f"Agents: completed={doc.get('agents', {}).get('completed', 0)} tokens={doc.get('agents', {}).get('tokens', 0):,} cost=${float(doc.get('agents', {}).get('cost_usd', 0) or 0):.4f}",
        f"Alerts: recent={doc.get('alerts', {}).get('recent_count', 0)} active={len(doc.get('alerts', {}).get('active', {}) or {})}",
        f"Self-heal events: {doc.get('self_heal', {}).get('events', 0)}",
        "",
        "Top block rules:",
    ]
    top_rules = doc.get("blocks", {}).get("top_rules") or {}
    if top_rules:
        for k, v in top_rules.items():
            lines.append(f"- {k}: {v}")
    else:
        lines.append("- none")
    lines += ["", "Recent timeline:"]
    for ev in doc.get("timeline", [])[-10:]:
        lines.append(
            f"- {ev.get('ts')} [{ev.get('source')}] {ev.get('event')}: {ev.get('message')}"
        )
    return "\n".join(lines)


def _render_markdown(doc: Dict[str, Any]) -> str:
    budget = doc.get("budget") or {}
    spend = doc.get("spend") or {}
    totals = (spend.get("totals") or {}) if isinstance(spend, dict) else {}
    lines = [
        "# Token Management Ops Today",
        "",
        f"- Generated: {doc.get('generated_at')}",
        f"- Budget: `{budget.get('level', 'unknown')}` ({budget.get('pct')}%) current=${budget.get('currentUSD')} / limit=${budget.get('limitUSD')}",
        f"- Spend: ${totals.get('totalUSD') or totals.get('localCostUSD') or 0} ({totals.get('messages', 0)} msgs)",
        f"- Blocks: {doc.get('blocks', {}).get('count', 0)}",
        f"- Shadow near-misses: {doc.get('blocks', {}).get('shadow_near_misses', 0)}",
        f"- Alerts (recent): {doc.get('alerts', {}).get('recent_count', 0)}",
        "",
        "## Top Block Rules",
    ]
    for k, v in (doc.get("blocks", {}).get("top_rules") or {}).items():
        lines.append(f"- {k}: {v}")
    if not (doc.get("blocks", {}).get("top_rules") or {}):
        lines.append("- none")
    lines += ["", "## Recent Events"]
    for ev in doc.get("timeline", [])[-15:]:
        lines.append(
            f"- `{ev.get('ts')}` **{ev.get('source')}:{ev.get('event')}** {ev.get('message')}"
        )
    return "\n".join(lines)


def _render_statusline(doc: Dict[str, Any]) -> str:
    budget = doc.get("budget") or {}
    agents = doc.get("agents") or {}
    blocks = doc.get("blocks") or {}
    level = str(budget.get("level") or "none").upper()
    return f"OPS budget={level}:{budget.get('pct', '?')}% blocks={blocks.get('count', 0)} agents={agents.get('completed', 0)} cost=${float(agents.get('cost_usd', 0) or 0):.2f}"


def main() -> int:
    ap = argparse.ArgumentParser(description="Unified token management ops snapshot")
    ap.add_argument("today", nargs="?")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--markdown", action="store_true")
    ap.add_argument("--statusline", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--evaluate-alerts", action="store_true")
    ap.add_argument("--deliver-alerts", action="store_true")
    args = ap.parse_args()
    doc = _build_snapshot(
        evaluate_alerts_now=args.evaluate_alerts,
        deliver_alerts=args.deliver_alerts,
        use_cache=not args.refresh,
    )
    if args.json:
        print(json.dumps(doc, indent=2))
    elif args.markdown:
        print(_render_markdown(doc))
    elif args.statusline:
        print(_render_statusline(doc))
    else:
        print(_render_text(doc))
    return 0


def build_ops_today(**kwargs: Any) -> Dict[str, Any]:
    return _build_snapshot(**kwargs)


def render_ops_today(doc: Dict[str, Any], fmt: str = "text") -> str:
    if fmt == "json":
        return json.dumps(doc, indent=2)
    if fmt == "markdown":
        return _render_markdown(doc)
    if fmt == "statusline":
        return _render_statusline(doc)
    return _render_text(doc)


if __name__ == "__main__":
    raise SystemExit(main())
