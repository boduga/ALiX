// Test-only observation of unchanged production decisions, at their public seams.
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const repo = process.env.ALIX_D9_PROBE_REPO;
const sink = process.env.ALIX_D9_PROBE_OBSERVATIONS;
if (!repo || !sink) throw new Error('Missing isolated D9 observer configuration');
const moduleAt = path => import(pathToFileURL(join(repo, 'dist/src', path)).href);
const { setScriptedScenario } = await moduleAt('operations/evals/providers/scripted-mock-carrier.js');
setScriptedScenario(JSON.parse(readFileSync(process.env.ALIX_D9_GLOBAL_SCENARIO, 'utf8')));
const { hashArgs } = await moduleAt('capabilities/tools/hash-args.js');
const { PolicyGate } = await moduleAt('governance/policy/policy-gate.js');
const { ExecutionAuthorization } = await moduleAt('runtime-state/runtime/execution-authorization.js');
const { EventLog } = await moduleAt('runtime-state/events/event-log.js');
function emit(entry) {
  try { appendFileSync(sink, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...entry }) + '\n'); }
  catch { /* A missing observation fails the probe; it cannot affect authority. */ }
}
function requestFields(request) {
  return {
    requestId: request.requestId, toolName: request.toolName, capability: request.capability,
    agentId: request.agentId, sessionId: request.sessionId, source: request.source,
    cwd: request.cwd, sessionMode: request.sessionMode, ownedPaths: request.ownedPaths,
    argsHash: request.args ? hashArgs(request.args) : undefined,
    coordination: request.coordination,
    coordinationRunId: request.coordinationRunId, workerId: request.workerId, workerAttempt: request.workerAttempt,
  };
}
for (const [type, prototype, name] of [
  ['policy.tool', PolicyGate.prototype, 'evaluateToolCall'],
  ['policy.capability', PolicyGate.prototype, 'evaluateCapability'],
  ['authorization', ExecutionAuthorization.prototype, 'evaluate'],
]) {
  const original = prototype[name];
  prototype[name] = async function (...args) {
    const request = requestFields(args[0]);
    try {
      const decision = await Reflect.apply(original, this, args);
      emit({ type, request, decision });
      return decision;
    } catch (error) {
      emit({ type, request, error: String(error) });
      throw error;
    }
  };
}
const append = EventLog.prototype.append;
EventLog.prototype.append = async function (...args) {
  const result = await Reflect.apply(append, this, args);
  if (/^(tool\.|file\.|approval\.|coordination\.|agent\.|session\.)/.test(result.type)) emit({ type: 'event', event: result });
  return result;
};
emit({ type: 'observer.ready', policyUnchanged: true });
