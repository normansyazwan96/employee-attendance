import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("application routes", () => {
  it("renders the login screen", () => {
    window.history.pushState({}, "", "/login");
    render(<BrowserRouter><App /></BrowserRouter>);
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });

  it("routes users with temporary passwords to their profile", () => {
    localStorage.setItem("attendance.session", JSON.stringify({ token: "test", user: { id: "1", username: "employee", role: "EMPLOYEE", name: "Employee", mustChangePassword: true } }));
    window.history.pushState({}, "", "/employee");
    render(<BrowserRouter><App /></BrowserRouter>);
    expect(window.location.pathname).toBe("/profile");
    localStorage.clear();
  });
});
