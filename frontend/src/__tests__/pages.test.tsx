import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { AddVendorPage, AuditTrailPage, BatchPipelinePage, VendorMasterPage } from "../pages";

const fetchMock = vi.fn();

describe("frontend pages", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("renders batch validation after upload", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          job_id: "job-1",
          file_name: "vendors.csv",
          status: "queued",
          progress: 0.02,
          current_step: "Preparing records",
          validation: {
            file_name: "vendors.csv",
            record_count: 3,
            columns: [{ name: "vendor_name", required: true, status: "matched" }],
            missing_required: [],
            missing_optional: [],
            extra_columns: [],
          },
          result: null,
          error_message: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        { status: 200 },
      ),
    );

    render(
      <MemoryRouter>
        <BatchPipelinePage />
      </MemoryRouter>,
    );

    const input = screen.getByLabelText(/Drop a vendor file here or click to browse./i);
    const file = new File(["vendor_name\nAcme"], "vendors.csv", { type: "text/csv" });
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole("button", { name: /Start pipeline/i }));

    expect(await screen.findByText(/Column validation/i)).toBeInTheDocument();
    expect(screen.getByText(/vendor_name/i)).toBeInTheDocument();
  });

  it("renders vendor matches after a check", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          recommendation: "warn",
          message: "High-confidence duplicate found.",
          matches: [
            {
              vendor_id: 1,
              vendor_name: "Acme Corporation",
              address: "123 Main Street",
              tax_id: "12-3456789",
              score: 97,
              tax_id_match: true,
            },
          ],
        }),
        { status: 200 },
      ),
    );

    render(
      <MemoryRouter>
        <AddVendorPage />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText(/Vendor name/i), "Acme Corp");
    await userEvent.click(screen.getByRole("button", { name: /Check vendor/i }));

    expect(await screen.findAllByText(/High-confidence duplicate found/i)).toHaveLength(2);
    expect(screen.getByText(/Acme Corporation/i)).toBeInTheDocument();
  });

  it("loads vendor results and opens a duplicate cluster", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            metrics: {
              active_vendors: 3,
              total_records: 4,
              duplicates: 1,
              showing: 1,
            },
            results: [
              {
                id: 1,
                vendor_name: "Acme Corp",
                address: "123 Main",
                city: "Austin",
                state: "TX",
                zip: "78701",
                country: "US",
                tax_id: "12-3456789",
                status: "active",
                cluster_id: 99,
                source: "batch",
                created_at: null,
                updated_at: null,
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            vendor_id: 1,
            cluster_id: 99,
            canonical_vendor: {
              id: 1,
              vendor_name: "Acme Corp",
              address: "123 Main",
              city: "Austin",
              state: "TX",
              zip: "78701",
              country: "US",
              tax_id: "12-3456789",
              status: "active",
              cluster_id: 99,
              source: "batch",
              created_at: null,
              updated_at: null,
            },
            duplicates: [
              {
                id: 2,
                vendor_name: "ACME Corporation",
                address: "123 Main Street",
                city: "Austin",
                state: "TX",
                zip: "78701",
                country: "US",
                tax_id: "12-3456789",
                status: "duplicate",
                cluster_id: 99,
                source: "batch",
                created_at: null,
                updated_at: null,
              },
            ],
          }),
          { status: 200 },
        ),
      );

    render(
      <MemoryRouter>
        <VendorMasterPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Acme Corp/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /View cluster/i }));
    expect(await screen.findByText(/Duplicate cluster #99/i)).toBeInTheDocument();
  });

  it("switches audit modes", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entries: [
              {
                id: 1,
                agent_name: "LoaderAgent",
                action: "insert",
                vendor_id: 10,
                confidence: 0.92,
                timestamp: new Date().toISOString(),
                details_json: null,
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entries: [
              {
                id: 1,
                vendor_id: 10,
                original_action: "block_duplicate",
                override_action: "force_insert",
                reason: "Reviewed manually",
                analyst_name: "analyst",
                timestamp: new Date().toISOString(),
              },
            ],
          }),
          { status: 200 },
        ),
      );

    render(
      <MemoryRouter>
        <AuditTrailPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/LoaderAgent/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Analyst overrides/i }));

    await waitFor(() => expect(screen.getByText(/Reviewed manually/i)).toBeInTheDocument());
  });
});
