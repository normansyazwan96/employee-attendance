import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("application routes", () => {
  it("renders the login screen", () => {
    window.history.pushState({}, "", "/login");
    render(<BrowserRouter><App /></BrowserRouter>);
    expect(screen.getByLabelText("attend+")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  });

  it("routes users with temporary passwords to their profile", () => {
    localStorage.setItem("attendance.session", JSON.stringify({ token: "test", user: { id: "1", username: "employee", role: "EMPLOYEE", name: "Employee", mustChangePassword: true } }));
    window.history.pushState({}, "", "/employee");
    render(<BrowserRouter><App /></BrowserRouter>);
    expect(window.location.pathname).toBe("/profile");
    localStorage.clear();
  });

  it("redirects administrators away from audit history", () => {
    localStorage.clear();
    localStorage.setItem("attendance.user", JSON.stringify({ id: "admin-1", username: "administrator", role: "ADMIN", name: "Administrator", mustChangePassword: false }));
    window.history.pushState({}, "", "/admin/audit");
    render(<BrowserRouter><App /></BrowserRouter>);
    expect(window.location.pathname).toBe("/admin");
    expect(screen.queryByText("Audit history")).not.toBeInTheDocument();
    localStorage.clear();
  });
});
