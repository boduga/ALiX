/**
 * lib/client.mjs — shared Langfuse gateway client for langfuse-traces scripts.
 *
 * One `{ baseUrl, publicKey, secretKey }` bundle (not three loose strings),
 * Basic auth, 15s bounded wait, fail-open transport. Error bodies truncate;
 * success bodies always parse whole (truncating them once broke window JSON).
 */

export const TIMEOUT_MS = 15_000;
export const ERROR_TRUNCATE = 300;

export function makeClient({ baseUrl, publicKey, secretKey }) {
  const clean = (baseUrl ?? "").replace(/\/+$/, "");
  const auth = `Basic ${Buffer.from(`${publicKey ?? ""}:${secretKey ?? ""}`).toString("base64")}`;
  const missing = !clean || !publicKey || !secretKey;

  async function request(method, path, params, body) {
    const qs = params ? `?${new URLSearchParams(params)}` : "";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${clean}${path}${qs}`, {
        method,
        signal: ctrl.signal,
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, ERROR_TRUNCATE)}` : ""}`);
      }
      return text;
    } catch (err) {
      if (err?.name === "AbortError") throw new Error(`timeout after ${TIMEOUT_MS}ms`);
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    missing,
    apiGet: (path, params) => request("GET", path, params),
    apiPost: (path, body) => request("POST", path, undefined, body),
    /** Raw variant: resolves { status, body } for callers that report per-item verdicts. */
    apiRaw: async (method, path, params, body) => {
      const qs = params ? `?${new URLSearchParams(params)}` : "";
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${clean}${path}${qs}`, {
          method,
          signal: ctrl.signal,
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text().catch(() => "");
        return { status: res.status, body: res.ok ? text : text.slice(0, ERROR_TRUNCATE) };
      } catch (err) {
        return { status: "TRANSPORT", body: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
