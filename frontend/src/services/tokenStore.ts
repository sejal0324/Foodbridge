/**
 * In-memory access token holder. The access token is NEVER persisted
 * (no localStorage/sessionStorage); a page reload restores the session through
 * the httpOnly refresh cookie (POST /api/auth/refresh).
 */
type Listener = (token: string | null) => void;

let accessToken: string | null = null;
const listeners = new Set<Listener>();

export const tokenStore = {
  get(): string | null {
    return accessToken;
  },
  set(token: string | null): void {
    if (token === accessToken) return;
    accessToken = token;
    for (const l of listeners) l(token);
  },
  clear(): void {
    tokenStore.set(null);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
