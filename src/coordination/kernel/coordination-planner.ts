/**
 * coordination-planner.ts — Convert TaskGraph plans into persistent
 * CoordinationRun and WorkerAssignment records.
 */

import { randomUUID } from "node:crypto";
import { relative } from "node:path";
import { GraphPlanner, persistGraph, normalizeNodeCapabilities } from "./graph-planner.js";
import { validateGraphDag } from "./graph-validator.js";
import { classifyCapabilities } from "./mutation-classifier.js";
import { isWriteWorker } from "./worker-role.js";
import { compileOwnershipClaims } from "./ownership-claim-compiler.js";
import { CoordinationStore } from "./coordination-store.js";
import { createCoordinationRun, createWorkerAssignment } from "./coordination-types.js";
import { buildDefaultToolIndex } from "../../capabilities/tools/tool-registry.js";
import { claimScopesOverlap } from "../ownership/path-scope.js";
import type { TaskGraph, TaskNode } from "./task-graph.js";
import type { CoordinationRun, WorkerAssignment } from "./coordination-types.js";
import type { MutationClass } from "./mutation-classifier.js";
import type { ToolRegistry } from "../../capabilities/tools/tool-registry.js";

export interface TaskGraphPlanner {
  plan(goal: string, workflowId: string): Promise<{
    graph: TaskGraph;
    rawModelOutput: string;
    valid: boolean;
    errors: string[];
  }>;
}

type PlannerResult = Awaited<ReturnType<TaskGraphPlanner["plan"]>>;

function isPlannerResult(value: unknown): value is PlannerResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return "graph" in candidate && typeof candidate.valid === "boolean" && Array.isArray(candidate.errors);
}

export const DOMAIN_SCOPE_MAP: Record<string, string[]> = {
  coding: ["src/**", "tests/**", "package.json", "package-lock.json"],
  docs: ["docs/**", "README.md", "CHANGELOG.md"],
  infra: [
    ".github/**", "Dockerfile*", "docker-compose*.yml", "docker-compose*.yaml",
    "compose*.yml", "compose*.yaml", "infra/**", "terraform/**", "helm/**",
  ],
  research: ["docs/research/**"],
  business: ["docs/**", "README.md"],
};

/**
 * Extract workspace-relative file paths mentioned in a node goal.
 * Matches quoted segments (`path`, "path", 'path') plus bare tokens
 * containing a slash (./x, .tmp/f.txt, src/a/b.ts) — the planner prompt
 * tells the model to name concrete deliverables, which usually arrive
 * unquoted. Skips URLs, flags, and tokens with spaces. Sorted, deduped,
 * without leading ./ or /.
 */
