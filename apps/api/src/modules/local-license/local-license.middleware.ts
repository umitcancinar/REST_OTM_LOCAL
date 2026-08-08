import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  LocalLicenseRuntime,
  OperationalLicenseError,
} from './local-license.runtime';

export interface RecoveryRouteRule {
  path: string;
  methods?: readonly string[];
  match?: 'exact' | 'prefix';
}

/**
 * Kilitli sistemde veri kaybini onleyecek cikislar acik kalir. Import, restore,
 * siparis ve ayar degisikligi bu listede bilerek yoktur.
 */
export const DEFAULT_LOCAL_LICENSE_RECOVERY_RULES: readonly RecoveryRouteRule[] = [
  { path: '/api/health', methods: ['GET', 'HEAD'] },
  { path: '/api/local-license/status', methods: ['GET', 'HEAD'] },
  { path: '/api/local-license/activate', methods: ['POST'] },
  { path: '/api/local-license/heartbeat', methods: ['POST'] },
  { path: '/api/local-license/retry', methods: ['POST'] },
  { path: '/api/backup/export', methods: ['GET', 'POST'] },
  { path: '/api/export', methods: ['GET', 'POST'] },
  { path: '/api/support', methods: ['GET', 'POST'], match: 'prefix' },
];

export interface LocalLicenseGateOptions {
  /** Varsayilan guvenli kurtarma yollarina eklenen uygulamaya ozel yollar. */
  additionalRecoveryRules?: readonly RecoveryRouteRule[];
  /** Nadir durumlarda varsayilan listeyi tamamen degistirmek icin. */
  recoveryRules?: readonly RecoveryRouteRule[];
}

function normalizedPath(path: string): string {
  const withoutQuery = path.split('?', 1)[0] || '/';
  const collapsed = withoutQuery.replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
}

export function isRecoveryRequest(
  method: string,
  path: string,
  rules: readonly RecoveryRouteRule[] = DEFAULT_LOCAL_LICENSE_RECOVERY_RULES,
): boolean {
  const requestMethod = method.toUpperCase();
  const requestPath = normalizedPath(path);

  return rules.some((rule) => {
    const methods = rule.methods?.map((item) => item.toUpperCase());
    if (methods && !methods.includes(requestMethod)) return false;

    const rulePath = normalizedPath(rule.path);
    if (rule.match !== 'prefix') return requestPath === rulePath;
    return requestPath === rulePath || requestPath.startsWith(`${rulePath}/`);
  });
}

export function createLocalLicenseGate(
  runtime: LocalLicenseRuntime,
  options: LocalLicenseGateOptions = {},
): RequestHandler {
  const rules = options.recoveryRules ?? [
    ...DEFAULT_LOCAL_LICENSE_RECOVERY_RULES,
    ...(options.additionalRecoveryRules ?? []),
  ];

  return (req: Request, res: Response, next: NextFunction): void => {
    if (isRecoveryRequest(req.method, req.originalUrl || req.path, rules)) {
      next();
      return;
    }

    try {
      runtime.assertOperationalLicense('request');
      next();
    } catch (error) {
      if (!(error instanceof OperationalLicenseError)) {
        next(error);
        return;
      }

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Rest-Otm-License-State', error.view.state);
      res.status(423).json({
        success: false,
        code: error.code,
        message: error.message,
        data: error.view,
        timestamp: new Date().toISOString(),
      });
    }
  };
}
