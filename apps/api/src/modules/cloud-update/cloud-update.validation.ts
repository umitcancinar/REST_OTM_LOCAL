import { z } from 'zod';
import {
  updateArtifactSchema,
  updateMigrationSchema,
} from '../local-update/local-update.contract';

const versionSchema = z.string().regex(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
);
const channelSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const canonicalDateSchema = z.string().refine((value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}, 'canonical ISO-8601 gerekli');

export const createCloudUpdateReleaseSchema = z.object({
  version: versionSchema,
  channel: channelSchema,
  minCurrentVersion: versionSchema,
  maxCurrentVersion: versionSchema,
  issuedAt: canonicalDateSchema,
  expiresAt: canonicalDateSchema,
  migration: updateMigrationSchema,
  artifacts: z.array(updateArtifactSchema).min(1).max(64),
}).strict();

export const cloudUpdateReleaseIdSchema = z.object({
  id: z.string().cuid(),
}).strict();

export const revokeCloudUpdateReleaseSchema = z.object({
  reason: z.string().trim().min(3).max(500),
}).strict();

export const listCloudUpdateReleasesSchema = z.object({
  channel: channelSchema.optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'REVOKED']).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const updateManifestRequestSchema = z.object({
  currentVersion: versionSchema,
  channel: channelSchema,
}).strict();

export type CreateCloudUpdateReleaseInput = z.infer<typeof createCloudUpdateReleaseSchema>;
export type ListCloudUpdateReleasesInput = z.infer<typeof listCloudUpdateReleasesSchema>;
