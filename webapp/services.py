from __future__ import annotations

import io
import re
from typing import Any

import pandas as pd

from agents.vendor_check import VendorCheckAgent
from context.memory import SharedContext
from db.connection import init_db, session_scope
from db.models import AnalystOverride, AuditLog, VendorMaster
from utils.audit import log_analyst_override
from utils.errors import safe_message
from utils.matching import sanitize_like
from webapp.schemas import BatchValidationSummary, ColumnStatus, OverviewResponse

MAX_UPLOAD_SIZE_MB = 200
REQUIRED_COLUMNS = {"vendor_name"}
EXPECTED_COLUMNS = {
    "vendor_name",
    "address",
    "city",
    "state",
    "zip",
    "country",
    "tax_id",
    "source",
}
EXPECTED_ORDERED = [
    "vendor_name",
    "address",
    "city",
    "state",
    "zip",
    "country",
    "tax_id",
    "source",
]

US_STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
    "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
    "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
    "WI", "WY", "DC",
}
TAX_ID_PATTERN = re.compile(r"^\d{2}-\d{7}$")
ZIP_PATTERN = re.compile(r"^\d{5}(-\d{4})?$")


def ensure_database_ready() -> None:
    init_db()


def _new_context() -> SharedContext:
    ctx = SharedContext()
    ctx.new_run()
    return ctx


def validate_vendor_form(record: dict[str, Any]) -> list[str]:
    vendor_name = (record.get("vendor_name") or "").strip()
    tax_id = (record.get("tax_id") or "").strip()
    zip_code = (record.get("zip") or "").strip()
    state = (record.get("state") or "").strip()

    errors: list[str] = []
    if not vendor_name:
        errors.append("Vendor name is required.")
    if tax_id and not TAX_ID_PATTERN.match(tax_id):
        errors.append("Tax ID must be in EIN format: XX-XXXXXXX (e.g. 12-3456789).")
    if zip_code and not ZIP_PATTERN.match(zip_code):
        errors.append("ZIP code must be 5 digits or 5+4 format (e.g. 12345 or 12345-6789).")
    if state and state.upper() not in US_STATES:
        errors.append(f"State '{state}' is not a valid 2-letter US state code.")
    return errors


def parse_vendor_file(file_name: str, content: bytes) -> tuple[list[dict[str, Any]], BatchValidationSummary]:
    file_size_mb = len(content) / (1024 * 1024)
    if file_size_mb > MAX_UPLOAD_SIZE_MB:
        raise ValueError(
            f"File too large ({file_size_mb:.1f} MB). Maximum allowed size is {MAX_UPLOAD_SIZE_MB} MB."
        )

    lower_name = file_name.lower()
    buffer = io.BytesIO(content)
    if lower_name.endswith(".csv"):
        df = pd.read_csv(buffer)
    elif lower_name.endswith((".xlsx", ".xls")):
        df = pd.read_excel(buffer)
    else:
        raise ValueError("Unsupported file type. Upload a CSV, XLSX, or XLS file.")

    df.columns = df.columns.str.strip().str.lower()
    file_cols = set(df.columns)
    missing_required = sorted(REQUIRED_COLUMNS - file_cols)
    missing_optional = sorted(EXPECTED_COLUMNS - REQUIRED_COLUMNS - file_cols)
    extra_columns = sorted(file_cols - EXPECTED_COLUMNS)

    for col in EXPECTED_ORDERED:
        if col not in df.columns:
            df[col] = ""

    columns = [
        ColumnStatus(
            name=name,
            required=name in REQUIRED_COLUMNS,
            status="matched" if name in file_cols else "missing",
        )
        for name in EXPECTED_ORDERED
    ]
    columns.extend(
        ColumnStatus(name=name, required=False, status="extra")
        for name in extra_columns
    )

    summary = BatchValidationSummary(
        file_name=file_name,
        record_count=len(df),
        columns=columns,
        missing_required=missing_required,
        missing_optional=missing_optional,
        extra_columns=extra_columns,
    )

    records = df.fillna("").to_dict(orient="records")
    return records, summary


def run_vendor_check(record: dict[str, Any]) -> dict[str, Any]:
    errors = validate_vendor_form(record)
    if errors:
        raise ValueError(" ".join(errors))
    ctx = _new_context()
    agent = VendorCheckAgent(ctx)
    return agent.run(_normalize_vendor_record(record))


def _normalize_vendor_record(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "vendor_name": (record.get("vendor_name") or "").strip(),
        "address": (record.get("address") or "").strip(),
        "city": (record.get("city") or "").strip(),
        "state": (record.get("state") or "").strip().upper(),
        "zip": (record.get("zip") or "").strip(),
        "country": (record.get("country") or "US").strip() or "US",
        "tax_id": (record.get("tax_id") or "").strip(),
    }


def insert_vendor_record(
    record: dict[str, Any],
    *,
    force_add: bool = False,
    override_reason: str = "",
    analyst_name: str = "analyst",
) -> tuple[int, dict[str, Any], bool]:
    normalized = _normalize_vendor_record(record)
    check_result = run_vendor_check(normalized)

    if check_result["recommendation"] == "warn" and not force_add:
        raise DuplicateWarning(check_result)

    try:
        with session_scope() as session:
            vendor = VendorMaster(
                vendor_name=normalized["vendor_name"],
                address=normalized["address"],
                city=normalized["city"],
                state=normalized["state"],
                zip=normalized["zip"],
                country=normalized["country"],
                tax_id=normalized["tax_id"],
                status="active",
                source="manual_entry",
            )
            session.add(vendor)
            session.flush()
            vendor_id = int(vendor.id)

        used_override = check_result["recommendation"] == "warn" and force_add
        if used_override:
            log_analyst_override(
                vendor_id=vendor_id,
                original_action="block_duplicate",
                override_action="force_insert",
                reason=override_reason or "Analyst override",
                analyst_name=analyst_name,
            )
        return vendor_id, check_result, used_override
    except Exception as exc:
        raise RuntimeError(safe_message(exc)) from exc


