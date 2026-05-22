import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  FolderSearch,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  startTransition,
  useDeferredValue,
  useEffect,
  useState,
} from "react";
import { Link } from "react-router-dom";

import {
  ApiError,
  checkVendor,
  createBatchJob,
  createVendor,
  fetchAgentAudit,
  fetchBatchJob,
  fetchDuplicateCluster,
  fetchOverview,
  fetchOverrideAudit,
  fetchVendors,
} from "./api";
import { EmptyState, GlassPanel, MetricCard, PageHeader } from "./components";
import type {
  AgentAuditEntry,
  BatchJobResponse,
  DuplicateClusterResponse,
  OverviewResponse,
  OverrideAuditEntry,
  VendorCheckResponse,
  VendorCreatePayload,
  VendorRow,
  VendorSearchResponse,
} from "./types";

const STEP_COPY = [
  "Cleaning and standardizing records...",
  "Finding and clustering duplicates...",
  "Inserting into vendor master database...",
];

const AGENT_FILTERS = [
  "All",
  "DataQualityAgent",
  "DeduplicationAgent",
  "LoaderAgent",
  "VendorCheckAgent",
];

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function defaultVendorPayload(): VendorCreatePayload {
  return {
    vendor: {
      vendor_name: "",
      address: "",
      city: "",
      state: "",
      zip: "",
      country: "US",
      tax_id: "",
    },
    force_add: false,
    override_reason: "",
    analyst_name: "analyst",
  };
}

export function OverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchOverview()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load overview."));
  }, []);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Overview"
        title="A calmer way to run vendor operations."
        description="Review the state of your vendor master, move into live workflows, and keep analysts oriented as batch jobs and exceptions unfold."
      />
      {error ? <p className="error-text">{error}</p> : null}
      <div className="metric-grid">
        {data?.metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>
      <div className="two-column-grid">
        <GlassPanel title="Workflow shortcuts" aside="Move directly into the four core analyst paths.">
          <div className="shortcut-grid">
            <Link to="/batch" className="shortcut-card">
              <Upload size={18} />
              <div>
                <h4>Batch Pipeline</h4>
                <p>Upload, validate, and monitor staged processing.</p>
              </div>
              <ArrowUpRight size={16} />
            </Link>
            <Link to="/add-vendor" className="shortcut-card">
              <ShieldCheck size={18} />
              <div>
                <h4>Add Vendor</h4>
                <p>Check a new supplier before it lands in the master.</p>
              </div>
              <ArrowUpRight size={16} />
            </Link>
            <Link to="/vendor-master" className="shortcut-card">
              <FolderSearch size={18} />
              <div>
                <h4>Vendor Master</h4>
                <p>Search the canonical vendor directory and inspect clusters.</p>
              </div>
              <ArrowUpRight size={16} />
            </Link>
            <Link to="/audit" className="shortcut-card">
              <Activity size={18} />
              <div>
                <h4>Audit Trail</h4>
                <p>Trace agent actions and human overrides in one place.</p>
              </div>
              <ArrowUpRight size={16} />
            </Link>
          </div>
        </GlassPanel>
        <GlassPanel title="Recent activity" aside="Latest agent and analyst events across the workspace.">
          <div className="activity-list">
            {data?.recent_activity.length ? (
              data.recent_activity.map((item) => (
                <div className="activity-row" key={`${item.title}-${item.timestamp}`}>
                  <div>
                    <p className="activity-title">{item.title}</p>
                    <p className="activity-detail">{item.detail}</p>
                  </div>
                  <span className="activity-time">{formatDate(item.timestamp)}</span>
                </div>
              ))
            ) : (
              <EmptyState
                title="No recent activity yet"
                description="Process a file or review a duplicate check to populate this feed."
              />
            )}
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}

