---
name: retry
description: Basic retry with failure analysis
trigger: any
temperature: 0.3
---

The previous attempt failed. Analyze the failure and provide a fix.

## Failure
{{failure}}

## Your Task
1. Read the error message carefully
2. Identify the root cause (not just the symptom)
3. Implement the fix
4. Verify the fix works by running relevant checks

Provide your corrected implementation with a brief explanation of what was wrong.