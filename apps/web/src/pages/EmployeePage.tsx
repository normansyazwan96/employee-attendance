import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { BottomNav, EmployeeHeader } from "../components/layout";
import { Icon } from "../components/icons";
import { AttendanceRequestError, clockIn, clockOut, endBreak, getLocationStatus, getTodayAttendance, getTodayTimesheet, startBreak, type Attendance, type AttendanceEvent, type Location, type LocationStatus } from "../lib/attendance";
import { getSession } from "../lib/auth";
import { locationReasonLabel, scheduleStatusLabel } from "../lib/i18n";
import { useLanguage } from "../lib/language-context";
import { LocationFailure, getBrowserLocation } from "../lib/location";
import { createClockException, type ClockExceptionReason } from "../lib/requests";

type GpsFailure = { reasonCode: ClockExceptionReason; message: string; browserErrorCode?: number };

function reasonForStatus(status: LocationStatus): ClockExceptionReason {
  if (status.reason?.includes("No active worksite")) return "NO_WORKSITE";
  return "OUTSIDE_WORKSITE";
}

export function EmployeePage(): JSX.Element {
  const { language, locale, t } = useLanguage();
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [location, setLocation] = useState<LocationStatus | null>(null);
  const [lastCoordinates, setLastCoordinates] = useState<Location | null>(null);
  const [gpsFailure, setGpsFailure] = useState<GpsFailure | null>(null);
  const [gpsAttempts, setGpsAttempts] = useState(0);
  const [showExceptionForm, setShowExceptionForm] = useState(false);
  const [exceptionNote, setExceptionNote] = useState("");
  const [exceptionSubmitted, setExceptionSubmitted] = useState(false);
  const [clockReviewPending, setClockReviewPending] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [events, setEvents] = useState<AttendanceEvent[]>([]);
  const attemptRef = useRef(0);
  const session = getSession();
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const formatTime = (value: string | null): string => value ? new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "--";

  const checkLocation = useCallback(async (): Promise<void> => {
    setMessage("");
    attemptRef.current += 1;
    setGpsAttempts(attemptRef.current);
    try {
      const coordinates = await getBrowserLocation();
      setLastCoordinates(coordinates);
      const status = await getLocationStatus(coordinates);
      setLocation(status);
      if (status.valid) setGpsFailure(null);
      else setGpsFailure({ reasonCode: reasonForStatus(status), message: locationReasonLabel(language, status.reason) ?? t("outsideAllowedWorksiteArea") });
    } catch (error: unknown) {
      setLocation(null);
      const failure = error instanceof LocationFailure
        ? { reasonCode: error.code, message: error.message, browserErrorCode: error.browserErrorCode }
        : { reasonCode: "GPS_UNAVAILABLE" as const, message: error instanceof Error ? error.message : t("unableToValidateLocation") };
      setGpsFailure(failure);
      setMessage(failure.message);
    }
  }, [language, t]);

  useEffect(() => {
    Promise.all([getTodayAttendance(), getTodayTimesheet()]).then(([record, today]) => { setAttendance(record); setEvents(today.events); setClockReviewPending(Boolean(today.timesheet?.exceptionCodes.includes("GPS_CLOCK_REQUEST_PENDING"))); }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : t("unableToLoadAttendance"))).finally(() => setLoading(false));
    void checkLocation();
  }, [checkLocation, t]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  async function act(action: "clock-in" | "clock-out" | "break-start" | "break-end"): Promise<void> {
    setMessage("");
    setSubmitting(true);
    try {
      attemptRef.current += 1;
      setGpsAttempts(attemptRef.current);
      const browserLocation = await getBrowserLocation();
      setLastCoordinates(browserLocation);
      const status = await getLocationStatus(browserLocation);
      setLocation(status);
      if (!status.valid) {
        const failure = { reasonCode: reasonForStatus(status), message: locationReasonLabel(language, status.reason) ?? t("outsideAllowedWorksiteArea") };
        setGpsFailure(failure);
        setMessage(failure.message);
        return;
      }
      const updated = action === "clock-in" ? await clockIn(browserLocation) : action === "clock-out" ? await clockOut(browserLocation) : action === "break-start" ? await startBreak(browserLocation) : await endBreak(browserLocation);
      setAttendance(updated);
      const today = await getTodayTimesheet();
      setEvents(today.events);
      setClockReviewPending(Boolean(today.timesheet?.exceptionCodes.includes("GPS_CLOCK_REQUEST_PENDING")));
      setGpsFailure(null);
    } catch (error: unknown) {
      if (error instanceof LocationFailure) setGpsFailure({ reasonCode: error.code, message: error.message, browserErrorCode: error.browserErrorCode });
      else if (error instanceof AttendanceRequestError && error.code && ["GPS_ACCURACY_TOO_LOW", "OUTSIDE_WORKSITE"].includes(error.code)) {
        setGpsFailure({ reasonCode: error.code as ClockExceptionReason, message: error.message });
        if (error.location) setLocation(error.location);
      }
      setMessage(error instanceof Error ? error.message : t("unableToUpdateAttendance"));
    }
    finally { setSubmitting(false); }
  }

  async function submitClockException(): Promise<void> {
    if (!gpsFailure) return;
    if (!online) { setMessage(t("internetRequiredForClockRequest")); return; }
    setSubmitting(true);
    setMessage("");
    try {
      await createClockException({
        action: attendance ? "CLOCK_OUT" : "CLOCK_IN",
        reasonCode: gpsFailure.reasonCode,
        note: exceptionNote.trim() || undefined,
        diagnostics: {
          attemptCount: gpsAttempts,
          accuracyMeters: lastCoordinates?.accuracy,
          worksiteId: location?.worksite?.id,
          worksiteName: location?.worksite?.name,
          distanceMeters: location?.worksite?.distanceMeters,
          radiusMeters: location?.worksite?.radiusMeters,
          browserErrorCode: gpsFailure.browserErrorCode,
        },
      });
      setExceptionSubmitted(true);
      setClockReviewPending(true);
      setShowExceptionForm(false);
      setMessage(t("gpsRequestPending"));
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : t("unableToSubmitClockRequest")); }
    finally { setSubmitting(false); }
  }

  const hasClockedOut = Boolean(attendance?.clockOutAt);
  const lastEvent = events.at(-1)?.type;
  const isOnBreak = lastEvent === "BREAK_START";
  const canTakeBreak = lastEvent === "CLOCK_IN" || lastEvent === "BREAK_END";
  const actionLabel = attendance ? (hasClockedOut ? t("clockedOutForToday") : t("clockOut")) : t("clockIn");
  const locationMessage = location?.valid && location.worksite
    ? `${t("withinWorksite")} ${location.worksite.name}: ${location.worksite.distanceMeters} ${t("metersAway")}`
    : gpsFailure?.message ?? locationReasonLabel(language, location?.reason) ?? t("checkingGpsLocation");
  const canRequestReview = gpsAttempts >= 2 && Boolean(gpsFailure) && !hasClockedOut && !isOnBreak && !exceptionSubmitted && !clockReviewPending;

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
          {message && <p role="alert" className={`mt-4 rounded-md p-3 text-sm font-medium ${exceptionSubmitted ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message}</p>}
          {clockReviewPending && !message && <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm font-medium text-amber-900">{t("gpsRequestPending")}</p>}
          <button disabled={loading || submitting || hasClockedOut || isOnBreak || !location?.valid || clockReviewPending} onClick={() => void act(attendance ? "clock-out" : "clock-in")} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:bg-slate-400"><Icon name="arrow" className="h-5 w-5" />{submitting ? t("saving") : actionLabel}</button>
          {attendance && !hasClockedOut && <button disabled={loading || submitting || (!isOnBreak && !canTakeBreak) || !location?.valid || clockReviewPending} onClick={() => void act(isOnBreak ? "break-end" : "break-start")} className="mt-3 h-11 w-full rounded-lg border border-slate-300 bg-white/70 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">{isOnBreak ? t("endBreak") : t("startBreak")}</button>}
        </div>
      </section>
      <section className={`mt-4 rounded-lg border p-4 ${location?.valid ? "border-emerald-200/70 bg-emerald-50/70" : "border-amber-200/70 bg-amber-50/70"}`}>
        <div className="flex gap-3"><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white/80 ${location?.valid ? "text-emerald-700" : "text-amber-700"}`}><Icon name="pin" className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{t("locationCheck")}</h2><button type="button" disabled={submitting} onClick={() => void checkLocation()} className="text-xs font-semibold text-brand-600 disabled:opacity-50">{t("gpsRetry")}</button></div><p className="mt-1 text-sm leading-5 text-slate-700">{locationMessage}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600"><span>{t("gpsAttempt")}: {gpsAttempts}</span>{lastCoordinates && <span>{t("gpsAccuracy")}: {Math.round(lastCoordinates.accuracy)} m</span>}{location?.worksite && <span>{location.worksite.distanceMeters} m / {location.worksite.radiusMeters} m</span>}</div></div></div>
        {canRequestReview && !showExceptionForm && <button type="button" onClick={() => setShowExceptionForm(true)} className="mt-4 w-full rounded-md border border-amber-300 bg-white/80 px-4 py-2.5 text-sm font-semibold text-amber-900">{t("requestAttendanceReview")}</button>}
        {showExceptionForm && <div className="mt-4 border-t border-amber-200 pt-4"><p className="text-sm leading-5 text-slate-700">{t("gpsExceptionHelp")}</p><label className="mt-3 block text-xs font-semibold text-slate-700" htmlFor="gps-exception-note">{t("gpsExceptionNote")}</label><textarea id="gps-exception-note" value={exceptionNote} onChange={(event) => setExceptionNote(event.target.value)} maxLength={1000} placeholder={t("gpsExceptionNotePlaceholder")} className="mt-1 min-h-24 w-full rounded-md border border-slate-300 bg-white/90 px-3 py-2 text-sm" />{!online && <p className="mt-2 text-xs font-medium text-rose-700">{t("internetRequiredForClockRequest")}</p>}<div className="mt-3 flex gap-2"><button type="button" disabled={submitting || !online} onClick={() => void submitClockException()} className="rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:bg-slate-400">{submitting ? t("sending") : t("submitForReview")}</button><button type="button" disabled={submitting} onClick={() => setShowExceptionForm(false)} className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">{t("cancel")}</button></div></div>}
      </section>
      <NavLink to="/employee/history" className="mt-4 flex w-full items-center justify-between gap-3 border-t border-slate-300/60 py-5 text-left"><span><span className="block font-semibold">{t("attendanceHistory")}</span><span className="mt-1 block text-sm text-slate-600">{t("viewRecentWorkdays")}</span></span><Icon name="arrow" className="h-5 w-5 text-brand-600" /></NavLink>
    </main>
    <BottomNav />
  </div>;
}
