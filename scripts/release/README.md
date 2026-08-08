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
node scripts/release/assemble-windows-payload.mjs --version 1.0.0 --out build/windows-payload/1.0.0
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
3. Menu ve superadmin cloud deploy closure'lari kendi yayin hattinda ayrica
   tamamlanmali; Windows local payload bunlari bilerek almaz.

## Windows local payload assembler

`assemble-windows-payload.mjs`, audited `build/stage/local` API closure'ini,
admin/waiter Next standalone + static + public dosyalarini, gateway/print-agent
dist'lerini ve print-agent icin `receipt-core` runtime'ini tek yeni payload
dizininde toplar. Uygulama kaynaklarini rebuild veya redesign etmez. Exact
runtime girisleri su yollarda kalir:

```text
bin/restotm-runtime-service.exe
bin/restotm-installer-bootstrap.exe
postgres/bin/postgres.exe
postgres/bin/pg_dump.exe
api/restotm-api.exe                 api/runtime/...
admin/restotm-admin.exe             admin/runtime/...
waiter/restotm-waiter.exe           waiter/runtime/...
print-agent/restotm-print-agent.exe print-agent/dist/... + receipt-core
gateway/restotm-lan-gateway.exe     gateway/dist/...
config/license-public-key.pem
installer-contract.json
artifact-manifest.json
```

Varsayilan future/native girdiler `build/windows-input` altindaki ayni canonical
yollardan okunur. Her yol CLI flag'iyle degistirilebilir; tam liste icin betigi
argumansiz calistir. Hedef dizin daha once var olmamalidir; assembler bir
temporary sibling dizinde calisir ve ancak tum kontroller gecince atomik olarak
hedefe tasir.

Production modu su kosullardan biri eksikse hic payload uretmez:

- API closure local audit'ten gecmis, workspace dependency'leri pruned ve tum
  NPM/Prisma runtime closure'i bundled olarak isaretlenmis olmali;
- installer contract exact child role/path sirasi ile
  `native_bootstrap.production_ready=true` tasimali;
- native host/bootstrap, PostgreSQL, pg_dump ve bes uygulama launcher'i gercek
  Windows PE olmali;
- payload'a girecek **tum** PE/MZ dosyalarinin (`.exe/.dll/.node` dahil)
  Authenticode durumu Windows build makinesinde `Valid` olmali;
- lisans anahtari parse edilebilen Ed25519 public key olmali; private key, baska
  `.pem/.key/.pfx/.p12/.jks` kabul edilmez;
- symlink/special file, path traversal veya case-insensitive path collision;
  `.ts/.tsx/.map`, `.env*`, `.git`, test/fixture/coverage ve source-map marker
  bulunmamali.

Manifest relative path'e gore sirali, timestamp icermeyen ve her staged dosya
icin lowercase SHA-256 + role + Authenticode gereksinimi tasiyan deterministic
JSON'dir. Canonical required role/path sapmasi installer preflight tarafinda da
ayrica reddedilir.

`--fixture` sadece test girdileri icindir: contract kesinlikle
`production_ready=false` olmali ve manifest `fixture:true` olur. Bu mod
Authenticode kabul kriteri degildir; fixture payload'i production installer
olamaz.

Bugunku repoda audited API closure `npmDependenciesBundled:false`, native
Windows artifact'leri/PostgreSQL/public key yok ve mevcut print/receipt derleme
ciktilarinda source map bulunuyor. Dolayisiyla production komutunun su an
fail-closed durmasi beklenen davranistir; gercek installer hazir oldugu iddia
edilmez.

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
