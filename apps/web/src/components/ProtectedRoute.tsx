import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { getSession, rolePath, type Role } from "../lib/auth";

export function ProtectedRoute({ role, roles, children }: { role?: Role; roles?: Role[]; children: ReactNode }): JSX.Element {
  const session = getSession();
  if (!session) return <Navigate to="/login" replace />;
  if (role && session.user.role !== role) return <Navigate to={rolePath(session.user.role)} replace />;
  if (roles && !roles.includes(session.user.role)) return <Navigate to={rolePath(session.user.role)} replace />;
  return <>{children}</>;
}
