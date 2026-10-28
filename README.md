# Gimis Charms (Android + Windows) - app yako ya kuendesha extensions kwenye simu

Ni browser ndogo (injini ya Firefox/GeckoView) inayopakia extensions ulizoziweka kwenye folda `extensions/`.
Extension inafanya kazi ndani ya app kama kwenye PC: content scripts ndani ya ukurasa wa GIMIS, background, storage, n.k.
App inafunguka moja kwa moja kwenye https://gimis.gpsa.go.tz/login . Haibadilishi wala kuficha utambulisho wa browser.

## Jinsi ya kupata APK (huhitaji Android Studio)
1. Tengeneza repo **PRIVATE** kwenye GitHub (muhimu: extension ina API keys ndani ya config.js) na upload folda hii yote.
2. Ingia **Actions > Build Gimis Charms > Run workflow** (au itaanza yenyewe kila ukisukuma mabadiliko).
3. Ikimaliza (~10-15 dakika), fungua run hiyo > **Artifacts > Gimis-Charms-APK** > download.
   - `arm64` = simu nyingi za sasa.  `arm` = simu za zamani (32-bit).  Kama hujui, jaribu arm64 kwanza.
4. Tuma APK kwenye simu, ifungue, ruhusu "Install unknown apps", kisha install. Fungua **Gimis Charms**.

## Nini unapata baada ya build (Actions > run > Artifacts)
Workflow moja, **Build Gimis Charms (Android simu, Android tablet, Windows)**, inatoa zip TATU tofauti:

| Artifact (zip) | Kwa nani | Ndani yake |
|---|---|---|
| `Gimis-Charms-Android-SIMU` | simu za Android | `...Simu-universal.apk` (kila simu), `...arm64-only.apk` (64-bit, ndogo), `...arm32-only.apk` (32-bit, ndogo) |
| `Gimis-Charms-Android-TABLET` | tablet za Android | `...Tablet-universal.apk`, `...arm64-only.apk`, `...arm32-only.apk` (vitufe na maandishi makubwa zaidi) |
| `Gimis-Charms-Windows` | kompyuta za Windows 10/11 | `Gimis-Charms-Setup-<toleo>-x64.exe`, `-ia32.exe` (32-bit), `-arm64.exe` |

Kila zip ina `SOMA-HAPA.txt` yenye maelekezo mafupi. Anza na faili ya `universal` (Android) au `x64` (Windows).
APK za simu na tablet zinatofautiana kwa ukubwa wa upau wa juu tu; zote zinaweza kuwekwa kwenye kifaa chochote.
Android: zimetiwa saini kwa ufunguo ule ule (`app/gpsa-release.jks`), kwa hiyo mabadiliko yanawekwa juu ya app iliyopo.
**Mara ya kwanza tu:** uninstall Gimis Charms ya zamani kabla ya kuinstall hii. **Usipoteze `app/gpsa-release.jks`.**
Windows: installer ni FILE MOJA lililo kamili (Electron + extension viko ndani). Bonyeza mara mbili: inajiweka bila maswali, haihitaji admin wala intaneti ya kupakua chochote, inatengeneza **shortcut ya Gimis Charms kwenye Desktop** na Start Menu na kuifungua. Kama ulikuwa na "GPSA Browser" ya zamani, data yake (login, usajili) inaendelea kutumika.
Android: app inajiwekea icon kwenye home screen mara ya kwanza ikifunguliwa (Android 8+ inauliza "Add to home screen" - bonyeza Add).
Icon: logo ya GPSA (iliyosafishwa, background ya uwazi) - chanzo kwenye `windows/build/icon.ico` na `app/src/main/res/mipmap-*`.
Windows: installer haijatiwa saini ya kampuni, kwa hiyo SmartScreen inaweza kuonya (More info > Run anyway). Windows 7/8 hazishikwi.
Source ya Windows ipo kwenye `windows/` (Electron).

## Kuweka extension nyingine (mfumo mwingine)
Weka folda yake (au `.zip` yake) ndani ya `extensions/`, kisha sukuma kwenye GitHub. Script `tools/prepare_extensions.py`
inabadilisha manifest kutoka Chrome kwenda Firefox yenyewe na APK mpya inajengwa. Extension zote kwenye folda zinapakiwa.

## Mambo ya kujua (soma)
- **Sijaijenga wala kuijaribu kwenye simu.** Code imeandikwa kwa nyaraka za GeckoView; converter ya extension nimeijaribu.
  Build ikishindwa, nakili ujumbe wa kosa kutoka Actions na umpe Claude, tutarekebisha.
- **Extensions lazima ziwe ndani ya APK.** Kubadilisha extension = kujenga APK mpya na watumiaji kuisakinisha upya.
  Kwa extension ya GPSA: ukichapisha update kwenye Owner console, simu zitaona "Update available", lakini zinasasishwa kwa APK mpya.
  Kama ukichagua "Force this update", simu zenye APK ya zamani zitafungwa hadi zisakinishe APK mpya.
- Kwenye extension ya GPSA: kipengele cha **code interpreter ya elapsAI** hakitafanya kazi (Firefox haina "sandbox pages"); kitufe cha
  updater cha folda hakifanyi kazi kwenye simu. Vingine (usajili wa devices, block, GIMIS, AI, Cloud) vinatarajiwa kufanya kazi.
- Kama dashboard ya extension haionekani kwenye GIMIS, inaweza kuwa ruhusa za tovuti hazikutolewa kwa extension; tuambie, tutaongeza hiyo.
- Upau wa anwani haubadiliki ukitembea kurasa (toleo la 1). Downloads zinaenda **Downloads** (Android 10+).
- iPhone: haijafunikwa (inahitaji Mac, Xcode na akaunti ya Apple Developer).
- Pin toleo la GeckoView baada ya build ya kwanza kufanikiwa (angalia `gradle.properties`) ili builds zisibadilike zenyewe.
