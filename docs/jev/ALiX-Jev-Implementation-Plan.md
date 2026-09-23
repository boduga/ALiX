**Phased delivery plan with tests, gates, rollback points, and
acceptance criteria**

Project: ALiX \| Jev / System One integration \| Status: delivered (J0-J6)
See ALiX-Jev-Status.md for current state.

Prepared: 20 September 2026

# 1. Goal

Introduce Jev incrementally as an optional DecisionEngine for three
bounded decisions while preserving ALiX local-first behavior,
deterministic governance and the canonical model configuration.

# 2. Delivery rules

-   Every phase lands independently and leaves main usable.

-   Tests are written at the decision boundary, not only provider
    adapter level.

-   No phase may introduce a mandatory Jev dependency.

-   No runtime wiring before the underlying projection, redaction,
    journaling and fallback behavior are tested.

-   Use shadow/observe mode before allowing a Jev decision to affect
    routing where practical.

-   Stop and surface any conflict with existing governance or canonical
    models configuration rather than adding a parallel source of truth.

# J0 --- Decision foundation

## Tasks

1.  Inventory existing classifier/model-routing/governance seams and
    identify exact integration points.

2.  Add typed Choice/Score/Noul result contracts plus provenance
    metadata.

3.  Add DecisionEngine capability metadata and engine registry.

4.  Add decision-specific projector interface.

5.  Add remote-boundary redaction/validation service.

6.  Add decision journal schema/store integration.

7.  Add configuration: local default; Jev opt-in; per-decision
    engine/fallback; threshold profile IDs.

8.  Add unit tests for redaction, forbidden secret material, engine
    selection, fallback and journaling.

## Exit criteria

-   ALiX runs with Jev absent/disabled.

-   No raw ExecutionState is accepted by remote adapter.

-   Decision journal records provenance and projection hash.

-   JEV-1 through JEV-10 have direct tests where applicable.

# J1 --- Claim verification

## Tasks

9.  Define ClaimVerificationProjection and enumerated result schema.

10. Implement local baseline engine behavior/adapter path.

11. Implement Jev adapter mapping using official SDK semantics.

12. Add fixture corpus of supported/contradicted/insufficient examples.

13. Run Jev in shadow mode and record results/outcomes.

14. Add failure/fallback tests and adversarial-text fixtures.

## Exit criteria

-   No execution authority is granted by the decision.

-   Results are journaled and replayable.

-   Baseline vs Jev can be compared on the same fixtures.

# J2 --- Per-item context relevance

## Tasks

15. Define objective + single-item projection.

16. Choose Noul/Score semantics based on SDK behavior and empirical
    results.

17. Integrate with context selection behind a feature flag.

18. Evaluate items independently; rank/filter in deterministic code.

19. Collect false-positive/false-negative labels and tune a versioned
    threshold profile.

## Exit criteria

-   Whole memory/session dumps are never sent.

-   Threshold is decision/engine-specific.

-   Disabling the feature restores existing context behavior.

# J3 --- Model-tier routing

## Tasks

20. Enumerate currently enabled canonical tiers from models.\*
    configuration.

21. Build safe request/task projection; exclude secrets/raw source/tool
    output.

22. Implement bounded Choice over enabled tiers.

23. Resolve returned tier exclusively through ModelRegistry/canonical
    models configuration.

24. Add shadow comparison against current routing policy.

25. Gate active routing behind config after evaluation.

## Exit criteria

-   Jev never sees/returns provider model IDs.

-   Unknown/disabled tiers are rejected.

-   Current routing remains the fallback.

-   No legacy model alias/source is introduced.

# J4 --- Outcome collection and calibration

## Tasks

26. Define outcome labels for each of the three decisions.

27. Build journal queries/export for calibration datasets.

28. Plot/compute reliability by confidence/probability bins where
    semantically valid.

29. Create versioned threshold profiles per engine/decision/risk.

30. Add promotion/rollback mechanism for threshold profiles.

## Exit criteria

-   Thresholds have empirical provenance.

-   LLM and Jev profiles are distinct.

-   Profile version is captured in each journal record.

# J5 --- Replay and regression

## Tasks

31. Build offline replay harness over stored/protected fixtures.

