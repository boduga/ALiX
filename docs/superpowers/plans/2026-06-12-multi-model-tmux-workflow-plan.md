# Multi-Model Side-by-Side tmux Workflow Setup

**Goal:** Set up a Ras Mic-inspired development workflow with Claude Code on the left, Codex CLI on the right, and a terminal below — all launched from a single command.

**Architecture:** tmux session with a 3-pane layout. Claude Code runs in the left pane, Codex CLI in the right pane, a shared terminal in the bottom pane. Keybindings for quick switching. Session resumes after detach. Single launch script to start everything.

**Current state:** Claude Code is installed at `~/.local/bin/claude`. tmux is NOT installed. Codex CLI is NOT installed.

---

## File Structure

### Create
- `~/.config/tmux/tmux.conf` — tmux configuration with keybindings and status bar
- `~/bin/dev-session.sh` — launch script for the multi-model session
- `~/bin/switch-model.sh` — helper to pipe context between panes

---

### Task 1: Install tmux

**Files:**
- (none — system package)

- [ ] **Step 1: Install tmux**

```bash
sudo apt-get install -y tmux
```

Verify: `tmux -V`
Expected: `tmux next-3.6` or similar

---

### Task 2: Create tmux configuration

**Files:**
- Create: `~/.config/tmux/tmux.conf`

- [ ] **Step 1: Write the config**

```tmux
# --- General ---
set -g default-terminal "screen-256color"
set -g history-limit 50000
set -g escape-time 0
set -g focus-events on
set -g mouse on
set -s copy-command 'xclip -selection clipboard'

# --- Status bar ---
set -g status-style 'bg=#1a1b26 fg=#a9b1d6'
set -g status-left '#[fg=#7aa2f2,bold] #[bg=#7aa2f2,fg=#1a1b26] #S #[bg=#1a1b26,fg=#7aa2f2]'
set -g status-right '#[fg=#9ece6a] #[bg=#9ece6a,fg=#1a1b26] #(whoami) #[bg=#1a1b26,fg=#9ece6a]#[fg=#bb9af7] #[bg=#bb9af7,fg=#1a1b26] #W #[bg=#1a1b26,fg=#bb9af7]'
set -g status-position top
set -g status-interval 5

# --- Window/pane indexing ---
set -g base-index 1
setw -g pane-base-index 1

# --- Keybindings ---
# Prefix: Ctrl+A instead of Ctrl+B (easier reach)
set -g prefix C-a
unbind C-b
bind C-a send-prefix

# Reload config
bind r source-file ~/.config/tmux/tmux.conf \; display "Config reloaded!"

# Split: vertical | and horizontal -
bind | split-window -h
bind - split-window -v

# Vim-style pane navigation
bind h select-pane -L
bind j select-pane -D
bind k select-pane -U
bind l select-pane -R

# Resize panes with Shift + arrows
bind -r H resize-pane -L 5
bind -r J resize-pane -D 5
bind -r K resize-pane -U 5
bind -r L resize-pane -R 5

# Quick pane swap
bind s swap-pane -D

# Zoom pane
bind z resize-pane -Z

# Smart pane borders
set -g pane-border-style 'fg=#3b4261'
set -g pane-active-border-style 'fg=#7aa2f2'
setw -g window-status-current-style 'bg=#7aa2f2,fg=#1a1b26,bold'
```

- [ ] **Step 2: Create config directory**

```bash
mkdir -p ~/.config/tmux
```

---

### Task 3: Install Codex CLI

**Files:**
- (none — npm package)

- [ ] **Step 1: Install Codex CLI**

```bash
npm install -g @openai/codex
```

Verify: `codex --version`
Expected: version string

- [ ] **Step 2: Verify Claude Code CLI path**

```bash
which claude && claude --version
```

Expected: `/home/babasola/.local/bin/claude` and version string

---

### Task 4: Create the dev session launch script

**Files:**
- Create: `~/bin/dev-session.sh`

- [ ] **Step 1: Write the launch script**

