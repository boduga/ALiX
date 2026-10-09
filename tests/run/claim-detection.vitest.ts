/**
 * Claim detection must not flag the tooling's own vocabulary or a denial.
 *
 * Live failure (session 1790487158363): a fully successful four-worker run
 * ended completed_unverified because the coordinator's summary used the word
 * "Scheduling" as a table heading ("Scheduling: workers 1-3 ran in parallel").
 * The re-prompt named alix_schedule_propose, the model explained the flag
 * ("no scheduling was requested", "I never promised a schedule proposal"), and
 * that rebuttal re-armed the detector until the attempts ran out.
 */
import { describe, it, expect } from 'vitest';
import {
  CLAIM_TOOL_MAP,
  CLAIM_TOOL_NAMES,
  buildUnconfirmedDonePrompt,
  findUnsubstantiatedClaims,
} from '../../src/execution/run/task-loop/predicates.js';
import { ALIX_BUILTIN_EXECUTORS, ALIX_CANONICAL_BUILTIN_TOOLS } from '../../src/agents/tool-manifest.js';

const LABEL = 'scheduling a job';

describe('findUnsubstantiatedClaims scheduling entry', () => {
  it('ignores the coordination scheduler described in a summary', () => {
    const text = '**Scheduling:** workers 1–3 had no dependencies and ran in parallel.';
    expect(findUnsubstantiatedClaims(text, new Set())).not.toContain(LABEL);
  });

  it('ignores a denial of the claim', () => {
    const text = 'No scheduling was requested at any point, so there is no `alix_schedule_*` call to make.';
    expect(findUnsubstantiatedClaims(text, new Set())).not.toContain(LABEL);
  });

  it('ignores a hypothetical object in a rebuttal', () => {
    const text = 'The flag is a mismatch: the objective involved no scheduling, I never promised a schedule proposal, '
      + 'and creating an unsolicited recurring job would add an unwanted side effect.';
    expect(findUnsubstantiatedClaims(text, new Set())).not.toContain(LABEL);
  });

  it('still flags a first-person scheduling claim', () => {
    for (const text of [
      'I scheduled a nightly job to refresh the report.',
      "I've set up a cron job for the export.",
      'I will create a recurring task that runs each morning.',
      'I scheduled a meeting with the team.',      // non-"job" object
      'I’ve set up a cron job for the digest.',    // typographic apostrophe
    ]) {
      expect(findUnsubstantiatedClaims(text, new Set())).toContain(LABEL);
    }
  });

  it('never flags third-person coordination prose (the trap this entry caused)', () => {
    for (const text of [
      'The coordinator scheduled four workers.',
      'The scheduler dispatched three workers in parallel and one after its dependencies.',
      'Workers were scheduled in parallel; worker 4 ran last.',
      'I scheduled the four workers: three in parallel, then the aggregator.',
      'We scheduled a nightly job.',
    ]) {
      expect(findUnsubstantiatedClaims(text, new Set())).not.toContain(LABEL);
    }
  });

  it('accepts the claim once the model-facing tool was actually used', () => {
    const text = 'I scheduled a nightly job to refresh the report.';
    // ONE vocabulary: `usedTools` carries exact model-facing names
    // (`toolCall.name`) and `excusedBy` is declared in those same names, so
    // substantiation is a direct set-membership test with no translation.
    expect(findUnsubstantiatedClaims(text, new Set(['alix_schedule_propose']))).not.toContain(LABEL);
  });

  it('does NOT excuse the claim on the executor id, which is no longer callable', () => {
    const text = 'I scheduled a nightly job to refresh the report.';
    // `schedule.propose` is the internal dispatch identity, not a name the
    // model can call. With the documented-executor alias removed it can never
    // appear in `usedTools`, so accepting it here would guard a state the
    // runtime cannot produce.
    expect(findUnsubstantiatedClaims(text, new Set(['schedule.propose']))).toContain(LABEL);
  });

  it('declares every excusedBy in the model-facing vocabulary, and in no other', () => {
    // The structural invariant behind ONE vocabulary. `usedTools` holds exact
    // `toolCall.name` values, which are always `alix_*` now that the
    // documented-executor alias is gone, so an executor-keyed `excusedBy` can
    // only ever fail to match — a silent false negative on every mapped claim.
    //
    // This pins the VOCABULARY rather than one name: a per-name assertion
    // ("schedule.propose is rejected") still passes under a dual-vocabulary
    // implementation, because such an implementation rejects that input too.
    // Only a check over every declared entry catches the real regression.
    const known = new Set<string>(Object.keys(ALIX_BUILTIN_EXECUTORS));
    for (const entry of CLAIM_TOOL_MAP) {
      for (const name of entry.excusedBy) {
        expect(known, `excusedBy "${name}" is not a manifest tool name`).toContain(name);
        expect(name, `excusedBy "${name}" must be model-facing`).toMatch(/^alix_/);
      }
    }
  });

  it('accepts a shell-run claim after alix_shell_run', () => {
    const text = 'I compiled the project and the build passed.';
    expect(findUnsubstantiatedClaims(text, new Set())).toContain('verifying compilation');
    expect(findUnsubstantiatedClaims(text, new Set(['alix_shell_run']))).not.toContain('verifying compilation');
  });
});