def fetch_vendor_directory(
    *,
    search_name: str = "",
    search_tax: str = "",
    include_duplicates: bool = False,
    limit: int = 200,
) -> dict[str, Any]:
    with session_scope() as session:
        total_active = session.query(VendorMaster).filter(VendorMaster.status == "active").count()
        total_all = session.query(VendorMaster).count()

        query = session.query(VendorMaster)
        if not include_duplicates:
            query = query.filter(VendorMaster.status == "active")

        if search_name:
            safe_name = sanitize_like(search_name.strip())
            query = query.filter(VendorMaster.vendor_name.ilike(f"%{safe_name}%"))
        if search_tax:
            safe_tax = sanitize_like(search_tax.strip())
            query = query.filter(VendorMaster.tax_id.ilike(f"%{safe_tax}%"))

        results = query.order_by(VendorMaster.vendor_name).limit(limit).all()
        return {
            "metrics": {
                "active_vendors": total_active,
                "total_records": total_all,
                "duplicates": total_all - total_active,
                "showing": len(results),
            },
            "results": [vendor.to_dict() for vendor in results],
        }


def fetch_duplicate_cluster(vendor_id: int) -> dict[str, Any]:
    with session_scope() as session:
        vendor = session.query(VendorMaster).filter(VendorMaster.id == vendor_id).first()
        if vendor is None or vendor.cluster_id is None:
            raise LookupError("No duplicate cluster found for this vendor.")

        duplicates = (
            session.query(VendorMaster)
            .filter(
                VendorMaster.cluster_id == vendor.cluster_id,
                VendorMaster.status == "duplicate",
            )
            .order_by(VendorMaster.vendor_name)
            .all()
        )
        return {
            "vendor_id": vendor.id,
            "cluster_id": vendor.cluster_id,
            "canonical_vendor": vendor.to_dict(),
            "duplicates": [row.to_dict() for row in duplicates],
        }


def fetch_agent_actions(agent_name: str = "All", limit: int = 200) -> list[dict[str, Any]]:
    with session_scope() as session:
        query = session.query(AuditLog).order_by(AuditLog.timestamp.desc())
        if agent_name != "All":
            query = query.filter(AuditLog.agent_name == agent_name)
        logs = query.limit(limit).all()
        return [
            {
                "id": log.id,
                "agent_name": log.agent_name,
                "action": log.action,
                "vendor_id": log.vendor_id,
                "confidence": log.confidence,
                "timestamp": log.timestamp.isoformat() if log.timestamp else "",
                "details_json": log.details_json,
            }
            for log in logs
        ]


def fetch_override_actions(limit: int = 200) -> list[dict[str, Any]]:
    with session_scope() as session:
        overrides = (
            session.query(AnalystOverride)
            .order_by(AnalystOverride.timestamp.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "id": override.id,
                "vendor_id": override.vendor_id,
                "original_action": override.original_action,
                "override_action": override.override_action,
                "reason": override.reason,
                "analyst_name": override.analyst_name,
                "timestamp": override.timestamp.isoformat() if override.timestamp else "",
            }
            for override in overrides
        ]


def fetch_overview() -> OverviewResponse:
    directory = fetch_vendor_directory(limit=8)
    actions = fetch_agent_actions(limit=4)
    overrides = fetch_override_actions(limit=4)

    metrics = [
        {
            "label": "Active vendors",
            "value": f"{directory['metrics']['active_vendors']:,}",
            "detail": "Canonical suppliers currently available to analysts.",
        },
        {
            "label": "Total records",
            "value": f"{directory['metrics']['total_records']:,}",
            "detail": "Canonical and duplicate records tracked in the master.",
        },
        {
            "label": "Duplicates",
            "value": f"{directory['metrics']['duplicates']:,}",
            "detail": "Records suppressed into duplicate clusters.",
        },
    ]

    recent_activity = [
        {
            "title": f"{entry['agent_name']} · {entry['action']}",
            "detail": _summarize_details(entry.get("details_json")),
            "timestamp": entry["timestamp"],
        }
        for entry in actions
    ]
    recent_activity.extend(
        {
            "title": "Analyst override",
            "detail": override.get("reason") or "Vendor inserted with analyst override.",
            "timestamp": override["timestamp"],
        }
        for override in overrides[:2]
    )

    return OverviewResponse(metrics=metrics, recent_activity=recent_activity[:6])


def _summarize_details(details: Any) -> str:
    if isinstance(details, dict):
        for key in ("message", "match", "new_vendor", "summary"):
            value = details.get(key)
            if value:
                return str(value)[:140]
        return str(details)[:140]
    if isinstance(details, list):
        return f"{len(details)} detail item(s)"
    return (str(details) if details is not None else "No additional details.")[:140]


class DuplicateWarning(Exception):
    def __init__(self, result: dict[str, Any]) -> None:
        self.result = result
        super().__init__(result.get("message", "Potential duplicate found."))
