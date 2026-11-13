"""Unprivileged GE-04 source-shape regressions; not an authority or TOCTOU proof."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2] / 'native/ge04'


def body(text, start, end):
    a = text.index(start)
    return text[a:text.index(end, a)]


class DestructiveAndPrivilegeGuards(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.worker = (ROOT / 'cgroup-worker-qualification.c').read_text()
        cls.view = (ROOT / 'cgroup-runtime-view-qualification.c').read_text()
        cls.launcher = (ROOT / 'isolated-worker-launcher.c').read_text()

    def test_journal_publication_requires_exclusive_temp_fsync_and_no_replace(self):
        for source in (self.worker, self.view):
            publish = body(source, 'static int publish(', 'static int process_info(') if source is self.view else body(source, 'static int publish(', 'static int stat_info(')
            order = ('O_CREAT|O_EXCL|O_NOFOLLOW', 'fsync(fd)', 'RENAME_NOREPLACE', 'fsync(c->work)')
            positions = [publish.index(token) for token in order]
            self.assertEqual(positions, sorted(positions))

    def test_recovery_requires_original_published_record(self):
        for source in (self.worker, self.view):
            main = source[source.index('int main('):]
            self.assertIn('if(!strcmp(c.mode,"recover"))', main)
            self.assertIn('"intent.v1",&r)', main)
            self.assertIn('reason="BINDING_DENIED"' if source is self.worker else 'c.reason="BINDING_DENIED"', main)

    def test_worker_artifact_removal_binds_record_before_unlink(self):
        s = body(self.worker, 'static int remove_artifact(', 'static int cleanup(')
        self.assertLess(s.index('read_intent(c->work,name,&r)'), s.index('unlinkat(c->work,name,0)'))
        self.assertLess(s.index('records_equal(&r,&c->record)'), s.index('unlinkat(c->work,name,0)'))

    def test_worker_cleanup_checks_ownership_and_emptiness(self):
        s = body(self.worker, 'static int cleanup(', 'static int no_worker_directories(')
        deletion = s.index('unlinkat(c->parent,c->record.name,AT_REMOVEDIR)')
        self.assertLess(s.index('if(!c->owned_leaf)return 0;'), deletion)
        self.assertLess(s.index('if(!bindings(c))return 0;'), deletion)
        self.assertIn('if(!bindings(c)||!empty(c)||unlinkat(', s)

    def test_worker_lock_descriptor_remains_name_bound(self):
        setup = body(self.worker, 'static int setup(', 'static int open_recorded_leaf(')
        binding = body(self.worker, 'static int bindings(', 'static int members(')
        self.assertIn('fstat(c->lock,&c->lock_stat)', setup)
        self.assertIn('fstatat(c->work,".lock",&s,AT_SYMLINK_NOFOLLOW)', binding)
        self.assertIn('same_inode(&s,&c->lock_stat)', binding)
        self.assertIn('regular_root(c->lock,0600,0)', binding)

    def test_worker_sweep_requires_recorded_leaf(self):
        s = body(self.worker, 'static int sweep_empty(', 'int main(')
        deletion = s.index('unlinkat(c->parent,e->d_name,AT_REMOVEDIR)')
        for check in ('sweep_candidate_allowed(has_temp,&pending,&st,e->d_name)',
                      'open_recorded_leaf(c)', 'empty(c)', 'bindings(c)'):
            self.assertLess(s.index(check), deletion)

    def test_view_inner_removal_checks_custody_and_emptiness(self):
        s = body(self.view, 'static int empty_inner_remove(', 'static int remove_record(')
        deletion = s.index('unlinkat(c->outer,name,AT_REMOVEDIR)')
        for check in ('inner_custody(', 'controllers(', 'known_children(', 'empty(fd)', 'bindings(c)', 'budget_ok()'):
            self.assertLess(s.index(check), deletion)

    def test_view_journal_removal_requires_matching_record(self):
        s = body(self.view, 'static int remove_record(', 'static int cleanup_until(')
        deletion = s.index('unlinkat(c->work,name,0)')
        for check in ('intent(c->work,name,&r)', 'records_equal(&r,&c->record)', 'budget_ok()'):
            self.assertLess(s.index(check), deletion)

    def test_launcher_drop_and_exec_order(self):
        s = self.launcher[self.launcher.index('int main('):]
        ordered = ('if(geteuid()!=0 || getuid()!=0)', 'pin_executable(argv[3])',
                   'prctl(PR_SET_NO_NEW_PRIVS', 'setgroups(0,NULL)', 'setresgid(',
                   'setresuid(', 'if(getuid()!=target', 'close_inherited_fds(executable_fd)',
                   'syscall(SYS_execveat')
        indices = [s.index(token) for token in ordered]
        self.assertEqual(indices, sorted(indices))
        self.assertIn('die("identity isolation failed")', s)
        self.assertIn('die("identity mismatch")', s)
        self.assertIn('getegid()!=(gid_t)target', s)

    def test_saved_ids_and_supplementary_groups_verified_before_exec_or_fork(self):
        for source, endpoint in ((self.launcher, 'syscall(SYS_execveat'),
                                 (self.worker, 'pid_t descendant=fork()')):
            start = source.index('setresuid(')
            end = source.index(endpoint, start)
            span = source[start:end]
            for required in ('getresuid(&ru,&eu,&su)', 'getresgid(&rg,&eg,&sg)',
                             'getgroups(0,NULL)!=0', 'su!=', 'sg!='):
                self.assertIn(required, span)

    def test_worker_child_fails_before_fork_on_drop_failure(self):
        s = body(self.worker, 'static void child(', 'static int wait_running(') if 'static void child(' in self.worker else self.worker
        start = s.index('if(prctl(PR_SET_NO_NEW_PRIVS')
        end = s.index('pid_t descendant=fork()', start)
        self.assertIn('setgroups(0,NULL)', s[start:end])
        self.assertIn('setresgid(TEST_UID,TEST_UID,TEST_UID)', s[start:end])
        self.assertIn('setresuid(TEST_UID,TEST_UID,TEST_UID))_exit(125)', s[start:end])


if __name__ == '__main__':
    unittest.main()
