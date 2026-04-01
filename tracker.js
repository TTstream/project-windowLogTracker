const tracker = require("./lib/activity-tracker");

const rawInterval = process.env.TRACKER_INTERVAL_SECONDS;
const intervalSeconds = Number(rawInterval || tracker.DEFAULT_INTERVAL_SECONDS);

tracker.ensureLogDir();
tracker.startTracking({ intervalSeconds });

console.log(
  `Activity tracker started. Logging every ${intervalSeconds}s (KST) to ${tracker.getLogDir()}`
);
