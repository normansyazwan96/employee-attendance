import type { NextFunction, Request, Response } from "express";

const malayByCode: Record<string, string> = {
  ACCOUNT_LOCKED: "Akaun ini dikunci sementara. Cuba lagi kemudian.",
  ASSIGNMENT_TARGET_NOT_FOUND: "Pekerja atau templat syif tidak ditemui.",
  ATTENDANCE_EVENT_NOT_FOUND: "Peristiwa kehadiran tidak ditemui.",
  CONCURRENT_ATTENDANCE_ACTION: "Tindakan kehadiran ini telah diproses. Muat semula dan cuba lagi.",
  CLOCK_IN_ALREADY_RECORDED: "Waktu masuk untuk hari ini telah direkodkan.",
  CLOCK_EXCEPTION_PENDING: "Permintaan waktu GPS untuk tindakan ini sedang menunggu semakan pentadbir.",
  CORRECTION_NOT_FOUND: "Permohonan pembetulan yang belum selesai tidak ditemui.",
  CORRECTION_PENDING: "Permohonan pembetulan untuk hari ini masih menunggu kelulusan.",
  CORRECTION_STALE: "Kehadiran telah berubah sejak permintaan ini dihantar. Tolak permintaan dan semak lembaran masa terkini.",
  DEPARTMENT_EXISTS: "Jabatan dengan nama atau kod ini sudah wujud.",
  DEPARTMENT_NOT_FOUND: "Jabatan tidak ditemui.",
  EMPLOYEE_NOT_FOUND: "Pekerja tidak ditemui.",
  EMPLOYEE_NUMBER_EXISTS: "Nombor pekerja ini sudah digunakan.",
  EMPLOYEE_REQUIRED: "Akaun pekerja yang ditetapkan kepada organisasi diperlukan.",
  EMPLOYEE_SCOPE_VIOLATION: "Seorang atau lebih pekerja berada di luar skop pengurus ini.",
  EMPLOYMENT_INACTIVE: "Hanya pekerja aktif boleh merekodkan kehadiran.",
  EXPORT_NOT_AVAILABLE: "Fail eksport belum tersedia.",
  GPS_ACCURACY_TOO_LOW: "Ketepatan GPS tidak mencukupi untuk merekodkan kehadiran.",
  INSUFFICIENT_LEAVE: "Tempoh cuti yang diminta melebihi baki yang tersedia.",
  INTERNAL_ERROR: "Ralat dalaman berlaku. Gunakan ID permintaan apabila menghubungi sokongan.",
  INVALID_ATTENDANCE_TRANSITION: "Tindakan kehadiran ini tidak sah untuk keadaan semasa.",
  INVALID_CORRECTION: "Masukkan sebab serta waktu sebelum dan selepas yang sah.",
  INVALID_CLOCK_EXCEPTION: "Masukkan butiran kegagalan GPS yang sah.",
  INVALID_CREDENTIALS: "Nama pengguna atau kata laluan tidak betul.",
  INVALID_DATE_RANGE: "Pilih julat tarikh yang sah.",
  INVALID_EMPLOYMENT_DATES: "Tarikh tamat tidak boleh mendahului tarikh mula.",
  INVALID_IDEMPOTENCY_KEY: "Pengepala Idempotency-Key yang sah diperlukan.",
  INVALID_LEAVE_REQUEST: "Masukkan tarikh dan tempoh cuti yang sah dalam satu tahun kalendar.",
  INVALID_LOCATION: "Lokasi GPS yang sah diperlukan.",
  INVALID_MFA_CHALLENGE: "Cabaran pengesahan tidak sah atau telah tamat tempoh.",
  INVALID_MFA_CODE: "Kod pengesahan tidak betul.",
  INVALID_PAY_PERIOD_TRANSITION: "Perubahan status tempoh gaji ini tidak dibenarkan.",
  INVALID_RESET: "Gunakan pautan tetapan semula yang sah dan kata laluan kukuh sekurang-kurangnya 8 aksara.",
  LEAVE_ALREADY_REVIEWED: "Permohonan cuti ini telah disemak.",
  LEAVE_DATES_OVERLAP: "Permohonan cuti aktif lain bertindih dengan tarikh ini.",
  LEAVE_DURATION_EXCEEDS_SCHEDULE: "Tempoh cuti melebihi waktu kerja yang dijadualkan dalam julat ini.",
  LEAVE_REQUEST_NOT_FOUND: "Permohonan cuti tidak ditemui.",
  LEAVE_TYPE_NOT_FOUND: "Jenis cuti tidak ditemui.",
  MANAGER_NOT_FOUND: "Pengurus tidak ditemui.",
  MFA_ADMIN_ONLY: "Persediaan pengesahan dua faktor hanya tersedia untuk pentadbir.",
  MFA_ALREADY_ENABLED: "Pengesahan dua faktor sudah diaktifkan.",
  MFA_NOT_CONFIGURED: "Pengesahan dua faktor belum dikonfigurasi untuk sistem ini.",
  NOTIFICATION_NOT_FOUND: "Pemberitahuan tidak ditemui.",
  ORGANIZATION_ACCESS_REQUIRED: "Keahlian pentadbir organisasi yang aktif diperlukan.",
  ORGANIZATION_NOT_FOUND: "Organisasi tidak ditemui.",
  ORGANIZATION_REQUIRED: "Pilih organisasi untuk meneruskan.",
  OUTSIDE_WORKSITE: "Anda berada di luar kawasan lokasi kerja yang dibenarkan.",
  PASSWORD_CHANGE_REQUIRED: "Tukar kata laluan sementara anda sebelum meneruskan.",
  PAY_PERIOD_LOCKED: "Tindakan ini tidak dibenarkan dalam tempoh gaji yang dikunci.",
  PAY_PERIOD_NOT_FOUND: "Tempoh gaji tidak ditemui.",
  PAY_PERIOD_OVERLAP: "Tempoh gaji ini bertindih dengan tempoh sedia ada.",
  RESET_EXPIRED: "Pautan tetapan semula ini tidak sah atau telah tamat tempoh.",
  ROUTE_NOT_FOUND: "Halaman atau perkhidmatan yang diminta tidak ditemui.",
  SCHEDULE_ASSIGNMENT_OVERLAP: "Penetapan jadual bertindih dengan penetapan sedia ada.",
  SESSION_EXPIRED: "Sesi anda telah tamat. Sila log masuk semula.",
  SESSION_NOT_FOUND: "Sesi aktif tidak ditemui.",
  TIMESHEET_LOCKED: "Lembaran masa ini telah dikunci dan tidak boleh menerima peristiwa baharu.",
  TIMESHEET_NOT_FOUND: "Lembaran masa tidak ditemui.",
  UNRESOLVED_PAYROLL_ITEMS: "Selesaikan semua pengecualian dan permohonan tertunda sebelum mengunci tempoh gaji.",
  USERNAME_EXISTS: "Nama pengguna ini sudah digunakan.",
};

