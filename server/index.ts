import { loadConfig } from "./config.js";
import { createDatabase, type Db, type FirestoreDb } from "./database.js";
import { createFirestoreDatabase, initializeFirestoreDatabase } from "./firestore-bootstrap.js";
import { createApp } from "./app.js";
import { logStage } from "./logging.js";
import { configureRequestTimeouts, listenHost } from "./network.js";

async function start(): Promise<void> {
  const config = loadConfig();
  let db: Db;
  if (config.databaseBackend === "firestore") {
    const firestoreDb = createFirestoreDatabase(config.googleCloudProject ?? "");
    await initializeFirestoreDatabase(firestoreDb);
    db = firestoreDb;
  } else db = createDatabase(config.databasePath);
  const app = createApp({ config, db, serveStatic: true });
  const host = listenHost(config.nodeEnv);
  const server = app.listen(config.port, host, () => {
    console.info(JSON.stringify({ timestamp: new Date().toISOString(), stage: "server_listen", outcome: "success", host, port: config.port }));
  });
  configureRequestTimeouts(server);

  function shutdown(signal: string): void {
    logStage("shutdown", signal, "start");
    server.close(() => {
      void (async () => {
        if ((db as FirestoreDb).firestoreBrand) await (db as FirestoreDb).firestoreStore.client.terminate();
        db.close();
        logStage("shutdown", signal, "success");
        process.exit(0);
      })().catch((error: unknown) => {
        logStage("shutdown", signal, "failure", error);
        process.exit(1);
      });
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void start().catch((error: unknown) => {
  logStage("startup", "database_initialization", "failure", error);
  process.exitCode = 1;
});
