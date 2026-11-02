import { spawn } from "node:child_process";
import { recordGe04Attempt } from "../../../../src/execution/filesystem/ge04-attempt-journal.js";

const root = process.argv[2];
if (!root || !process.send) throw new Error("workspace and IPC required");
const id = await recordGe04Attempt({
  workspaceRoot: root, ownedScope: "owned", workerId: "worker-orphan",
  leaseId: "lease-orphan", approvalId: "approval-orphan", policyRevision: "revision-orphan",
}, { kind: "create", relativePath: "orphan.txt", content: Buffer.from("orphan") });
const helper = spawn("/bin/sh", ["-c",
  'printf ready > "$1/started"; sleep 1; printf orphan > "$1/orphan.txt"',
  "ge04-helper", root], { stdio: "ignore" });
if (!helper.pid) throw new Error("helper failed to spawn");
process.send({ attemptId: id, helperPid: helper.pid });
setInterval(() => {}, 1000);