export function extractGoalPaths(goal: string): string[] {
  const found = new Set<string>();
  // Normalize a candidate token and add it only if it is a plausible
  // workspace-relative path (not a URL, flag, or prose word).
  const addIfWorkspacePath = (candidate: string): void => {
    const clean = candidate.trim().replace(/^\.\//, "").replace(/^\//, "").replace(/[.,;:)\"'`]+$/, "");
    if (!clean || /\s/.test(clean)) return;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(clean)) return;
    if (clean.startsWith("-")) return;
    if (!clean.includes("/") && !/\.[a-z0-9]{1,5}$/i.test(clean)) return;
    found.add(clean);
  };
  const quotedTokens = goal.match(/[`"']([^`"'${}]+)[`"']/g) ?? [];
  for (const token of quotedTokens) addIfWorkspacePath(token.slice(1, -1));
  const bareTokens = goal.match(/(?:^|[\s(])(\.\.?\/[\w.\-+/$]+|[\w.+\-]+(?:\/[\w.+\-]+)+)(?=$|[\s).,;:!?])/g) ?? [];
  for (const token of bareTokens) addIfWorkspacePath(token.trim().replace(/^[([]/, ""));
  return [...found].sort();
}

export function inferOwnershipScopes(node: TaskNode, mutationClass: MutationClass): string[] {
  if (mutationClass === "no-write") return [];
  if (mutationClass === "unknown-write") return ["**"];
  // Prefer concrete goal-mentioned paths: two workers writing different
  // files get disjoint scopes instead of colliding on the domain default
  // (e.g. both claiming src/** blocks the second worker forever).
  const goalPaths = extractGoalPaths(node.goal ?? "");
  if (goalPaths.length > 0) return goalPaths;
  const domain = (node.domain ?? "").toLowerCase();
  if (domain && DOMAIN_SCOPE_MAP[domain]) return [...DOMAIN_SCOPE_MAP[domain]];
  return ["**"];
}

function isOutputPathMention(goal: string, ownedPath: string): boolean {
  const basename = ownedPath.split("/").at(-1) ?? ownedPath;
  const pathPattern = [...new Set([ownedPath, basename])]
    .map(path => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const suffix = `(?=$|[\\s).,;:!?\\x60\\\"'])`;
  const quotedPath = `[\\x60\\\"']?(?:${pathPattern})${suffix}`;
  const destination = new RegExp(
    `\\b(?:to|into|at|as|in)\\s+(?:(?:the|a|an)\\s+)?(?:(?:output|final)\\s+)?(?:file\\s+)?${quotedPath}`,
    "i",
  );
  const direct = new RegExp(
    `\\b(?:create|write|edit|update|modify|save|generate|produce)\\s+(?:(?:the|a|an)\\s+)?(?:(?:new|output|final)\\s+)?(?:file\\s+)?${quotedPath}`,
    "i",
  );
  return destination.test(goal) || direct.test(goal);
}

/**
 * Ownership clauses the operator or model writes deliberately:
 * `owns only <path>`, `owned path only <path>`, `exclusive owned path: <path>`.
 * The capture is the clause *tail*, not one token — models write "owns only
 * the file `X`" as often as "owns only `X`".
 */
const OWNERSHIP_CLAUSE_TAIL = String.raw`([^\n;—–)]+?)(?=[.;]\s|$|[;\n—–)])`;
const OWNERSHIP_CLAUSE_STRICT = new RegExp(
  String.raw`\b(?:owns?\s+only|owned\s+path\s+only|exclusive\s+owned\s+path)\b\s*:?\s*${OWNERSHIP_CLAUSE_TAIL}`,
  "gi",
);

/**
 * Looser markers models also emit — `Owned path: <path>`, `owns <path>`,
 * `ownership: <path>`. Those clauses only ever *add* declared paths; they are
 * not held to the strict "names no workspace path" verdict, so ordinary prose
 * ("each worker owns exactly one file path") cannot block a plan.
 */
const OWNERSHIP_CLAUSE_LOOSE = new RegExp(
  String.raw`\b(?:exclusive\s+owned|ownership|owned|owns?)\b\s*(?:only\s+)?(?:paths?|files?|outputs?)?\s*:?\s*${OWNERSHIP_CLAUSE_TAIL}`,
  "gi",
);

/** Words that can sit between the clause and the path without being one. */
const OWNERSHIP_FILLER = new Set([
  "the", "a", "an", "its", "it", "their", "own", "one", "single", "exclusive",
  "file", "files", "path", "paths", "output", "outputs", "only", "each",
  "that", "which", "creates", "create", "writes", "write", "edits", "edit",
  "updates", "update", "modifies", "modify", "saves", "save", "generates",
  "generate", "produces", "produce", "exactly", "just", "distinct", "disjoint",
  "separate", "respective", "corresponding", "is", "are",
]);

/**
 * Drop the quoting and sentence punctuation a capture absorbs from prose:
 * "…/project.md.", "`…/project.md`". Only the token itself is a path.
 */
function trimOwnedToken(token: string): string {
  return token.replace(/^[`"']+/, "").replace(/[.,;:)\"'`]+$/, "");
}

/**
 * A captured token is an ownership claim only when it is shaped like a
 * workspace path — a slash or a file extension. Prose can follow the clause
 * ("each worker owns ONLY its one file"); reading that as a malformed
 * declaration would block a goal whose real paths are perfectly explicit.
 */
function isOwnedPathToken(token: string): boolean {
  return token.includes("/") || /\.[a-z0-9]{1,5}$/i.test(token);
}

function clauseTailsFor(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)]
    .map((match) => (match[1] ?? "").trim())
    .filter(tail => tail.length > 0);
}

/** Every clause tail in `text`, strict markers first. */
function ownershipClauseTails(text: string): string[] {
  const strict = clauseTailsFor(text, OWNERSHIP_CLAUSE_STRICT);
  const loose = clauseTailsFor(text, OWNERSHIP_CLAUSE_LOOSE);
  return [...strict, ...loose.filter(tail => !strict.includes(tail))];
}

/**
 * The path a clause names. A quoted or directory-bearing token resolves
 * through the goal-path extractor; otherwise the last word is taken when it
 * is shaped like a filename, which covers bare `owns only project.md`.
 * One clause names one path — trailing prose after it is not an ownership
 * list ("owns only X and must not write Y" claims X).
 */
function ownedPathsInClause(tail: string): string[] {
  const direct = extractGoalPaths(tail);
  // Prefer a file-shaped path: a clause often names its inputs in the same
  // breath ("own only out/a.md — inspect src/tui").
  if (direct.length > 0) return [direct.find(path => /\.[a-z0-9]{1,5}$/i.test(path)) ?? direct[0]];
  const last = trimOwnedToken(tail.split(/\s+/).at(-1) ?? "");
  return isOwnedPathToken(last) ? [last] : [];
}

/** Declared ownership paths in `text`, in order, with prose clauses dropped. */
function ownedPathTokens(text: string): string[] {
  const paths = new Set<string>();
  for (const tail of ownershipClauseTails(text)) {
    for (const path of ownedPathsInClause(tail)) paths.add(path);
  }
  return [...paths];
}

/**
 * The first ownership clause that names nothing we can resolve while still
 * carrying a concrete word ("owns only whatever it needs"). Collective prose
 * ("each worker owns ONLY its one file") reduces to filler words and is
 * ignored; a clause that meant to name a path must not vanish silently.
 */
function unresolvedOwnershipClause(text: string): string | undefined {
  return clauseTailsFor(text, OWNERSHIP_CLAUSE_STRICT).find((tail) => {
    if (ownedPathsInClause(tail).length > 0) return false;
    return tail
      .split(/\s+/)
      .map(trimOwnedToken)
      .some(token => token.length > 0 && !OWNERSHIP_FILLER.has(token.toLowerCase()));
  });
}

/**
 * Resolve a declared ownership token to a workspace-relative path.
 *
 * A token that carries its own directory resolves from itself. A bare
 * filename ("project.md") leans on the planned node goals: when exactly one
 * node names that basename, its full path is the claim, so the worker is
 * scoped to the directory the plan actually writes into — never to a
 * same-named file at the workspace root. Zero or several candidates leave
 * the literal token, which still has to survive unique-match validation.
 */
function resolveOwnedPath(token: string, nodeGoals: readonly string[]): string {
  if (token.includes("/")) return extractGoalPaths(token)[0] ?? "";
  const named = nodeGoals
    .flatMap(nodeGoal => extractGoalPaths(nodeGoal))
    .filter(path => path.split("/").at(-1) === token);
  return new Set(named).size === 1 ? named[0] : token;
}

/**
 * Directory prep and verification are steps, not workers. A write node that
 * claims no declared output is auxiliary when every file it names is already
 * declared and it works inside a directory the declared paths live in. A
 * writer naming an undeclared file — or referencing no declared location at
 * all — is the planner inventing work, which stays fail-closed.
 */
function isAuxiliaryWriter(goalText: string, ownedPaths: readonly string[]): boolean {
  const declared = new Set(ownedPaths);
  const declaredBasenames = new Set(ownedPaths.map(path => path.split("/").at(-1) ?? path));
  const mentioned = goalText.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,5}/g) ?? [];
  if (mentioned.some(token => !declared.has(token) && !declaredBasenames.has(token))) return false;
  return declaredDirectories(ownedPaths).some(dir => goalText.includes(dir));
}

/** Directories the declared owned paths live in, longest first, deduped. */
function declaredDirectories(ownedPaths: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const path of ownedPaths) {
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir.length > 0) dirs.add(dir);
  }
  return [...dirs].sort((left, right) => right.length - left.length);
}

