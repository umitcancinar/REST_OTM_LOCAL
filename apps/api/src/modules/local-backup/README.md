# Local PostgreSQL backup runtime

Bu modül yalnız müşteri bilgisayarındaki `local` runtime içindir. PostgreSQL
custom-format yedeğini (`pg_dump -Fc`) ayrı bir dizine üretir. Destructive
restore/import endpoint'i içermez; yalnız güvenli restore-adayı doğrulama
çekirdeği sağlar.

## Güvenlik sınırları

- Yeni manifestler v2'dir. Dump, AES-256-GCM ile şifrelenir; yayımlanan dosya
  yalnız ciphertext'tir. IV, auth tag, `keyId`, plaintext boyutu ve ciphertext
  SHA-256 değeri manifestte tutulur. Kimlik alanları GCM AAD ile bağlanır.
- Üretim local profili supervisor'ın Windows DPAPI ile açıp yalnız prosese
  aktardığı canonical Base64 32-byte `LOCAL_BACKUP_KEY_BASE64` ve secret
  olmayan `LOCAL_BACKUP_KEY_ID` olmadan fail-fast durur. Base64 env alanı
  okunduktan sonra process ortamından silinir ve child process'lere aktarılmaz.
- `execFile` + sabit argüman dizisi kullanılır; shell çalıştırılmaz.
- Veritabanı parolası argv'ye konmaz, yalnız child-process ortamında
  `PGPASSWORD` olarak verilir ve hata/status cevaplarında gösterilmez.
- `dataDir` ile `backupDir` aynı veya iç içe olamaz. Backup kökü symlink
  olamaz ve `0700`, dosyalar `0600` izniyle oluşturulur.
- Plaintext yalnız OS temp altındaki rastgele `0700` çalışma dizisinde `0600`
  tutulur, ciphertext `.partial` dosyasına stream edilir ve plaintext her
  sonuçta silinir. Ciphertext fsync + SHA-256 sonrasında aynı dosya sistemi
  içinde atomik rename ile taşınır. Manifest en son yayınlanır.
- In-process bayrak ve dosya kilidi aynı anda yalnız tek `pg_dump` çalıştırır.
- İndirme öncesi saklanan dosyanın boyutu ve SHA-256 değeri yeniden doğrulanır.
- Manifest v1 plaintext yedekleri geriye dönük salt-okuma olarak listelenebilir,
  indirilebilir ve doğrulanabilir; runtime v1 üretmez ve retention v1'i silmez.
- Başarılı v2 ciphertext ve manifest, yapılandırılmış harici hedefe yeniden
  `.partial` + fsync + SHA-256 doğrulama + atomik rename ile kopyalanır.
  Plaintext harici hedefe hiçbir zaman çıkmaz. Replikasyon arızası lokal yedeği
  başarısız saymaz veya silmez; pending/error durumu lokal backup kökündeki
  atomik durum dosyasında kalır ve scheduler tekrar dener.
- Harici hedef `dataDir`/`backupDir` ile aynı, iç içe veya symlink olamaz.
  POSIX'te `stat.dev`, Windows'ta drive/UNC volume kökü karşılaştırılır.
  `warn` varsayılanında aynı/belirsiz volume yedeği engellemez fakat status'ta
  yüksek öncelikli `warningCode` ve `acceptanceRequired: true` üretir.
  Yönetilen çok-diskli kurulumlar `require-separate` ile fail-fast seçebilir.
- Harici retention varsayılan olarak 30 günlük, 12 haftalık ve 24 aylıktır;
  lokal retention'dan kısa yapılandırılamaz. Harici v1 dosyalara dokunulmaz.
- `verifyRestoreCandidate(id)` bütünlüğü doğrular, v2'yi rastgele `0700` temp
  dizisindeki `0600` dosyaya çözer ve shell/veritabanı bağlantısı olmadan
  `pg_restore --list <dosya>` çalıştırır. Temp dosya başarıda ve hatada silinir.
- Scheduler varsayılan haftalık non-destructive restore drill çalıştırır.
  Startup'ta `nextDueAt` geçmişse ilk bakım turunda en yeni lokal v2 yedeği,
  mevcutsa aynı external replica da decrypt + `pg_restore --list` ile sınanır.
  Backup ve drill aynı in-process bayrağı ve processler arası dosya kilidini
  paylaşır; eşzamanlı çalışmaz. Başarı/hata, `lastRestoreVerification`,
  `nextDueAt` ve alarm durumu atomik bakım-state dosyasında kalıcıdır.
- Drill başarısızlığı hiçbir yedeği silmez ve gerçek veritabanına bağlanmaz.
  Başarısız drill varsayılan 6 saat sonra yeniden denenir. External replica
  yok/çevrimdışıysa lokal başarı korunur ve warning üretilir; mevcut fakat
  bozuk external replica error alarmıdır.
- Lisans gate politikası açıkça `RECOVERY_MAINTENANCE_ALWAYS`dır: drill ve
  backup, lisans kilitliyken de veri kurtarma/süreklilik görevi olarak devam
  eder. HTTP restore/drill endpoint'i yoktur; recovery allowlist yüzeyi
  status/list/export/download ile sınırlı kalır.
- Günlük/haftalık/aylık retention her UTC zaman kovasında en yeni yedeği
  tutar. Varsayılanlar 7 günlük, 4 haftalık ve 12 aylıktır.

## Entegrasyon şablonu

