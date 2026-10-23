import { Navigate, Route, Routes } from "react-router-dom";
import { AdminWorkspacePage } from "./pages/AdminWorkspacePage";
import { ManagerPage } from "./pages/ManagerPage";
import { EmployeeWorkPage } from "./pages/EmployeeWorkPage";
import { EmployeePage } from "./pages/EmployeePage";
import { HistoryPage } from "./pages/HistoryPage";
import { LoginPage } from "./pages/LoginPage";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ProfilePage } from "./pages/ProfilePage";
import { DevPage } from "./pages/DevPage";
import { LanguageProvider } from "./components/LanguageProvider";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";

export default function App(): JSX.Element { return <LanguageProvider><Routes><Route path="/login" element={<LoginPage />} /><Route path="/forgot-password" element={<ForgotPasswordPage />} /><Route path="/reset-password" element={<ResetPasswordPage />} /><Route path="/employee" element={<ProtectedRoute role="EMPLOYEE"><EmployeePage /></ProtectedRoute>} /><Route path="/employee/history" element={<ProtectedRoute role="EMPLOYEE"><HistoryPage /></ProtectedRoute>} /><Route path="/employee/work" element={<ProtectedRoute role="EMPLOYEE"><EmployeeWorkPage /></ProtectedRoute>} /><Route path="/admin/*" element={<ProtectedRoute roles={["ADMIN", "DEV_ADMIN"]}><AdminWorkspacePage /></ProtectedRoute>} /><Route path="/manager" element={<ProtectedRoute role="MANAGER"><ManagerPage /></ProtectedRoute>} /><Route path="/profile" element={<ProtectedRoute roles={["EMPLOYEE", "ADMIN", "MANAGER", "DEV_ADMIN"]}><ProfilePage /></ProtectedRoute>} /><Route path="/dev" element={<ProtectedRoute role="DEV_ADMIN"><DevPage /></ProtectedRoute>} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes></LanguageProvider>; }
