import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const runtimeDir = path.join(repoRoot, '.tmp', 'dev-runtime');
const args = process.argv.slice(2);
const command = args[0] || 'status';
const jsonOnly = args.includes('--json');

const services = {
  server: {
    port: 8080,
    pidFile: path.join(runtimeDir, 'server.pid'),
    logFile: path.join(runtimeDir, 'server.log'),
    cwd: path.join(repoRoot, 'server'),
    shell: 'go run ./cmd/zeus/main.go',
  },
  'app-backend': {
    port: 4870,
    pidFile: path.join(runtimeDir, 'app-backend.pid'),
    logFile: path.join(runtimeDir, 'app-backend.log'),
    cwd: path.join(repoRoot, 'apps', 'app-backend'),
    shell: 'set -a && source .env && source .env.local && set +a && npm run dev',
  },
  web: {
    port: 1420,
    pidFile: path.join(runtimeDir, 'web.pid'),
    logFile: path.join(runtimeDir, 'web.log'),
    cwd: path.join(repoRoot, 'apps', 'web'),
    shell: 'npm run dev -- --host 127.0.0.1 --port 1420',
  },
};

async function ensureRuntimeDir() {
  await mkdir(runtimeDir, { recursive: true });
}

async function readPid(pidFile) {
  try {
    const text = await readFile(pidFile, 'utf8');
    const pid = Number(text.trim());
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isPortListening(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}`, { method: 'HEAD', signal: AbortSignal.timeout(1000) });
    return Boolean(response);
  } catch {
    return false;
  }
}

async function getServiceStatus(name) {
  const service = services[name];
  const pid = await readPid(service.pidFile);
  const alive = isPidAlive(pid);
  const listening = await isPortListening(service.port);
  return { pid, alive, listening, port: service.port, logFile: service.logFile };
}

async function startService(name) {
  const service = services[name];
  const status = await getServiceStatus(name);
  if (status.alive && status.listening) {
    return status;
  }
  await ensureRuntimeDir();
  const child = spawn('zsh', ['-lc', service.shell], {
    cwd: service.cwd,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  child.unref();
  await writeFile(service.pidFile, `${child.pid}\n`, 'utf8');
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    const next = await getServiceStatus(name);
    if (next.listening) {
      return next;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return getServiceStatus(name);
}

async function stopService(name) {
  const service = services[name];
  const pid = await readPid(service.pidFile);
  if (pid && isPidAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }
  return getServiceStatus(name);
}

const targetNames = Object.keys(services);
const report = { runtimeDir, services: {} };
for (const name of targetNames) {
  if (command === 'start') {
    report.services[name] = await startService(name);
  } else if (command === 'stop') {
    report.services[name] = await stopService(name);
  } else {
    report.services[name] = await getServiceStatus(name);
  }
}

if (jsonOnly) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  for (const [name, value] of Object.entries(report.services)) {
    process.stdout.write(`${name}: ${JSON.stringify(value)}\n`);
  }
}
