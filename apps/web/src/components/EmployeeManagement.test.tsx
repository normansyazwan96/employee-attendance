import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmployeeManagement } from "./EmployeeManagement";

const mocks = vi.hoisted(() => ({
  getAdminEmployees: vi.fn(),
}));
const translate = (key: string) => key;

vi.mock("../lib/admin-employees", () => ({
  getAdminEmployees: mocks.getAdminEmployees,
  createAdminEmployee: vi.fn(),
  updateAdminEmployeeStatus: vi.fn(),
}));
vi.mock("../lib/admin-accounts", () => ({
  resetManagedAccountPassword: vi.fn(),
}));
vi.mock("../lib/language-context", () => ({ useLanguage: () => ({ t: translate }) }));

describe("EmployeeManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminEmployees.mockResolvedValue([]);
  });

  it("does not require an administrator assignment when adding an employee", async () => {
    render(<MemoryRouter><EmployeeManagement /></MemoryRouter>);

    await waitFor(() => expect(mocks.getAdminEmployees).toHaveBeenCalledOnce());
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "createEmployee" })).toBeEnabled();
  });

  it("shows every employee returned for the selected organization", async () => {
    mocks.getAdminEmployees.mockResolvedValue([{ id: "employee-1", employeeId: "profile-1", username: "amira", firstName: "Amira", lastName: "Hassan", isActive: true, clientId: "client-1", ownerAdmin: null }]);
    render(<MemoryRouter><EmployeeManagement /></MemoryRouter>);

    expect(await screen.findByText("Amira Hassan")).toBeInTheDocument();
    expect(screen.getByText("@amira")).toBeInTheDocument();
  });
});
