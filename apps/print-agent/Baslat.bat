@echo off
chcp 65001 >nul
title REST_OTM Yazici Araci
cd /d "%~dp0..\.."

echo ==========================================
echo    REST_OTM Yazici Aracisi
echo ==========================================
echo.

where pnpm >nul 2>nul
if %errorlevel%==0 (set "PNPM=pnpm") else (set "PNPM=npx -y pnpm@9.15.0")

echo [1/4] Guncellemeler aliniyor...
git pull --ff-only
if errorlevel 1 (
    echo    ! Git guncellemesi atlandi ^(internet yok veya yerel degisiklik var^).
)

echo [2/4] Bagimliliklar kuruluyor...
call %PNPM% install --no-frozen-lockfile
if errorlevel 1 goto hata

echo [3/4] Derleniyor...
call %PNPM% --filter @rest-otm/receipt-core build
if errorlevel 1 goto hata
call %PNPM% --filter @rest-otm/print-agent build
if errorlevel 1 goto hata

echo [4/4] Baslatiliyor...
cd apps\print-agent
call npm run start
goto son

:hata
echo.
echo ❌ HATA: Kurulum/derleme basarisiz. Internet baglantisini ve Node.js kurulumunu kontrol edin.

:son
pause
