// Disposable Node child-descriptor observation; never opens ALiX state.
const fs = require('node:fs');
const cp = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ge04-fd-'));
const fixture = path.join(dir, 'synthetic-only.txt');
fs.writeFileSync(fixture, 'SYNTHETIC_ONLY\n', { mode: 0o600 });
const fd = fs.openSync(fixture, 'r+');
const inspect = `const fs=require('node:fs');let a=[];for(let n=0;n<=12;n++){try{const s=fs.fstatSync(n);a.push({fd:n,regular:s.isFile(),fifo:s.isFIFO(),socket:s.isSocket()})}catch{}}process.stdout.write(JSON.stringify(a))`;
function observe(label, stdio) {
  const p = cp.spawnSync(process.execPath, ['-e', inspect], {stdio, encoding:'utf8', timeout:4000});
  if (p.error || p.status !== 0) throw new Error(label + ': child failed');
  return JSON.parse(p.stdout);
}
try {
  const normal = observe('subagent_shape', ['ignore','pipe','pipe','pipe']);
  const ignored = observe('daemon_shape', ['ignore','pipe','pipe']);
  const passed = observe('explicit_fd9', ['ignore','pipe','pipe','ignore','ignore','ignore','ignore','ignore','ignore',fd]);
  const regular = a => a.filter(x=>x.regular).map(x=>x.fd);
  const checks = {
    subagent_shape_no_regular_file: regular(normal).length === 0,
    daemon_shape_no_regular_file: regular(ignored).length === 0,
    explicit_fd9_regular_file: regular(passed).includes(9),
    no_fd9_in_normal_or_daemon: !regular(normal).includes(9) && !regular(ignored).includes(9),
    fixture_unchanged: fs.readFileSync(fixture,'utf8') === 'SYNTHETIC_ONLY\n'
  };
  process.stdout.write(JSON.stringify({gate:'GE04_Q32_RUNTIME_FD_TRACE',disposition:'HOLD',qualified_independent_issuance:false,real_effects_performed:0,checks,all_expected:Object.values(checks).every(Boolean),observed_fd_numbers:{normal:regular(normal),ignored:regular(ignored),passed:regular(passed)},limits:'synthetic_Node_spawnSync_shape_only_not_real_ALiX_process_or_cross_UID_proof'})+'\n');
} finally { fs.closeSync(fd); fs.rmSync(dir,{recursive:true,force:true}); }
