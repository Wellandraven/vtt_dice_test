export const SESSION_INACTIVITY_MS = 15 * 60 * 1000;

export function isSessionInactive(lastActivityAt: number, now = Date.now()): boolean {
  return now - lastActivityAt >= SESSION_INACTIVITY_MS;
}