```bash
#!/usr/bin/env bash
set -euo pipefail

SESSION="dev"
PROJECT_DIR="${1:-$HOME/Projects/Monolith}"

# Kill existing session if any
tmux kill-session -t "$SESSION" 2>/dev/null || true

# Create new session with one window, three panes
# Layout: Claude Code (left 60%), Codex CLI (right 40%), terminal (bottom)
tmux new-session -d -s "$SESSION" -c "$PROJECT_DIR" -n "dev"

# Left pane: Claude Code
tmux send-keys -t "$SESSION" "cd $PROJECT_DIR && claude" Enter

# Split right: Codex CLI
tmux split-window -h -t "$SESSION" -c "$PROJECT_DIR"
tmux send-keys -t "$SESSION" "cd $PROJECT_DIR && codex" Enter

# Split bottom: terminal (takes bottom 30% of both columns)
tmux split-window -v -t "$SESSION" -c "$PROJECT_DIR" -p 30

# Resize to make left pane wider
tmux select-pane -t "$SESSION":1.1
tmux resize-pane -R 20

# Set pane labels via borders (tmux 3.3+)
tmux select-pane -t "$SESSION":1.1 -T " Claude Code "
tmux select-pane -t "$SESSION":1.2 -T " Codex CLI "
tmux select-pane -t "$SESSION":1.3 -T " Terminal "

# Select the terminal pane as default
tmux select-pane -t "$SESSION":1.3

# Attach
tmux attach-session -t "$SESSION"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x ~/bin/dev-session.sh
```

- [ ] **Step 3: Create bin dir if needed**

```bash
mkdir -p ~/bin
```

- [ ] **Step 4: Add ~/bin to PATH if not already**

Check if `~/bin` is in PATH:

```bash
echo "$PATH" | grep -q "$HOME/bin" && echo "in PATH" || echo "not in PATH"
```

If not, add to `~/.bashrc`:

```bash
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

---

### Task 5: Create a context-switching helper (optional but useful)

**Files:**
- Create: `~/bin/switch-model.sh`

- [ ] **Step 1: Write the switch helper**

This script copies the current pane's selection or working directory and pipes it to the other model pane.

```bash
#!/usr/bin/env bash
# switch-model.sh — Copy current working directory to the other model pane
# Usage: in tmux, run this to jump to the other model's pane

TARGET_PANE="$1"

if [ -z "$TARGET_PANE" ]; then
  echo "Usage: switch-model.sh left|right"
  echo "  left  — jump to Claude Code pane"
  echo "  right — jump to Codex CLI pane"
  exit 1
fi

SESSION="dev"

if [ "$TARGET_PANE" = "left" ]; then
  tmux select-pane -t "$SESSION":1.1
elif [ "$TARGET_PANE" = "right" ]; then
  tmux select-pane -t "$SESSION":1.2
else
  echo "Unknown target: $TARGET_PANE. Use 'left' or 'right'."
  exit 1
fi
```

- [ ] **Step 2: Make executable**

```bash
chmod +x ~/bin/switch-model.sh
```

---

### Task 6: Add tmux keybinding for quick model switching

**Files:**
- Modify: `~/.config/tmux/tmux.conf`

- [ ] **Step 1: Add bindings to the tmux config**

Append to `~/.config/tmux/tmux.conf`:

```tmux
# Quick model switching (Prefix + 1 = Claude, Prefix + 2 = Codex, Prefix + 3 = Terminal)
bind 1 select-pane -t :.1
bind 2 select-pane -t :.2
bind 3 select-pane -t :.3

# Send current directory to sibling pane
bind C-p run-shell "tmux send-keys -t :.2 'cd $(pwd) && clear' Enter"
bind C-o run-shell "tmux send-keys -t :.1 'cd $(pwd) && clear' Enter"
```

---

### Verification

1. Open a terminal and run: `tmux`
2. Check the status bar shows correctly
3. Create a test window: `Prefix + c`
4. Split vertically: `Prefix + |`
5. Split horizontally: `Prefix + -`
6. Navigate: `Prefix + h/j/k/l`
7. Exit tmux: `exit` in each pane, or `Prefix + &` to kill window
8. Run the dev session: `~/bin/dev-session.sh`
9. Verify Claude Code starts in left pane
10. Verify Codex CLI starts in right pane (or shows error if not configured)
11. Detach: `Prefix + d`
12. Reattach: `tmux attach -t dev`