function explicitOwnershipForNodes(goal: string, nodes: TaskNode[]): {
  paths: Map<string, string>;
  auxiliaryScopes: Map<string, string[]>;
  errors: string[];
} {
  const rawPaths = ownedPathTokens(goal);
  const paths = new Map<string, string>();
  const auxiliaryScopes = new Map<string, string[]>();
  const errors: string[] = [];
  // A clause that names no workspace path must not vanish silently: dropping it
  // switches off declared-ownership validation and lets workers fall back to
  // inferred scopes that can claim their own inputs.
  const unresolvedClause = unresolvedOwnershipClause(goal);
  if (unresolvedClause) {
    errors.push(`Explicit ownership clause names no workspace path: "${unresolvedClause}"`);
  }
  const countWords: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  const countToken = goal.match(/\bexactly\s+(\d+|[a-z]+)\s+workers?\b/i)?.[1].toLowerCase();
  const statedCount = countToken === undefined ? undefined : /^\d+$/.test(countToken)
    ? Number(countToken) : countWords[countToken];
  if (countToken !== undefined && (!statedCount || !Number.isSafeInteger(statedCount))) {
    errors.push(`Cannot parse explicit worker count: ${countToken}`);
  }

  // Worker sections may be numbered by a list marker, by digits after
  // "Worker", or by neither when the model writes `Worker "Name"` entries;
  // the list position supplies the number in that last case so declared
  // dependencies stay verifiable for named worker lists too.
  const headers = [...goal.matchAll(/^[ \t]*(?:(\d+)\s*[.)]\s*)?Worker\b\s*(\d+)?/gim)];
  const sections = headers.map((header, index) => ({
    number: Number(header[1] ?? header[2] ?? index + 1),
    text: goal.slice(header.index, headers[index + 1]?.index ?? goal.length),
  }));
  const sectionNumbers = new Set(sections.map(section => section.number));
  if (sectionNumbers.size !== sections.length) errors.push("Explicit worker numbers are duplicated");
  const expectedCount = statedCount ?? (sections.length > 0 && rawPaths.length === sections.length ? sections.length : undefined);
  // A goal that declares owned paths defines its workers by those paths: the
  // 1:1 ownership mapping below is the count check, and auxiliary nodes
  // (directory prep, verification) are not workers that write files. Without
  // declared paths there is nothing to map, so the raw node count is the only
  // available signal.
  if (expectedCount !== undefined && rawPaths.length === 0 && nodes.length !== expectedCount) {
    errors.push(`Expected ${expectedCount} workers, planner returned ${nodes.length}`);
  }
  if (statedCount !== undefined && sections.length > 0 && sections.length !== statedCount) {
    errors.push(`Expected ${statedCount} worker sections, found ${sections.length}`);
  }
  const dependencyTextForSection = (text: string): string | undefined =>
    text.match(/\bdepends?\s+on\s+workers?\s+([^.;\n]+)/i)?.[1]
      ?? text.match(/\bdependencies\s*:\s*workers?\s+([^.;\n]+)/i)?.[1];

  if (rawPaths.length === 0) {
    if (sections.some(section => dependencyTextForSection(section.text) !== undefined)) {
      errors.push("Cannot verify explicit worker dependencies without mappable ownership paths");
    }
    return { paths, auxiliaryScopes, errors };
  }

  const nodeGoals = nodes.map(node => node.goal ?? "");
  const ownedPaths = rawPaths.map(raw => resolveOwnedPath(raw, nodeGoals));
  const unresolved = ownedPaths.findIndex(path => !path);
  if (unresolved !== -1) {
    return {
      paths,
      auxiliaryScopes,
      errors: [...errors, `Explicit ownership contains an invalid path: ${rawPaths[unresolved]}`],
    };
  }

  const used = new Set<string>();
  for (const node of nodes) {
    const nodeGoal = node.goal ?? "";
    const writeWorker = isWriteWorker({ requiredCapabilities: node.requiredCapabilities ?? [] });
    const matches = ownedPaths.filter(path => isOutputPathMention(nodeGoal, path));
    if (matches.length === 0) {
      // A node claiming no declared output is auxiliary work (prep, verify,
      // reads). Only a writer that steps outside the declared ownership is
      // the planner inventing a worker, and that stays fail-closed.
      if (writeWorker && !isAuxiliaryWriter(nodeGoal, ownedPaths)) {
        errors.push(
          `Cannot verify explicit worker count: node ${node.id} is an extra writer with no declared owned path`,
        );
      } else if (writeWorker) {
        // Prep work mutates a directory the declared paths live in; scope it
        // there instead of falling back to broad domain defaults.
        const dirs = declaredDirectories(ownedPaths).filter(dir => nodeGoal.includes(dir));
        if (dirs.length > 0) auxiliaryScopes.set(node.id, dirs);
      }
      continue;
    }
    if (!writeWorker) {
      errors.push(`Explicit ownership requires a write worker for node ${node.id}`);
      continue;
    }
    if (matches.length !== 1 || used.has(matches[0])) {
      errors.push(`Cannot uniquely match explicit ownership for node ${node.id}`);
      continue;
    }
    paths.set(node.id, matches[0]);
    used.add(matches[0]);
  }
  if (used.size !== ownedPaths.length) errors.push("Explicit ownership paths do not match planned workers");

  const nodeIdByWorkerNumber = new Map<number, string>();
  for (const section of sections) {
    const rawPath = ownedPathTokens(section.text)[0];
    if (!rawPath) continue;
    const path = resolveOwnedPath(rawPath, nodeGoals);
    const matchedNode = [...paths].find(([, ownedPath]) => ownedPath === path)?.[0];
    if (matchedNode) nodeIdByWorkerNumber.set(section.number, matchedNode);
  }
  for (const section of sections) {
    const dependencyText = dependencyTextForSection(section.text);
    if (!dependencyText) continue;
    const nodeId = nodeIdByWorkerNumber.get(section.number);
    if (!nodeId) {
      errors.push(`Cannot match explicit dependencies for worker ${section.number}`);
      continue;
    }
    const node = nodes.find(candidate => candidate.id === nodeId)!;
    for (const dependencyNumber of [...dependencyText.matchAll(/\b\d+\b/g)].map(match => Number(match[0]))) {
      const dependencyNodeId = nodeIdByWorkerNumber.get(dependencyNumber);
      if (!dependencyNodeId || !node.dependencies.includes(dependencyNodeId)) {
        errors.push(`Worker ${section.number} is missing dependency on worker ${dependencyNumber}`);
      }
    }
  }
  return { paths, auxiliaryScopes, errors };
}

