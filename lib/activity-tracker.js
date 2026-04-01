const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
let activeWin = null;

try {
  activeWin = require("active-win");
} catch {
  activeWin = null;
}

const DEFAULT_INTERVAL_SECONDS = 5;
const LOG_TIMEZONE = "Asia/Seoul";
const MAX_RECENT_LINES = 15;
const DEFAULT_LOG_DIR = path.join(process.cwd(), "logs");

function createTrackerState() {
  return {
    timer: null,
    isRunning: false,
    isCollecting: false,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    logDir: DEFAULT_LOG_DIR,
    startedAt: null,
    lastCapturedAt: null,
    lastError: "",
    lastEntry: null,
  };
}

const trackerState =
  global.__activityTrackerState || (global.__activityTrackerState = createTrackerState());

function getLogDir() {
  return trackerState.logDir || DEFAULT_LOG_DIR;
}

function setLogDir(nextLogDir) {
  if (typeof nextLogDir !== "string") {
    return getLogDir();
  }

  const trimmed = nextLogDir.trim();
  if (!trimmed) {
    return getLogDir();
  }

  trackerState.logDir = path.resolve(trimmed);
  ensureLogDir();
  return trackerState.logDir;
}

function ensureLogDir() {
  const logDir = getLogDir();
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function formatSeoulDateKey(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LOG_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function formatSeoulDateTime(now) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LOG_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function getLogFilePath(now = new Date()) {
  return path.join(getLogDir(), `${formatSeoulDateKey(now)}.txt`);
}

function getMostRecentLogFilePath() {
  ensureLogDir();

  const files = fs
    .readdirSync(getLogDir(), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".txt"))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, "en"));

  if (!files.length) {
    return null;
  }

  return path.join(getLogDir(), files[0]);
}

function appendLogLine(now, appName, title) {
  const filePath = getLogFilePath(now);
  const safeTitle = String(title || "").replace(/[\r\n]+/g, " ").trim();
  const localTime = formatSeoulDateTime(now);
  const line = `[${localTime} KST] app="${appName}" title="${safeTitle}"\n`;
  fs.appendFileSync(filePath, line, "utf8");
  return {
    appName,
    title: safeTitle,
    capturedAt: now.toISOString(),
    displayTime: `${localTime} KST`,
    logFilePath: filePath,
  };
}

function getForegroundWindowViaPowerShell() {
  const psScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WinApi {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

  $h = [WinApi]::GetForegroundWindow()
  if ($h -eq [IntPtr]::Zero) {
    [PSCustomObject]@{ ok = $false; appName = "no-active-window"; title = ""; source = "winapi"; error = "GetForegroundWindow=Zero" } | ConvertTo-Json -Compress
    exit 0
  }

  $sb = New-Object System.Text.StringBuilder 2048
  [void][WinApi]::GetWindowText($h, $sb, $sb.Capacity)
  [uint32]$processId = 0
  [void][WinApi]::GetWindowThreadProcessId($h, [ref]$processId)

  $procName = "unknown"
  if ($processId -gt 0) {
    try {
      $procName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
    }
    catch {
      $procName = "unknown"
    }
  }

  [PSCustomObject]@{
    ok = $true
    appName = $procName
    title = $sb.ToString()
    source = "winapi"
    error = ""
  } | ConvertTo-Json -Compress
}
catch {
  [PSCustomObject]@{ ok = $false; appName = "winapi-error"; title = ""; source = "winapi"; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`;

  try {
    const rawBuffer = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript],
      { encoding: "buffer" }
    );
    const raw = new TextDecoder("utf-8").decode(rawBuffer).trim();

    if (!raw) {
      return { ok: false, appName: "empty-output", title: "", source: "winapi", error: "No output" };
    }

    return JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      appName: "powershell-spawn-error",
      title: "",
      source: "winapi",
      error: String(error?.message || error),
    };
  }
}

async function getWindowInfo() {
  if (activeWin) {
    try {
      const win = await activeWin();
      if (win) {
        return {
          ok: true,
          appName: win?.owner?.name || "unknown",
          title: win?.title || "",
          source: "active-win",
          error: "",
        };
      }
    } catch (error) {
      return {
        ok: false,
        appName: "active-win-error",
        title: "",
        source: "active-win",
        error: String(error?.message || error),
      };
    }
  }

  return getForegroundWindowViaPowerShell();
}

async function collectActivity() {
  if (trackerState.isCollecting) {
    return trackerState.lastEntry;
  }

  trackerState.isCollecting = true;

  try {
    const now = new Date();
    const info = await getWindowInfo();
    const appName = info?.appName || "unknown";
    const title = info?.title || (info?.error ? `error=${info.error}` : "");

    ensureLogDir();
    const entry = appendLogLine(now, appName, title);
    trackerState.lastCapturedAt = entry.capturedAt;
    trackerState.lastEntry = {
      ...entry,
      source: info?.source || "unknown",
      error: info?.error || "",
      ok: Boolean(info?.ok),
    };
    trackerState.lastError = info?.error || "";

    return trackerState.lastEntry;
  } catch (error) {
    trackerState.lastError = String(error?.message || error);
    return trackerState.lastEntry;
  } finally {
    trackerState.isCollecting = false;
  }
}

function normalizeIntervalSeconds(intervalSeconds) {
  const parsed = Number(intervalSeconds);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_INTERVAL_SECONDS;
  }

  return Math.min(3600, Math.max(1, Math.floor(parsed)));
}

function clearTrackerTimer() {
  if (trackerState.timer) {
    clearInterval(trackerState.timer);
    trackerState.timer = null;
  }
}

function startTracking(options = {}) {
  if (options.logDir) {
    setLogDir(options.logDir);
  }

  ensureLogDir();

  const intervalSeconds = normalizeIntervalSeconds(
    options.intervalSeconds ?? trackerState.intervalSeconds
  );

  clearTrackerTimer();

  trackerState.intervalSeconds = intervalSeconds;
  trackerState.isRunning = true;
  trackerState.startedAt = new Date().toISOString();
  trackerState.timer = setInterval(() => {
    void collectActivity();
  }, intervalSeconds * 1000);

  void collectActivity();

  return getTrackerStatus();
}

function stopTracking() {
  clearTrackerTimer();
  trackerState.isRunning = false;
  return getTrackerStatus();
}

function readRecentLogLines(limit = MAX_RECENT_LINES) {
  ensureLogDir();
  const recentPath = getMostRecentLogFilePath();

  if (!recentPath || !fs.existsSync(recentPath)) {
    return [];
  }

  const raw = fs.readFileSync(recentPath, "utf8").trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .reverse();
}

function getTrackerStatus() {
  ensureLogDir();

  return {
    isRunning: trackerState.isRunning,
    intervalSeconds: trackerState.intervalSeconds,
    startedAt: trackerState.startedAt,
    lastCapturedAt: trackerState.lastCapturedAt,
    lastError: trackerState.lastError,
    logDir: getLogDir(),
    todayLogPath: getLogFilePath(new Date()),
    recentLogPath: getMostRecentLogFilePath(),
    lastEntry: trackerState.lastEntry,
    recentLines: readRecentLogLines(),
  };
}

module.exports = {
  DEFAULT_INTERVAL_SECONDS,
  DEFAULT_LOG_DIR,
  ensureLogDir,
  collectActivity,
  getTrackerStatus,
  getLogDir,
  setLogDir,
  startTracking,
  stopTracking,
};