export function BatchPipelinePage() {
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<BatchJobResponse | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) {
      return;
    }
    const timer = window.setInterval(() => {
      fetchBatchJob(job.job_id)
        .then(setJob)
        .catch((err) => setError(err instanceof Error ? err.message : "Failed to refresh job status."));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [job]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Choose a CSV, XLSX, or XLS file to begin.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const createdJob = await createBatchJob(file);
      setJob(createdJob);
    } catch (err) {
      if (err instanceof ApiError && typeof err.detail === "object") {
        const detail = err.detail as { message?: string };
        setError(detail.message ?? err.message);
      } else {
        setError(err instanceof Error ? err.message : "Failed to start batch job.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Batch Pipeline"
        title="Upload once. Watch the full pipeline stay legible."
        description="Bring in a vendor file, validate its shape, and follow each stage of cleaning, clustering, and loading without losing the thread."
      />
      <div className="two-column-grid">
        <GlassPanel title="Upload vendor file" aside="CSV, XLSX, and XLS are supported.">
          <form className="stacked-form" onSubmit={handleSubmit}>
            <label className="upload-surface">
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null)}
              />
              <Upload size={24} />
              <div>
                <p>{file ? file.name : "Drop a vendor file here or click to browse."}</p>
                <span>We’ll validate required columns before the job runs.</span>
              </div>
            </label>
            {error ? <p className="error-text">{error}</p> : null}
            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? "Starting..." : "Start pipeline"}
            </button>
          </form>
        </GlassPanel>
        <GlassPanel title="Progress stage" aside="Live updates from the running in-process job.">
          {job ? (
            <div className="batch-status">
              <div className="status-pill-row">
                <span className={`status-pill status-${job.status}`}>{job.status}</span>
                <span>{job.file_name}</span>
              </div>
              <div className="progress-shell">
                <motion.div
                  className="progress-fill"
                  animate={{ width: `${Math.max(job.progress * 100, 4)}%` }}
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              </div>
              <p className="status-copy">{job.current_step}</p>
              <div className="timeline-list">
                {STEP_COPY.map((label, index) => {
                  const isActive = job.current_step === label;
                  const isComplete = job.progress > index / STEP_COPY.length;
                  return (
                    <div className={`timeline-row${isActive ? " active" : ""}`} key={label}>
                      <span className={`timeline-dot${isComplete ? " complete" : ""}`} />
                      <div>
                        <p>{label}</p>
                        <span>{isComplete ? "Completed or in progress" : "Waiting"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState
              title="No active batch job"
              description="Upload a file to see validation, progress, and post-run quality reporting here."
            />
          )}
        </GlassPanel>
      </div>

      {job?.validation ? (
        <GlassPanel
          title="Column validation"
          aside={`${job.validation.record_count.toLocaleString()} records detected in ${job.validation.file_name}.`}
        >
          <div className="chip-row">
            {job.validation.columns.map((column) => (
              <span key={column.name} className={`field-chip field-chip-${column.status}`}>
                {column.name}
                {column.required ? " *" : ""}
              </span>
            ))}
          </div>
        </GlassPanel>
      ) : null}

      {job?.result ? (
        <div className="page-stack">
          <div className="metric-grid">
            <MetricCard
              label="Total processed"
              value={`${job.result.load_result.total_processed ?? 0}`}
              detail="Records read from the uploaded file."
            />
            <MetricCard
              label="Canonical vendors"
              value={`${job.result.load_result.inserted_canonical ?? 0}`}
              detail="Unique records retained in the active master."
            />
            <MetricCard
              label="Duplicates marked"
              value={`${job.result.load_result.duplicates_marked ?? 0}`}
              detail="Records suppressed into duplicate clusters."
            />
            <MetricCard
              label="Clusters"
              value={`${job.result.load_result.clusters ?? 0}`}
              detail="Distinct duplicate groupings detected during processing."
            />
          </div>
          <GlassPanel title="Quality report" aside="Generated during the data quality stage.">
            <div className="quality-grid">
              <div className="quality-summary">
                {(job.result.quality_report.needs_review as boolean) ? (
                  <AlertTriangle size={18} />
                ) : (
                  <CheckCircle2 size={18} />
                )}
                <div>
                  <p>
                    {(job.result.quality_report.needs_review as boolean)
                      ? "Review recommended before downstream trust expands."
                      : "Quality looks healthy for this run."}
                  </p>
                  <span>
                    Issue rate:{" "}
                    {Math.round(Number(job.result.quality_report.quality_issue_rate ?? 0) * 100)}%
                  </span>
                </div>
              </div>
              <div className="quality-stats">
                <span>Clean: {job.result.quality_report.total_records && job.result.quality_report.flagged_records ? Number(job.result.quality_report.total_records) - Number(job.result.quality_report.flagged_records) : 0}</span>
                <span>Flagged: {job.result.quality_report.flagged_records ?? 0}</span>
                <span>Total issues: {job.result.quality_report.total_issues ?? 0}</span>
              </div>
            </div>
          </GlassPanel>
        </div>
      ) : null}
    </div>
  );
}

export function AddVendorPage() {
  const [payload, setPayload] = useState(defaultVendorPayload);
  const [checkResult, setCheckResult] = useState<VendorCheckResponse | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateField(key: keyof VendorCreatePayload["vendor"], value: string) {
    setPayload((current) => ({
      ...current,
      vendor: { ...current.vendor, [key]: value },
    }));
  }

  async function handleCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const result = await checkVendor(payload);
      setCheckResult(result);
      setMessage(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vendor check failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreate(forceAdd: boolean) {
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const result = await createVendor({ ...payload, force_add: forceAdd });
      setMessage(
        result.status === "created_with_override"
          ? `Vendor added with override as record #${result.vendor_id}.`
          : `Vendor added as record #${result.vendor_id}.`,
      );
      setCheckResult(result.duplicate_check);
      setPayload(defaultVendorPayload());
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && typeof err.detail === "object") {
        const detail = err.detail as VendorCheckResponse;
        setCheckResult(detail);
        setMessage(detail.message);
      } else {
        setError(err instanceof Error ? err.message : "Vendor insert failed.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Add Vendor"
        title="Review each supplier before it touches the master."
        description="Check a new vendor against existing records, inspect potential duplicates, and make an explicit analyst decision when exceptions matter."
      />
      <div className="split-stage">
        <GlassPanel title="Vendor details" aside="Structured entry with lightweight validation on the API side.">
          <form className="stacked-form" onSubmit={handleCheck}>
            <div className="form-grid">
              <label className="field">
                <span>Vendor name</span>
                <input value={payload.vendor.vendor_name} onChange={(event) => updateField("vendor_name", event.target.value)} />
              </label>
              <label className="field">
                <span>Tax ID</span>
                <input value={payload.vendor.tax_id} onChange={(event) => updateField("tax_id", event.target.value)} />
              </label>
              <label className="field">
                <span>Address</span>
                <input value={payload.vendor.address} onChange={(event) => updateField("address", event.target.value)} />
              </label>
              <label className="field">
                <span>City</span>
                <input value={payload.vendor.city} onChange={(event) => updateField("city", event.target.value)} />
              </label>
              <label className="field">
                <span>State</span>
                <input value={payload.vendor.state} onChange={(event) => updateField("state", event.target.value)} />
              </label>
              <label className="field">
                <span>ZIP code</span>
                <input value={payload.vendor.zip} onChange={(event) => updateField("zip", event.target.value)} />
              </label>
              <label className="field">
                <span>Country</span>
                <input value={payload.vendor.country} onChange={(event) => updateField("country", event.target.value)} />
              </label>
              <label className="field">
                <span>Override reason</span>
                <input value={payload.override_reason} onChange={(event) => setPayload((current) => ({ ...current, override_reason: event.target.value }))} />
              </label>
            </div>
            {error ? <p className="error-text">{error}</p> : null}
            {message ? <p className="info-text">{message}</p> : null}
            <div className="button-row">
              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting ? "Checking..." : "Check vendor"}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={submitting || !checkResult || checkResult.recommendation === "warn"}
                onClick={() => void handleCreate(false)}
              >
                Add vendor
              </button>
              <button
                className="ghost-button"
                type="button"
                disabled={submitting || !checkResult || checkResult.recommendation !== "warn"}
                onClick={() => void handleCreate(true)}
              >
                Override and add
              </button>
            </div>
          </form>
        </GlassPanel>
        <GlassPanel title="Duplicate intelligence" aside="Potential matches stay visible while the analyst decides.">
          {checkResult ? (
            <div className="matches-stack">
              <div className={`status-banner status-${checkResult.recommendation}`}>
                <p>{checkResult.message}</p>
              </div>
              {checkResult.matches.length ? (
                checkResult.matches.map((match, index) => (
                  <div className="match-card" key={`${match.vendor_id ?? index}`}>
                    <div className="match-head">
                      <h4>{String(match.vendor_name ?? "Potential match")}</h4>
                      <span>{String(match.score ?? "n/a")}% match</span>
                    </div>
                    <p>{String(match.address ?? "No address on file")}</p>
                    <div className="meta-row">
                      <span>Tax ID: {String(match.tax_id ?? "n/a")}</span>
                      <span>{match.tax_id_match ? "Exact tax match" : "Fuzzy match"}</span>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="No conflicting records found"
                  description="Run a check to see possible duplicates and confidence signals here."
                />
              )}
            </div>
          ) : (
            <EmptyState
              title="Awaiting a vendor check"
              description="Use the form to evaluate the supplier before you add it."
            />
          )}
        </GlassPanel>
      </div>
    </div>
  );
}

export function VendorMasterPage() {
  const [searchName, setSearchName] = useState("");
  const [searchTax, setSearchTax] = useState("");
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const deferredName = useDeferredValue(searchName);
  const deferredTax = useDeferredValue(searchTax);
  const [data, setData] = useState<VendorSearchResponse | null>(null);
  const [error, setError] = useState("");
  const [cluster, setCluster] = useState<DuplicateClusterResponse | null>(null);

  useEffect(() => {
    fetchVendors(deferredName, deferredTax, includeDuplicates)
      .then((response) => {
        startTransition(() => setData(response));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load vendors."));
  }, [deferredName, deferredTax, includeDuplicates]);

  async function openCluster(vendorId: number) {
    try {
      const response = await fetchDuplicateCluster(vendorId);
      setCluster(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load duplicate cluster.");
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Vendor Master"
        title="Search the master with context still attached."
        description="Filter the active directory, compare duplicate clusters, and keep summary metrics visible while you investigate."
      />
      <GlassPanel title="Search controls" aside="Results update as filters settle.">
        <div className="search-bar">
          <label className="field">
            <span>Vendor name</span>
            <input value={searchName} onChange={(event) => setSearchName(event.target.value)} />
          </label>
          <label className="field">
            <span>Tax ID</span>
            <input value={searchTax} onChange={(event) => setSearchTax(event.target.value)} />
          </label>
          <label className="toggle-field">
            <span>Include duplicates</span>
            <button
              type="button"
              className={`toggle-button${includeDuplicates ? " active" : ""}`}
              onClick={() => setIncludeDuplicates((current) => !current)}
            >
              {includeDuplicates ? "On" : "Off"}
            </button>
          </label>
        </div>
      </GlassPanel>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="metric-grid">
        <MetricCard
          label="Active vendors"
          value={`${data?.metrics.active_vendors ?? 0}`}
          detail="Canonical vendors shown by default."
        />
        <MetricCard
          label="Total records"
          value={`${data?.metrics.total_records ?? 0}`}
          detail="Includes duplicate rows and manual entries."
        />
        <MetricCard
          label="Duplicates"
          value={`${data?.metrics.duplicates ?? 0}`}
          detail="Rows marked as duplicates across active clusters."
        />
        <MetricCard
          label="Currently showing"
          value={`${data?.metrics.showing ?? 0}`}
          detail="Capped for faster analyst review."
        />
      </div>
      <GlassPanel title="Search results" aside="Up to 200 rows per view.">
        {data?.results.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Location</th>
                  <th>Tax ID</th>
                  <th>Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.results.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <p>{row.vendor_name}</p>
                      <span>{row.status ?? "active"}</span>
                    </td>
                    <td>{[row.city, row.state].filter(Boolean).join(", ") || "No location"}</td>
                    <td>{row.tax_id || "n/a"}</td>
                    <td>{row.source || "n/a"}</td>
                    <td>
                      {row.cluster_id && !includeDuplicates ? (
                        <button className="ghost-button small" type="button" onClick={() => void openCluster(row.id)}>
                          View cluster
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No vendors found"
            description="Adjust the filters or process a file in the batch pipeline to populate the master."
          />
        )}
      </GlassPanel>
      {cluster ? (
        <motion.aside
          className="drawer glass-surface"
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
        >
          <div className="drawer-head">
            <div>
              <p className="eyebrow">Duplicate cluster #{cluster.cluster_id}</p>
              <h3>{cluster.canonical_vendor.vendor_name}</h3>
            </div>
            <button className="ghost-button small" type="button" onClick={() => setCluster(null)}>
              Close
            </button>
          </div>
          <div className="matches-stack">
            {cluster.duplicates.map((row) => (
              <div className="match-card" key={row.id}>
                <div className="match-head">
                  <h4>{row.vendor_name}</h4>
                  <span>{row.source ?? "n/a"}</span>
                </div>
                <p>{row.address || "No address on file"}</p>
                <div className="meta-row">
                  <span>{[row.city, row.state].filter(Boolean).join(", ") || "No location"}</span>
                  <span>{row.tax_id || "No tax ID"}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.aside>
      ) : null}
    </div>
  );
}

export function AuditTrailPage() {
  const [mode, setMode] = useState<"actions" | "overrides">("actions");
  const [agent, setAgent] = useState("All");
  const [actions, setActions] = useState<AgentAuditEntry[]>([]);
  const [overrides, setOverrides] = useState<OverrideAuditEntry[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (mode === "actions") {
      fetchAgentAudit(agent)
        .then((response) => setActions(response.entries))
        .catch((err) => setError(err instanceof Error ? err.message : "Failed to load agent audit."));
      return;
    }
    fetchOverrideAudit()
      .then((response) => setOverrides(response.entries))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load override audit."));
  }, [agent, mode]);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Audit Trail"
        title="Every agent move, every human override."
        description="Switch between autonomous system actions and analyst decisions without losing the surrounding context."
      />
      <GlassPanel title="Audit mode" aside="Filter the feed by source.">
        <div className="segmented-control" role="tablist" aria-label="Audit mode">
          <button
            className={`segment${mode === "actions" ? " active" : ""}`}
            type="button"
            onClick={() => setMode("actions")}
          >
            Agent actions
          </button>
          <button
            className={`segment${mode === "overrides" ? " active" : ""}`}
            type="button"
            onClick={() => setMode("overrides")}
          >
            Analyst overrides
          </button>
        </div>
        {mode === "actions" ? (
          <div className="chip-row">
            {AGENT_FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                className={`filter-chip${value === agent ? " active" : ""}`}
                onClick={() => setAgent(value)}
              >
                {value}
              </button>
            ))}
          </div>
        ) : null}
      </GlassPanel>
      {error ? <p className="error-text">{error}</p> : null}
      <GlassPanel title={mode === "actions" ? "Agent activity" : "Override history"}>
        <div className="table-wrap">
          {mode === "actions" ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Action</th>
                  <th>Confidence</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.agent_name}</td>
                    <td>{entry.action}</td>
                    <td>{entry.confidence ? `${Math.round(entry.confidence * 100)}%` : "n/a"}</td>
                    <td>{formatDate(entry.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vendor ID</th>
                  <th>Original action</th>
                  <th>Override</th>
                  <th>Reason</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.vendor_id}</td>
                    <td>{entry.original_action}</td>
                    <td>{entry.override_action}</td>
                    <td>{entry.reason || "No reason provided"}</td>
                    <td>{formatDate(entry.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}
