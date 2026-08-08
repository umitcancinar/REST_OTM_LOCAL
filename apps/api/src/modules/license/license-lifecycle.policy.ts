export type CloudLicenseStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

export function isActivationEligible(
  license: {
    status: CloudLicenseStatus;
    hardwareId: string | null;
    expiresAt: Date;
  },
  requestedHardwareId: string,
  now = new Date(),
): boolean {
  return (
    (license.status === 'PENDING' || license.status === 'ACTIVE') &&
    license.expiresAt >= now &&
    (license.hardwareId === null || license.hardwareId === requestedHardwareId)
  );
}

/** Suspend/revoke heartbeat alabilir; terminal entitlement imzalanıp lokale
 * iletilmelidir. PENDING ise önce atomik aktivasyon şarttır. */
export function isHeartbeatEligible(
  license: { status: CloudLicenseStatus; hardwareId: string | null },
  requestedHardwareId: string,
): boolean {
  return license.status !== 'PENDING' && license.hardwareId === requestedHardwareId;
}

export function assertSignableStatus(status: CloudLicenseStatus): void {
  if (status === 'PENDING') {
    throw Object.assign(new Error('Lisans aktivasyonu gerekli.'), { statusCode: 409 });
  }
}
