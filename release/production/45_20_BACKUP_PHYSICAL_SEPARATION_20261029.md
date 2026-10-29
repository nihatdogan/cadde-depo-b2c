# CADDE DEPO — ADIM 45.20 / YEDEK FIZIKSEL BAGIMSIZLIK

Tarih: 29 Ekim 2026
Karar: **G1 PARCALI PASS / FIZIKSEL BAGIMSIZLIK BEKLIYOR / PRODUCTION NO-GO**.

## Kanitlarin dogru ayrimi

26 Ekim tarihli `99G_20261026_ENCRYPTED_RECOVERY_SECOND_COPY_VERIFIED.md` kaynak belgesine gore:
- Kullanici Windows V6 raporu: `PASS_ENCRYPTED_RECOVERY_WITH_VERIFIED_SECOND_COPY`.
- Ikinci ayri volume kopyasi SHA-256 esligi: PASS (yerel rapor).
- Ikinci kopyadan sifreli arsiv ile izolasyonlu PostgreSQL 17 restore: PASS (yerel rapor).
- Farkli fiziksel disk, ayri cihaz veya offsite konum: **KANITLANMADI**. Rapor: `SEPARATE_VOLUME_ONLY_NOT_PHYSICAL_PROOF`.
- Otomatik yedekleme, saklama/rotation, alarm, olculmus RPO/RTO: OPEN.
- Supabase Auth ve Storage metadata/object bytes dahil tam managed restore: OPEN.
- Gizli arsiv/parola model tarafindan bagimsiz acilip incelenmedi; yerel rapor sinirlarini koru.

29 Ekim 45.19 raporunun V6 ikinci kopya/restore durumunu OPEN gibi ele alan ifadesi, 26 Ekim tarihli daha spesifik 99G belgesiyle duzeltilmistir. **Ikinci volume kopyasi ve ondan restoreyi yeniden acik sayma**; yalniz fiziksel bagimsizligi OPEN tut.

## Uygulanabilir yerel kontrol — salt okunur

Script: `release/production/tools/verify_windows_backup_disk_separation.ps1`.

Windows PowerShell'de gercek iki .cdp arsivinin yollarini yalniz yerel terminalde belirleyin; chat'e, GitHub'a, loglara path/arsiv/parola koymayin. Beklenen kaynak SHA-256:
`b3717bd7d79a9711cbd0ed950d963a4296138f7dda4d695a4f5ed196d18c0646`.

Ornek, yalnizca yerel cihazda (dosya yollarini gercek konumlara gore kullan):
```powershell
./release/production/tools/verify_windows_backup_disk_separation.ps1 -SourceArchive 'C:\\private\\source.cdp' -SecondArchive 'E:\\private\\copy.cdp' -ExpectedSha256 'b3717bd7d79a9711cbd0ed950d963a4296138f7dda4d695a4f5ed196d18c0646'
```
Beklenen cikti: `PASS_LOCAL_HASH_AND_DISTINCT_DISK_NUMBERS_PHYSICAL_CONFIRMATION_OPEN`. Bu sadece iki yerel dosyanin ayni hash'i tasidigini ve Windows tarafindan **farkli disk numaralarina** baglandigini gosterir. Bu tek basina bagimsiz fiziksel cihaz/offsite kurtarmasi kaniti degildir: sanal diskler, RAID, LUN, USB hub, paylasilan depolama ve ayni ariza etki alani ayrica kontrol edilmelidir. Daha sonra operatör diskin fiziksel kimligi, offsite saklama ve erisim sinirini imzalamalidir.

**DUR:** Hash farki, beklenen arsiv kimligiyle uyusmazlik, ayni Windows disk numarasi veya belirsiz drive map. Belirsiz durumu PASS sayma.
Script, Production veritabanina baglanmaz, arşivi decrypt etmez veya diger test kanitlarini yeniden uretmez.

## Sorumlu ve tamamlanma ölçütü

Sorumlu: Backup/operasyon sahibi.
- Farkli fiziksel disk teyidi: iki bagimsiz cihaz fiziksel envanter kaydi, erisim ve offsite konum; gizli kimlikler yerelde saklanmali.
- Tekrar restore gerekirse yalniz yalitilmis PostgreSQL ve kayitli manifest.
- Otomatik takvim, beklenen RPO/RTO ve kurtarma politikasini somut veriyle doldurun; hedefler onay olmadan PASS degildir.
- Auth ve Storage kurtarma kapsaminda metadata ve dosya baytlari birlikte tasarlanmali.
- PR #2 DRAFT, main ve Production NO-GO; canli yazi veya deployment yok.

Kaynak: 99G_20261026_ENCRYPTED_RECOVERY_SECOND_COPY_VERIFIED.md