function claimsOverlap(
  left: readonly { path: string; recursive: boolean }[],
  right: readonly { path: string; recursive: boolean }[],
): boolean {
  // Matcher logic lives in src/coordination/ownership/path-scope.ts (ONE matcher module);
  // this is only the pairwise fold over a worker's claim list.
  return left.some(a => right.some(b => claimScopesOverlap(a, b)));
}

function dependsTransitively(workerId: string, targetId: string, byId: ReadonlyMap<string, WorkerAssignment>): boolean {
  const seen = new Set<string>();
  const pending = [...(byId.get(workerId)?.dependencies ?? [])];
  while (pending.length > 0) {
    const dependencyId = pending.pop()!;
    if (dependencyId === targetId) return true;
    if (seen.has(dependencyId)) continue;
    seen.add(dependencyId);
    pending.push(...(byId.get(dependencyId)?.dependencies ?? []));
  }
  return false;
}

/**
 * Order overlapping writers so the scheduler never dispatches two writers
 * whose ownership claims overlap at the same time. Vague write goals carry
 * a workspace-wide (`**`) claim that overlaps every other writer, so they
 * are serialized against explicit-path writers too — not only against
 * other ambiguous writers. Disjoint writers (and read-only workers, which
 * carry no claims) stay parallel. The runtime ownership lease remains the
 * hard guard; this is the planning-level ordering that avoids the
 * conflict in the first place.
 */
