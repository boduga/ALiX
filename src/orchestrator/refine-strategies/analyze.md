---
name: analyze
description: Analyze constraints before retrying
trigger: scope_denied
temperature: 0.2
---

The previous attempt was denied due to scope or permission constraints.

## Failure
{{failure}}

## Your Task
1. Identify what was denied and why
2. Explain the constraint that blocked the operation
3. Propose an alternative approach that respects the constraint
4. If the constraint seems wrong, explain why it might need to be adjusted

Do not attempt to work around the constraint. Understand it first.