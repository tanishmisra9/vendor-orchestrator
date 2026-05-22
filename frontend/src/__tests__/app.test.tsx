import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import App from "../App";

const fetchMock = vi.fn();

describe("App auth flow", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shows the auth gate and logs in successfully", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ require_auth: true, authenticated: false }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ require_auth: true, authenticated: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ metrics: [], recent_activity: [] }), { status: 200 }),
      );

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Enter the shared analyst password/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Password/i), "secret");
    await userEvent.click(screen.getByRole("button", { name: /Unlock workspace/i }));

    await waitFor(() => expect(screen.getByText(/Vendor Master Console/i)).toBeInTheDocument());
  });
});