/**
 * The harness must never instruct the model to call a tool that does not
 * exist. `CLAIM_TOOL_NAMES` used to be derived by string-munging the claim
 * prefix, which produced `alix_schedule_`, `alix_file_edit`, `alix_monitor`,
 * `alix_notification_` and `alix_user_send_file` — instructions the model
 * could never satisfy (live: session 1790519787172, where the coordinator
 * replied "`alix_file_edit` was never required").
 */
describe('claim mappings name real tools only', () => {
  const manifest = new Set<string>(ALIX_CANONICAL_BUILTIN_TOOLS);

  it('every claim-to-tool mapping resolves to a manifest name', () => {
    for (const [label, tool] of Object.entries(CLAIM_TOOL_NAMES)) {
      expect(manifest.has(tool), `${label} -> ${tool} is not in the tool manifest`).toBe(true);
    }
  });

  it('labels without a tool ask for the claim to be withdrawn, never a phantom call', () => {
    const toolLess = CLAIM_TOOL_MAP.filter(entry => !entry.tool).map(entry => entry.label);
    expect(toolLess.length).toBeGreaterThan(0);
    const prompt = buildUnconfirmedDonePrompt({
      unsubstantiated: toolLess,
      evidenceGaps: [],
      errorEchoDone: false,
      attempt: 1,
    });
    for (const label of toolLess) {
      expect(prompt).toContain(`${label} (no matching tool exists in this build — remove that claim)`);
    }
  });

  it('no harness-authored re-prompt text names a tool outside the manifest', () => {
    for (const attempt of [0, 1, 2]) {
      const prompt = buildUnconfirmedDonePrompt({
        unsubstantiated: [...CLAIM_TOOL_MAP.map(entry => entry.label), 'a successful coordination run with worker outcomes'],
        evidenceGaps: [],
        errorEchoDone: false,
        attempt,
      });
      const named = prompt.match(/alix_[a-z0-9_]{2,}/g) ?? [];
      for (const token of named) {
        expect(manifest.has(token), `re-prompt (attempt ${attempt}) names unknown tool ${token}`).toBe(true);
      }
    }
  });
});

/**
 * Operator reporting vocabulary is not a claim. The operator's own prompt asks
 * for "every worker ID, task ID, … and registered artifact", so the summary
 * repeats it — the old bare `\bregister(ed|ing)\b` keyword flagged that.
 */
describe('claim keywords require a first-person action with an object', () => {
  it('ignores operator/coordination reporting vocabulary', () => {
    for (const text of [
      'Registered artifacts (all present, sizes): project.md, workbench.md.',
      'The scheduler dispatched the workers; monitoring is not part of this objective.',
      'The report was sent to the operator with the file list attached.',
    ]) {
      expect(findUnsubstantiatedClaims(text, new Set())).toEqual([]);
    }
  });

  it('flags first-person claims for tools that exist', () => {
    expect(findUnsubstantiatedClaims('I registered the tool card in the registry.', new Set()))
      .toContain('editing/registering files');
    expect(findUnsubstantiatedClaims('I registered the tool card in the registry.', new Set(['alix_patch_apply'])))
      .not.toContain('editing/registering files');
    expect(findUnsubstantiatedClaims('I compiled the project and the build passed.', new Set()))
      .toContain('verifying compilation');
  });

  it('flags first-person claims with no tool in this build', () => {
    for (const [text, label] of [
      ['I sent the operator a notification about the run.', 'sending a notification'],
      ['I uploaded the artifact to the user.', 'sending a file to the user'],
      ['I set up monitoring for the daemon.', 'setting up monitoring'],
    ] as const) {
      expect(findUnsubstantiatedClaims(text, new Set())).toContain(label);
    }
  });
});
