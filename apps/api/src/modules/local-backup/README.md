# Local PostgreSQL backup runtime

Bu modül yalnız müşteri bilgisayarındaki `local` runtime içindir. PostgreSQL
custom-format yedeğini (`pg_dump -Fc`) ayrı bir dizine üretir; restore/import
işlemi içermez.

## Güvenlik sınırları

- `execFile` + sabit argüman dizisi kullanılır; shell çalıştırılmaz.
- Veritabanı parolası argv'ye konmaz, yalnız child-process ortamında
  `PGPASSWORD` olarak verilir ve hata/status cevaplarında gösterilmez.
- `dataDir` ile `backupDir` aynı veya iç içe olamaz. Backup kökü symlink
  olamaz ve `0700`, dosyalar `0600` izniyle oluşturulur.
- Yedek önce `.partial` dosyasına yazılır, fsync + SHA-256 sonrasında aynı
  dosya sistemi içinde atomik rename yapılır. Manifest en son yayınlanır.
- In-process bayrak ve dosya kilidi aynı anda yalnız tek `pg_dump` çalıştırır.
- İndirme öncesi boyut ve SHA-256 yeniden doğrulanır.
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
  pgDumpPath: env.PG_DUMP_PATH,
  connection: postgresConnectionFromUrl(env.DATABASE_URL),
  retention: {
    daily: env.BACKUP_RETENTION_DAILY,
    weekly: env.BACKUP_RETENTION_WEEKLY,
    monthly: env.BACKUP_RETENTION_MONTHLY,
  },
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

Gerekli yeni ayarlar: `LOCAL_POSTGRES_DATA_DIR`, `LOCAL_BACKUP_DIR`,
`PG_DUMP_PATH` ve üç retention sayısıdır. Üretim kurulumunda veri ile yedek
dizinlerinin tercihen farklı fiziksel disklerde seçilmesi önerilir.