32. Compare engine/version agreement, accuracy, latency and cost.

33. Add regression gates for promoted engine/model/threshold changes.

34. Support dry-run replay without mutating runtime state.

## Exit criteria

-   A provider/version change can be evaluated before production
    activation.

-   Replay cannot execute tools or mutate governance state.

# J6 --- Optional bounded expansion

## Tasks

35. Evaluate only after J1-J5 evidence is satisfactory.

36. Candidate areas: bounded risk escalation, bounded candidate action
    selection, per-domain parallel-task classification.

37. Require an atomic-question review and deterministic candidate
    generator for every new decision.

38. Keep task decomposition, dependency analysis and open-ended
    next-action planning with System Two/ALiX workflow.

## Exit criteria

-   No new decision violates the admission rule.

-   Any execution-affecting decision has deterministic policy floor and
    safe fallback.

# 3. Suggested test matrix

  --------------------------------------------------------------------------------------
  Area          Happy path          Failure path                Security/governance
  ------------- ------------------- --------------------------- ------------------------
  Engine        configured engine   missing/unavailable engine  remote engine cannot
  registry      resolves            falls back                  bypass allow/opt-in

  Projection    minimal typed       missing required field      secret-bearing field
                projection          rejected                    rejected/redacted

  Jev adapter   valid               timeout/malformed/unknown   raw state/tool output
                Choice/Score/Noul   result                      prohibited
                mapping                                         

  Journal       record + hash +     journal failure policy      sensitive payload not
                provenance          tested                      persisted by default

  Approval      risk can escalate   engine unavailable          policy-required approval
  composition   approval                                        always remains required

  Model tier    enabled tier        unknown/disabled tier       provider/model ID not
                resolves            rejected                    accepted from Jev

  Replay        same fixture        missing engine/version      replay cannot execute
                re-evaluates        handled                     tools
  --------------------------------------------------------------------------------------

# 4. Configuration sketch

decision:\
defaultEngine: local\
remote:\
jev:\
enabled: false

claimVerification:\
engine: jev\
fallback: local\
thresholdProfile: claim-verification/jev/v1

contextRelevance:\
engine: jev\
fallback: local\
thresholdProfile: context-relevance/jev/v1

modelTier:\
engine: jev\
fallback: existing-routing\
thresholdProfile: model-tier/jev/v1

Names above are conceptual; align them with the repository's existing
configuration conventions rather than introducing a competing
configuration hierarchy.

# 5. Suggested implementation order inside J0

39. Repository inventory and integration-point note.

40. Contracts and native decision result types.

41. Decision-specific projector contract.

42. Redaction/remote-boundary validator.

43. Decision journal schema and recorder.

44. Engine registry plus local baseline engine.

45. Jev adapter behind disabled configuration.

46. Fallback/error policy.

47. Invariant tests.

48. Only then begin J1.

# 6. Pull request strategy

-   PR J0a: contracts + engine registry + configuration skeleton.

-   PR J0b: projection/redaction boundary + security tests.

-   PR J0c: decision journal + provenance/replay identifiers.

-   PR J1: claim verification in shadow mode.

-   PR J2: context relevance in shadow mode, then separately activate if
    metrics support it.

-   PR J3: model-tier routing in shadow mode, then separately activate.

-   PR J4/J5: calibration and replay tooling.

-   Keep activation changes small and independently reversible.

# 7. Stop conditions

-   Implementation requires sending raw ExecutionState or secrets to
    Jev.

-   A new path lets probabilistic output waive deterministic
    approval/policy.

-   A second authoritative model configuration is introduced.

-   The Jev adapter becomes required for normal local ALiX operation.

-   A proposed Jev question requires multi-hop planning rather than an
    atomic bounded judgment.

-   Provider SDK semantics cannot be represented faithfully by the typed
    contracts.

-   Fallback would silently change authority or execute an action twice.

# 8. Final milestone acceptance

The integration is successful when ALiX can run the three bounded
decisions through Jev or local fallbacks, with minimal redacted inputs,
native result semantics, deterministic governance, canonical model-tier
resolution, journaled provenance, empirical calibration data and replay
support---while remaining fully usable with Jev disabled.
