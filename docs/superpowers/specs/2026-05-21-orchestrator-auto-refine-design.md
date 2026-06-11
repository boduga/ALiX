# Orchestrator Auto-Refine Design

**Status:** ✅ Completed (M0.7) — Design implemented and committed to main.

**Goal:** Use Fabric-style patterns to distill vague user prompts into structured plans before dispatching to sub-agents. Enables high-quality output from simple inputs.

**Architecture:** Orchestrator applies a chain of patterns to transform raw user input into refined prompts for sub-agents. Each pattern extracts a specific dimension (intent, constraints, context needs, acceptance criteria).

---

## Problem

User prompts are often:
- **Vague:** "make it faster" without specifying what "it" is
- **Under-specified:** missing constraints, acceptance criteria
- **Scattered:** intent, context, and goal mixed together

ALiX needs consistent, structured input to run its agent loop effectively.

---

## Solution: Pattern Chain

The orchestrator applies patterns in sequence:

```
Raw Prompt → distill_intent → extract_constraints → identify_context → build_plan
```

Each pattern is a markdown prompt file stored in the config directory, following Fabric conventions.

---

## Pattern Files

### 1. `distill_intent`

**Purpose:** Extract the core intent from a vague prompt. Remove noise, identify the primary goal.

**File:** `config/patterns/distill_intent/system.md`

```markdown
# Instruction

You are an intent distillation engine. Given a vague user prompt, extract the core intent.

## Format

Output a JSON object:
```json
{
  "intent": "What the user actually wants (imperative, <15 words)",
  "type": "feature|bugfix|refactor|research|question",
  "success_signal": "How to know when done (<=3 sentences)"
}
```

## Process

1. Identify the action verb (create, fix, add, remove, optimize, compare)
2. Identify the subject (what is being acted upon)
3. Identify the desired outcome
4. Classify the type
5. Define success signal

## Input

{{prompt}}
```

### 2. `extract_constraints`

**Purpose:** Identify hard constraints, preferences, and non-functional requirements.

**File:** `config/patterns/extract_constraints/system.md`

```markdown
# Instruction

You are a constraint extraction engine. Given an intent, identify all constraints and preferences.

## Format

Output a JSON object:
```json
{
  "hard_constraints": [
    "Must be satisfied or the output fails"
  ],
  "soft_constraints": [
    "Preferences that improve quality"
  ],
  "forbidden": [
    "Explicitly prohibited approaches or outcomes"
  ],
  "preferences": {
    "style": "e.g., functional, declarative, verbose",
    "tech_stack": ["constraints on language/framework/lib versions"],
    "output_format": "e.g., json, markdown, code only"
  }
}
```

## Process

1. Look for constraint keywords: "must", "only", "never", "always", "except"
2. Identify performance requirements: "fast", "<100ms", "scalable"
3. Identify style preferences: "clean", "readable", "minimal"
4. Identify forbidden patterns: "don't use X", "avoid Y"

## Input

{{intent}}
{{raw_prompt}}
```

### 3. `identify_context`

**Purpose:** Determine what context the agent needs to fulfill the intent.

**File:** `config/patterns/identify_context/system.md`

```markdown
# Instruction

You are a context planner. Given an intent and constraints, identify what context is needed.

## Format

Output a JSON object:
```json
{
  "required_context": {
    "files": ["specific files the agent must read"],
    "patterns": ["file patterns to scan, e.g., '*.ts'"],
    "search_queries": ["code search terms to understand structure"]
  },
  "optional_context": {
    "files": ["helpful but not critical"],
    "search_queries": ["would improve quality"]
  },
  "context_summary": "What the agent needs to understand (2 sentences)"
}
```

## Process

1. Identify files mentioned in intent
2. Identify file patterns needed (src/**/*.ts, tests/**/*.py)
3. Identify code patterns to search for (e.g., "authentication middleware", "database models")
4. Determine read vs. modify vs. create needs

## Input

{{intent}}
{{constraints}}
{{project_type}}
```

### 4. `build_plan`

**Purpose:** Convert distilled intent + constraints + context into an ALiX plan structure.

