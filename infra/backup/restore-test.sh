#!/usr/bin/env bash
# ==========================================
# REST_OTM — otomatik geri yukleme dogrulamasi
# ==========================================
# Yedekleme sistemlerinde en sik yapilan hata, yedegin alindigini
# varsayip hic geri yuklememektir. Bozuk yedek, yedek olmadigini
# ancak ihtiyac aninda belli eder.
#
# Bu betik ayda bir otomatik calisir:
#   1. En son yedegi AYRI bir dizine, AYRI bir portta geri yukler
#   2. Canli veritabaniyla satir sayilarini karsilastirir
#   3. Gecici ornegi temizler
#   4. Sonucu bildirir; basarisizsa uyari gonderir
#
# Canli veritabanina dokunmaz.

set -uo pipefail

STANZA="rest-otm"
PG_VERSION="${PG_VERSION:-16}"
PG_BIN="/usr/lib/postgresql/${PG_VERSION}/bin"
TEST_PORT="${TEST_PORT:-5433}"
TEST_DIR="${TEST_DIR:-/var/tmp/restotm-restore-test}"
LOCAL_DB="${LOCAL_DATABASE_URL:-postgresql://postgres@localhost:5432/rest_otm}"
ALERT_URL="${ALERT_WEBHOOK_URL:-}"

# Sayilari karsilastirilacak tablolar. Fatura ve siparis kayitlari
# mali veri tasidigi icin listede olmalari sart.
TABLES=(tenants users orders order_items invoices menu_items reservations)

log()  { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }

notify() {
  local status="$1" message="$2"
  log "$status: $message"
  if [[ -n "$ALERT_URL" ]]; then
    curl -fsS -m 15 -X POST "$ALERT_URL" \
      -H 'Content-Type: application/json' \
      -d "$(printf '{"text":"REST_OTM yedek dogrulama [%s]: %s"}' "$status" "$message")" \
      >/dev/null 2>&1 || log "UYARI: bildirim gonderilemedi"
  fi
}

cleanup() {
  if [[ -d "$TEST_DIR" ]]; then
    "$PG_BIN/pg_ctl" -D "$TEST_DIR" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$TEST_DIR"
    log "Gecici ornek temizlendi"
  fi
}
trap cleanup EXIT

# ─── 1. Diskte yer var mi ─────────────────────────────────────────
DB_SIZE_KB=$(du -sk /var/lib/postgresql/"${PG_VERSION}"/main 2>/dev/null | cut -f1 || echo 0)
FREE_KB=$(df -Pk /var/tmp | awk 'NR==2 {print $4}')
if (( FREE_KB < DB_SIZE_KB * 2 )); then
  notify "BASARISIZ" "Geri yukleme testi icin disk yetersiz (gerekli ~$((DB_SIZE_KB*2/1024)) MB, bos $((FREE_KB/1024)) MB)"
  exit 1
fi

# ─── 2. Yedegi gecici dizine geri yukle ───────────────────────────
log "En son yedek $TEST_DIR dizinine geri yukleniyor"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"
chmod 700 "$TEST_DIR"

if ! pgbackrest --stanza="$STANZA" --pg1-path="$TEST_DIR" --type=default restore; then
  notify "BASARISIZ" "pgBackRest restore basarisiz — yedekler geri yuklenemiyor!"
  exit 1
fi

# ─── 3. Gecici ornegi ayri portta baslat ──────────────────────────
log "Gecici Postgres ornegi $TEST_PORT portunda baslatiliyor"
cat >> "$TEST_DIR/postgresql.auto.conf" <<EOF
port = ${TEST_PORT}
archive_mode = off
listen_addresses = 'localhost'
EOF

# recovery.signal, WAL'in tutarli bir noktaya kadar oynatilmasini saglar.
touch "$TEST_DIR/recovery.signal"

if ! "$PG_BIN/pg_ctl" -D "$TEST_DIR" -o "-p ${TEST_PORT}" -w -t 300 -l "$TEST_DIR/startup.log" start; then
  notify "BASARISIZ" "Geri yuklenen ornek baslatilamadi. Log: $(tail -5 "$TEST_DIR/startup.log" 2>/dev/null)"
  exit 1
fi

# Kurtarma modundan cikip sorgu kabul etmesini bekle
for _ in {1..60}; do
  if "$PG_BIN/psql" -p "$TEST_PORT" -U postgres -d postgres -tAc 'SELECT 1' >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# ─── 4. Satir sayilarini karsilastir ──────────────────────────────
log "Satir sayilari karsilastiriliyor"
FAILURES=()
SUMMARY=""

for tbl in "${TABLES[@]}"; do
  live=$("$PG_BIN/psql" "$LOCAL_DB" -tAc "SELECT count(*) FROM ${tbl}" 2>/dev/null || echo "HATA")
  rest=$("$PG_BIN/psql" -p "$TEST_PORT" -U postgres -d rest_otm -tAc "SELECT count(*) FROM ${tbl}" 2>/dev/null || echo "HATA")

  if [[ "$live" == "HATA" || "$rest" == "HATA" ]]; then
    FAILURES+=("${tbl}: sorgulanamadi")
    continue
  fi

  # Yedek, canlidan bir miktar geride olabilir (son yedekten sonra yazilan
  # satirlar). Geri gitmesi normal, ILERI gitmesi veya bosalmasi degildir.
  if (( rest > live )); then
    FAILURES+=("${tbl}: yedekte canlidan FAZLA satir var (${rest} > ${live})")
  elif (( live > 0 && rest == 0 )); then
    FAILURES+=("${tbl}: yedekte BOS ama canlida ${live} satir var")
  fi

  SUMMARY+="${tbl}=${rest}/${live} "
done

# ─── 5. Sonuc ─────────────────────────────────────────────────────
if (( ${#FAILURES[@]} > 0 )); then
  notify "BASARISIZ" "Geri yukleme dogrulamasi sorunlu: ${FAILURES[*]}"
  exit 1
fi

notify "BASARILI" "Geri yukleme dogrulandi (yedek/canli): ${SUMMARY}"
exit 0
