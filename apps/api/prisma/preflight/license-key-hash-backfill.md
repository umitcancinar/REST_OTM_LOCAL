# License key HMAC backfill

Bu geçiş bilinçli olarak iki release'tir. Pepper migration SQL'ine veya image'a
yazılmaz.

1. Cloud secret store'a `LICENSE_KEY_PEPPERS` ve
   `LICENSE_KEY_ACTIVE_PEPPER_VERSION` eklenir. Eski pepper'lar rotasyon
   tamamlanana kadar ring'de kalır. Bir pepper ancak aşağıdaki sorguda kendi
   sürümü için sıfır kayıt görüldükten sonra kaldırılır; eski hash yeni pepper
   ile geri döndürülemez, rotasyon activate/heartbeat sırasında gelen ham
   anahtarla yapılır.

   ```sql
   SELECT "keyPepperVersion", COUNT(*)
   FROM "licenses"
   WHERE "keyHash" IS NOT NULL
   GROUP BY "keyPepperVersion";
   ```
2. `20260809010000_harden_license_keys` expand migration'ı uygulanır. Yeni
   lisanslar yalnız `keyHash`, `keyPepperVersion`, `keyLast4` yazar.
3. Önce salt-okunur sayım çalıştırılır:

   ```sql
   SELECT COUNT(*) AS plaintext_remaining FROM "licenses" WHERE "key" IS NOT NULL;
   SELECT COUNT(*) AS hash_missing FROM "licenses" WHERE "keyHash" IS NULL;
   ```

4. Aynı cloud secret'larıyla kuru koşum, sonra kontrollü backfill yapılır:

   ```sh
   pnpm --filter @rest-otm/api license-keys:backfill
   pnpm --filter @rest-otm/api license-keys:backfill -- --apply
   ```

   Betik anahtarları loglamaz; aktif pepper ile HMAC-SHA-256 üretir ve başarılı
   satırda plaintext'i aynı transaction'da null yapar. Activate/heartbeat de
   geçiş süresince erişilen eski satırı aynı şekilde lazy-backfill eder.

5. `plaintext_remaining = 0`, `hash_missing = 0` ve tüm cloud instance'ları
   hash-okuyan release'e geçtiğinde fallback alanını koddan kaldıran ikinci
   release hazırlanır. Ancak bundan sonra contract migration'ı aşağıdaki
   preflight ile `key` kolonunu kaldırır:

   ```sql
   DO $$
   BEGIN
     IF EXISTS (
       SELECT 1 FROM "licenses"
       WHERE "key" IS NOT NULL OR "keyHash" IS NULL
          OR "keyPepperVersion" IS NULL OR "keyLast4" IS NULL
     ) THEN
       RAISE EXCEPTION 'license key HMAC backfill is incomplete';
     END IF;
   END $$;
   ALTER TABLE "licenses" DROP CONSTRAINT "licenses_key_material_check";
   DROP INDEX "licenses_key_key";
   ALTER TABLE "licenses" DROP COLUMN "key";
   ALTER TABLE "licenses"
     ALTER COLUMN "keyHash" SET NOT NULL,
     ALTER COLUMN "keyPepperVersion" SET NOT NULL,
     ALTER COLUMN "keyLast4" SET NOT NULL;
   ```

Bu sıra, plaintext'i körlemesine drop edip aktif kurulumları kilitlemez ve DB
salt-okunur sızıntısının yeni oluşturulan anahtarları vermesini hemen engeller.
