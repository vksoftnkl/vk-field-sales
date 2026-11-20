// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

/** Where the salesman was at a visit: the GPS fix kept with it and sent to VK Nex. */
export interface Fix {
  latitude: number;
  longitude: number;
  /** Metres. */
  accuracyM: number | null;
  /** When the phone read it (ISO). */
  locatedAt: string;
}

export type LocateResult =
  | { kind: 'fix'; fix: Fix }
  /** canAskAgain false: Android won't show the question again, only the app's settings can allow it. */
  | { kind: 'denied'; canAskAgain: boolean }
  | { kind: 'off' }
  | { kind: 'failed' };

export interface Position {
  coords: { latitude: number; longitude: number; accuracy: number | null };
  timestamp: number;
}

export interface Permission {
  granted: boolean;
  canAskAgain: boolean;
}

/** expo-location, as readLocation uses it (tests pass a fake). */
export interface LocationApi {
  getPermission(): Promise<Permission>;
  requestPermission(): Promise<Permission>;
  servicesOn(): Promise<boolean>;
  /** Android: the system dialog that turns location on. Rejects when the salesman says no. */
  askToTurnOn?: () => Promise<void>;
  lastKnown(options?: { maxAge?: number; requiredAccuracy?: number }): Promise<Position | null>;
  current(): Promise<Position>;
}

/** getCurrentPositionAsync has no timeout of its own; indoors it may never answer. */
export const GPS_TIMEOUT_MS = 20_000;
/** A fix this recent and this close is used at once instead of waiting for the GPS. */
const RECENT_MS = 120_000;
const RECENT_ACCURACY_M = 100;

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('GPS_TIMEOUT')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** A position as the visit keeps it; null when it is not a real place (VK Nex refuses those). */
export function fixOf(pos: Position | null | undefined): Fix | null {
  if (!pos) return null;
  const { latitude, longitude, accuracy } = pos.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const t = Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now();
  return {
    latitude,
    longitude,
    accuracyM: typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
    locatedAt: new Date(t).toISOString(),
  };
}

const quiet = async <T>(p: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p();
  } catch {
    return fallback;
  }
};

/**
 * Reads where the salesman is for a visit (offline too: GPS needs no internet), and gets past what
 * left visits without a place (user, 2026-11-20):
 *  - permission not given yet: asks; refused for good: says so (the screen offers Settings);
 *  - location switched off: Android's own dialog to switch it on, then reads;
 *  - a recent fix (2 min, ±100 m) at once; else the GPS, up to 20 s; if that gives nothing (indoors),
 *    the phone's last known place, however old, rather than none (its own time and accuracy go with it).
 */
export async function readLocation(api: LocationApi, timeoutMs = GPS_TIMEOUT_MS): Promise<LocateResult> {
  let perm = await quiet(() => api.getPermission(), { granted: false, canAskAgain: true });
  if (!perm.granted && perm.canAskAgain) perm = await quiet(() => api.requestPermission(), perm);
  if (!perm.granted) return { kind: 'denied', canAskAgain: perm.canAskAgain };

  if (!(await quiet(() => api.servicesOn(), false))) {
    if (api.askToTurnOn) await quiet(() => api.askToTurnOn!(), undefined);
    if (!(await quiet(() => api.servicesOn(), false))) return { kind: 'off' };
  }

  const recent = fixOf(await quiet(() => api.lastKnown({ maxAge: RECENT_MS, requiredAccuracy: RECENT_ACCURACY_M }), null));
  if (recent) return { kind: 'fix', fix: recent };
  const now = fixOf(await quiet(() => withTimeout(api.current(), timeoutMs), null));
  if (now) return { kind: 'fix', fix: now };
  const last = fixOf(await quiet(() => api.lastKnown(), null));
  return last ? { kind: 'fix', fix: last } : { kind: 'failed' };
}
