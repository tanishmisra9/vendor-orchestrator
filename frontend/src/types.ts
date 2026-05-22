export type SessionResponse = {
  require_auth: boolean;
  authenticated: boolean;
};

export type LoginPayload = {
  password: string;
};

export type OverviewMetric = {
  label: string;
  value: string;
  detail: string;
};

export type OverviewActivityItem = {
  title: string;
  detail: string;
  timestamp: string;
};

export type OverviewResponse = {
  metrics: OverviewMetric[];
  recent_activity: OverviewActivityItem[];
};

export type ColumnStatus = {
  name: string;
  required: boolean;
  status: "matched" | "missing" | "extra";
};

export type BatchValidationSummary = {
  file_name: string;
  record_count: number;
  columns: ColumnStatus[];
  missing_required: string[];
  missing_optional: string[];
  extra_columns: string[];
};

export type BatchJobResult = {
  load_result: Record<string, number>;
  quality_report: Record<string, number | boolean>;
};

export type BatchJobResponse = {
  job_id: string;
  file_name: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  current_step: string;
  validation: BatchValidationSummary;
  result: BatchJobResult | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type VendorRecord = {
  vendor_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  tax_id: string;
};

export type VendorCheckResponse = {
  recommendation: "allow" | "warn" | "block";
  matches: Array<Record<string, string | number | boolean | null>>;
  message: string;
};

export type VendorCreatePayload = {
  vendor: VendorRecord;
  force_add: boolean;
  override_reason: string;
  analyst_name: string;
};

export type VendorCreateResponse = {
  vendor_id: number;
  status: "created" | "created_with_override";
  duplicate_check: VendorCheckResponse;
};

export type VendorRow = {
  id: number;
  vendor_name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  tax_id: string | null;
  status: string | null;
  cluster_id: number | null;
  source: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type VendorSearchResponse = {
  metrics: {
    active_vendors: number;
    total_records: number;
    duplicates: number;
    showing: number;
  };
  results: VendorRow[];
};

export type DuplicateClusterResponse = {
  vendor_id: number;
  cluster_id: number;
  canonical_vendor: VendorRow;
  duplicates: VendorRow[];
};

export type AgentAuditEntry = {
  id: number;
  agent_name: string;
  action: string;
  vendor_id: number | null;
  confidence: number | null;
  timestamp: string;
  details_json: Record<string, unknown> | string | null;
};

export type OverrideAuditEntry = {
  id: number;
  vendor_id: number;
  original_action: string;
  override_action: string;
  reason: string | null;
  analyst_name: string | null;
  timestamp: string;
};

export type AgentAuditResponse = {
  entries: AgentAuditEntry[];
};

export type OverrideAuditResponse = {
  entries: OverrideAuditEntry[];
};
