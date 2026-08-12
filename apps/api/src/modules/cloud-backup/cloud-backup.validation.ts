import { z } from 'zod';

const hardwareId = z.string().regex(/^[a-f0-9]{64}$/i, 'Geçersiz cihaz kimliği');
const backupId = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, 'Geçersiz SHA-256');
const fileName = z.string().regex(
  /^restotm-\d{8}T\d{9}Z-[0-9a-f-]{36}\.dump\.enc$/i,
  'Geçersiz yedek dosyası adı',
);

const common = {
  licenseKey: z.string().min(8).max(64),
  hardwareId,
  backupId,
  fileName,
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024 * 1024),
  cipherSha256: sha256,
  manifestSizeBytes: z.number().int().positive().max(64 * 1024),
  manifestSha256: sha256,
};

const descriptor = z.object(common).strict().superRefine((value, context) => {
  if (!value.fileName.toLowerCase().includes(value.backupId.toLowerCase())) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fileName'],
      message: 'Yedek kimliği ile dosya adı eşleşmiyor',
    });
  }
});

export const cloudBackupPresignSchema = descriptor;
export const cloudBackupCompleteSchema = descriptor;

export type CloudBackupPresignBody = z.infer<typeof cloudBackupPresignSchema>;
export type CloudBackupCompleteBody = z.infer<typeof cloudBackupCompleteSchema>;
