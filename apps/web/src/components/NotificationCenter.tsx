import { useCallback, useEffect, useRef, useState } from "react";
import { getNotifications, markNotificationRead, type Notification } from "../lib/notifications";
import { useLanguage } from "../lib/language-context";
import { Icon } from "./icons";

export function NotificationCenter({ inverse = false }: { inverse?: boolean }): JSX.Element {
  const { language, locale } = useLanguage();
  const ms = language === "ms";
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const unread = items.filter((item) => !item.readAt).length;

  const load = useCallback(async (): Promise<void> => {
    try { setItems(await getNotifications()); setError(""); }
    catch { setError(ms ? "Notifikasi tidak dapat dimuatkan." : "Notifications could not be loaded."); }
    finally { setLoading(false); }
  }, [ms]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    function close(event: MouseEvent): void { if (open && panel.current && !panel.current.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function read(item: Notification): Promise<void> {
    if (item.readAt) return;
    try {
      await markNotificationRead(item.id);
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry));
    } catch { setError(ms ? "Notifikasi tidak dapat dikemas kini." : "The notification could not be updated."); }
  }

  return <div ref={panel} className="relative">
    <button type="button" onClick={() => { setOpen((current) => !current); if (!open) void load(); }} className={`relative grid h-10 w-10 place-items-center rounded-lg ${inverse ? "text-slate-300 hover:bg-white/10 hover:text-white" : "text-slate-600 hover:bg-slate-100"}`} aria-label={ms ? "Notifikasi" : "Notifications"} aria-expanded={open}>
      <Icon name="bell" className="h-5 w-5" />
      {unread > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-rose-600 px-1 text-center text-[10px] font-bold leading-4 text-white">{Math.min(unread, 99)}</span>}
    </button>
    {open && <section className="glass-panel absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border shadow-xl" aria-label={ms ? "Senarai notifikasi" : "Notification list"}>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><h2 className="text-sm font-semibold">{ms ? "Notifikasi" : "Notifications"}</h2><span className="text-xs text-slate-500">{unread} {ms ? "belum dibaca" : "unread"}</span></div>
      <div className="max-h-96 overflow-y-auto">
        {loading && <p className="p-5 text-center text-sm text-slate-500">{ms ? "Memuatkan..." : "Loading..."}</p>}
        {error && <div className="p-4"><p role="alert" className="text-sm text-rose-700">{error}</p><button type="button" onClick={() => void load()} className="mt-2 text-xs font-semibold text-brand-700">{ms ? "Cuba lagi" : "Retry"}</button></div>}
        {!loading && !error && items.length === 0 && <p className="p-6 text-center text-sm text-slate-500">{ms ? "Tiada notifikasi." : "No notifications."}</p>}
        {!loading && items.map((item) => <button type="button" key={item.id} onClick={() => void read(item)} className={`block w-full border-b border-slate-200 px-4 py-3 text-left last:border-0 ${item.readAt ? "bg-white/35" : "bg-white/80"}`}>
          <span className="block text-sm font-semibold text-ink">{item.title}</span><span className="mt-1 block text-xs leading-5 text-slate-600">{item.message}</span><span className="mt-1 block text-[11px] text-slate-400">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</span>
        </button>)}
      </div>
    </section>}
  </div>;
}
