import { useEffect, useState } from "react";
import { getWebhookDetails, type WebhookDetails as WebhookDetailsData } from "../lib/admin-system";
import { useLanguage } from "../lib/language-context";

export function WebhookDetails(): JSX.Element {
  const { t } = useLanguage();
  const [details, setDetails] = useState<WebhookDetailsData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getWebhookDetails()
      .then(setDetails)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : t("unableToLoadWebhook")));
  }, [t]);

  return <section className="mt-10">
    <div className="mb-4">
      <h2 className="text-lg font-bold">{t("webhookIntegration")}</h2>
      <p className="text-sm text-slate-500">{t("webhookDescription")}</p>
    </div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {details && <div className="rounded-2xl bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <span className="font-semibold text-slate-700">{t("status")}</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${details.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{details.enabled ? t("webhookEnabled") : t("webhookDisabled")}</span>
      </div>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold text-slate-500">{t("endpoint")}</dt><dd className="mt-1 break-all font-mono text-xs text-slate-700">{details.url ?? t("notConfigured")}</dd></div>
        <div><dt className="font-semibold text-slate-500">{t("method")}</dt><dd className="mt-1 text-slate-700">{details.method} / {details.contentType}</dd></div>
        <div><dt className="font-semibold text-slate-500">{t("events")}</dt><dd className="mt-1 font-mono text-xs text-slate-700">{details.events.join(", ")}</dd></div>
        <div><dt className="font-semibold text-slate-500">{t("signature")}</dt><dd className="mt-1 font-mono text-xs text-slate-700">{details.signatureHeader} / {details.signatureAlgorithm}</dd></div>
        <div><dt className="font-semibold text-slate-500">{t("webhookSecret")}</dt><dd className="mt-1 text-slate-700">{details.secretConfigured ? t("configured") : t("notConfigured")}</dd></div>
        <div><dt className="font-semibold text-slate-500">{t("deliveryBehavior")}</dt><dd className="mt-1 text-slate-700">{t("webhookFailureBehavior")}</dd></div>
      </dl>
    </div>}
  </section>;
}
