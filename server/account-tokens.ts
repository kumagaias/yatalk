import { createHash, randomBytes } from "node:crypto";
import type { Db, FirestoreDb } from "./database.js";
import type { FirestoreDocument } from "./firestore-store.js";

export type AccountTokenPurpose = "verify_email" | "password_reset";
const TOKEN_TTL_MS: Record<AccountTokenPurpose, number> = { verify_email: 24 * 60 * 60_000, password_reset: 30 * 60_000 };

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueAccountToken(db: Db, userId: string, purpose: AccountTokenPurpose, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = digest(token);
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS[purpose]).toISOString();
  if ((db as FirestoreDb).firestoreBrand) {
    await (db as FirestoreDb).firestoreStore.runTransaction(async (transaction) => {
      const existing = await transaction.query<FirestoreDocument>("ownerTokens", [
        { field: "userId", op: "==", value: userId }, { field: "purpose", op: "==", value: purpose },
      ]);
      for (const item of existing) transaction.delete("ownerTokens", item.id);
      transaction.create("ownerTokens", tokenHash, { userId, purpose, createdAt, expiresAt, expiresAtTtl: new Date(expiresAt) });
    });
  } else {
    const transaction = (db as import("./database.js").SqliteDb).transaction(() => {
      const sqlite = db as import("./database.js").SqliteDb;
      sqlite.prepare("DELETE FROM owner_tokens WHERE user_id = ? AND purpose = ?").run(userId, purpose);
      sqlite.prepare("INSERT INTO owner_tokens(token_hash, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(tokenHash, userId, purpose, expiresAt, createdAt);
    });
    transaction.immediate();
  }
  return token;
}

export async function consumeEmailVerification(db: Db, token: string, now = new Date()): Promise<boolean> {
  return consumeAccountToken(db, token, "verify_email", now);
}

export async function consumePasswordReset(db: Db, token: string, passwordHash: string, now = new Date()): Promise<boolean> {
  return consumeAccountToken(db, token, "password_reset", now, passwordHash);
}

async function consumeAccountToken(db: Db, token: string, purpose: AccountTokenPurpose, now: Date, passwordHash?: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const tokenHash = digest(token);
  const nowIso = now.toISOString();
  if ((db as FirestoreDb).firestoreBrand) {
    return (db as FirestoreDb).firestoreStore.runTransaction(async (transaction) => {
      const stored = await transaction.get<{ userId: string; purpose: AccountTokenPurpose; expiresAt: string } & FirestoreDocument>("ownerTokens", tokenHash);
      if (!stored || stored.purpose !== purpose || stored.expiresAt <= nowIso) return false;
      const user = await transaction.get<FirestoreDocument>("users", stored.userId);
      if (!user) return false;
      const sessions = passwordHash ? await transaction.query<FirestoreDocument>("ownerSessions", [
        { field: "userId", op: "==", value: stored.userId },
      ]) : [];
      transaction.update("users", stored.userId, passwordHash
        ? { passwordHash, passwordChangedAt: nowIso }
        : { emailVerified: true });
      transaction.delete("ownerTokens", tokenHash);
      for (const session of sessions) transaction.delete("ownerSessions", session.id);
      return true;
    });
  }

  const sqlite = db as import("./database.js").SqliteDb;
  const transaction = sqlite.transaction(() => {
    const stored = sqlite.prepare("SELECT user_id, purpose, expires_at FROM owner_tokens WHERE token_hash = ?")
      .get(tokenHash) as { user_id: string; purpose: AccountTokenPurpose; expires_at: string } | undefined;
    if (!stored || stored.purpose !== purpose || stored.expires_at <= nowIso) return false;
    if (passwordHash) {
      sqlite.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, stored.user_id);
      sqlite.prepare("DELETE FROM owner_sessions WHERE user_id = ?").run(stored.user_id);
    } else {
      sqlite.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(stored.user_id);
    }
    sqlite.prepare("DELETE FROM owner_tokens WHERE token_hash = ?").run(tokenHash);
    return true;
  });
  return transaction.immediate();
}