export function serializeOverlappingWriters(workers: WorkerAssignment[]): void {
  const writers = workers
    .filter(worker => worker.ownershipClaims.length > 0)
    .sort((a, b) =>
      (a.planOrder ?? Number.MAX_SAFE_INTEGER) - (b.planOrder ?? Number.MAX_SAFE_INTEGER) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id)
    );
  const byId = new Map(workers.map(worker => [worker.id, worker]));
  for (let index = 0; index < writers.length; index += 1) {
    const current = writers[index];
    for (let priorIndex = index - 1; priorIndex >= 0; priorIndex -= 1) {
      const prior = writers[priorIndex];
      if (!claimsOverlap(current.ownershipClaims, prior.ownershipClaims)) continue;
      if (!dependsTransitively(current.id, prior.id, byId)) current.dependencies.push(prior.id);
      break;
    }
  }
}

/**
 * Defensive mapping error.
 * Should be unreachable after validateGraphDag() succeeds,
 * unless the graph is mutated between validation and mapping.
 */
export class CoordinationPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoordinationPlanValidationError";
  }
}

export type CoordinationPlanResult = {
  run: CoordinationRun | null;
  graph: TaskGraph | null;
  valid: boolean;
  errors: string[];
};

export type PlannerOptions = {
  agentPool?: string[];
  modelEndpoint?: string;
  modelName?: string;
  /** Provider-backed generator for planning; uses the configured model
   * when supplied instead of the raw Ollama endpoint. */
  generate?: import("./graph-planner.js").PlannerGenerate;
};

