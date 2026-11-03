import { loadConfig } from "./config.js";
import { createDatabase } from "./database.js";
import { createApp } from "./app.js";
import { logStage } from "./logging.js";
import { configureRequestTimeouts, listenHost } from "./network.js";

const config = loadConfig();
const db = createDatabase(config.databasePath);
const app = createApp({ config, db, serveStatic: true });
const host = listenHost(config.nodeEnv);
const server = app.listen(config.port, host, () => {
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), stage: "server_listen", outcome: "success", host, port: config.port }));
});
configureRequestTimeouts(server);

function shutdown(signal: string): void {
  logStage("shutdown", signal, "start");
  server.close(() => {
    db.close();
    logStage("shutdown", signal, "success");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
