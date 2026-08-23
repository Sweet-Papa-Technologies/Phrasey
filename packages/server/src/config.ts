/**
 * Process configuration. Everything comes from the environment — the
 * deployment contract in `infra/cloudrun.tf` sets NODE_ENV,
 * FIRESTORE_DATABASE_ID, GCP_PROJECT and CORS_ORIGINS; Cloud Run injects PORT.
 *
 * No key files: Firestore authenticates with Application Default Credentials
 * (the `phrasey-server@` service account in production, your gcloud login
 * locally).
 */

export interface ServerConfig {
  nodeEnv: 'development' | 'production' | 'test';
  /** Cloud Run injects this. Bind 0.0.0.0 — never localhost, or the probe fails. */
  port: number;
  host: string;
  projectId: string | undefined;
  /** MUST be 'phrasey'. The (default) database is another app's. */
  databaseId: string;
  corsOrigins: string[];
  /** Firestore off entirely: local dev with no cloud creds. */
  firestoreEnabled: boolean;
  /** Run engine invariant checks after every action. Off in production. */
  debugInvariants: boolean;
  /**
   * Deep-scan every outbound payload for the answer before it hits a socket.
   * ON everywhere by default, production included: §6.2 calls server authority
   * non-negotiable, and a dropped board update is a recoverable annoyance while
   * a leaked answer kills the game. `LEAK_GUARD=0` is the escape hatch.
   */
  leakGuard: boolean;
  /** Main loop period. Turn timers and interrupt windows are resolved here. */
  tickMs: number;
  /** Cadence of the `turn:timer` event. */
  timerEmitMs: number;
  /** Pause between a round ending and the next one dealing. */
  intermissionMs: number;
  /** §7 — seat held this long after a drop, then it converts to a bot. */
  reconnectGraceMs: number | null;
  /** A room with no connected humans this long is dropped from memory. */
  idleRoomMs: number;
  logLevel: string;
}

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === '') return dflt;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

function num(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = (env.NODE_ENV as ServerConfig['nodeEnv']) ?? 'development';
  const isProd = nodeEnv === 'production';
  return {
    nodeEnv,
    port: num(env.PORT, 8080),
    // 0.0.0.0 is not optional: Cloud Run's probes come from outside the
    // loopback. Deliberately NOT read from `HOST` — that name is commonly set
    // in interactive shells (macOS sets it to the machine name), which would
    // silently bind the server somewhere unreachable.
    host: env.BIND_HOST ?? '0.0.0.0',
    projectId: env.GCP_PROJECT ?? env.GOOGLE_CLOUD_PROJECT,
    databaseId: env.FIRESTORE_DATABASE_ID ?? 'phrasey',
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    firestoreEnabled: bool(env.FIRESTORE_ENABLED, true),
    debugInvariants: bool(env.DEBUG_INVARIANTS, !isProd),
    leakGuard: bool(env.LEAK_GUARD, true),
    tickMs: num(env.TICK_MS, 200),
    timerEmitMs: num(env.TIMER_EMIT_MS, 1000),
    intermissionMs: num(env.INTERMISSION_MS, 6000),
    reconnectGraceMs: env.RECONNECT_GRACE_MS === 'off' ? null : num(env.RECONNECT_GRACE_MS, 90_000),
    idleRoomMs: num(env.IDLE_ROOM_MS, 30 * 60_000),
    logLevel: env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  };
}
