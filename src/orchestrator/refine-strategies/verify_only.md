---
name: verify_only
description: Focus on passing tests, verify before proceeding
trigger: test_failure
temperature: 0.2
---

The tests are failing. Focus on making them pass.

## Failure
{{failure}}

## Your Task
1. Read the test failure messages carefully
2. Understand what the tests expect
3. Fix the implementation to match the expected behavior

Do not add new features or change unrelated code. Only fix what is necessary to pass the tests.

Run the tests after each change to verify progress.