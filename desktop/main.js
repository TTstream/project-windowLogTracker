const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell } = require("electron");
const tracker = require("../lib/activity-tracker");

let mainWindow = null;
let tray = null;
let isQuitting = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

function loadLocalEnv() {
  const candidatePaths = [
    path.join(__dirname, "..", ".env"),
    path.join(process.resourcesPath || "", ".env"),
    path.join(process.cwd(), ".env"),
  ].filter(Boolean);

  for (const envPath of candidatePaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      const value = rawValue.replace(/^['"]|['"]$/g, "");

      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    }

    return;
  }
}

function getDefaultDesktopLogDir() {
  return path.join(app.getPath("userData"), "logs");
}

function getAppIconPath() {
  return path.join(__dirname, "..", "app", "favicon.ico");
}

function parseLogLine(line) {
  const match = line.match(/^\[(.+?) KST\] app="(.*?)" title="(.*)"$/);
  if (!match) {
    return null;
  }

  return {
    timestamp: match[1],
    appName: match[2] || "unknown",
    title: match[3] || "",
  };
}

function formatMinutes(minutes) {
  if (minutes < 1) {
    return "1분 미만";
  }

  return `${minutes}분`;
}

function sanitizeSummaryName(value) {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim() || "요약";
}

function sliceTextForModel(text, maxChars = 12000) {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n\n[이하 내용 생략]`;
}

function collectSummaryStats() {
  const status = tracker.getTrackerStatus();
  const sourcePath = status.recentLogPath || status.todayLogPath;
  const summaryDate = sourcePath
    ? path.basename(sourcePath, path.extname(sourcePath))
    : new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

  const rawLines =
    sourcePath && fs.existsSync(sourcePath)
      ? fs.readFileSync(sourcePath, "utf8").split(/\r?\n/).filter(Boolean)
      : [];

  const entries = rawLines.map(parseLogLine).filter(Boolean);
  const appCounts = new Map();
  const titleCounts = new Map();

  for (const entry of entries) {
    appCounts.set(entry.appName, (appCounts.get(entry.appName) || 0) + 1);
    if (entry.title) {
      titleCounts.set(entry.title, (titleCounts.get(entry.title) || 0) + 1);
    }
  }

  const sortedApps = [...appCounts.entries()].sort((left, right) => right[1] - left[1]);
  const sortedTitles = [...titleCounts.entries()].sort((left, right) => right[1] - left[1]);

  return {
    status,
    sourcePath,
    summaryDate,
    entries,
    sortedApps,
    sortedTitles,
  };
}

function buildLocalActivitySummaryContent() {
  const { status, sourcePath, summaryDate, entries, sortedApps, sortedTitles } =
    collectSummaryStats();
  const topApp = sortedApps[0];
  const topTitle = sortedTitles[0];
  const estimatedMinutes = (status.intervalSeconds * entries.length) / 60;
  const recentEntries = entries.slice(-5).reverse();

  const lines = [
    `${summaryDate} 요약`,
    "",
    `생성 시각: ${new Date().toLocaleString("ko-KR")}`,
    `기준 로그 파일: ${sourcePath || "-"}`,
    `총 로그 수: ${entries.length}개`,
    `수집 주기: ${status.intervalSeconds}초`,
    `추정 기록 시간: ${formatMinutes(Math.round(estimatedMinutes))}`,
    `등장한 앱 수: ${sortedApps.length}개`,
    `가장 많이 사용한 앱: ${topApp ? `${topApp[0]} (${topApp[1]}회)` : "-"}`,
    `가장 많이 본 창 제목: ${topTitle ? `${topTitle[0]} (${topTitle[1]}회)` : "-"}`,
    `마지막 수집 시각: ${
      status.lastCapturedAt ? new Date(status.lastCapturedAt).toLocaleString("ko-KR") : "-"
    }`,
    `마지막 오류: ${status.lastError || "없음"}`,
    "",
    "앱별 기록 횟수:",
  ];

  if (sortedApps.length) {
    for (const [appName, count] of sortedApps.slice(0, 8)) {
      lines.push(`- ${appName}: ${count}회`);
    }
  } else {
    lines.push("- 기록이 없습니다.");
  }

  lines.push("", "최근 활동 5개:");

  if (recentEntries.length) {
    for (const entry of recentEntries) {
      lines.push(`- [${entry.timestamp}] ${entry.appName} | ${entry.title || "(제목 없음)"}`);
    }
  } else {
    lines.push("- 최근 활동이 없습니다.");
  }

  lines.push("", "한줄 요약:");

  if (entries.length) {
    lines.push(
      `${summaryDate}에는 ${topApp ? topApp[0] : "주요 앱"} 중심으로 활동했고, 총 ${entries.length}개의 로그가 기록되었습니다.`
    );
  } else {
    lines.push("아직 분석할 로그가 없어 요약할 내용이 없습니다.");
  }

  return {
    summaryLabel: summaryDate,
    content: lines.join("\r\n"),
    source: "local",
  };
}

function buildLocalTextSummaryContent({ sourcePath, summaryLabel, text }) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const nonEmptyLines = lines.filter(Boolean);
  const firstMeaningfulLines = nonEmptyLines.slice(0, 5);
  const lastMeaningfulLines = nonEmptyLines.slice(-5);
  const uniqueLineCount = new Set(nonEmptyLines).size;
  const charCount = text.length;

  const summaryLines = [
    `${summaryLabel} 요약`,
    "",
    `생성 시각: ${new Date().toLocaleString("ko-KR")}`,
    `원본 파일: ${sourcePath}`,
    `전체 줄 수: ${lines.length}줄`,
    `내용이 있는 줄 수: ${nonEmptyLines.length}줄`,
    `대략 글자 수: ${charCount}자`,
    `겹치지 않는 줄 수: ${uniqueLineCount}줄`,
    "",
    "앞부분 핵심 문장:",
  ];

  if (firstMeaningfulLines.length) {
    for (const line of firstMeaningfulLines) {
      summaryLines.push(`- ${line}`);
    }
  } else {
    summaryLines.push("- 내용이 없습니다.");
  }

  summaryLines.push("", "뒷부분 핵심 문장:");

  if (lastMeaningfulLines.length) {
    for (const line of lastMeaningfulLines) {
      summaryLines.push(`- ${line}`);
    }
  } else {
    summaryLines.push("- 내용이 없습니다.");
  }

  summaryLines.push("", "한줄 요약:");

  if (nonEmptyLines.length) {
    summaryLines.push(
      `이 문서는 총 ${nonEmptyLines.length}개의 의미 있는 줄로 이루어져 있고, 앞부분부터 뒷부분까지 이어지는 내용을 빠르게 훑어볼 수 있게 정리했습니다.`
    );
  } else {
    summaryLines.push("요약할 내용이 없는 빈 파일입니다.");
  }

  return {
    summaryLabel,
    content: summaryLines.join("\r\n"),
    source: "local",
  };
}

async function requestGroqSummary(prompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is missing");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: "You summarize Korean text and computer activity logs in concise Korean.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const aiText = data?.choices?.[0]?.message?.content?.trim();
  if (!aiText) {
    throw new Error("Groq returned an empty summary");
  }

  return aiText;
}

async function buildGroqActivitySummaryContent() {
  const { status, sourcePath, summaryDate, entries, sortedApps } = collectSummaryStats();
  const logText = entries.length
    ? entries
        .map((entry) => `[${entry.timestamp}] app=${entry.appName} title=${entry.title || "(제목 없음)"}`)
        .join("\n")
    : "로그가 없습니다.";

  const topAppsText = sortedApps.length
    ? sortedApps.slice(0, 5).map(([appName, count]) => `${appName}(${count}회)`).join(", ")
    : "없음";

  const prompt = [
    "다음 활동 로그를 한국어로 간단하고 자연스럽게 요약해줘.",
    "형식 요구사항:",
    "- 첫 줄은 'YYYY-MM-DD 요약' 형식",
    "- 총평 2~4문장",
    "- 주요 사용 앱",
    "- 최근 작업 흐름",
    "- 마지막에 한줄 요약",
    "- 불필요한 마크다운 기호는 쓰지 말 것",
    "",
    `기준 로그 파일: ${sourcePath || "-"}`,
    `수집 주기: ${status.intervalSeconds}초`,
    `주요 앱 후보: ${topAppsText}`,
    "",
    "로그 원문:",
    sliceTextForModel(logText),
  ].join("\n");

  return {
    summaryLabel: summaryDate,
    content: await requestGroqSummary(prompt),
    source: "groq",
  };
}

async function buildGroqTextSummaryContent({ sourcePath, summaryLabel, text }) {
  const prompt = [
    "다음 메모장 파일 내용을 한국어로 간단하고 자연스럽게 요약해줘.",
    "형식 요구사항:",
    "- 첫 줄은 '파일명 요약' 또는 날짜가 보이면 'YYYY-MM-DD 요약' 형식",
    "- 핵심 내용 2~4문장",
    "- 중요한 항목이나 할 일",
    "- 마지막에 한줄 요약",
    "- 불필요한 마크다운 기호는 쓰지 말 것",
    "",
    `원본 파일 경로: ${sourcePath}`,
    "",
    "원문:",
    sliceTextForModel(text),
  ].join("\n");

  return {
    summaryLabel,
    content: await requestGroqSummary(prompt),
    source: "groq",
  };
}

async function buildActivitySummaryContent() {
  try {
    return await buildGroqActivitySummaryContent();
  } catch {
    return buildLocalActivitySummaryContent();
  }
}

async function buildSelectedFileSummaryContent(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const summaryLabel = path.basename(filePath, path.extname(filePath));

  try {
    return await buildGroqTextSummaryContent({
      sourcePath: filePath,
      summaryLabel,
      text,
    });
  } catch {
    return buildLocalTextSummaryContent({
      sourcePath: filePath,
      summaryLabel,
      text,
    });
  }
}

function showMainWindow() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) {
    return;
  }

  tray = new Tray(getAppIconPath());
  tray.setToolTip("Window Log Tracker");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "창 열기",
        click: () => showMainWindow(),
      },
      {
        label: "종료",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("double-click", () => showMainWindow());
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: "#101418",
    title: "Window Log Tracker",
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer.html"));

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

loadLocalEnv();

app.whenReady().then(() => {
  tracker.setLogDir(getDefaultDesktopLogDir());
  tracker.ensureLogDir();
  createTray();
  createMainWindow();

  app.on("activate", () => {
    if (!mainWindow) {
      createMainWindow();
      return;
    }

    showMainWindow();
  });
});

app.on("second-instance", () => {
  showMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) {
    app.quit();
  }
});

ipcMain.handle("tracker:get-status", () => tracker.getTrackerStatus());
ipcMain.handle("tracker:start", (_event, intervalSeconds) =>
  tracker.startTracking({ intervalSeconds })
);
ipcMain.handle("tracker:stop", () => tracker.stopTracking());
ipcMain.handle("tracker:open-log-dir", async () => {
  const result = await shell.openPath(tracker.getLogDir());
  return { ok: !result, error: result || "" };
});
ipcMain.handle("tracker:choose-log-dir", async () => {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const result = await dialog.showOpenDialog(window, {
    title: "로그 저장 폴더 선택",
    defaultPath: tracker.getLogDir(),
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || !result.filePaths.length) {
    return { canceled: true, logDir: tracker.getLogDir() };
  }

  const logDir = tracker.setLogDir(result.filePaths[0]);
  return {
    canceled: false,
    logDir,
    status: tracker.getTrackerStatus(),
  };
});
ipcMain.handle("tracker:open-summary", async () => {
  const summary = await buildActivitySummaryContent();
  const summaryPath = path.join(tracker.getLogDir(), `${sanitizeSummaryName(summary.summaryLabel)}_요약.txt`);
  fs.writeFileSync(summaryPath, summary.content, "utf8");
  const openResult = await shell.openPath(summaryPath);

  if (openResult) {
    throw new Error(openResult);
  }

  return {
    ok: true,
    summaryPath,
    source: summary.source,
    status: tracker.getTrackerStatus(),
  };
});
ipcMain.handle("tracker:open-file-summary", async () => {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const result = await dialog.showOpenDialog(window, {
    title: "요약할 메모장 파일 선택",
    properties: ["openFile"],
    filters: [
      { name: "텍스트 파일", extensions: ["txt", "md", "log"] },
      { name: "모든 파일", extensions: ["*"] },
    ],
  });

  if (result.canceled || !result.filePaths.length) {
    return { canceled: true };
  }

  const sourcePath = result.filePaths[0];
  const summary = await buildSelectedFileSummaryContent(sourcePath);
  const summaryPath = path.join(
    path.dirname(sourcePath),
    `${sanitizeSummaryName(summary.summaryLabel)}_요약.txt`
  );

  fs.writeFileSync(summaryPath, summary.content, "utf8");
  const openResult = await shell.openPath(summaryPath);

  if (openResult) {
    throw new Error(openResult);
  }

  return {
    ok: true,
    canceled: false,
    source: summary.source,
    sourcePath,
    summaryPath,
  };
});

