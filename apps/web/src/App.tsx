import { Navigate, Route, Routes } from "react-router-dom";
import { AdminPage } from "./pages/AdminPage";
import { EmployeePage } from "./pages/EmployeePage";
import { HistoryPage } from "./pages/HistoryPage";
import { LoginPage } from "./pages/LoginPage";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ProfilePage } from "./pages/ProfilePage";
import { DevPage } from "./pages/DevPage";
import { LanguageProvider } from "./components/LanguageProvider";

export default function App(): JSX.Element { return <LanguageProvider><Routes><Route path="/login" element={<LoginPage />} /><Route path="/employee" element={<ProtectedRoute role="EMPLOYEE"><EmployeePage /></ProtectedRoute>} /><Route path="/employee/history" element={<ProtectedRoute role="EMPLOYEE"><HistoryPage /></ProtectedRoute>} /><Route path="/admin" element={<ProtectedRoute roles={["ADMIN", "DEV_ADMIN"]}><AdminPage /></ProtectedRoute>} /><Route path="/profile" element={<ProtectedRoute roles={["EMPLOYEE", "ADMIN", "DEV_ADMIN"]}><ProfilePage /></ProtectedRoute>} /><Route path="/dev" element={<ProtectedRoute role="DEV_ADMIN"><DevPage /></ProtectedRoute>} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes></LanguageProvider>; }
