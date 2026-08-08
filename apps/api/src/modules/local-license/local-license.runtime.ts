import {
  activate as activateStoredLicense,
  checkLocalLicense,
  heartbeat as sendLicenseHeartbeat,
  statusMessage,
  type ActivationResult,
  type ClientConfig,
  type LicenseEntitlement,
  type LicenseStatus,
} from '@rest-otm/license';

export type OperationalLicenseStatus = Extract<LicenseStatus, { state: 'valid' }>;
export type LocalLicenseCheckReason =
  | 'startup'
  | 'request'
  | 'status'
  | 'activation'
  | 'heartbeat'
  | 'scheduled-heartbeat'
  | 'job'
  | 'websocket';

export interface LocalLicenseRuntimeConfig extends ClientConfig {
  /** LOCAL olmayan dagitimlarda bu modulu olusturmak bir yapilandirma hatasidir. */
  runtimeMode: 'local';
  /** Basarili yoklamalar arasindaki sure. Varsayilan: 1 saat. */
  heartbeatIntervalMs?: number;
  /** Kilitli durumda buluttan yenilenmis lisansi tekrar isteme suresi. */
  retryIntervalMs?: number;
}

export interface LocalLicenseStatusView {
  state: LicenseStatus['state'];
  operational: boolean;
  activationRequired: boolean;
  entitlement?: LicenseEntitlement;
  message: string;
  restaurantName?: string;
  expiresAt?: string;
  daysLeft?: number;
  lastCheckedAt: string;
  nextHeartbeatAt?: string;
}

export interface LocalLicenseStatusEvent {
  previous: LicenseStatus;
  current: LicenseStatus;
  view: LocalLicenseStatusView;
  reason: LocalLicenseCheckReason;
  occurredAt: string;
}

export type LocalLicenseStatusListener = (event: LocalLicenseStatusEvent) => void;

export interface LocalLicenseClientAdapter {
  checkLocalLicense(config: ClientConfig): LicenseStatus;
  activate(config: ClientConfig, licenseKey: string): Promise<ActivationResult>;
  heartbeat(config: ClientConfig): Promise<LicenseStatus>;
  statusMessage(status: LicenseStatus): string;
}

const defaultClient: LocalLicenseClientAdapter = {
  checkLocalLicense,
  activate: activateStoredLicense,
  heartbeat: sendLicenseHeartbeat,
  statusMessage,
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_RETRY_INTERVAL_MS = 5 * 60 * 1000;

function sanitizeInterval(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value < 1_000) return fallback;
  return Math.floor(value);
}

function statusFingerprint(status: LicenseStatus): string {
  if ('license' in status) {
    return [
      status.state,
      status.license.entitlement,
      status.license.issuedAt,
      status.license.expiresAt,
      status.license.offlineUntil,
    ].join('|');
  }
  if (status.state === 'hardware_mismatch') return status.state;
  if (status.state === 'malformed') return `${status.state}|${status.reason}`;
  if (status.state === 'unsupported_version') return `${status.state}|${status.version}`;
  if (status.state === 'clock_tampered') {
    return `${status.state}|${status.lastKnown.toISOString()}|${status.current.toISOString()}`;
  }
  return status.state;
}

/**
 * Lokal API'nin tek lisans karar noktasi.
 *
 * Bellekteki durum arayuz ve olay dagitimi icindir. Yetkilendirme karari
 * bellekteki kopyaya guvenmez: assertOperationalLicense her cagrida imzali
 * dosyayi yeniden okur ve @rest-otm/license ile tekrar dogrular.
 */
