/**
 * Crash and Error Reporting abstraction
 * Opt-in by default per BUILD_PLAN.md §6 P13 & Cross-cutting requirements (Privacy).
 */

const STORAGE_KEY = 'folio_crash_reporting';
const CRASH_LOGS_KEY = 'folio_recent_crashes';
const MAX_LOCAL_CRASH_LOGS = 10;

export interface CrashReport {
  id: string;
  timestamp: number;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  userAgent: string;
}

/**
 * Redacts potential sensitive data like bearer tokens, auth headers, passwords.
 */
export function sanitizeContext(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(sanitizeContext);

  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('token') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('password') ||
      lowerKey.includes('auth') ||
      lowerKey.includes('cookie')
    ) {
      clean[key] = '[REDACTED]';
    } else if (typeof val === 'string' && /bearer\s+[a-zA-Z0-9_\-.]+/i.test(val)) {
      clean[key] = val.replace(/bearer\s+[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]');
    } else if (typeof val === 'object' && val !== null) {
      clean[key] = sanitizeContext(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

export function isCrashReportingEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setCrashReportingEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage errors
  }
}

export function getRecentCrashReports(): CrashReport[] {
  try {
    const raw = localStorage.getItem(CRASH_LOGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearCrashReports(): void {
  try {
    localStorage.removeItem(CRASH_LOGS_KEY);
  } catch {
    // Ignore
  }
}

export function reportCrash(error: unknown, context?: Record<string, unknown>): CrashReport | null {
  const err = error instanceof Error ? error : new Error(String(error));
  const cleanContext = (context ? sanitizeContext(context) : {}) as Record<string, unknown>;

  const report: CrashReport = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    timestamp: Date.now(),
    message: err.message,
    stack: err.stack,
    context: cleanContext,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
  };

  // Always buffer in memory / local diagnostic storage (capped)
  try {
    const existing = getRecentCrashReports();
    const updated = [report, ...existing].slice(0, MAX_LOCAL_CRASH_LOGS);
    localStorage.setItem(CRASH_LOGS_KEY, JSON.stringify(updated));
  } catch {
    // Local storage quota or unavailable
  }

  if (isCrashReportingEnabled()) {
    console.info('[CrashReporter: Telemetry Dispatched]', {
      id: report.id,
      message: report.message,
    });
    return report;
  }

  return null;
}
