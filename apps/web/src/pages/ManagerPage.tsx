import { ApprovalInbox } from "../components/ApprovalInbox";
import { DashboardShell } from "../components/layout";
import { useLanguage } from "../lib/language-context";

export function ManagerPage(): JSX.Element { const { language } = useLanguage(); return <DashboardShell title={language === "ms" ? "Peti kelulusan" : "Approval inbox"}><ApprovalInbox/></DashboardShell>; }
