/**
 * corpus.ts — Context-relevance fixture corpus (J2).
 *
 * One objective plus single items labeled relevant/irrelevant. Labels are for
 * baseline/Jev comparison and J4 threshold tuning — no engine produces them.
 */

export type ContextRelevanceFixture = {
  id: string;
  objective: string;
  item: string;
  expected: "relevant" | "irrelevant";
  note?: string;
  /**
   * Ground truth says irrelevant but the lexical baseline scores it relevant.
   * Kept in the corpus deliberately: it is a false positive for J4 to measure
   * and tune against, not a case the baseline is expected to pass.
   */
  knownBaselineFalsePositive?: boolean;
};

export const CONTEXT_RELEVANCE_CORPUS: readonly ContextRelevanceFixture[] = [
  {
    id: "relevant-direct",
    objective: "Fix the flaky provider timeout test",
    item: "The provider contract wrapper enforces a per-call timeout on complete().",
    expected: "relevant",
  },
  {
    id: "relevant-tooling",
    objective: "Fix the flaky provider timeout test",
    item: "Vitest retries can mask a timeout race in the provider test suite.",
    expected: "relevant",
  },
  {
    id: "irrelevant-unrelated",
    objective: "Fix the flaky provider timeout test",
    item: "The marketing site uses a serif display font for headings.",
    expected: "irrelevant",
  },
  {
    id: "irrelevant-lexical-bait",
    objective: "Fix the flaky provider timeout test",
    item: "Provider timeout test fixtures were archived in 2019 and never reused.",
    expected: "irrelevant",
    note: "shares terms but describes archive history, not the work",
    knownBaselineFalsePositive: true,
  },
  {
    id: "irrelevant-empty-signal",
    objective: "Reduce context window pressure in long sessions",
    item: "The team ordered pizza for the release party.",
    expected: "irrelevant",
  },
];
