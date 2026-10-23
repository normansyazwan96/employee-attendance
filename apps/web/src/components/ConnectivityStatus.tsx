import { useEffect, useState } from "react";
import { useLanguage } from "../lib/language-context";

export function ConnectivityStatus(): JSX.Element | null {
  const { language } = useLanguage();
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    return () => { window.removeEventListener("online", connected); window.removeEventListener("offline", disconnected); };
  }, []);
  if (online) return null;
  return <div role="status" className="fixed inset-x-0 top-0 z-50 bg-amber-700 px-3 py-2 text-center text-xs font-semibold text-white">{language === "ms" ? "Anda di luar talian. Sambungan diperlukan untuk merekod kehadiran." : "You are offline. A connection is required to record attendance."}</div>;
}