export class LocalLicenseRuntime {
  private readonly heartbeatIntervalMs: number;
  private readonly retryIntervalMs: number;
  private readonly listeners = new Set<LocalLicenseStatusListener>();
  private currentStatus: LicenseStatus;
  private checkedAt = new Date(0);
  private nextHeartbeatAt?: Date;
  private timer?: ReturnType<typeof setTimeout>;
  private started = false;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: LocalLicenseRuntimeConfig,
    private readonly client: LocalLicenseClientAdapter = defaultClient,
  ) {
    if (config.runtimeMode !== 'local') {
      throw new Error('LocalLicenseRuntime yalnizca runtimeMode=local ile kullanilabilir.');
    }
    if (!config.publicKeyPem.trim()) {
      throw new Error('Lokal lisans acik anahtari tanimli degil.');
    }
    if (!config.serverUrl.trim()) {
      throw new Error('Lisans sunucusu adresi tanimli degil.');
    }

    this.heartbeatIntervalMs = sanitizeInterval(
      config.heartbeatIntervalMs,
      DEFAULT_HEARTBEAT_INTERVAL_MS,
    );
    this.retryIntervalMs = sanitizeInterval(config.retryIntervalMs, DEFAULT_RETRY_INTERVAL_MS);
    this.currentStatus = this.safeLocalCheck();
    this.checkedAt = new Date();
  }

  /** Sunucu acilisinda cagrilir; ilk yoklamayi beklemeden lokal karar hazirdir. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.checkNow('startup');
    void this.runScheduledHeartbeat('heartbeat');
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.nextHeartbeatAt = undefined;
  }

  /** Status endpoint'i de diskteki imzali kaydi yeniden dogrular. */
  getStatusView(revalidate = true): LocalLicenseStatusView {
    if (revalidate) this.checkNow('status');
    return this.toStatusView(this.currentStatus);
  }

  getStatus(): LicenseStatus {
    return this.currentStatus;
  }

  checkNow(reason: LocalLicenseCheckReason = 'request'): LicenseStatus {
    const status = this.safeLocalCheck();
    this.setStatus(status, reason);
    return status;
  }

  /** REST, WebSocket ve arka plan isleri ayni fail-closed guard'i kullanir. */
  assertOperationalLicense(
    reason: LocalLicenseCheckReason = 'request',
  ): OperationalLicenseStatus {
    const status = this.checkNow(reason);
    if (status.state !== 'valid') {
      throw new OperationalLicenseError(this.toStatusView(status), status);
    }
    return status;
  }

  async activate(licenseKey: string): Promise<{
    result: ActivationResult;
    status: LocalLicenseStatusView;
  }> {
    const normalizedKey = licenseKey.trim().toUpperCase();
    let result = await this.enqueue(() => this.client.activate(this.config, normalizedKey));

    // Yalnizca diskte dogrulanabilen lisansi operasyonel kabul et. Ag cevabinda
    // status=valid gelmesi tek basina yeterli degildir.
    const persistedStatus = this.checkNow('activation');
    if (result.ok && persistedStatus.state !== 'valid') {
      result = {
        ok: false,
        message: 'Etkinlestirme yaniti kalici lisans dosyasindan dogrulanamadi.',
        status: persistedStatus,
      };
    }
    return { result, status: this.toStatusView(this.currentStatus) };
  }

  async heartbeat(reason: LocalLicenseCheckReason = 'heartbeat'): Promise<LocalLicenseStatusView> {
    try {
      await this.enqueue(() => this.client.heartbeat(this.config));
      // Paket sonucu dogrulanmis olsa da, kalici dosyanin gercekten okunabildigini
      // kontrol ederek bellek ve disk arasindaki yarim yazma riskini kapat.
      const persistedStatus = this.safeLocalCheck();
      this.setStatus(persistedStatus, reason);
    } catch {
      // Internet kesintisi lisansi aninda dusurmez. Diskteki imzali offlineUntil
      // karari gecerlidir; beklenmeyen istemci hatasinda da fail-closed olur.
      this.checkNow(reason);
    }
    return this.toStatusView(this.currentStatus);
  }

  subscribe(listener: LocalLicenseStatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private safeLocalCheck(): LicenseStatus {
    try {
      return this.client.checkLocalLicense(this.config);
    } catch {
      return { state: 'malformed', reason: 'Lisans durumu dogrulanamadi' };
    }
  }

  private setStatus(status: LicenseStatus, reason: LocalLicenseCheckReason): void {
    const previous = this.currentStatus;
    this.currentStatus = status;
    this.checkedAt = new Date();

    if (statusFingerprint(previous) === statusFingerprint(status)) return;
    const event: LocalLicenseStatusEvent = {
      previous,
      current: status,
      view: this.toStatusView(status),
      reason,
      occurredAt: this.checkedAt.toISOString(),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Bir UI/logger dinleyicisi lisans karar dongusunu bozamaz.
      }
    }
  }

  private toStatusView(status: LicenseStatus): LocalLicenseStatusView {
    const license = 'license' in status ? status.license : undefined;
    return {
      state: status.state,
      operational: status.state === 'valid',
      activationRequired: status.state !== 'valid',
      message: this.client.statusMessage(status),
      ...(license && { entitlement: license.entitlement }),
      ...(license && { restaurantName: license.restaurantName, expiresAt: license.expiresAt }),
      ...(status.state === 'valid' && { daysLeft: status.daysLeft }),
      lastCheckedAt: this.checkedAt.toISOString(),
      ...(this.nextHeartbeatAt && { nextHeartbeatAt: this.nextHeartbeatAt.toISOString() }),
    };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async runScheduledHeartbeat(reason: LocalLicenseCheckReason): Promise<void> {
    await this.heartbeat(reason);
    if (!this.started) return;

    const delay = this.currentStatus.state === 'valid'
      ? this.heartbeatIntervalMs
      : this.retryIntervalMs;
    this.nextHeartbeatAt = new Date(Date.now() + delay);
    this.timer = setTimeout(() => void this.runScheduledHeartbeat('scheduled-heartbeat'), delay);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }
}

export class OperationalLicenseError extends Error {
  readonly name = 'OperationalLicenseError';
  readonly code = 'LOCAL_LICENSE_LOCKED';
  readonly statusCode = 423;

  constructor(
    readonly view: LocalLicenseStatusView,
    readonly licenseStatus: LicenseStatus,
  ) {
    super(view.message);
  }
}

/** Is/WS modullerinin sinif metoduna baglanmadan kullanabilecegi guard. */
export function assertOperationalLicense(
  runtime: LocalLicenseRuntime,
  reason: LocalLicenseCheckReason = 'job',
): OperationalLicenseStatus {
  return runtime.assertOperationalLicense(reason);
}