export class CoordinationPlanner {
  private readonly planner: TaskGraphPlanner;
  private readonly store: CoordinationStore;
  private readonly agentPool: string[];
  private readonly cwd: string;
  private readonly toolRegistry: ToolRegistry;

  constructor(
    cwd: string,
    options: PlannerOptions = {},
    dependencies?: {
      planner?: TaskGraphPlanner;
      store?: CoordinationStore;
      toolRegistry?: ToolRegistry;
    },
  ) {
    this.planner = dependencies?.planner ?? new GraphPlanner({
      modelEndpoint: options.modelEndpoint,
      modelName: options.modelName,
      generate: options.generate,
    });
    this.store = dependencies?.store ?? new CoordinationStore(cwd);
    this.agentPool = options.agentPool ?? [];
    this.cwd = cwd;
    this.toolRegistry = dependencies?.toolRegistry ?? buildDefaultToolIndex().registry;
  }

  async plan(
    goal: string,
    coordinatorAgentId: string,
    sessionId: string,
    metadata?: { hostKind?: "inspector" | "daemon" | "cli"; sessionMode?: "auto" | "ask" | "bypass"; maxConcurrency?: number },
  ): Promise<CoordinationPlanResult> {
    let rawPlanResult: unknown;

    try {
      rawPlanResult = await this.planner.plan(goal, `wf_${randomUUID()}`);
    } catch (error) {
      return this.persistBlockedDiagnostic({
        goal, coordinatorAgentId, sessionId, graph: null,
        errors: [`Planner threw: ${error instanceof Error ? error.message : String(error)}`],
        graphSafeToPersist: false,
      });
    }

    if (!isPlannerResult(rawPlanResult)) {
      return this.persistBlockedDiagnostic({
        goal, coordinatorAgentId, sessionId, graph: null,
        errors: ["Planner returned a malformed result"],
        graphSafeToPersist: false,
      });
    }

    const planResult = rawPlanResult;
    const dagResult = validateGraphDag(planResult.graph);

    if (!planResult.valid || !dagResult.valid) {
      return this.persistBlockedDiagnostic({
        goal, coordinatorAgentId, sessionId, graph: planResult.graph,
        errors: [...planResult.errors, ...dagResult.errors],
        graphSafeToPersist: dagResult.safeToPersist,
      });
    }

    const planOrderByNode = new Map<string, number>(
      dagResult.topologicalOrder.map((nodeId, index) => [nodeId, index]),
    );

    // Layer 2 (deterministic, registry-sourced): guarantee every node
    // carries non-empty, known capabilities before workers are derived.
    // The planner prompt asks for them, but flash-tier models omit or
    // invent names — normalization filters to the live registry catalog
    // and falls back to read-only role/domain defaults. `authorizeWorker`
    // stays fail-closed; this only ensures well-formed input reaches it.
    const catalog = new Set(
      this.toolRegistry.getAll().flatMap(t => [t.name, t.capabilityId]),
    );
    for (const node of planResult.graph.nodes) {
      node.requiredCapabilities = normalizeNodeCapabilities(
        { requiredCapabilities: node.requiredCapabilities, role: node.role, domain: node.domain },
        catalog,
      );
    }

    const explicitOwnership = explicitOwnershipForNodes(goal, planResult.graph.nodes);
    if (explicitOwnership.errors.length > 0) {
      return this.persistBlockedDiagnostic({
        goal, coordinatorAgentId, sessionId, graph: planResult.graph,
        errors: explicitOwnership.errors, graphSafeToPersist: true,
      });
    }

    const absoluteGraphPath = await persistGraph(planResult.graph, this.cwd);
    const taskGraphRef = relative(this.cwd, absoluteGraphPath).replaceAll("\\", "/");

    const run = createCoordinationRun({
      sessionId, rootGoal: goal, coordinatorAgentId,
      taskGraphId: planResult.graph.id,
      taskGraphRef,
    });
    // Apply host/approval metadata before the run is persisted so a crash
    // can never leave a run saved without its resume identity.
    if (metadata?.hostKind) run.hostKind = metadata.hostKind;
    if (metadata?.sessionMode) run.sessionMode = metadata.sessionMode;
    if (metadata?.maxConcurrency !== undefined) run.maxConcurrency = metadata.maxConcurrency;

    // Distinct owner labels by default: an empty pool previously stamped
    // every worker with the coordinator id, making parallel workers
    // indistinguishable in listings. Indexed suffixes preserve attribution
    // (prefix is still the coordinator) while telling workers apart.
    // An explicit agentPool keeps round-robin behavior.
    const pool = this.agentPool.length > 0 ? this.agentPool : [];
    const defaultLabel = (index: number): string => `${coordinatorAgentId}#${index + 1}`;
    const nodeToWorkerId = new Map<string, string>();
    const workers: WorkerAssignment[] = [];

    for (const node of planResult.graph.nodes) {
      const workerId = `worker_${randomUUID()}`;
      nodeToWorkerId.set(node.id, workerId);

      const mutationClass = classifyCapabilities(node.requiredCapabilities ?? [], this.toolRegistry);
      // Ownership must match execution privilege: only workers the executor
      // will run in write mode claim write scopes. A read-only worker
      // (explorer/researcher, including unknown-only capabilities) claims
      // nothing, so the planner never over-reserves `**` for a node that
      // cannot write.
      const writer = isWriteWorker({ requiredCapabilities: node.requiredCapabilities ?? [] });
      const explicitPath = explicitOwnership.paths.get(node.id);
      const auxiliaryScope = explicitOwnership.auxiliaryScopes.get(node.id);
      const ownershipScopes = writer
        ? explicitPath ? [explicitPath]
          : auxiliaryScope ?? inferOwnershipScopes(node, mutationClass)
        : [];
      const claimResult = compileOwnershipClaims(ownershipScopes);
      const agentId = pool.length > 0 ? pool[workers.length % pool.length] : defaultLabel(workers.length);

      workers.push(createWorkerAssignment({
        id: workerId,
        coordinationRunId: run.id,
        agentId,
        taskLabel: node.title,
        goalPrompt: explicitPath ? `${node.goal}\nOutput path: ${explicitPath}` : node.goal,
        dependencies: [],
        ownershipScopes,
        sourceNodeId: node.id,
        requiredCapabilities: node.requiredCapabilities ?? [],
        riskLevel: node.riskLevel,
        approvalMode: node.approvalMode,
        attempt: 0,
        maxAttempts: 3,
        planOrder: planOrderByNode.get(node.id),
        ownershipClaims: claimResult.claims,
      }));
    }

    for (let index = 0; index < planResult.graph.nodes.length; index += 1) {
      const node = planResult.graph.nodes[index];
      for (const dependencyId of node.dependencies) {
        const dependencyWorkerId = nodeToWorkerId.get(dependencyId);
        if (!dependencyWorkerId) {
          throw new CoordinationPlanValidationError(
            `Unknown graph dependency: ${node.id} → ${dependencyId}`,
          );
        }
        workers[index].dependencies.push(dependencyWorkerId);
      }
      const inputPaths = [...new Set(node.dependencies
        .map(dependencyId => explicitOwnership.paths.get(dependencyId))
        .filter((path): path is string => path !== undefined))];
      if (inputPaths.length > 0) {
        workers[index].inputPaths = inputPaths;
        workers[index].goalPrompt += `\nInput paths:\n${inputPaths.map(path => `- ${path}`).join("\n")}`;
      }
    }

    serializeOverlappingWriters(workers);

    run.workers = workers;
    // Deliberately remains "planning". M0.77c transitions it to "running".
    await this.store.save(run);

    return { run, graph: planResult.graph, valid: true, errors: [] };
  }

