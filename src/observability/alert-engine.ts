/**
 * alert-engine.ts -- P4.2f Alert Engine (stub for Task 6).
 */

export interface Alert {
  name: string;
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface AlertResult {
  firing: Alert[];
}

export class AlertEngine {
  evaluate(_snap: unknown): AlertResult {
    return { firing: [] };
  }
}
