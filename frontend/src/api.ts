import type {
  AgentAuditResponse,
  BatchJobResponse,
  DuplicateClusterResponse,
  LoginPayload,
  OverviewResponse,
  OverrideAuditResponse,
  SessionResponse,
  VendorCheckResponse,
  VendorCreatePayload,
  VendorCreateResponse,
  VendorSearchResponse,
} from "./types";

type ApiMethod = "GET" | "POST";

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : "Request failed.");
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(
  path: string,
  method: ApiMethod = "GET",
  body?: BodyInit | object,
) {
  const init: RequestInit = {
    method,
    credentials: "include",
    headers: {},
  };

  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }

  const response = await fetch(path, init);
  if (!response.ok) {
    let detail: unknown = response.statusText;
    const rawBody = await response.text();
    try {
      const payload = rawBody ? JSON.parse(rawBody) : {};
      detail = payload.detail ?? payload;
    } catch {
      detail = rawBody || response.statusText;
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function fetchSession() {
  return request<SessionResponse>("/api/session");
}

export function login(payload: LoginPayload) {
  return request("/api/auth/login", "POST", payload);
}

export function logout() {
  return request("/api/auth/logout", "POST");
}

export function fetchOverview() {
  return request<OverviewResponse>("/api/overview");
}

export function createBatchJob(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return request<BatchJobResponse>("/api/batch-jobs", "POST", formData);
}

export function fetchBatchJob(jobId: string) {
  return request<BatchJobResponse>(`/api/batch-jobs/${jobId}`);
}

export function checkVendor(payload: VendorCreatePayload) {
  return request<VendorCheckResponse>("/api/vendors/check", "POST", payload);
}

export function createVendor(payload: VendorCreatePayload) {
  return request<VendorCreateResponse>("/api/vendors", "POST", payload);
}

export function fetchVendors(searchName = "", searchTax = "", includeDuplicates = false) {
  const params = new URLSearchParams();
  if (searchName) {
    params.set("search_name", searchName);
  }
  if (searchTax) {
    params.set("search_tax", searchTax);
  }
  if (includeDuplicates) {
    params.set("include_duplicates", "true");
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<VendorSearchResponse>(`/api/vendors${suffix}`);
}

export function fetchDuplicateCluster(vendorId: number) {
  return request<DuplicateClusterResponse>(`/api/vendors/${vendorId}/duplicates`);
}

export function fetchAgentAudit(agentName = "All") {
  const params = new URLSearchParams({ agent_name: agentName });
  return request<AgentAuditResponse>(`/api/audit/agent-actions?${params.toString()}`);
}

export function fetchOverrideAudit() {
  return request<OverrideAuditResponse>("/api/audit/overrides");
}
