# Auto-update ya Gimis Charms (APK + Windows)

Ukibadilisha chochote kwenye project na kukisukuma (push) kwenye `main`:

1. GitHub Actions inajenga APK (simu + tablet) na installer za Windows (x64, ia32, arm64).
2. Inatoa GitHub Release mpya (`build-<namba>`).
3. Inaandika toleo jipya kwenye Supabase (`gpsa_release`, safu `app-android` na `app-windows`).
4. Kila kifaa kinaangalia safu hiyo (app inapofunguliwa, kisha kila dakika 30). Kikiona build mpya kinaonyesha
   **"Sasisha sasa / Baadaye"**, kinapakua na kujisakinisha juu ya app iliyopo.

Toleo linalotangazwa = `version` ya `extensions/gpsa-extension/manifest.json` + namba ya build (inapanda yenyewe).

## Kuweka (mara moja)

1. **Supabase > SQL Editor:** endesha `SUPABASE-UPDATE.sql` (inaruhusu app kusoma taarifa ya toleo jipya tu).
2. **GitHub > repo > Settings > Secrets and variables > Actions > New repository secret:**
   - `OWNER_EMAIL`    = email ya akaunti ya OWNER (ile iliyo kwenye `gpsa_owners`)
   - `OWNER_PASSWORD` = password ya owner huyo
   (Workflow inaingia kama owner kuandika toleo. Hakuna `service_role` key inayotumika.)
3. **Repo lazima iruhusu vifaa kupakua release bila kuingia:**
   - Repo ikiwa **public**: hakuna cha kuongeza. (Kumbuka: `config.js` na `gpsa-release.jks` vitaonekana na wote.)
   - Repo ikiwa **private**: tengeneza repo ya pili ya umma ya release tu (mf. `gimis-releases`, yenye commit moja),
     kisha weka **Variable** `RELEASE_REPO = kinondonigpsa/gimis-releases` na **Secret** `RELEASES_TOKEN`
     (Personal Access Token yenye ruhusa ya `contents: write` kwenye repo hiyo).
4. Push kwenye `main` (au Actions > Run workflow). Subiri kazi nne zikamilike: prepare, android, windows, publish.

## Muhimu kujua

- **Toleo la kwanza lenye auto-update lazima liwekwe kwa mkono** (install APK/EXE hii mara moja). Matoleo ya zamani hayana kisasishaji.
  Baada ya hapo kila kitu ni otomatiki.
- Android: mtumiaji akiulizwa, aruhusu **"Install unknown apps"** kwa Gimis Charms mara moja.
- Windows: menyu `Page > Angalia sasisho` inaangalia mara moja. Installer inaendeshwa kimya na app inafunguka tena.
- Release 5 za mwisho tu ndizo zinabaki (zamani zinafutwa otomatiki).
- Kulazimisha sasisho kwa kila mtu: kwenye Supabase (Table Editor > `gpsa_release` > safu `app-android` / `app-windows`),
  ongeza `"force": true` au `"minBuild": <namba>` ndani ya `data`. Build zinazofuata hazifuti hivi viwili.
- Extension ya Chrome ya kawaida (Load unpacked) ina updater yake ya zamani (Owner console); hii mpya ni ya APK na EXE.
