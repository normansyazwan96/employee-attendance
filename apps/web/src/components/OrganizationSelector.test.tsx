import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationSelector } from "./OrganizationSelector";

const mocks = vi.hoisted(() => ({
  getAdminClients: vi.fn(),
  getSelectedOrganizationId: vi.fn(),
  getSession: vi.fn(),
  setSelectedOrganizationId: vi.fn(),
  selectOrganizationContext: vi.fn(),
}));

vi.mock("../lib/admin-clients", () => ({ getAdminClients: mocks.getAdminClients, selectOrganizationContext: mocks.selectOrganizationContext }));
vi.mock("../lib/auth", () => ({
  getSelectedOrganizationId: mocks.getSelectedOrganizationId,
  getSession: mocks.getSession,
  setSelectedOrganizationId: mocks.setSelectedOrganizationId,
}));
vi.mock("../lib/language-context", () => ({ useLanguage: () => ({ language: "en" }) }));

describe("OrganizationSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockReturnValue({ user: { role: "DEV_ADMIN" } });
    mocks.getSelectedOrganizationId.mockReturnValue("");
    mocks.getAdminClients.mockResolvedValue([
      { id: "organization-a", name: "Organization A", isTest: true },
      { id: "organization-b", name: "Organization B", isTest: false },
    ]);
    mocks.selectOrganizationContext.mockResolvedValue(undefined);
  });

  it("requires an explicit organization selection", async () => {
    render(<OrganizationSelector />);
    const selector = await screen.findByRole("combobox", { name: "Active organization" });
    await waitFor(() => expect(screen.getByRole("option", { name: "Organization A (Test)" })).toBeInTheDocument());
    expect(selector).toHaveValue("");
    expect(mocks.setSelectedOrganizationId).not.toHaveBeenCalled();
  });
});
