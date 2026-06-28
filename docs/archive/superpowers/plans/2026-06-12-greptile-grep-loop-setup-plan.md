# Greptile + Grep Loop CI Workflow Setup

**Goal:** Set up the automated PR review loop Ras Mic uses: push code → Greptile reviews → Grep Loop auto-fixes → re-review → iterate to 5/5 confidence.

**Architecture:** Greptile hooks into GitHub PRs via a GitHub App. Grep Loop is a Claude Code/Cursor skill that reads Greptile review comments, fixes the issues, pushes updates, and waits for the next review — repeating until confidence reaches 5/5.

**Prerequisites:** GitHub CLI authenticated (`gh`), Claude Code installed.

---

### Step 1: Install the Greptile GitHub App

1. Go to https://github.com/apps/greptile
2. Click **Install** → select the `boduga` account
3. Grant access to the ALiX repository (and optionally others)
4. After install, note the **Greptile API key** (Settings → Developer settings → Personal access tokens → check for greptile)

### Step 2: Enable Greptile on ALiX repo

After installing the app, Greptile will automatically review PRs. Trigger a test review by creating a PR.

### Step 3: Install the Grep Loop skill

Grep Loop is a skill for Claude Code / Cursor that automates the fix → push → re-review cycle.

```bash
# Create the skill file
mkdir -p ~/.claude/skills/grep-loop
```

Create `~/.claude/skills/grep-loop/SKILL.md`:

```markdown
# Grep Loop

Automated PR fix loop with Greptile. Reads review feedback, applies fixes, pushes, re-reviews.

## Trigger

/grep-loop [PR-number]

## Behavior

1. Read the latest Greptile review comments on the specified PR
2. Apply fixes for each actionable comment
3. Update affected tests
4. Commit and push to the PR branch
5. Wait for Greptile to re-review (polling every 30s, max 5 iterations)
6. If confidence < 5/5, repeat from step 1
7. Stop at 5/5 or 5 iterations
```

### Step 4: Create a PR workflow script

Create `~/bin/grep-loop.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

PR_NUMBER="${1:-}"

if [ -z "$PR_NUMBER" ]; then
  echo "Usage: grep-loop.sh <PR-number>"
  exit 1
fi

echo "🚀 Starting Grep Loop for PR #$PR_NUMBER"
echo ""

MAX_ITERATIONS=5
ITERATION=1

while [ $ITERATION -le $MAX_ITERATIONS ]; do
  echo "📡 Iteration $ITERATION — fetching Greptile review..."

  # Fetch the review — this is manual trigger, Grep Loop skill handles the agentic part
  gh pr view "$PR_NUMBER" --json title,body,additions,deletions

  echo ""
  echo "🤖 Run /grep-loop in Claude Code to process this iteration"
  echo "   Then come back here and run this script again with the same PR number"
  echo "   to start the next iteration."
  echo ""
  echo "   PR: https://github.com/boduga/ALiX/pull/$PR_NUMBER"
  echo ""

  ITERATION=$((ITERATION + 1))
done

echo "✅ Grep Loop complete for PR #$PR_NUMBER"
```

```bash
chmod +x ~/bin/grep-loop.sh
```

### Step 5: Test the workflow

1. Create a branch and push a PR:
   ```bash
   git checkout -b test-greptile
   # make a small change
   git add -A && git commit -m "test: trigger Greptile review"
   git push -u origin test-greptile
   gh pr create --fill
   ```

2. Wait for Greptile to post a review (check PR on GitHub)

3. Run the loop:
   ```bash
   grep-loop.sh <PR-number>
   ```

4. Open Claude Code in the project and run:
   ```
   /grep-loop
   ```

5. Watch the iteration: fix → push → re-review → 5/5 → merge
