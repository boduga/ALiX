// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * P5.5/P5.6 — `alix capability consolidate` operator CLI (ruling #544).
 *
 * The CLI IS the authorized caller for `consolidation_opportunity`. These
 * tests pin the locked architectural boundary:
 *
 * - The operator supplies the COMPLETE governed set explicitly
 *   (`--survivor`, `--absorbed`, `--definition`, `--source-disposition`).
 * - Nothing is defaulted, derived, inferred, expanded, or reordered.
 * - Pair-layer evidence is CONTEXT only — it never influences, gates, or
 *   supplies any identity.
 *
 * Required axes:
 *   1. Missing `--survivor` → usage rejection (exit 2).
 *   2. Missing `--absorbed` → usage rejection (exit 2).
 *   3. `--absorbed=""` (empty) → rejection (ruling #534, non-empty set).
 *   4. `--survivor=B --absorbed=B,C` (survivor ∈ absorbed) → rejection.
 *   5. Valid invocation → emits a `CapabilityConsolidateMutation` carrying
 *      the operator's explicit values.
 *   6. SENTINEL: `mutation.target` === `--survivor` exactly (no transform).
 *   7. SENTINEL: `mutation.sources` === `--absorbed` exactly (same values,
 *      same order, same length — no expansion, no inference).
 *   8. SENTINEL: pair-layer evidence does NOT influence the operator's
 *      explicit values, and its absence does not gate the request.
 *
 * @module tests/cli/capability-consolidate
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/events/event-log.js";
import {
  CapabilityService,
  type OperatorConsolidationInput,
  type CapabilityProposeConsolidationResult,
} from "../../src/capability/capability-service.js";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { CapabilityResolver } from "../../src/capability/provider-resolver.js";
import { ProviderExecutorRegistry } from "../../src/capability/provider-registry.js";
import { NativeProviderExecutor } from "../../src/capability/provider-executor.js";
import { NativeExecutor } from "../../src/capability/executors.js";
import type { CapabilityDefinition } from "../../src/capability/canonical/definition.js";
import type { CapabilityMutationExecutor } from "../../src/evolution/execution/capability-mutation-executor.js";
import { def } from "../_support/capability-test-fixtures.js";
import {
  capabilityConsolidateCommand,
  parseConsolidateArgs,
  buildConsolidationInput,
} from "../../src/cli/commands/capability-consolidate.js";
import { handleCapabilityCommand } from "../../src/cli/commands/capability.js";

/**
 * Records every `proposeConsolidation` input so the sentinels can compare it
 * against the raw command line. Deliberately does NOT validate — the point is
 * to observe exactly what the CLI hands across the seam.
 */
class RecordingService {
  readonly inputs: OperatorConsolidationInput[] = [];

  async proposeConsolidation(
    input: OperatorConsolidationInput,
  ): Promise<CapabilityProposeConsolidationResult> {
    this.inputs.push(input);
    return {
      proposalId: "p-recorded",
      status: "pending",
      candidate: {
        candidateId: "c-recorded",
        sourcePatternId: "consolidation_opportunity",
        confidence: 1,
        target: { kind: "capability", id: input.identity.survivorCapabilityId },
        description: "d",
        expectedEffect: "e",
        riskClass: "high",
        evidenceIds: [],
        absorbedCapabilityIds: [...input.identity.absorbedCapabilityIds],
      },
      mutation: {
        operation: "capability.consolidate",
        target: input.identity.survivorCapabilityId,
        sources: [...input.identity.absorbedCapabilityIds],
        definition: input.identity.consolidateDefinition,
        sourceDisposition: input.identity.sourceDisposition,
      },
      signal: {
        kind: "consolidation_opportunity",
        survivorCapabilityId: input.identity.survivorCapabilityId,
        absorbedCapabilityIds: [...input.identity.absorbedCapabilityIds],
        consolidateDefinition: input.identity.consolidateDefinition,
        sourceDisposition: input.identity.sourceDisposition,
        score: 1,
        evidenceIds: [],
      },
    };
  }
}

describe("P5.5/P5.6 operator CLI — `alix capability consolidate` (ruling #544)", () => {
  let dir: string;
  let catalog: CapabilityCatalog;
  let registry: CapabilityRegistry;
  let resolver: CapabilityResolver;
  let eventLog: EventLog;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let outSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "p5-operator-cli-"));
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    registry = new CapabilityRegistry(catalog);
    const providers = new ProviderExecutorRegistry();
    providers.register("native", new NativeProviderExecutor(new NativeExecutor()));
    resolver = new CapabilityResolver(registry, providers);
    eventLog = new EventLog(dir);
    await eventLog.init();
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    outSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
    outSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Register survivor + two absorbed capabilities. The proposed target
   *  definition unions the sources' permissions/dependencies so
   *  `validateConsolidateMerge` accepts the operator's explicit proposal. */
  function seedCatalog(): void {
    catalog.register(
      def({ id: "core.alpha", bindings: [{ id: "core.alpha", type: "native" }] }),
      { id: "core.alpha", type: "native" },
    );
    catalog.register(
      def({ id: "core.beta", bindings: [{ id: "core.beta", type: "native" }] }),
      { id: "core.beta", type: "native" },
    );
    catalog.register(
      def({ id: "core.gamma", bindings: [{ id: "core.gamma", type: "native" }] }),
      { id: "core.gamma", type: "native" },
    );
    registry.reload();
  }

  function realService(): CapabilityService {
    return new CapabilityService({
      catalog,
      resolver,
      mutationExecutor: {} as unknown as CapabilityMutationExecutor,
      eventLog,
    });
  }

  function lookup(): { get(id: string): CapabilityDefinition | undefined } {
    return { get: (id: string) => catalog.get(id) };
  }

  const VALID_ARGS = [
    "--survivor=core.alpha@1.0.0",
    "--absorbed=core.beta@1.0.0,core.gamma@1.0.0",
    "--definition=core.alpha@1.0.0",
    "--source-disposition=deprecate",
  ];

  // -------------------------------------------------------------------------
  // Axis 1 — missing --survivor
  // -------------------------------------------------------------------------
  it("axis 1: missing --survivor is rejected with a usage message (exit 2)", async () => {
    const rec = new RecordingService();
    const exit = await capabilityConsolidateCommand(
      [
        "--absorbed=core.beta@1.0.0",
        "--definition=core.alpha@1.0.0",
        "--source-disposition=deprecate",
      ],
      { service: rec as unknown as CapabilityService, catalog: lookup() },
    );
    expect(exit).toBe(2);
    expect(rec.inputs).toHaveLength(0);
    const text = errSpy.mock.calls.flat().join("\n");
    expect(text).toContain("--survivor is required");
    expect(text).toContain("Usage: alix capability consolidate");
  });

  // -------------------------------------------------------------------------
  // Axis 2 — missing --absorbed
  // -------------------------------------------------------------------------
  it("axis 2: missing --absorbed is rejected (absorbed set is required, exit 2)", async () => {
    const rec = new RecordingService();
    const exit = await capabilityConsolidateCommand(
      [
        "--survivor=core.alpha@1.0.0",
        "--definition=core.alpha@1.0.0",
        "--source-disposition=deprecate",
      ],
      { service: rec as unknown as CapabilityService, catalog: lookup() },
    );
    expect(exit).toBe(2);
    expect(rec.inputs).toHaveLength(0);
    expect(errSpy.mock.calls.flat().join("\n")).toContain("--absorbed is required");
  });

  // -------------------------------------------------------------------------
  // Axis 3 — empty --absorbed (ruling #534: non-empty)
  // -------------------------------------------------------------------------
  it("axis 3: --absorbed='' is rejected — the absorbed set must be non-empty (#534)", async () => {
    const rec = new RecordingService();
    const exit = await capabilityConsolidateCommand(
      [
        "--survivor=core.alpha@1.0.0",
        "--absorbed=",
        "--definition=core.alpha@1.0.0",
        "--source-disposition=deprecate",
      ],
      { service: rec as unknown as CapabilityService, catalog: lookup() },
    );
    expect(exit).toBe(2);
    expect(rec.inputs).toHaveLength(0);
    expect(errSpy.mock.calls.flat().join("\n")).toContain("at least one capability");
  });

  it("axis 3b: an empty entry inside --absorbed is rejected, never silently dropped", () => {
    const parsed = parseConsolidateArgs([
      "--survivor=core.alpha@1.0.0",
      "--absorbed=core.beta@1.0.0,,core.gamma@1.0.0",
      "--definition=core.alpha@1.0.0",
      "--source-disposition=deprecate",
    ]);
    expect(parsed.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Axis 4 — survivor ∈ absorbed
  // -------------------------------------------------------------------------
  it("axis 4: --survivor appearing in --absorbed is rejected (target ∉ sources)", async () => {
    const rec = new RecordingService();
    const exit = await capabilityConsolidateCommand(
      [
        "--survivor=core.beta@1.0.0",
        "--absorbed=core.beta@1.0.0,core.gamma@1.0.0",
        "--definition=core.alpha@1.0.0",
        "--source-disposition=deprecate",
      ],
      { service: rec as unknown as CapabilityService, catalog: lookup() },
    );
    expect(exit).toBe(2);
    expect(rec.inputs).toHaveLength(0);
    expect(errSpy.mock.calls.flat().join("\n")).toContain("must not also appear in --absorbed");
  });

  it("axis 4b: --source-disposition is required and never defaulted", () => {
    const parsed = parseConsolidateArgs([
      "--survivor=core.alpha@1.0.0",
      "--absorbed=core.beta@1.0.0",
      "--definition=core.alpha@1.0.0",
    ]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.join("\n")).toContain("--source-disposition is required");
    }
  });

  it("axis 4c: --definition is required and never defaulted", () => {
    const parsed = parseConsolidateArgs([
      "--survivor=core.alpha@1.0.0",
      "--absorbed=core.beta@1.0.0",
      "--source-disposition=remove",
    ]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.join("\n")).toContain("--definition is required");
    }
  });

  // -------------------------------------------------------------------------
  // Axis 5 — valid invocation emits a CapabilityConsolidateMutation
  // -------------------------------------------------------------------------
  it("axis 5: a valid invocation emits a capability.consolidate mutation with the operator's values", async () => {
    seedCatalog();
    const service = realService();
    const exit = await capabilityConsolidateCommand(VALID_ARGS, {
      service,
      catalog: lookup(),
    });
    expect(exit).toBe(0);

    const printed = JSON.parse(outSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("")) as {
      proposalId: string;
      status: string;
      mutation: {
        operation: string;
        target: string;
        sources: string[];
        sourceDisposition: string;
      };
    };
    expect(printed.status).toBe("pending");
    expect(printed.proposalId).toBeTruthy();
    expect(printed.mutation.operation).toBe("capability.consolidate");
    expect(printed.mutation.sourceDisposition).toBe("deprecate");
  });

  it("axis 5b: the `consolidate` subcommand is registered on the capability dispatcher", async () => {
    seedCatalog();
    const exit = await handleCapabilityCommand(["consolidate", ...VALID_ARGS], {
      cwd: dir,
      service: realService(),
      definitions: lookup(),
    });
    expect(exit).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Axis 6 — SENTINEL: target === --survivor exactly
  // -------------------------------------------------------------------------
  it("axis 6 SENTINEL: mutation.target equals --survivor verbatim (no transformation)", async () => {
    seedCatalog();
    const result = await realService().proposeConsolidation(
      buildConsolidationInput(
        (
          parseConsolidateArgs(VALID_ARGS) as Extract<
            ReturnType<typeof parseConsolidateArgs>,
            { ok: true }
          >
        ).args,
        catalog.get("core.alpha") as CapabilityDefinition,
      ),
    );
    // The operator typed `--survivor=core.alpha@1.0.0`.
    expect(result.mutation.target).toBe("core.alpha");
    expect((result.signal as { survivorCapabilityId: string }).survivorCapabilityId).toBe(
      "core.alpha",
    );
    expect(result.candidate.target.id).toBe("core.alpha");
  });

  // -------------------------------------------------------------------------
  // Axis 7 — SENTINEL: sources === --absorbed exactly
  // -------------------------------------------------------------------------
  it("axis 7 SENTINEL: mutation.sources equals --absorbed verbatim — no expansion, no inference, order preserved", async () => {
    seedCatalog();
    const rec = new RecordingService();
    // Reverse order on the command line: the CLI must preserve it exactly.
    const exit = await capabilityConsolidateCommand(
      [
        "--survivor=core.alpha@1.0.0",
        "--absorbed=core.gamma@1.0.0,core.beta@1.0.0",
        "--definition=core.alpha@1.0.0",
        "--source-disposition=remove",
      ],
      { service: rec as unknown as CapabilityService, catalog: lookup() },
    );
    expect(exit).toBe(0);
    expect(rec.inputs).toHaveLength(1);
    const input = rec.inputs[0]!;
    expect([...input.identity.absorbedCapabilityIds]).toEqual(["core.gamma", "core.beta"]);
    expect(input.identity.absorbedCapabilityIds).toHaveLength(2);
    expect(input.identity.survivorCapabilityId).toBe("core.alpha");
    // The survivor is NEVER folded into the absorbed set.
    expect(input.identity.absorbedCapabilityIds).not.toContain("core.alpha");
  });

  it("axis 7b SENTINEL: a single-element absorbed set is not expanded to sibling capabilities", async () => {
    seedCatalog();
    const rec = new RecordingService();
    const exit = await capabilityConsolidateCommand(
      [
        "--survivor=core.alpha@1.0.0",
        "--absorbed=core.beta@1.0.0",
        "--definition=core.alpha@1.0.0",
        "--source-disposition=deprecate",
      ],
      { service: rec as unknown as CapabilityService, catalog: lookup() },
    );
    expect(exit).toBe(0);
    // `core.gamma` exists in the catalog and overlaps, but the operator did
    // not name it — it must not appear.
    expect([...rec.inputs[0]!.identity.absorbedCapabilityIds]).toEqual(["core.beta"]);
  });

  // -------------------------------------------------------------------------
  // Axis 8 — SENTINEL: pair evidence is context, never a determinant
  // -------------------------------------------------------------------------
  it("axis 8 SENTINEL: pair-layer evidence does not influence the operator's explicit values", async () => {
    seedCatalog();
    // Evidence deliberately CONTRADICTS the operator: it recommends
    // core.gamma <> core.delta and never mentions the operator's request.
    const pairEvidence = [
      "p5.5-pair:core.gamma<>core.delta",
      "overlapScore=0.9900",
      "coverageAtoB=1.0000",
    ];
    const withEvidence = new RecordingService();
    const withoutEvidence = new RecordingService();

    const args = [...VALID_ARGS, "--show-evidence"];
    const exitA = await capabilityConsolidateCommand(args, {
      service: withEvidence as unknown as CapabilityService,
      catalog: lookup(),
      pairEvidence,
    });
    const exitB = await capabilityConsolidateCommand(args, {
      service: withoutEvidence as unknown as CapabilityService,
      catalog: lookup(),
      pairEvidence: [],
    });

    // Absent evidence does NOT gate the request — both succeed identically.
    expect(exitA).toBe(0);
    expect(exitB).toBe(0);
    expect(withEvidence.inputs[0]!.identity.survivorCapabilityId).toBe(
      withoutEvidence.inputs[0]!.identity.survivorCapabilityId,
    );
    expect([...withEvidence.inputs[0]!.identity.absorbedCapabilityIds]).toEqual([
      ...withoutEvidence.inputs[0]!.identity.absorbedCapabilityIds,
    ]);
    // The contradicting evidence's capabilities never leak into the request.
    expect(withEvidence.inputs[0]!.identity.absorbedCapabilityIds).not.toContain("core.delta");
    expect(withEvidence.inputs[0]!.identity.survivorCapabilityId).not.toBe("core.gamma");
    // Evidence IS displayed as context.
    expect(errSpy.mock.calls.flat().join("\n")).toContain("context only");
  });

  it("axis 8b SENTINEL: the service rejects an empty absorbed set instead of completing it", async () => {
    seedCatalog();
    await expect(
      realService().proposeConsolidation({
        identity: {
          survivorCapabilityId: "core.alpha",
          absorbedCapabilityIds: [],
          consolidateDefinition: catalog.get("core.alpha") as CapabilityDefinition,
          sourceDisposition: "deprecate",
        },
      }),
    ).rejects.toThrow(/absorbedCapabilityIds must be a non-empty array/);
  });

  it("axis 8c: an operator-named capability absent from the catalog is reported, never dropped", async () => {
    seedCatalog();
    const exit = await capabilityConsolidateCommand(
      [
        "--survivor=core.alpha@1.0.0",
        "--absorbed=core.beta@1.0.0,core.nonexistent@1.0.0",
        "--definition=core.alpha@1.0.0",
        "--source-disposition=deprecate",
      ],
      { service: realService(), catalog: lookup() },
    );
    expect(exit).toBe(4);
    expect(errSpy.mock.calls.flat().join("\n")).toContain("core.nonexistent");
  });

  it("axis 8d: --definition must match the catalog version exactly (no nearby-version substitution)", async () => {
    seedCatalog();
    const exit = await capabilityConsolidateCommand(
      [
        "--survivor=core.alpha@1.0.0",
        "--absorbed=core.beta@1.0.0",
        "--definition=core.alpha@9.9.9",
        "--source-disposition=deprecate",
      ],
      { service: realService(), catalog: lookup() },
    );
    expect(exit).toBe(4);
    expect(errSpy.mock.calls.flat().join("\n")).toContain("core.alpha@9.9.9");
  });
});
