import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const processOwnerVariable = "FILEGRC_TEST_PROCESS_OWNER";

export async function processTable() {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,pgid=,uid=,stat=,lstart="]);
  return stdout.trim().split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 10 && !parts[4].startsWith("Z") && parts.slice(0, 4).every((part) => Number.isInteger(Number(part))))
    .map(([pid, parentPid, groupId, uid, , ...started]) => ({ pid: Number(pid), parentPid: Number(parentPid), groupId: Number(groupId), uid: Number(uid), started: started.join(" ") }));
}

export async function hasOwner(pid, owner, { platform = process.platform, readEnvironment = (pid) => readFile(`/proc/${pid}/environ`, "utf8"), liveProcesses = processTable } = {}) {
  try {
    if (platform === "linux") {
      const environment = await readEnvironment(pid);
      return environment.split("\0").includes(`${processOwnerVariable}=${owner}`);
    }
    // Never expose process environments in logs or return values.
    const { stdout } = await execFileAsync("ps", ["eww", "-p", String(pid), "-o", "command="], { maxBuffer: 8 * 1024 * 1024 });
    return stdout.split(/\s+/).includes(`${processOwnerVariable}=${owner}`);
  } catch (error) {
    // ps exits 1 when the process has already gone away.
    if (["ENOENT", "ESRCH"].includes(error.code) || (error.code === 1 && !error.stdout?.trim() && !error.stderr?.trim())) return false;
    if (platform === "linux" && ["EACCES", "EPERM"].includes(error.code)) {
      // Linux may deny environ while an exiting process becomes a zombie.
      // Recheck the live table, which excludes zombies, before treating this as
      // a permission failure. A still-live selected process must fail closed.
      if (!(await liveProcesses()).some((entry) => entry.pid === pid)) return false;
    }
    throw new Error("Could not inspect test child process ownership.", { cause: { code: error.code } });
  }
}

export async function discoverLinuxOwners(owners, procRoot = "/proc") {
  const marked = new Map();
  try {
    for (const entry of await readdir(procRoot)) {
      if (!/^[1-9]\d*$/.test(entry) || Number(entry) <= 1) continue;
      let environment;
      try { environment = await readFile(join(procRoot, entry, "environ"), "utf8"); }
      catch (error) {
        // Unrelated processes may disappear or belong to another user. A
        // selected target is separately verified, and its permission errors fail.
        if (["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(error.code)) continue;
        throw error;
      }
      const owner = environment.split("\0").find((value) => value.startsWith(`${processOwnerVariable}=`))?.slice(processOwnerVariable.length + 1);
      if (owners.has(owner)) marked.set(Number(entry), owner);
    }
    return marked;
  } catch (error) {
    throw new Error("Could not discover test child process ownership.", { cause: { code: error.code } });
  }
}

async function discoverOwners(owners) {
  if (process.platform === "linux") return discoverLinuxOwners(owners);
  try {
    // A descendant can create its own session and outlive its original group.
    // Inspect environments internally; never expose command text or environments.
    const { stdout } = await execFileAsync("ps", ["eww", "-axo", "pid=,command="], { maxBuffer: 64 * 1024 * 1024 });
    const marked = new Map();
    for (const line of stdout.split("\n")) {
      const pid = Number(line.trim().match(/^\d+/)?.[0]);
      const owner = line.match(/(?:^|\s)FILEGRC_TEST_PROCESS_OWNER=([a-f0-9-]{36})(?=\s|$)/)?.[1];
      if (Number.isInteger(pid) && pid > 1 && owners.has(owner)) marked.set(pid, owner);
    }
    return marked;
  } catch (error) {
    throw new Error("Could not discover test child process ownership.", { cause: { code: error.code } });
  }
}

export async function ownedProcessIds(groups, { table = processTable, owns = hasOwner, discover = discoverOwners, excludePid = process.pid, identities } = {}) {
  const processes = await table();
  const targets = new Set();
  const owners = new Set([...groups].filter(([pid, owner]) => Number.isInteger(pid) && pid > 1 && typeof owner === "string" && /^[a-f0-9-]{36}$/.test(owner)).map(([, owner]) => owner));
  const marked = await discover(owners);
  for (const { pid } of processes) {
    if (pid !== excludePid && marked.has(pid) && await owns(pid, marked.get(pid))) targets.add(pid);
  }
  for (const [groupId, owner] of groups) {
    if (!Number.isInteger(groupId) || groupId <= 1 || typeof owner !== "string" || !/^[a-f0-9-]{36}$/.test(owner)) continue;
    const members = processes.filter((entry) => entry.groupId === groupId && entry.pid > 1);
    // A historical PID is not authority over a group with the same reused ID.
    // No marker means fail closed, including an orphan that cleared its environment.
    let verified = false;
    for (const member of members) {
      if (marked.get(member.pid) === owner && await owns(member.pid, owner)) { verified = true; break; }
    }
    if (verified) for (const { pid } of members) if (pid !== excludePid) targets.add(pid);
  }
  // Also retain still-attached descendants that deliberately supplied a clean env.
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of processes) {
      if (entry.pid > 1 && entry.pid !== excludePid && targets.has(entry.parentPid) && !targets.has(entry.pid)) {
        targets.add(entry.pid);
        changed = true;
      }
    }
  }
  for (const entry of processes) if (targets.has(entry.pid)) identities?.set(entry.pid, processIdentity(entry));
  return targets;
}

function processIdentity({ pid, groupId, uid, started }) {
  return JSON.stringify([pid, groupId, uid, started]);
}

export async function cleanupOwnedProcesses(groups, options = {}) {
  const { kill = process.kill, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), ...selection } = options;
  const retained = new Map();
  const targetsNow = async () => {
    const snapshot = await (selection.table || processTable)();
    const targets = await ownedProcessIds(groups, { ...selection, table: async () => snapshot, identities: retained });
    for (const [pid, identity] of retained) {
      const entry = snapshot.find((entry) => entry.pid === pid);
      // Retain ownership after its marked ancestor exits, but never across a
      // PID reuse, group change, or process start change. Reparenting is allowed.
      if (!entry) retained.delete(pid);
      else if (processIdentity(entry) === identity) targets.add(pid);
      else throw new Error("A selected test child process changed identity during cleanup; it was not signalled.");
    }
    return targets;
  };
  let found = false;
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    // Revalidate ownership after TERM, never signal a remembered numeric group.
    const targets = await targetsNow();
    found ||= targets.size > 0;
    for (const pid of targets) {
      if (!(await targetsNow()).has(pid)) continue;
      try { kill(pid, signal); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    if (signal === "SIGTERM" && targets.size) await delay(100);
  }
  const deadline = Date.now() + 2_000;
  while ((await targetsNow()).size) {
    if (Date.now() >= deadline) throw new Error("A test-file child process did not exit after cleanup.");
    await delay(25);
  }
  return found;
}
