import type { AuthContext } from './auth.js';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id, echoed in the X-Request-Id response header and error bodies. */
      requestId: string;
      /** Present only after the authenticate middleware succeeded. */
      auth?: AuthContext;
    }
  }
}

export {};
