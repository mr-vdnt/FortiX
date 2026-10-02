import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';

export type FeatureEntitlement =
  | 'ADVANCED_EXPERIMENTS'
  | 'POLICY_VERIFICATION'
  | 'ADVANCED_ANALYTICS'
  | 'TOPOLOGY'
  | 'EXPORT_REPORTS'
  | 'REALTIME_TELEMETRY'
  | 'ADVANCED_SECURITY'
  | 'EXPERIMENT_SCHEDULING'
  | 'API_KEY_MANAGEMENT'
  | 'ADVANCED_RATE_LIMITING';

export const requireEntitlement = (entitlement: FeatureEntitlement) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.user.role === 'ADMIN') {
      return next();
    }

    // In the future, check subscription plans here for normal users.
    // Right now, DEVELOPERs do not have Pro entitlements.
    return res.status(403).json({ 
      error: 'Entitlement required', 
      message: `Your current plan does not include access to ${entitlement}.` 
    });
  };
};
