WINDOWS DERLEME MAKINESINE DISARIDAN KONULACAK DOSYALAR
======================================================

Bu klasore gercek dosyalari commit etmeyin. Private key ASLA koymayin.

Gerekenler:

1. Node.js 22 LTS Windows x64 ZIP arsivi.
   Arsiv icinde node.exe bulunmali.

2. PostgreSQL Windows x64 binary ZIP arsivi.
   Arsiv icinde bin\postgres.exe, bin\initdb.exe, bin\pg_dump.exe,
   bin\pg_restore.exe ve share\postgresql.conf.sample bulunmali.

3. license-public-key.pem
   Ed25519 SPKI PUBLIC KEY. Private key degil.

4. update-public-key.pem
   Lisans anahtarindan farkli Ed25519 SPKI PUBLIC KEY. Private key degil.

5. Windows Code Signing sertifikasi.
   PFX dosyasini bu klasore koymayin. Sertifikayi Windows Certificate Store'a
   guvenli bicimde import edin; derleme scriptine yalniz thumbprint verilir.

Indirilen Node/PostgreSQL arsivlerinin uretici hash ve imzalarini indirdiginiz
resmi sayfadan dogrulamadan derleme yapmayin.