  private async persistBlockedDiagnostic(
    options: {
      goal: string;
      coordinatorAgentId: string;
      sessionId: string;
      graph: TaskGraph | null;
      errors: string[];
      graphSafeToPersist: boolean;
    },
  ): Promise<CoordinationPlanResult> {
    const diagnosticErrors = [...options.errors];
    let taskGraphId: string | undefined;
    let taskGraphRef: string | undefined;

    if (options.graph && options.graphSafeToPersist) {
      try {
        const absolutePath = await persistGraph(options.graph, this.cwd);
        taskGraphRef = relative(this.cwd, absolutePath).replaceAll("\\", "/");
        taskGraphId = options.graph.id;
      } catch (error) {
        diagnosticErrors.push(
          `Failed to persist planning graph: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const run = createCoordinationRun({
      sessionId: options.sessionId,
      rootGoal: options.goal,
      coordinatorAgentId: options.coordinatorAgentId,
      taskGraphId,
      taskGraphRef,
    });
    run.status = "blocked";

    run.workers.push(createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: options.coordinatorAgentId,
      taskLabel: "Planner diagnostic — requires review",
      goalPrompt: options.goal,
      ownershipScopes: ["**"],
      status: "blocked",
      error: `Planner validation failed: ${diagnosticErrors.join("; ")}`,
    }));

    await this.store.save(run);
    return { run, graph: options.graph, valid: false, errors: diagnosticErrors };
  }
}
