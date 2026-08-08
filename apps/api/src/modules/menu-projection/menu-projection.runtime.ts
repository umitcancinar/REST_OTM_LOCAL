import { randomUUID } from 'crypto';
import { Prisma, type MenuProjectionOutbox } from '@prisma/client';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { MENU_PUBLICATION_MAX_BYTES } from '../publication-contract/menu-publication.contract';
import {
  enqueueMenuProjection,
  registerMenuProjectionKick,
} from './menu-projection.service';

const POLL_MS = 5_000;
const LEASE_MS = 30_000;

type ClaimedProjection = MenuProjectionOutbox & { leaseToken: string };

export interface MenuProjectionCredentials {
  licenseKey: string;
  hardwareId: string;
}

export interface MenuProjectionRuntimeOptions {
  endpoint: string;
  credentials(): MenuProjectionCredentials;
  fetch?: typeof fetch;
  workerId?: string;
  now?: () => Date;
  random?: () => number;
  allowLoopbackHttp?: boolean;
}

export function assertOutboundPublicationEndpoint(
  endpoint: string,
  allowLoopbackHttp = false,
): URL {
  const url = new URL(endpoint);
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(allowLoopbackHttp && url.protocol === 'http:' && loopback))
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error('Menu sync endpoint yalnız credentials/query/hash içermeyen HTTPS URL olabilir');
  }
  return url;
}

export function menuProjectionRetryDelay(attempt: number, random = Math.random): number {
  const base = Math.min(15 * 60_000, 5_000 * 2 ** Math.min(10, Math.max(0, attempt - 1)));
  return base + Math.floor(base * 0.25 * Math.max(0, Math.min(0.999999, random())));
}

export class MenuProjectionRuntime {
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;
  private readonly workerId: string;
  private readonly now: () => Date;
  private readonly random: () => number;
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(private readonly options: MenuProjectionRuntimeOptions) {
    this.endpoint = assertOutboundPublicationEndpoint(
      options.endpoint,
      options.allowLoopbackHttp,
    ).toString();
    this.fetcher = options.fetch ?? fetch;
    this.workerId = options.workerId ?? `menu-projection-${randomUUID()}`;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
  }

  start(): void {
    if (this.timer) return;
    registerMenuProjectionKick(() => this.kick());
    this.timer = setInterval(() => this.kick(), POLL_MS);
    this.timer.unref?.();
    this.kick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    registerMenuProjectionKick(undefined);
  }

  kick(): void {
    if (!this.ticking) void this.tick();
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      // Reads the signed license from disk on every job pass; no cached grant.
      const credentials = this.options.credentials();
      await this.ensureInitialProjection();
      await this.markExhaustedDead();
      for (let index = 0; index < 5; index += 1) {
        const job = await this.claimNext();
        if (!job) break;
        await this.push(job, credentials);
      }
    } catch (error) {
      logger.warn(`Menu projection sync ertelendi: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.ticking = false;
    }
  }

  private async ensureInitialProjection(): Promise<void> {
    const tenants = await prisma.tenant.findMany({
      where: { isActive: true, menuProjectionSequence: null },
      select: { id: true },
      take: 10,
    });
    for (const tenant of tenants) {
      try {
        await prisma.$transaction((tx) => enqueueMenuProjection(tx, tenant.id));
      } catch (error) {
        // Concurrent startup/mutation can win the sequence insert; the next tick observes it.
        if ((error as { code?: string }).code !== 'P2002') throw error;
      }
    }
  }

  private async claimNext(): Promise<ClaimedProjection | null> {
    const now = this.now();
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const rows = await prisma.$queryRaw<ClaimedProjection[]>(Prisma.sql`
      WITH candidate AS (
        SELECT "id"
        FROM "menu_projection_outbox"
        WHERE "attempts" < "maxAttempts"
          AND (
            ("status" IN ('PENDING', 'RETRY') AND "nextAttemptAt" <= ${now})
            OR ("status" = 'LEASED' AND "leaseExpiresAt" <= ${now})
          )
        ORDER BY "version", "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "menu_projection_outbox" AS job
      SET "status" = 'LEASED',
          "attempts" = job."attempts" + 1,
          "leaseOwner" = ${this.workerId},
          "leaseToken" = ${leaseToken},
          "leaseExpiresAt" = ${leaseExpiresAt},
          "updatedAt" = ${now}
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING job.*
    `);
    return rows[0] ?? null;
  }

  private async push(job: ClaimedProjection, credentials: MenuProjectionCredentials): Promise<void> {
    const body = JSON.stringify({
      version: job.version,
      checksum: job.checksum,
      payload: job.payload,
    });
    if (Buffer.byteLength(body) > MENU_PUBLICATION_MAX_BYTES) {
      await this.dead(job, 'Publication body exceeds 512 KiB');
      return;
    }
    try {
      const response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-resto-license-key': credentials.licenseKey,
          'x-resto-hardware-id': credentials.hardwareId,
          'idempotency-key': `menu-v${job.version}-${job.checksum}`,
        },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        const result = await response.json() as { data?: { version?: number; checksum?: string } };
        if (result.data?.version !== job.version || result.data?.checksum !== job.checksum) {
          throw new Error('Cloud ACK version/checksum mismatch');
        }
        const changed = await prisma.menuProjectionOutbox.updateMany({
          where: { id: job.id, status: 'LEASED', leaseToken: job.leaseToken },
          data: {
            status: 'ACKED',
            acknowledgedAt: this.now(),
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
            lastError: null,
          },
        });
        if (changed.count !== 1) logger.warn(`Stale menu projection ACK ignored: ${job.id}`);
        return;
      }
      const error = `Cloud publication rejected with HTTP ${response.status}`;
      if ([400, 409, 413, 422].includes(response.status)) await this.dead(job, error);
      else await this.retry(job, error);
    } catch (error) {
      await this.retry(job, error instanceof Error ? error.message : String(error));
    }
  }

  private async retry(job: ClaimedProjection, error: string): Promise<void> {
    if (job.attempts >= job.maxAttempts) return this.dead(job, error);
    await prisma.menuProjectionOutbox.updateMany({
      where: { id: job.id, status: 'LEASED', leaseToken: job.leaseToken },
      data: {
        status: 'RETRY',
        nextAttemptAt: new Date(this.now().getTime() + menuProjectionRetryDelay(job.attempts, this.random)),
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: error.slice(0, 1000),
      },
    });
  }

  private async dead(job: ClaimedProjection, error: string): Promise<void> {
    await prisma.menuProjectionOutbox.updateMany({
      where: { id: job.id, status: 'LEASED', leaseToken: job.leaseToken },
      data: {
        status: 'DEAD',
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: error.slice(0, 1000),
      },
    });
  }

  private async markExhaustedDead(): Promise<void> {
    const now = this.now();
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "menu_projection_outbox"
      SET "status" = 'DEAD',
          "leaseOwner" = NULL,
          "leaseToken" = NULL,
          "leaseExpiresAt" = NULL,
          "lastError" = 'Maximum menu projection attempts exhausted',
          "updatedAt" = ${now}
      WHERE "status" IN ('PENDING', 'RETRY', 'LEASED')
        AND "attempts" >= "maxAttempts"
    `);
  }
}
