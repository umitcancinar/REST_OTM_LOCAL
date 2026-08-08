# Release artifact siniri

Bu dizindeki denetim, cloud ve local paketlerin yalniz calisma zamani
dosyalarini icerdigini ve birbirinin guven sinirini gecmedigini **fail-closed**
olarak kontrol eder. Bir dosyanin rotasi allowlist'te degilse paket reddedilir.
Symlink, kaynak kodu, source map, test/fixture, `.env`, `.git` ve gomulu private
key iki profilde de reddedilir. Ayrica derlenmis JavaScript icerigi yasak
import/env/PEM izleri icin taranir.

## Kanonik staging yerlesimi

Local artifact kokunde yalniz su dizinler bulunabilir:

```text
api/            # api/local.js ve local API bundle
admin/          # Next standalone/bundle
waiter/         # Next standalone/bundle
print-agent/    # native veya bundle edilmis agent
runtime/        # supervisor/gateway/native dosyalar
database/       # PostgreSQL runtime; isletme verisi degil
migrations/     # SQL migration'lari
assets/ config/ metadata/
```

Cloud artifact kokunde yalniz `api/`, `superadmin/`, `menu/` ve ortak runtime
dizinleri bulunabilir. Giris noktasi `api/cloud.js` olmak zorundadir. Lokal
pakette `api/local.js` zorunludur.

Kokte yalniz `manifest.json`, `checksums.json`, `version.json`, `license.txt`
ve `readme.txt` kabul edilir. Kucuk harf/buyuk harf farki denetimi etkilemez.

## Calistirma

```bash
node scripts/release/audit-artifact.mjs --profile local --root build/stage/local
node scripts/release/audit-artifact.mjs --profile cloud --root build/stage/cloud
node scripts/release/stage-api-artifacts.mjs --profile all
node --test scripts/release/*.test.mjs
```

Makine tarafindan okunabilir rapor icin `--json` eklenebilir. Temiz artifact
`0`, politika ihlali `1`, kullanim/dosya sistemi hatasi `2` cikis kodu verir.

## Uygulanan API fiziksel split

`cloud.ts` ve `local.ts` artik ortak `app.ts` dosyasini import etmez. Ortak HTTP
bootstrap'i yan etkisiz bir factory'dir; profile registrar'lari ayridir.
`app.ts` yalniz gelistirmedeki `all` profili icindir. Konfigurasyon da
`env.shared.ts`, `env.cloud.ts` ve `env.local.ts` olarak fiziksel ayrilmistir.

`stage-api-artifacts.mjs`, secilen derlenmis entrypoint'ten baslayarak statik
CommonJS dependency closure'ini cikarir. Tum `dist/` yerine yalniz ulasilabilen
dosyalari kopyalar. Workspace paketlerinde de export-bazli closure uygular:
local artifact `@rest-otm/license` verify/client tarafini alirken `sign.js`
almaz; cloud artifact yalniz `@rest-otm/license/sign` closure'ini alir.
Dinamik/cozulemeyen `require()` fail-closed reddedilir. Staging tamamlanmadan
once artifact audit otomatik calisir ve gecmezse hedef dizin degistirilmez.

Kalan production paketleme adimlari:

1. NPM externals'i Node SEA/native executable veya production-only dependency
   closure ile paketle. Bugunku minimal API artifact manifesti bunlari acikca
   `npmDependenciesBundled: false` olarak isaretler; tek basina installer
   degildir.
2. Prisma engine/migration'larini profile gore acikca ekle ve Windows hedefinde
   smoke test calistir.
3. Next standalone ciktilari kanonik `admin/`, `waiter/`, `menu/` ve
   `superadmin/` staging dizinlerine normalize edilmeli; `.next` cache ve map
   dosyalari kopyalanmamali.
4. Staging bittikten sonra SHA-256 checksum manifesti ve
   Authenticode/imzali update manifesti calismali. Denetim gecmeden imza ve
   yayin adimi baslamamali.

Root script onerisi (ortak `package.json` sahipligi nedeniyle burada otomatik
eklenmedi):

```json
{
  "release:audit:local": "node scripts/release/audit-artifact.mjs --profile local --root build/stage/local",
  "release:audit:cloud": "node scripts/release/audit-artifact.mjs --profile cloud --root build/stage/cloud",
  "release:stage:api": "node scripts/release/stage-api-artifacts.mjs --profile all",
  "test:release": "node --test scripts/release/*.test.mjs"
}
```