const malayLegacyMessages: Record<string, string> = {
  "Authentication is required": "Pengesahan diperlukan.",
  "You do not have access to this resource": "Anda tidak mempunyai akses kepada sumber ini.",
  "An account with that username already exists": "Akaun dengan nama pengguna itu sudah wujud.",
  "That username is already in use": "Nama pengguna itu sudah digunakan.",
  "You have already clocked in today": "Anda telah merekodkan waktu masuk hari ini.",
};

type ErrorBody = { error?: string | { code?: string; message?: string }; [key: string]: unknown };

function localize(body: unknown): unknown {
  if (!body || typeof body !== "object" || !("error" in body)) return body;
  const value = body as ErrorBody;
  if (typeof value.error === "string") {
    return { ...value, error: malayLegacyMessages[value.error] ?? "Permintaan tidak dapat diselesaikan. Cuba lagi." };
  }
  if (!value.error || typeof value.error !== "object") return body;
  const code = value.error.code;
  if (!code) return { ...value, error: { ...value.error, message: "Permintaan tidak dapat diselesaikan. Cuba lagi." } };
  return { ...value, error: { ...value.error, message: malayByCode[code] ?? `Permintaan tidak dapat diselesaikan (${code}).` } };
}

export function responseLanguage(request: Request, response: Response, next: NextFunction): void {
  const requested = request.header("accept-language")?.toLowerCase() ?? "";
  if (!requested.split(",").some((entry) => entry.trim().startsWith("ms"))) {
    next();
    return;
  }
  const originalJson = response.json.bind(response);
  response.json = ((body: unknown) => originalJson(localize(body))) as Response["json"];
  next();
}
