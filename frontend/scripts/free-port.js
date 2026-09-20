#!/usr/bin/env node
/**
 * Runs as `yarn start`'s prestart hook. Frees PORT (default 3000) before
 * CRA/craco checks it, so a leftover dev-server process from a previous
 * session doesn't trigger CRA's "Would you like to run the app on another
 * port instead? (Y/n)" prompt -- webpack-dev-server's watcher can leave an
 * orphaned child holding the port.
 *
 * Kills unconditionally, no identity check, no prompt: the dev server holds
 * no state worth protecting, so "just free the port and start" is the
 * right default here. Windows-only.
 */
const { execSync } = require("child_process");

const PORT = process.env.PORT || 3000;

function findListeningPid(port) {
  let out;
  try {
    out = execSync("netstat -ano", { encoding: "utf8" });
  } catch {
    return null;
  }
  for (const raw of out.split("\n")) {
    const parts = raw.trim().split(/\s+/);
    // TCP  0.0.0.0:3000  0.0.0.0:0  LISTENING  1234
    if (parts[0] === "TCP" && parts[3] === "LISTENING" && parts[1] && parts[1].endsWith(`:${port}`)) {
      return parts[4];
    }
  }
  return null;
}

function identify(pid) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"ProcessId=${pid}\\" | Select-Object Name,CommandLine | ConvertTo-Json -Compress"`,
      { encoding: "utf8" }
    ).trim();
    if (!out) return null;
    const data = JSON.parse(out);
    return Array.isArray(data) ? data[0] : data;
  } catch {
    return null;
  }
}

const pid = findListeningPid(PORT);
if (!pid) {
  console.log(`[free-port] ${PORT} is free.`);
  process.exit(0);
}

const proc = identify(pid);
const label = proc && proc.Name
  ? `${proc.Name} (${proc.CommandLine || "unknown command line"})`
  : "an unidentified process";
console.log(`[free-port] port ${PORT} was held by PID ${pid} -- ${label}. Freeing it.`);

try {
  // /T (tree-kill): CRA's dev server, like uvicorn --reload, can spawn a
  // child that survives killing just the parent PID.
  execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
} catch (e) {
  console.warn(`[free-port] taskkill failed (continuing -- craco start will surface any real problem): ${e.message}`);
}