`app.ts` ve `env.ts` bu bağımsız modül tarafından değiştirilmez. Local
bootstrap aşağıdaki eşdeğer bağlantıyı yapmalıdır:

```ts
import { authMiddleware } from './middlewares/auth.middleware';
import { rbac } from './middlewares/rbac.middleware';
import {
  createLocalBackupRouter,
  LOCAL_BACKUP_RECOVERY_RULES,
  LocalBackupRuntime,
  postgresConnectionFromUrl,
} from './modules/local-backup';

const backups = new LocalBackupRuntime({
  dataDir: env.LOCAL_POSTGRES_DATA_DIR,
  backupDir: env.LOCAL_BACKUP_DIR,
  externalBackupDir: env.LOCAL_BACKUP_EXTERNAL_DIR,
  externalVolumePolicy: env.LOCAL_BACKUP_EXTERNAL_VOLUME_POLICY,
  encryptionKey: env.LOCAL_BACKUP_KEY(),
  encryptionKeyId: env.LOCAL_BACKUP_KEY_ID,
  pgDumpPath: env.PG_DUMP_PATH,
  pgRestorePath: env.PG_RESTORE_PATH,
  connection: postgresConnectionFromUrl(env.DATABASE_URL),
  retention: {
    daily: env.BACKUP_RETENTION_DAILY,
    weekly: env.BACKUP_RETENTION_WEEKLY,
    monthly: env.BACKUP_RETENTION_MONTHLY,
  },
  externalRetention: {
    daily: env.BACKUP_EXTERNAL_RETENTION_DAILY,
    weekly: env.BACKUP_EXTERNAL_RETENTION_WEEKLY,
    monthly: env.BACKUP_EXTERNAL_RETENTION_MONTHLY,
  },
  restoreVerificationIntervalMs: env.BACKUP_RESTORE_VERIFICATION_INTERVAL_MS,
  restoreVerificationRetryMs: env.BACKUP_RESTORE_VERIFICATION_RETRY_MS,
});

await backups.initialize(); // listen'dan önce fail-fast
backups.startScheduler();

// Gate önce kuruluyorsa login/refresh/logout'un kesin metot+yol kuralları da
// recovery listesine eklenmeli; geniş bir /api/auth prefix'i açılmamalıdır.
app.use(createLocalLicenseGate(localLicenseRuntime, {
  additionalRecoveryRules: [
    ...LOCAL_BACKUP_RECOVERY_RULES,
    { path: '/api/auth/login', methods: ['POST'] },
    { path: '/api/auth/refresh', methods: ['POST'] },
    { path: '/api/auth/logout', methods: ['POST'] },
  ],
}));
app.use('/api/auth', authRoutes);
app.use('/api/backup', createLocalBackupRouter(backups, [
  authMiddleware,
  rbac('OWNER'),
]));
```

Kapanış akışında `backups.stopScheduler()` çağrılır. Scheduler servis açılır
açılmaz son başarılı yedeği kontrol eder; yapılandırılmış aralık dolmuşsa
kaçırılan günlük yedeği üretir.

Gerekli ayarlar: `LOCAL_POSTGRES_DATA_DIR`, `LOCAL_BACKUP_DIR`, üretim localde
zorunlu `LOCAL_BACKUP_EXTERNAL_DIR`, `LOCAL_BACKUP_EXTERNAL_VOLUME_POLICY`, mutlak
`PG_DUMP_PATH`, mutlak `PG_RESTORE_PATH`, `LOCAL_BACKUP_KEY_BASE64`,
`LOCAL_BACKUP_KEY_ID`, lokal ve harici retention sayılarıdır. Volume policy
varsayılanı `warn`dır; productionda `allow` kabul edilmez, `require-separate`
yönetilen kurulumlar için opt-in'dir. Anahtar `.env` dosyasına
yazılmaz; installer/supervisor DPAPI kaydını servis hesabı bağlamında açıp
child process ortamına enjekte eder. Üretim kurulumunda veri ile yedek
dizinlerinin farklı fiziksel disklerde seçilmesi önerilir.

Restore drill aralığı `BACKUP_RESTORE_VERIFICATION_INTERVAL_MS` ile ayarlanır;
production varsayılanı 7 gündür. Hata retry aralığı
`BACKUP_RESTORE_VERIFICATION_RETRY_MS` ile ayarlanır ve varsayılanı 6 saattir.

## Ucuncu katman: Backblaze B2

Uretim local profilinde bulut replikasyonu otomatik etkindir. Lokal motor ham
B2 anahtari bilmez. Aktif lisans anahtari ve donanim kimligiyle Control API'den
15 dakikalik, yalniz kendi restoran/lisans/cihaz object yoluna yazabilen iki
presigned URL alir. AES-256-GCM ciphertext ve manifest dogrudan B2'ye yuklenir;
Control API `HeadObject` ile boyut ve SHA-256 metadata'sini dogrulamadan islemi
basarili saymaz. Basarisiz yukleme kalici kuyrukta kalir ve scheduler yeniden
dener. Lokal retention, buluta henuz aktarilmamis yedegi silmez.

B2 sirlarinin yeri yalniz `rest-otm-control-api` Render environment alanidir:
`B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME`, `B2_BUCKET_ID`,
`B2_S3_ENDPOINT`, `B2_REGION`, `B2_KEY_PREFIX`. Bunlar Windows paketine,
`.env` dosyasina veya Git'e yazilmaz.
