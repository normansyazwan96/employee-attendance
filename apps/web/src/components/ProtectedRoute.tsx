import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getSession, sessionPath, type Role } from "../lib/auth";

export function ProtectedRoute({ role, roles, children }: { role?: Role; roles?: Role[]; children: ReactNode }): JSX.Element {
  const session = getSession();
  const location = useLocation();
  if (!session) return <Navigate to="/login" replace />;
  if (session.user.mustChangePassword && location.pathname !== "/profile") return <Navigate to="/profile" replace />;
  if (role && session.user.role !== role) return <Navigate to={sessionPath(session.user)} replace />;
  if (roles && !roles.includes(session.user.role)) return <Navigate to={sessionPath(session.user)} replace />;
  return <>{children}</>;
}
