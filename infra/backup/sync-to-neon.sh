#!/usr/bin/env bash
# ==========================================
# REST_OTM — Neon sicak yedek senkronu (3. katman)
# ==========================================
# Amac: VPS tamamen giderse (disk, saglayici, yangin) DATABASE_URL'i
# Neon'a cevirip DAKIKALAR icinde yeniden ayaga kalkmak.
#
# Katmanlarin isi farkli:
#   yerel pgBackRest : saniye hassasiyetinde geri donus, dakikalar icinde
#   B2/R2 kilitli    : silinemez kopya, geri yukleme ~1 saat
#   Neon (bu betik)  : 6 saatte bir, devralma ~5 dakika
#
# ONEMLI: Bu mantiksal bir kopya, akan bir replika DEGIL. Neon'daki veri
# son senkron anina aittir; devralinirsa aradaki siparisler kaybolur.
# Saniye hassasiyeti gerekiyorsa yerel pgBackRest + WAL kullanilir.
# Bu yuzden Neon "son care", ilk care degil.

set -uo pipefail

LOCAL_DB="${LOCAL_DATABASE_URL:-postgresql://postgres@localhost:5432/rest_otm}"
NEON_DB="${NEON_DATABASE_URL:-}"
ALERT_URL="${ALERT_WEBHOOK_URL:-}"
DUMP_FILE="/var/tmp/restotm-neon-sync.dump"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }

notify() {
  local status="$1" message="$2"
  log "$status: $message"
  if [[ -n "$ALERT_URL" ]]; then
    curl -fsS -m 15 -X POST "$ALERT_URL" \
      -H 'Content-Type: application/json' \
      -d "$(printf '{"text":"REST_OTM Neon senkron [%s]: %s"}' "$status" "$message")" \
      >/dev/null 2>&1 || log "UYARI: bildirim gonderilemedi"
  fi
}

cleanup() { rm -f "$DUMP_FILE"; }
trap cleanup EXIT

if [[ -z "$NEON_DB" ]]; then
  log "NEON_DATABASE_URL bos — senkron atlaniyor. (/etc/restotm/backup.env)"
  exit 0
fi

# ─── 1. Yerelden dok ──────────────────────────────────────────────
log "Yerel veritabani doksuluyor"
if ! pg_dump "$LOCAL_DB" --format=custom --no-owner --no-acl --file="$DUMP_FILE"; then
  notify "BASARISIZ" "Yerel pg_dump basarisiz — Neon kopyasi guncellenemedi"
  exit 1
fi

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
log "Dokum alindi: $DUMP_SIZE"

# Bos/kucuk dokum, sessizce iyi bir kopyanin uzerine yazmasin.
DUMP_BYTES=$(stat -c%s "$DUMP_FILE" 2>/dev/null || stat -f%z "$DUMP_FILE")
if (( DUMP_BYTES < 10240 )); then
  notify "BASARISIZ" "Dokum supheli derecede kucuk (${DUMP_BYTES} bayt) — Neon'a yazilmadi"
  exit 1
fi

# ─── 2. Neon'a yaz ────────────────────────────────────────────────
# --clean --if-exists: hedefteki eski nesneleri once dusurur.
# Sicak yedek her zaman kaynagin birebir kopyasi olmali; birikme olmamali.
log "Neon'a yaziliyor"
if ! pg_restore --dbname="$NEON_DB" --clean --if-exists --no-owner --no-acl \
                --single-transaction "$DUMP_FILE" 2>/tmp/neon-restore.err; then
  notify "BASARISIZ" "Neon'a yazma basarisiz: $(tail -3 /tmp/neon-restore.err | tr '\n' ' ')"
  exit 1
fi

# ─── 3. Dogrula ───────────────────────────────────────────────────
# Yazdiktan sonra saymadan "basarili" demek, bos bir sicak yedegi
# calisiyor sanmakla ayni sey.
log "Kopya dogrulaniyor"
MISMATCH=""
for tbl in tenants users orders invoices; do
  live=$(psql "$LOCAL_DB" -tAc "SELECT count(*) FROM ${tbl}" 2>/dev/null || echo "HATA")
  copy=$(psql "$NEON_DB"  -tAc "SELECT count(*) FROM ${tbl}" 2>/dev/null || echo "HATA")
  if [[ "$live" != "$copy" ]]; then
    MISMATCH+="${tbl}(canli=${live} neon=${copy}) "
  fi
done

if [[ -n "$MISMATCH" ]]; then
  notify "BASARISIZ" "Neon kopyasi canliyla uyusmuyor: ${MISMATCH}"
  exit 1
fi

notify "BASARILI" "Neon sicak yedegi guncellendi (${DUMP_SIZE})"
exit 0
