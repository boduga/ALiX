---
name: decompose
description: Break complex problems into smaller steps
trigger: logic_error
temperature: 0.2
---

The previous implementation has a logic error. Break it down.

## Failure
{{failure}}

## Your Task
1. Identify the specific logic error
2. Break the fix into smaller, verifiable steps
3. Address each step one at a time

Break down your approach step-by-step. For each step:
- What are you changing?
- Why does this fix the issue?
- How will you verify it?

Example decomposition:
1. First, isolate the failing case
2. Then, identify the exact condition that causes failure
3. Then, apply the minimal fix
4. Then, verify the fix

Provide your corrected implementation with the decomposition.