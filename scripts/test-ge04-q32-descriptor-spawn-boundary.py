"""Conservative source-contract tripwires; NOT runtime FD custody proof."""
from pathlib import Path
import re
import unittest
ROOT=Path(__file__).resolve().parent.parent
STANDARD=(
 'src/agents/subagent-manager.ts',
 'src/operations/daemon/daemon-manager.ts',
 'src/capabilities/mcp/process-manager.ts',
 'src/capabilities/mcp/registry.ts',
 'src/capabilities/tools/shell-tool.ts',
 'src/capabilities/tools/monitor-tool.ts',
 'src/models/providers/local-llama-launcher.ts',
 'src/operations/hooks/runner.ts',
 'src/capabilities/skills/sandbox.ts',
)
class Tests(unittest.TestCase):
 def test_known_spawn_sites_have_explicit_stdio(self):
  for filename in STANDARD:
   with self.subTest(file=filename):
    source=(ROOT/filename).read_text()
    self.assertIn('spawn(',source)
    self.assertRegex(source,r'\bstdio\s*:')
 def test_no_extra_numeric_descriptor_in_standard_spawn_config(self):
  for filename in STANDARD:
   with self.subTest(file=filename):
    source=(ROOT/filename).read_text()
    self.assertNotRegex(source,r'\bstdio\s*:\s*\[[^\]]*\b[0-9]+\b')
    self.assertNotIn('SCM_RIGHTS',source)
 def test_explicit_lock_fd_exception_is_scoped(self):
  source=(ROOT/'src/governance/approvals/approval-store-lock.ts').read_text()
  self.assertIn('const FLOCK_FD = 9',source)
  self.assertIn('concat([fd])',source)
  self.assertIn('spawn("flock"',source)
 def test_scoped_mutation_remains_blocked(self):
  source=(ROOT/'src/execution/filesystem/scoped-mutation.ts').read_text()
  self.assertIn('createScopedMutationService',source)
  self.assertIn('return new UnavailableScopedMutationService()',source[source.index('export function createScopedMutationService'):][:650])
if __name__=='__main__':unittest.main()
