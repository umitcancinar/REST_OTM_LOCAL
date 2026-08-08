"use strict";
// ==========================================
// Environment Configuration
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Load environment variables from workspace root and app-specific .env
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../../../.env') });
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../.env') });
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
// ==========================================
// Uretimde eksik/zayif sir tespiti
// ==========================================
// Onceki surum eksik sirlari yalnizca console.error ile uyariyordu. Uyari
// deploy loglarinda kaybolunca API, kaynak kodda yazili 'CHANGE-ME' sirriyla
// calismaya devam edebiliyordu — o sirri bilen herkes istedigi tenant icin
// SUPER_ADMIN token'i imzalayabilir. Artik uretimde surec hic baslamiyor.
//
// Sorunlar tek tek degil topluca toplanip tek seferde bildiriliyor; operator
// her deploy denemesinde bir sonraki eksigi ogrenmek zorunda kalmasin.
const startupErrors = [];
/** Kisa bir sir, varsayilan bir sir kadar zayiftir. 32 karakter = 128+ bit entropi. */
const MIN_SECRET_LENGTH = 32;
/**
 * Uretimde zorunlu, gelistirmede varsayilana dusen SIR okuma.
 * Zayif sir (kisa veya 'CHANGE-ME' iceren) uretimde gecersiz sayilir.
 */
function requireSecret(name, devFallback) {
    const value = process.env[name];
    if (!IS_PROD)
        return value || devFallback;
    if (!value) {
        startupErrors.push(`${name} tanimli degil.`);
        return '';
    }
    if (value.includes('CHANGE-ME')) {
        startupErrors.push(`${name} ornek/varsayilan degeri iceriyor.`);
        return '';
    }
    if (value.length < MIN_SECRET_LENGTH) {
        startupErrors.push(`${name} cok kisa — en az ${MIN_SECRET_LENGTH} karakter olmali.`);
        return '';
    }
    return value;
}
/** Uretimde zorunlu, gelistirmede varsayilana dusen SIR OLMAYAN deger. */
function requireValue(name, devFallback) {
    const value = process.env[name];
    if (!IS_PROD)
        return value || devFallback;
    if (!value) {
        startupErrors.push(`${name} tanimli degil.`);
        return '';
    }
    return value;
}
// ==========================================
// CORS
// ==========================================
// Merkezi panel mimarisinde izinli origin listesi kisa ve sabittir: yonetim
// paneli + garson paneli. Musterilerin kendi domainleri buraya GIRMEZ — onlar
// halka acik tarafta kendi sunucularindan proxy ile konusur.
//
// Onceki surumde bu listeye sabit kodlanmis vercel.app ve musteri domainleri
// vardi ve CORS_ORIGIN ne verilirse verilsin listeye zorla ekleniyordu; yeni
// musteri kod degisikligi, ayrilan musteri ise kodda kalan olu izin demekti.
const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'];
const CORS_ORIGIN = (() => {
    const parsed = (process.env.CORS_ORIGIN || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
    if (!IS_PROD)
        return parsed.length > 0 ? parsed : DEV_ORIGINS;
    if (parsed.length === 0) {
        startupErrors.push('CORS_ORIGIN tanimli degil — panel ve garson paneli adresleri virgulle ayrilmis olmali.');
    }
    return parsed;
})();
exports.env = {
    // General
    NODE_ENV,
    PORT: parseInt(process.env.PORT || '4000', 10),
    // Hangi ag arayuzu dinlenecek. Uretimde varsayilan 127.0.0.1: API'nin
    // onunde nginx durur, disaridan dogrudan erisim istenmez. Gelistirmede
    // 0.0.0.0 kalir ki ayni agdaki cihazlarla test edilebilsin.
    BIND_HOST: process.env.BIND_HOST || (IS_PROD ? '127.0.0.1' : '0.0.0.0'),
    // Database
    DATABASE_URL: requireValue('DATABASE_URL', ''),
    // Redis
    REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
    // JWT
    JWT_ACCESS_SECRET: requireSecret('JWT_ACCESS_SECRET', 'dev-access-secret-CHANGE-ME-NOT-FOR-PROD'),
    JWT_REFRESH_SECRET: requireSecret('JWT_REFRESH_SECRET', 'dev-refresh-secret-CHANGE-ME-NOT-FOR-PROD'),
    JWT_ACCESS_EXPIRY: process.env.JWT_ACCESS_EXPIRES_IN || '15m', // Short-lived: 15 minutes
    JWT_REFRESH_EXPIRY: process.env.JWT_REFRESH_EXPIRES_IN || '7d', // Long-lived: 7 days
    // Bcrypt
    BCRYPT_SALT_ROUNDS: parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10),
    // CORS
    CORS_ORIGIN,
    // Print Agent — tenant basina sir uretilemeyen eski kayitlar icin genel yedek
    // (bkz. websocket/socket.server.ts ve Tenant.printAgentSecret).
    PRINT_AGENT_SECRET: requireSecret('PRINT_AGENT_SECRET', 'dev-print-agent-secret-CHANGE-ME'),
    // ─── Lisans sunucusu ───────────────────────────────────────────
    // Ed25519 OZEL anahtari (PEM). Lisanslari bununla imzaliyoruz.
    //
    // Bu deger sizarsa lisans sistemi tamamen degersizlesir: sizan
    // anahtarla herkes kendine sinirsiz sureli lisans uretebilir. Bu yuzden
    // yalnizca bulut API'sinin ortam degiskeninde bulunur — repoda, musteri
    // paketinde veya loglarda ASLA yer almaz.
    //
    // Bilerek fail-fast DEGIL: ayni API menu/CMS de servis ediyor ve lisans
    // yapilandirilmamis bir ortamda (ornegin gelistirme) calisabilmeli.
    // Eksikse lisans uc noktalari 503 doner (bkz. license.service.ts).
    LICENSE_PRIVATE_KEY: process.env.LICENSE_PRIVATE_KEY || '',
    // Super Admin
    SUPER_ADMIN_EMAIL: process.env.SUPER_ADMIN_EMAIL || 'admin@restotm.com',
    SUPER_ADMIN_PASSWORD: requireSecret('SUPER_ADMIN_PASSWORD', 'dev-super-admin-CHANGE-ME'),
    isDev: NODE_ENV === 'development',
    isProd: IS_PROD,
};
// ==========================================
// Fail-fast: eksikse baslama.
// ==========================================
// Yarim yapilandirilmis bir API, calismayan bir API'den daha tehlikelidir:
// ayakta gorunur, istek kabul eder, ama kimlik dogrulamasi sahtelenebilir.
if (startupErrors.length > 0) {
    const lines = startupErrors.map((e) => `  - ${e}`).join('\n');
    throw new Error('\n\n=========================================================\n' +
        ' BASLATMA DURDURULDU — uretim yapilandirmasi eksik\n' +
        '=========================================================\n' +
        `${lines}\n\n` +
        ' Guclu bir sir uretmek icin:\n' +
        '   openssl rand -base64 48\n\n' +
        ' NOT: JWT sirlarini degistirmek tum aktif oturumlari sonlandirir;\n' +
        ' kullanicilar yeniden giris yapar. Beklenen davranis budur.\n' +
        '=========================================================\n');
}
//# sourceMappingURL=env.js.map