**File:** `config/patterns/build_plan/system.md`

```markdown
# Instruction

You are a project planner. Convert a distilled intent into a structured ALiX plan.

## ALiX Plan Structure

```yaml
plan:
  title: "Brief title"
  intent: "The distilled intent"
  type: "feature|bugfix|refactor|research"

  stages:
    - name: "explore"
      description: "Understand the current state"
      tools: ["grep", "read"]
      output: "Current state summary"

    - name: "plan"
      description: "Design the approach"
      input: ["explore output"]
      output: "Design document or approach"

    - name: "implement"
      description: "Write the code"
      input: ["plan output", "constraints"]
      output: "Modified files list"

    - name: "verify"
      description: "Test the changes"
      input: ["implement output"]
      output: "Test results"

  acceptance_criteria:
    - "Concrete criterion 1"
    - "Concrete criterion 2"

  risk_level: "low|medium|high"
  estimated_complexity: "simple|moderate|complex"
```

## Process

1. Map intent type to appropriate stages
2. Add stages based on complexity
3. Derive acceptance criteria from success_signal and constraints
4. Assess risk based on scope (file count, change types)

## Input

{{intent}}
{{constraints}}
{{context_needs}}
```

---

## Orchestrator Integration

### Flow

```typescript
async function autoRefine(rawPrompt: string): Promise<RefinedPlan> {
  // Chain of refinements
  const intent = await applyPattern("distill_intent", { prompt: rawPrompt });
  const constraints = await applyPattern("extract_constraints", {
    intent: intent.intent,
    raw_prompt: rawPrompt
  });
  const context = await applyPattern("identify_context", {
    intent: intent.intent,
    constraints: constraints,
    project_type: detectProjectType()
  });
  const plan = await applyPattern("build_plan", {
    intent: intent.intent,
    constraints: constraints,
    context_needs: context
  });

  return { intent, constraints, context, plan };
}
```

### `applyPattern` Function

```typescript
async function applyPattern(
  patternName: string,
  variables: Record<string, string>
): Promise<any> {
  // 1. Load pattern file
  const patternPath = join(configDir, "patterns", patternName, "system.md");
  const pattern = await readFile(patternPath, "utf8");

  // 2. Substitute variables
  const prompt = substituteVariables(pattern, variables);

  // 3. Call LLM
  const response = await callLLM({
    system: pattern,
    user: prompt
  });

  // 4. Parse JSON response
  return JSON.parse(response);
}
```

---

## Strategy Selection

Patterns can use different reasoning strategies:

| Strategy | Use When |
|----------|----------|
| `cot` (Chain-of-Thought) | Complex multi-step tasks |
| `self-refine` | Quality-critical outputs |
| `reflexion` | Bug fixes (review own work) |
| `standard` | Simple, well-defined tasks |

**Default strategy:** `cot` — balanced speed and quality.

---

## Error Handling

### Pattern Fails to Parse

If LLM returns non-JSON:
1. Log the raw response
2. Attempt regex extraction of key fields
3. Fall back to partial plan with explicit gaps

### Pattern Chain Fails

If any pattern fails:
1. Return what was successfully distilled
2. Mark gaps explicitly
3. Allow user to provide missing information

---

## File Structure

```
.alix/
  config.json
  patterns/
    distill_intent/
      system.md
    extract_constraints/
      system.md
    identify_context/
      system.md
    build_plan/
      system.md
```

Patterns are Markdown for readability. Users can edit them to customize behavior.

---

## Strategy File Format

**File:** `config/strategies/cot.json`

```json
{
  "name": "Chain-of-Thought",
  "description": "Step-by-step reasoning for complex tasks",
  "modification": "Add 'Think step by step' to system prompt",
  "temperature": 0.3
}
```

---

## Future Enhancements

- **Custom patterns:** Users add patterns for domain-specific distillation
- **Pattern chaining:** Combine patterns dynamically based on task type
- **Learning:** Track which patterns produce best results for similar intents
- **Caching:** Cache distilled plans for repeated similar prompts