from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class SessionResponse(BaseModel):
    require_auth: bool
    authenticated: bool


class LoginRequest(BaseModel):
    password: str = ""


class LoginResponse(BaseModel):
    success: bool


class ColumnStatus(BaseModel):
    name: str
    required: bool
    status: Literal["matched", "missing", "extra"]


class BatchValidationSummary(BaseModel):
    file_name: str
    record_count: int
    columns: list[ColumnStatus]
    missing_required: list[str]
    missing_optional: list[str]
    extra_columns: list[str]


class BatchJobResult(BaseModel):
    load_result: dict[str, Any] = Field(default_factory=dict)
    quality_report: dict[str, Any] = Field(default_factory=dict)


class BatchJobResponse(BaseModel):
    job_id: str
    file_name: str
    status: Literal["queued", "running", "completed", "failed"]
    progress: float
    current_step: str
    validation: BatchValidationSummary
    result: BatchJobResult | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime


class VendorRecordInput(BaseModel):
    vendor_name: str
    address: str = ""
    city: str = ""
    state: str = ""
    zip: str = ""
    country: str = "US"
    tax_id: str = ""


class VendorCheckResponse(BaseModel):
    recommendation: Literal["allow", "warn", "block"]
    matches: list[dict[str, Any]]
    message: str


class VendorCreateRequest(BaseModel):
    vendor: VendorRecordInput
    force_add: bool = False
    override_reason: str = ""
    analyst_name: str = "analyst"


class VendorCreateResponse(BaseModel):
    vendor_id: int
    status: Literal["created", "created_with_override"]
    duplicate_check: VendorCheckResponse


class VendorSearchResult(BaseModel):
    id: int
    vendor_name: str
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip: str | None = None
    country: str | None = None
    tax_id: str | None = None
    status: str | None = None
    cluster_id: int | None = None
    source: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class VendorMetrics(BaseModel):
    active_vendors: int
    total_records: int
    duplicates: int
    showing: int


class VendorSearchResponse(BaseModel):
    metrics: VendorMetrics
    results: list[VendorSearchResult]


class DuplicateClusterResponse(BaseModel):
    vendor_id: int
    cluster_id: int
    canonical_vendor: VendorSearchResult
    duplicates: list[VendorSearchResult]


class AgentAuditEntry(BaseModel):
    id: int
    agent_name: str
    action: str
    vendor_id: int | None = None
    confidence: float | None = None
    timestamp: str
    details_json: dict[str, Any] | list[Any] | str | None = None


class OverrideAuditEntry(BaseModel):
    id: int
    vendor_id: int
    original_action: str
    override_action: str
    reason: str | None = None
    analyst_name: str | None = None
    timestamp: str


class AgentAuditResponse(BaseModel):
    entries: list[AgentAuditEntry]


class OverrideAuditResponse(BaseModel):
    entries: list[OverrideAuditEntry]


class OverviewMetric(BaseModel):
    label: str
    value: str
    detail: str


class OverviewActivityItem(BaseModel):
    title: str
    detail: str
    timestamp: str


class OverviewResponse(BaseModel):
    metrics: list[OverviewMetric]
    recent_activity: list[OverviewActivityItem]
