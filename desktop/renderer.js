const statusBadge = document.querySelector("[data-role='status-badge']");
const statusText = document.querySelector("[data-role='status-text']");
const statusNotice = document.querySelector("[data-role='status-notice']");
const intervalInput = document.querySelector("[data-role='interval-input']");
const logDirValue = document.querySelector("[data-role='log-dir']");
const startButton = document.querySelector("[data-role='start-button']");
const stopButton = document.querySelector("[data-role='stop-button']");
const refreshButton = document.querySelector("[data-role='refresh-button']");
const chooseDirButton = document.querySelector("[data-role='choose-dir-button']");
const openDirButton = document.querySelector("[data-role='open-dir-button']");
const openSummaryButton = document.querySelector("[data-role='open-summary-button']");
const openFileSummaryButton = document.querySelector("[data-role='open-file-summary-button']");
const appNameValue = document.querySelector("[data-role='app-name']");
const titleValue = document.querySelector("[data-role='window-title']");
const sourceValue = document.querySelector("[data-role='capture-source']");
const lastTimeValue = document.querySelector("[data-role='last-time']");
const logPathValue = document.querySelector("[data-role='log-path']");
const errorValue = document.querySelector("[data-role='error']");
const recentList = document.querySelector("[data-role='recent-lines']");

let refreshTimer = null;
let currentStatus = null;

function setBusy(isBusy) {
  startButton.disabled = isBusy;
  stopButton.disabled = isBusy;
  refreshButton.disabled = isBusy || Boolean(currentStatus?.isRunning);
  chooseDirButton.disabled = isBusy || Boolean(currentStatus?.isRunning);
  openSummaryButton.disabled = isBusy || Boolean(currentStatus?.isRunning);
  openFileSummaryButton.disabled = isBusy || Boolean(currentStatus?.isRunning);
}

function syncControlState() {
  const running = Boolean(currentStatus?.isRunning);
  intervalInput.disabled = running;
  refreshButton.disabled = running;
  chooseDirButton.disabled = running;
  openSummaryButton.disabled = running;
  openFileSummaryButton.disabled = running;
}

function showNotice(message, tone = "neutral") {
  statusNotice.textContent = message;
  statusNotice.dataset.tone = tone;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function renderRecentLines(lines) {
  recentList.innerHTML = "";

  if (!lines.length) {
    const empty = document.createElement("li");
    empty.className = "log-line is-empty";
    empty.textContent = "아직 수집된 로그가 없습니다.";
    recentList.appendChild(empty);
    return;
  }

  for (const line of lines) {
    const item = document.createElement("li");
    item.className = "log-line";
    item.textContent = line;
    recentList.appendChild(item);
  }
}

function renderStatus(status) {
  currentStatus = status;

  const running = Boolean(status?.isRunning);
  statusBadge.textContent = running ? "RUNNING" : "STOPPED";
  statusBadge.dataset.state = running ? "running" : "stopped";
  statusText.textContent = running
    ? `${status.intervalSeconds}초마다 로그 수집 중`
    : "수집이 멈춰 있습니다";

  if (document.activeElement !== intervalInput) {
    intervalInput.value = String(status?.intervalSeconds ?? 5);
  }

  logDirValue.textContent = status?.logDir || "-";
  appNameValue.textContent = status?.lastEntry?.appName || "-";
  titleValue.textContent = status?.lastEntry?.title || "-";
  sourceValue.textContent = status?.lastEntry?.source || "-";
  lastTimeValue.textContent = formatDateTime(status?.lastCapturedAt);
  logPathValue.textContent = status?.recentLogPath || status?.todayLogPath || "-";
  errorValue.textContent = status?.lastError || "-";
  renderRecentLines(status?.recentLines || []);
  syncControlState();
}

async function refreshStatus() {
  const status = await window.trackerApp.getStatus();
  renderStatus(status);
}

async function handleStart() {
  const intervalSeconds = Number(intervalInput.value || 5);
  const wasRunning = Boolean(currentStatus?.isRunning);
  const nextLogDir = currentStatus?.logDir || "";
  const sameInterval = intervalSeconds === Number(currentStatus?.intervalSeconds ?? 5);
  const sameLogDir = nextLogDir === String(currentStatus?.logDir || "");

  if (currentStatus?.isRunning && sameInterval && sameLogDir) {
    showNotice("이미 수집 중입니다. 먼저 정지하거나 설정을 바꿔 주세요.", "warning");
    return;
  }

  setBusy(true);

  try {
    const status = await window.trackerApp.start(intervalSeconds);
    renderStatus(status);

    if (wasRunning) {
      showNotice("수집 주기를 다시 적용했습니다.", "success");
    } else {
      showNotice("로그 수집을 시작했습니다.", "success");
    }
  } finally {
    setBusy(false);
  }
}

async function handleStop() {
  if (!currentStatus?.isRunning) {
    showNotice("지금은 수집이 멈춰 있습니다.", "warning");
    return;
  }

  setBusy(true);

  try {
    const status = await window.trackerApp.stop();
    renderStatus(status);
    showNotice("로그 수집을 정지했습니다.", "success");
  } finally {
    setBusy(false);
  }
}

async function handleChooseDir() {
  setBusy(true);

  try {
    const result = await window.trackerApp.chooseLogDir();
    if (result?.canceled) {
      showNotice("로그 폴더 선택을 취소했습니다.", "neutral");
      return;
    }

    renderStatus(result.status);
    showNotice("로그 저장 위치를 변경했습니다.", "success");
  } finally {
    setBusy(false);
  }
}

async function handleOpenDir() {
  await window.trackerApp.openLogDir();
}

function getSummaryNotice(result, targetLabel) {
  if (result?.source === "groq") {
    return `${targetLabel}을 AI 요약으로 만들었습니다.`;
  }

  return `AI 연결이 안 되어 ${targetLabel}을 기본 요약으로 만들었습니다.`;
}

async function handleOpenSummary() {
  setBusy(true);

  try {
    const result = await window.trackerApp.openSummary();
    showNotice(getSummaryNotice(result, "메모장"), result?.source === "groq" ? "success" : "warning");
  } catch (error) {
    showNotice(`메모장 요약 생성 중 오류가 발생했습니다: ${error?.message || error}`, "warning");
  } finally {
    setBusy(false);
  }
}

async function handleOpenFileSummary() {
  setBusy(true);

  try {
    const result = await window.trackerApp.openFileSummary();
    if (result?.canceled) {
      showNotice("요약할 파일 선택을 취소했습니다.", "neutral");
      return;
    }

    showNotice(getSummaryNotice(result, "선택한 파일 요약"), result?.source === "groq" ? "success" : "warning");
  } catch (error) {
    showNotice(`파일 요약 생성 중 오류가 발생했습니다: ${error?.message || error}`, "warning");
  } finally {
    setBusy(false);
  }
}

startButton.addEventListener("click", handleStart);
stopButton.addEventListener("click", handleStop);
refreshButton.addEventListener("click", refreshStatus);
chooseDirButton.addEventListener("click", handleChooseDir);
openDirButton.addEventListener("click", handleOpenDir);
openSummaryButton.addEventListener("click", handleOpenSummary);
openFileSummaryButton.addEventListener("click", handleOpenFileSummary);

window.addEventListener("DOMContentLoaded", async () => {
  await refreshStatus();
  showNotice("수집을 시작하기 전에 저장 폴더와 주기를 확인해 주세요.", "neutral");
  refreshTimer = window.setInterval(refreshStatus, 3000);
});

window.addEventListener("beforeunload", () => {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
  }
});
