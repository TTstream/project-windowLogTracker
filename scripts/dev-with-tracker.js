const { spawn } = require("child_process");

const children = [];
let shuttingDown = false;

function runScript(name) {
  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", `npm run ${name}`], {
          stdio: "inherit",
          env: process.env,
          windowsHide: false,
        })
      : spawn("npm", ["run", name], {
          stdio: "inherit",
          env: process.env,
        });

  child.on("error", (error) => {
    console.error(`[spawn error] ${name}`, error);
    shutdown(1);
  });

  children.push(child);
  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }

  setTimeout(() => process.exit(exitCode), 100);
}

const dev = runScript("dev:next");
const track = runScript("track");

dev.on("exit", (code) => shutdown(code ?? 0));
track.on("exit", (code) => shutdown(code ?? 0));

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
