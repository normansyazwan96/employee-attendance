import { Navigate } from "react-router-dom";

export function DevPage(): JSX.Element {
	return <Navigate to="/admin" replace />;
}
