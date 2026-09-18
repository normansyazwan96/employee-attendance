import { useCallback, useEffect, useState } from "react";
import { BottomNav, EmployeeHeader } from "../components/layout";
import { Icon } from "../components/icons";
import { clockIn, clockOut, getLocationStatus, getTodayAttendance, type Attendance, type LocationStatus } from "../lib/attendance";
import { getSession } from "../lib/auth";
import { locationReasonLabel, scheduleStatusLabel } from "../lib/i18n";
import { useLanguage } from "../lib/language-context";
import { getBrowserLocation } from "../lib/location";

export function EmployeePage(): JSX.Element {
  const { language, locale, t } = useLanguage();
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [location, setLocation] = useState<LocationStatus | null>(null);
  const session = getSession();
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const formatTime = (value: string | null): string => value ? new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "--";

  const checkLocation = useCallback(async (): Promise<void> => {
    setMessage("");
    try { setLocation(await getLocationStatus(await getBrowserLocation())); }
    catch (error: unknown) { setLocation(null); setMessage(error instanceof Error ? error.message : t("unableToValidateLocation")); }
  }, [t]);

  useEffect(() => {
    getTodayAttendance().then(setAttendance).catch((error: unknown) => setMessage(error instanceof Error ? error.message : t("unableToLoadAttendance"))).finally(() => setLoading(false));
    void checkLocation();
  }, [checkLocation, t]);

  async function act(): Promise<void> {
    setMessage("");
    setSubmitting(true);
    try {
      const browserLocation = await getBrowserLocation();
      const status = await getLocationStatus(browserLocation);
      setLocation(status);
      if (!status.valid) { setMessage(locationReasonLabel(language, status.reason) ?? t("outsideAllowedWorksiteArea")); return; }
      setAttendance(attendance ? await clockOut(browserLocation) : await clockIn(browserLocation));
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : t("unableToUpdateAttendance")); }
    finally { setSubmitting(false); }
  }

  const hasClockedOut = Boolean(attendance?.clockOutAt);
  const actionLabel = attendance ? (hasClockedOut ? t("clockedOutForToday") : t("clockOut")) : t("clockIn");
  const locationMessage = location?.valid && location.worksite
    ? `${t("withinWorksite")} ${location.worksite.name}: ${location.worksite.distanceMeters} ${t("metersAway")}`
    : locationReasonLabel(language, location?.reason) ?? t("checkingGpsLocation");

  return <div className="mx-auto min-h-screen max-w-lg bg-white pb-24"><EmployeeHeader /><main className="px-5"><p className="text-sm font-medium text-slate-500">{t("goodMorning")}</p><h1 className="mt-1 text-2xl font-bold tracking-tight">{session?.user.name ?? t("employee")}</h1><section className="mt-7 rounded-3xl bg-ink px-6 py-7 text-center text-white shadow-card"><p className="text-sm font-medium text-slate-300">{t("today")}</p><p className="mt-3 text-2xl font-bold tracking-tight">{date}</p><p className="mt-2 text-sm text-slate-300">{t("attendanceIsRecorded")}</p></section><section className="mt-6"><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold">{t("todaysAttendance")}</h2><span className={`rounded-full px-3 py-1 text-xs font-bold ${hasClockedOut ? "bg-slate-100 text-slate-600" : attendance ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{hasClockedOut ? t("completed") : attendance ? t("clockedIn") : t("notStarted")}</span></div><div className="rounded-2xl border border-slate-100 p-5 shadow-card"><div className="grid grid-cols-2 divide-x divide-slate-100"><div><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("clockIn")}</p><p className="mt-2 text-xl font-bold">{loading ? "..." : formatTime(attendance?.clockInAt ?? null)}</p></div><div className="pl-5"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("clockOut")}</p><p className="mt-2 text-xl font-bold text-slate-600">{loading ? "..." : formatTime(attendance?.clockOutAt ?? null)}</p></div></div><p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-400">{t("schedule")}: {scheduleStatusLabel(language, attendance?.scheduleStatus)}</p>{message && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{message}</p>}<button disabled={loading || submitting || hasClockedOut || !location?.valid} onClick={() => void act()} className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-bold text-white shadow-lg shadow-brand-600/20 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"><Icon name="arrow" className="h-5 w-5" />{submitting ? t("saving") : actionLabel}</button></div></section><section className={`mt-6 rounded-2xl border p-4 ${location?.valid ? "border-emerald-100 bg-emerald-50" : "border-amber-100 bg-amber-50"}`}><div className="flex gap-3"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white ${location?.valid ? "text-emerald-600" : "text-amber-600"}`}><Icon name="pin" className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><h2 className="font-bold text-slate-800">{t("locationCheck")}</h2><button onClick={() => void checkLocation()} className="text-xs font-bold text-brand-600">{t("refresh")}</button></div><p className="mt-1 text-sm leading-5 text-slate-600">{locationMessage}</p></div></div></section><button className="mt-6 flex w-full items-center justify-between rounded-2xl border border-slate-200 p-4 text-left"><span><span className="block font-bold">{t("attendanceHistory")}</span><span className="mt-1 block text-sm text-slate-500">{t("viewRecentWorkdays")}</span></span><Icon name="arrow" className="h-5 w-5 text-slate-400" /></button></main><BottomNav /></div>;
}
