import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
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

  return <div className="app-canvas mx-auto max-w-lg pb-28">
    <EmployeeHeader />
    <main className="px-4 sm:px-5">
      <div className="mb-7"><p className="text-sm font-medium text-slate-600">{t("goodMorning")}</p><h1 className="mt-1 break-words text-2xl font-semibold">{session?.user.name ?? t("employee")}</h1></div>
      <section className="border-y border-slate-300/60 py-5"><p className="text-xs font-semibold uppercase text-brand-600">{t("today")}</p><p className="mt-2 text-xl font-semibold">{date}</p><p className="mt-1 text-sm text-slate-600">{t("attendanceIsRecorded")}</p></section>
      <section className="mt-7">
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{t("todaysAttendance")}</h2><span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${hasClockedOut ? "bg-slate-200/70 text-slate-700" : attendance ? "bg-emerald-100/80 text-emerald-800" : "bg-white/70 text-slate-600"}`}>{hasClockedOut ? t("completed") : attendance ? t("clockedIn") : t("notStarted")}</span></div>
        <div className="glass-panel rounded-lg p-5">
          <div className="grid grid-cols-2 divide-x divide-slate-200/80"><div><p className="text-xs font-semibold uppercase text-slate-500">{t("clockIn")}</p><p className="mt-2 text-xl font-semibold">{loading ? "..." : formatTime(attendance?.clockInAt ?? null)}</p></div><div className="pl-5"><p className="text-xs font-semibold uppercase text-slate-500">{t("clockOut")}</p><p className="mt-2 text-xl font-semibold">{loading ? "..." : formatTime(attendance?.clockOutAt ?? null)}</p></div></div>
          <p className="mt-5 border-t border-slate-200/70 pt-4 text-xs font-semibold text-slate-600">{t("schedule")}: {scheduleStatusLabel(language, attendance?.scheduleStatus)}</p>
          {message && <p role="alert" className="mt-4 rounded-md bg-rose-50 p-3 text-sm font-medium text-rose-700">{message}</p>}
          <button disabled={loading || submitting || hasClockedOut || !location?.valid} onClick={() => void act()} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:bg-slate-400"><Icon name="arrow" className="h-5 w-5" />{submitting ? t("saving") : actionLabel}</button>
        </div>
      </section>
      <section className={`mt-4 rounded-lg border p-4 ${location?.valid ? "border-emerald-200/70 bg-emerald-50/70" : "border-amber-200/70 bg-amber-50/70"}`}><div className="flex gap-3"><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white/80 ${location?.valid ? "text-emerald-700" : "text-amber-700"}`}><Icon name="pin" className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{t("locationCheck")}</h2><button type="button" onClick={() => void checkLocation()} className="text-xs font-semibold text-brand-600">{t("refresh")}</button></div><p className="mt-1 text-sm leading-5 text-slate-700">{locationMessage}</p></div></div></section>
      <NavLink to="/employee/history" className="mt-4 flex w-full items-center justify-between gap-3 border-t border-slate-300/60 py-5 text-left"><span><span className="block font-semibold">{t("attendanceHistory")}</span><span className="mt-1 block text-sm text-slate-600">{t("viewRecentWorkdays")}</span></span><Icon name="arrow" className="h-5 w-5 text-brand-600" /></NavLink>
    </main>
    <BottomNav />
  </div>;
}
