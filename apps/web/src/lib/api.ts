export const apiUrl = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:3000" : "");

export function withLanguage(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  try {
    result.set("Accept-Language", window.localStorage.getItem("attendance.language") === "ms" ? "ms-MY" : "en-MY");
  } catch {
    result.set("Accept-Language", "en-MY");
  }
  return result;
}
