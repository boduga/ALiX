# ALiX Architecture Governance

## Formal Relationship Between the M-Series and P-Series Roadmaps

**Status:** Proposed Governance Standard
**Applies To:** All future architecture, design specifications, implementation plans, and roadmap planning.
**Supersedes:** Informal distinction between "old" (M) and "new" (P) milestones.

---

## 1. Purpose

ALiX now has two roadmap families:

- **M-Series** — Platform Architecture
- **P-Series** — Product Architecture

Historically these evolved organically, but going forward they become permanent architectural layers, not historical artifacts.

The purpose of this document is to define:

- ownership
- dependency rules
- governance
- layering
- planning strategy

so that future development remains consistent as ALiX grows.

---

## 2. Architectural Philosophy

ALiX is organized into two independent but related roadmaps.

```
                    ALiX Vision
                         │
          ┌──────────────┴──────────────┐
          │                             │
          ▼                             ▼
   M-Series Roadmap              P-Series Roadmap
     (Platform)                     (Product)
```

The relationship is:

> «The M-Series provides platform capabilities.»
>
> «The P-Series consumes platform capabilities to deliver autonomous product features.»

The P-Series should never reimplement infrastructure already owned by the M-Series.

---

## 3. M-Series — Platform Roadmap

**Mission:** Build the reusable operating system of ALiX.

These milestones provide generic capabilities that are independent of any specific product workflow.

Typical responsibilities include:

- Runtime
- Coordination
- Scheduling
- Planning
- Context management
- Memory infrastructure
- Tool execution
- Storage
- Security primitives
- Model abstraction
- Event systems
- Worker framework
- Shared utilities

The M-Series answers questions such as:

- How do agents communicate?
- How is context shared?
- How are plans revised?
- How are conflicts resolved?
- How is memory stored?
- How are workspaces protected?
- How is execution coordinated?

These capabilities should be reusable by every higher layer.

---

## 4. P-Series — Product Roadmap

**Mission:** Build ALiX's autonomous intelligence using the platform.

These milestones implement user-facing capabilities.

Examples include:

- Workflow execution
- Adaptation
- Proposal lifecycle
- Learning
- Governance
- Executive Intelligence
- Recommendation systems
- Effectiveness analysis
- Future autonomous planning

The P-Series answers questions such as:

- What recommendations should ALiX generate?
- How should proposals be managed?
- How should ALiX learn?
- How should governance operate?
- How should executive decisions improve over time?

---

## 5. Layered Architecture

```
                 P11+ Future Autonomy
──────────────────────────────────────────────

             P10 Executive Intelligence

──────────────────────────────────────────────

              P9 Governance

──────────────────────────────────────────────

              P8 Learning

──────────────────────────────────────────────

         P5 Adaptation & Proposals

──────────────────────────────────────────────

      P4 Workflow & Orchestration

──────────────────────────────────────────────

             M-Series Platform

    Runtime
    Coordination
    Planning
    Context
    Storage
    Scheduling
    Security
    Workers
    Tools
    Models

──────────────────────────────────────────────

      Operating System / Node.js / Filesystem
```

---

## 6. Ownership Matrix

| Capability | Owner |
|---|---|
| Runtime | M-Series |
| Coordination | M-Series |
| Planning Engine | M-Series |
| Context Management | M-Series |
| Storage Layer | M-Series |
| Worker Framework | M-Series |
| Tool Framework | M-Series |
| Scheduling | M-Series |
| Event Bus | M-Series |
| Model Routing Infrastructure | M-Series |
| Workflow Engine | P-Series |
| Adaptation | P-Series |
| Proposal Lifecycle | P-Series |
| Learning | P-Series |
| Governance | P-Series |
| Executive Intelligence | P-Series |
| Recommendation Engine | P-Series |
| Recommendation Effectiveness | P-Series |
| Future Autonomy | P-Series |

---

## 7. Dependency Rules

### Rule 1
An M milestone MUST NOT depend on a P milestone.

The platform should compile and function independently of any product feature.

### Rule 2
A P milestone MAY depend on one or more M milestones.

This is the expected direction of dependency.

### Rule 3
A P milestone MUST NOT duplicate functionality already owned by the M-Series.

Instead it must consume the platform API.

### Rule 4
If a P milestone requires a new platform primitive, development pauses until a new M milestone provides that capability.

**Example:**

```
P10 requires Event Replay
        │
        ▼
Create M0.xx Event Replay
        │
        ▼
Merge M0.xx
        │
        ▼
Resume P10 implementation
```

---

## 8. Platform Contract

The M-Series exposes a stable platform contract.

Future P milestones may only depend upon documented interfaces.

Platform APIs include:

- Worker API
- Tool API
- Context API
- Memory API
- Storage API
- Scheduler API
- Event API
- Model API
- Runtime API

The implementation behind these APIs may evolve without affecting the P-Series.

---

## 9. Required Section in Every P Specification

Every P milestone must begin with:

```markdown
## Platform Dependencies

| Capability | Provider |
|------------|----------|
| Worker API | M |
| Context API | M |
| Memory API | M |
| Scheduler | M |
| Storage | M |
| Event Bus | M |
```

This makes architectural dependencies explicit.

---

## 10. Milestone Classes

To improve long-term roadmap clarity, milestone prefixes are standardized.

| Prefix | Meaning |
|---|---|
| M | Platform Architecture |
| P | Product Features |
| S | Security |
| D | Developer Experience |
| I | Infrastructure |
| R | Research |

**Examples:**
- `M0.80` — Event Streaming
- `P11.0` — Autonomous Planning
- `S1.2` — Supply Chain Verification
- `D2.1` — Generator Improvements
- `I3.0` — Distributed Scheduler
- `R1.0` — Experimental Planning Algorithms

---

## 11. Planning Workflow

Every new feature should follow this decision process.

```
New Capability
      │
      ▼
Is it generic platform functionality?
      │
 ┌────┴─────┐
 │          │
Yes         No
 │          │
 ▼          ▼
Create M    Create P
Milestone   Milestone
```

If a P milestone identifies a missing platform capability:

```
P Milestone
      │
      ▼
Missing Platform Primitive
      │
      ▼
Open new M milestone
      │
      ▼
Implement
      │
      ▼
Resume P milestone
```

---

## 12. Governance Rules

The following architectural rules are mandatory.

1. M milestones never depend on P milestones.
2. P milestones may depend on M milestones.
3. Platform ownership belongs exclusively to the M-Series.
4. Product ownership belongs exclusively to the P-Series.
5. Every P specification documents its platform dependencies.
6. New platform primitives require a new M milestone.
7. Stable platform APIs form the contract between both roadmaps.
8. Duplicate implementations across M and P are prohibited.

---

## 13. Benefits

This governance model provides:

- Clear separation of concerns
- Stable architectural layering
- Reduced duplication
- Cleaner dependency graphs
- Easier roadmap planning
- Better reviewability
- Simpler onboarding
- Long-term maintainability
- Independent evolution of platform and product
- Stronger architectural governance

---

## 14. Long-Term Vision

The M-Series becomes the permanent foundation of ALiX.

The P-Series becomes the continuously evolving intelligence built upon that foundation.

Rather than replacing one roadmap with another, ALiX adopts a layered architecture where both roadmaps coexist with clearly defined responsibilities.

This allows the platform to remain stable while product capabilities continue to expand without architectural drift.
