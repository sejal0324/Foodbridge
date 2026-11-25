import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthService } from '../services/auth.service.js';
import type { Role } from '../types/auth.js';
import { forbidden, unauthorized } from '../utils/errors.js';

/** Requires a valid Bearer access token; identity and role come from the database, never the client. */
export function authenticate(auth: AuthService): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.header('authorization');
    if (!header || !/^Bearer\s+\S+$/i.test(header)) throw unauthorized();
    req.auth = await auth.authenticate(header.replace(/^Bearer\s+/i, ''));
    next();
  };
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw unauthorized();
    if (!roles.includes(req.auth.role)) throw forbidden();
    next();
  };
}

/** Donor whose organisation has been approved by an admin. */
export const requireApprovedDonor: RequestHandler = (req, _res, next) => {
  const a = req.auth;
  if (!a) throw unauthorized();
  if (a.role !== 'DONOR' || !a.donorId) throw forbidden('Only donor accounts can do this.');
  if (a.donorStatus !== 'APPROVED') {
    throw forbidden('Your organisation must be verified by FoodBridge before you can do this.', 'ORGANISATION_NOT_APPROVED');
  }
  next();
};

/** Owner of an approved NGO (representatives cannot manage NGO-level resources). */
export const requireApprovedNgo: RequestHandler = (req, _res, next) => {
  const a = req.auth;
  if (!a) throw unauthorized();
  if (a.role !== 'NGO' || !a.ngoId) throw forbidden('Only NGO accounts can do this.');
  if (a.ngoStatus !== 'APPROVED') {
    throw forbidden('Your organisation must be verified by FoodBridge before you can do this.', 'ORGANISATION_NOT_APPROVED');
  }
  next();
};

/** NGO owner or an active representative. Fine-grained checks happen in services. */
export const requireNgoMember: RequestHandler = (req, _res, next) => {
  const a = req.auth;
  if (!a) throw unauthorized();
  if (a.role !== 'NGO' || (!a.ngoId && !(a.representativeId && a.representativeActive))) {
    throw forbidden('Only NGO members can do this.');
  }
  next();
};

export const requireAdmin = requireRole('ADMIN');
