/**
 * observability-alerts.ts -- P4.2f Alert Evaluation CLI handler.
 *
 * Usage: alix observability alerts [--acknowledge <id>]
 *
 * Fetches the latest health snapshot, evaluates all alert rules,
 * and prints firing and resolved alerts.
 */

import { ObservabilitySnapshotService } from "../../observability/health-snapshot.js";
import { AlertEngine } from "../../observability/alert-engine.js";

export async function cmdAlerts(cwd: string, args: string[]): Promise<void> {
  const acknowledgeIdx = args.indexOf("--acknowledge");
  const acknowledgeId = acknowledgeIdx >= 0 ? args[acknowledgeIdx + 1] : undefined;

  const svc = new ObservabilitySnapshotService(cwd);
  const snap = await svc.getHealth();
  const engine = new AlertEngine();
  const result = engine.evaluate(snap);

  // Handle acknowledge flag
  if (acknowledgeId) {
    const ok = engine.acknowledge(acknowledgeId);
    console.log(ok ? `Acknowledged alert ${acknowledgeId}` : `Alert ${acknowledgeId} not found`);
    return;
  }

  // Print firing alerts
  if (result.firing.length === 0 && result.resolved.length === 0) {
    console.log("No alerts.");
    return;
  }

  if (result.firing.length > 0) {
    console.log(`Firing Alerts (${result.firing.length}):`);
    for (const a of result.firing) {
      const ack = a.acknowledged ? " [acknowledged]" : "";
      console.log(`  [${a.severity.toUpperCase()}] ${a.ruleName}${ack}`);
      console.log(`    ${a.message}`);
      console.log(`    triggered: ${a.firstTriggeredAt} (x${a.occurrences})`);
    }
  }

  if (result.resolved.length > 0) {
    console.log(`\nResolved Alerts (${result.resolved.length}):`);
    for (const a of result.resolved) {
      console.log(`  [${a.severity.toUpperCase()}] ${a.ruleName}`);
      console.log(`    resolved: ${a.resolvedAt ?? "?"}`);
    }
  }
}
