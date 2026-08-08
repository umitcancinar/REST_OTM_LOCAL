#!/usr/bin/env bash
# ==========================================
# REST_OTM — uc katmanli yedek kurulumu
# ==========================================
# VPS uzerinde root olarak bir kez calistirilir. Tekrar calistirilabilir
# (idempotent): var olani bozmaz, eksigi tamamlar.
#
#   sudo bash install-backup.sh
#
# Onkosul: /etc/pgbackrest/pgbackrest.conf doldurulmus olmali
#          (bkz. pgbackrest.conf.example)

set -euo pipefail

STANZA="rest-otm"
PG_VERSION="${PG_VERSION:-16}"
PG_CONF="/etc/postgresql/${PG_VERSION}/main/postgresql.conf"
PGBR_CONF="/etc/pgbackrest/pgbackrest.conf"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\n\033[1;33m[!]\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m[HATA]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "root olarak calistirilmali: sudo bash $0"

# ─── 1. pgBackRest kurulumu ───────────────────────────────────────
log "pgBackRest kuruluyor"
if ! command -v pgbackrest >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y pgbackrest
else
  echo "    zaten kurulu: $(pgbackrest version)"
fi

# ─── 2. Yapilandirma dogrulamasi ──────────────────────────────────
log "Yapilandirma kontrol ediliyor"
[[ -f "$PGBR_CONF" ]] || die "$PGBR_CONF yok. pgbackrest.conf.example dosyasini kopyalayip doldur."

if grep -q "DOLDUR-" "$PGBR_CONF"; then
  die "$PGBR_CONF icinde doldurulmamis 'DOLDUR-' alanlari var. Once onlari tamamla."
fi

chown postgres:postgres "$PGBR_CONF"
chmod 640 "$PGBR_CONF"

# ─── 3. Dizinler ──────────────────────────────────────────────────
log "Dizinler hazirlaniyor"
for d in /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest; do
  mkdir -p "$d"
  chown postgres:postgres "$d"
  chmod 750 "$d"
done

# ─── 4. Postgres WAL arsivleme ────────────────────────────────────
# WAL arsivi olmadan yalnizca "yedek anina" donebilirsin. WAL ile
# herhangi bir SANIYEYE donebilirsin — yanlis silinen bir siparisin
# hemen oncesine, o gunun geri kalanini kaybetmeden.
log "Postgres WAL arsivlemesi ayarlaniyor"
[[ -f "$PG_CONF" ]] || die "$PG_CONF bulunamadi. PG_VERSION dogru mu? (su an: $PG_VERSION)"

set_pg() {
  local key="$1" val="$2"
  if grep -qE "^[[:space:]]*#?[[:space:]]*${key}[[:space:]]*=" "$PG_CONF"; then
    sed -i -E "s|^[[:space:]]*#?[[:space:]]*${key}[[:space:]]*=.*|${key} = ${val}|" "$PG_CONF"
  else
    printf '%s = %s\n' "$key" "$val" >> "$PG_CONF"
  fi
  echo "    ${key} = ${val}"
}

set_pg archive_mode    "on"
set_pg archive_command "'pgbackrest --stanza=${STANZA} archive-push %p'"
set_pg wal_level       "replica"
set_pg max_wal_senders "3"

# Postgres yalnizca localhost dinlesin — veritabani dis dunyaya kapali.
# Uygulama ayni makinede oldugu icin disaridan erisime hic gerek yok.
set_pg listen_addresses "'localhost'"

log "Postgres yeniden baslatiliyor (arsivleme ayarlari icin gerekli)"
systemctl restart "postgresql@${PG_VERSION}-main"

# ─── 5. Stanza olustur + ilk yedek ────────────────────────────────
log "Stanza olusturuluyor"
sudo -u postgres pgbackrest --stanza="$STANZA" stanza-create || \
  echo "    stanza zaten mevcut, atlaniyor"

log "Yapilandirma dogrulaniyor (check)"
sudo -u postgres pgbackrest --stanza="$STANZA" check

log "Ilk tam yedek aliniyor — veri boyutuna gore surebilir"
sudo -u postgres pgbackrest --stanza="$STANZA" --type=full backup

# ─── 6. Zamanlanmis isler ─────────────────────────────────────────
log "systemd zamanlayicilari kuruluyor"

install -m 755 "$SCRIPT_DIR/restore-test.sh"  /usr/local/bin/restotm-restore-test
install -m 755 "$SCRIPT_DIR/sync-to-neon.sh"  /usr/local/bin/restotm-sync-neon

write_unit() { cat > "/etc/systemd/system/$1"; }

# Haftalik tam yedek — pazar 03:00
write_unit restotm-backup-full.service <<EOF
[Unit]
Description=REST_OTM haftalik tam yedek
[Service]
Type=oneshot
User=postgres
ExecStart=/usr/bin/pgbackrest --stanza=${STANZA} --type=full backup
EOF

write_unit restotm-backup-full.timer <<'EOF'
[Unit]
Description=REST_OTM haftalik tam yedek
[Timer]
OnCalendar=Sun *-*-* 03:00:00
Persistent=true
[Install]
WantedBy=timers.target
EOF

# Gunluk artimli yedek — her gun 03:00 (restoran kapaliyken)
write_unit restotm-backup-incr.service <<EOF
[Unit]
Description=REST_OTM gunluk artimli yedek
[Service]
Type=oneshot
User=postgres
ExecStart=/usr/bin/pgbackrest --stanza=${STANZA} --type=incr backup
EOF

write_unit restotm-backup-incr.timer <<'EOF'
[Unit]
Description=REST_OTM gunluk artimli yedek
[Timer]
OnCalendar=Mon..Sat *-*-* 03:00:00
Persistent=true
[Install]
WantedBy=timers.target
EOF

# Neon sicak yedek senkronu — 6 saatte bir
write_unit restotm-sync-neon.service <<'EOF'
[Unit]
Description=REST_OTM Neon sicak yedek senkronu
[Service]
Type=oneshot
User=postgres
EnvironmentFile=/etc/restotm/backup.env
ExecStart=/usr/local/bin/restotm-sync-neon
EOF

write_unit restotm-sync-neon.timer <<'EOF'
[Unit]
Description=REST_OTM Neon sicak yedek senkronu
[Timer]
OnCalendar=*-*-* 00,06,12,18:30:00
Persistent=true
[Install]
WantedBy=timers.target
EOF

# Aylik geri yukleme testi — ayin 1'i 04:00
# Test edilmemis yedek, yedek degildir. Bu is sessizce atlanamaz.
write_unit restotm-restore-test.service <<'EOF'
[Unit]
Description=REST_OTM aylik geri yukleme dogrulamasi
[Service]
Type=oneshot
User=postgres
EnvironmentFile=/etc/restotm/backup.env
ExecStart=/usr/local/bin/restotm-restore-test
EOF

write_unit restotm-restore-test.timer <<'EOF'
[Unit]
Description=REST_OTM aylik geri yukleme dogrulamasi
[Timer]
OnCalendar=*-*-01 04:00:00
Persistent=true
[Install]
WantedBy=timers.target
EOF

mkdir -p /etc/restotm
if [[ ! -f /etc/restotm/backup.env ]]; then
  cat > /etc/restotm/backup.env <<'EOF'
# Neon sicak yedek baglantisi (sync-to-neon.sh kullanir)
NEON_DATABASE_URL=
# Yerel kaynak veritabani
LOCAL_DATABASE_URL=postgresql://postgres@localhost:5432/rest_otm
# Uyari webhook'u (Telegram/Slack) — bos birakilirsa yalnizca log'a yazar
ALERT_WEBHOOK_URL=
EOF
  chmod 600 /etc/restotm/backup.env
  warn "/etc/restotm/backup.env olusturuldu — NEON_DATABASE_URL doldurulmali."
fi

systemctl daemon-reload
for t in restotm-backup-full restotm-backup-incr restotm-sync-neon restotm-restore-test; do
  systemctl enable --now "${t}.timer"
done

# ─── 7. Ozet ──────────────────────────────────────────────────────
log "Kurulum tamam"
sudo -u postgres pgbackrest --stanza="$STANZA" info

cat <<'EOF'

  Katmanlar
  ---------
  1) Yerel  (VPS diski)      : dakikalar icinde geri donus
  2) Uzak   (B2/R2 kilitli)  : silinemez kopya, felaket senaryosu
  3) Neon   (sicak yedek)    : 6 saatte bir, acil devralma

  Zamanlayicilari gor : systemctl list-timers 'restotm-*'
  Yedek durumu        : sudo -u postgres pgbackrest --stanza=rest-otm info
  Acil kurtarma       : infra/backup/README.md

  YAPILACAK: /etc/restotm/backup.env icine NEON_DATABASE_URL yaz.
  YAPILACAK: repo2-cipher-pass degerini sunucudan AYRI bir yerde sakla.
             O parola kaybolursa uzak yedeklerin tamami okunamaz.

EOF
