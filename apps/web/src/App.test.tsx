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
});
