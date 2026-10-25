import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationManagement } from "./OrganizationManagement";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  setSelectedOrganizationId: vi.fn(),
}));

vi.mock("../lib/admin-clients", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("../lib/auth", () => ({ setSelectedOrganizationId: mocks.setSelectedOrganizationId }));
vi.mock("../lib/language-context", () => ({ useLanguage: () => ({ language: "en" }) }));

describe("OrganizationManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAdminClient.mockReturnValue(new Promise(() => undefined));
  });

  it("shows state names and submits the selected state code", async () => {
    render(<OrganizationManagement />);

    const state = screen.getByRole("combobox", { name: "Organization state" });
    expect(screen.getByRole("option", { name: "Selangor" })).toHaveValue("10");
    expect(screen.getByRole("option", { name: "Kuala Lumpur" })).toHaveValue("14");

    fireEvent.change(screen.getByRole("textbox", { name: "Organization name" }), { target: { value: "Test Company" } });
    fireEvent.change(state, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mocks.createAdminClient).toHaveBeenCalledWith({ name: "Test Company", stateCode: "10", isTest: false }));
  });
});
