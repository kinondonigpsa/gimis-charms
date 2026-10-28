## v2.25.0 - Cloud storage sasa ni SUPABASE (Firestore imeondolewa) + admin anaweza kufuta token ZOTE
**Kwa nini:** Firestore ilikuwa inagoma (quota ya kila siku). Supabase (Postgres) haina "daily quota" ya namna hiyo.

### Kuweka (mara moja)
1. supabase.com > New project (chagua region iliyo karibu, mf. Frankfurt/London). Weka password ya database, subiri imalize.
2. **SQL Editor > New query** > bandika yote ya `extensions/gpsa-extension/SUPABASE-SETUP.sql` > Run. (Inatengeneza jedwali + ulinzi wa RLS.)
3. **Authentication > Users > Add user**: tengeneza akaunti ya OWNER (email + password, tiki "Auto Confirm User"). Kisha kwenye SQL Editor endesha:
   `insert into public.gpsa_owners (user_id) select id from auth.users where email = 'EMAIL-YA-OWNER' on conflict do nothing;`
4. **Authentication > Providers > Email**: zima **"Confirm email"** (la sivyo watu wapya hawawezi kuingia mara moja baada ya Create account).
5. **Project Settings > API**: nakili **Project URL** na **anon public key** kisha ziweke kwenye `config.js` (`supabaseUrl`, `supabaseAnonKey`). USITUMIE `service_role` key.
6. Jenga APK/EXE mpya kama kawaida (GitHub Actions). Kila kompyuta/simu iinstall toleo jipya (2.25.0) mara moja - toleo la zamani la Firebase haliwezi kujisasisha kwenda hili kwa sababu server ya updates imebadilika.

### Data ya zamani
Hakuna kuhamisha kwa mkono: token ziko pia kwenye kila kompyuta (chrome.storage). Kompyuta ikifungua dashboard na kufanya sync, token zake zinapakiwa Supabase zenyewe.
Akaunti za Firebase Auth (barua pepe/password) HAZIHAMI - kila mtu anatengeneza akaunti mpya (Create new account) kwenye Supabase. Devices zinajisajili upya.

### Admin: Delete ALL tokens
- Owner anaingia: GPSA Control > Owner sign-in (akaunti iliyo kwenye `gpsa_owners`). Kwenye dashboard ya Gimis Charms kitufe chekundu **"Delete ALL tokens (admin)"** kinaonekana (kwa owner pekee, pamoja na "Delete issued" na "Delete selected").
- Kinafuta: (1) token zote kwenye kompyuta hii, (2) token zote kwenye Supabase, (3) kinaweka alama `gpsa_config/wipe`; kompyuta nyingine zinaposync zinafuta nakala zao za ndani (token zilizohifadhiwa BAADA ya alama hiyo zinabaki).
- Ulinzi uko kwenye server: kazi `gpsa_wipe_tokens()` inakataa kila akaunti isiyo owner, hata mtu akijaribu kuiita kwa mkono.
- Marekebisho: kitufe cha "owner status" kwenye dashboard sasa kinasoma hali ya owner ipasavyo (ulinzi wa zamani ulikuwa unazuia dashboard kuuliza `ownerStatus`, kwa hiyo vitufe vya kufuta havikuonekana).

### Mabadiliko ya kiufundi
`background.js` na `access-bg.js` zinatumia Supabase Auth (GoTrue) + PostgREST kupitia REST (hakuna SDK). `content.js`, AI na workspaces hazijabadilika isipokuwa kitufe kipya na sync ya "wipe".
`manifest.json`: host permission mpya `https://*.supabase.co/*` (za Google Firebase zimeondolewa). `firestore-rules-v2.20.txt` imeondolewa; badala yake `SUPABASE-SETUP.sql`.
AI: collection `gpsaQueue` inasomwa kutoka `gpsa_queue`; collections nyingine kwenye Settings za AI sasa ni **majina ya jedwali la Supabase** (data ya app ya Fuel Record iliyoko Firebase haionekani tena hapa isipokuwa ukaihamishia Supabase).
Kumbuka: mradi wa **Supabase wa bure unalala (pause) baada ya wiki ~1 bila matumizi**; ukilala bonyeza "Restore project" kwenye dashboard ya Supabase.

## v2.21.0 - elapsAI inajua API zote za GIMIS (katalogi ndani ya project)

## v2.23.0 - Workspaces: Fuel LPO, Vehicle / Token, Depot Bin Card (kutoka GIMIS PLUS Unified Dashboard v0.8.0)
Kazi tatu zilizokuwa kwenye extension tofauti sasa ziko ndani ya Gimis Charms. Kwenye dashboard, chini ya tabs (Cloud storage records) kuna vitufe vitatu:
**Fuel LPO**, **Vehicle / Token**, **Depot Bin Card**. Kila kimoja kinafungua dirisha lake juu ya dashboard (funga kwa X, kitufe cha Esc, au kubonyeza nje ya dirisha).
- Kila workspace inajitegemea kama ilivyokuwa (API zake, tarehe, Excel ya Bin Card, cache ya miezi ya Vehicle/Token). Code yake haijabadilishwa.
- Token ya GIMIS inakamatwa na mkamataji MMOJA (`injected.js`) na kupelekwa kwa kila workspace (hakuna `fetch` kubadilishwa mara mbili).
- Zinaheshimu ulinzi wa owner: kompyuta ikifungiwa / haijasajiliwa, workspace haifunguki na iliyo wazi inafungwa yenyewe.
- Vitufe vya zamani vinavyoelea ("GIMIS Dashboard", "GIMIS+", "GIMIS Fuel", "GIMIS Bin Card") vimeondolewa. USIWEKE tena extension ya zamani ya GIMIS PLUS pamoja na hii (scripts zingeendeshwa mara mbili).
- Updater ya owner sasa inajumuisha pia faili za CSS.
- Faili mpya: `workspaces.js`, `workspaces.css`, `ws-fuel.js/.css`, `ws-vehicle.js/.css`, `ws-bincard.js/.css`, `xlsx-lite.js`, `xlsx-export.js`, `logo-icon.png`, `logo-bin.png`.

**Kilichoongezwa:** katalogi ya API **198** za GIMIS (163 queries + 35 mutations) zilizonaswa 2026-10-22 sasa ni sehemu ya extension (`gimis-api-catalog.js`) na elapsAI inafundishwa kuzitumia kila ombi.

**Zana mpya za AI (za KUSOMA tu):**
- `gimis_api_catalog`: groups / search / describe. AI inatafuta API (mfano "lpo", "wallet", "bin card"), inaona vigezo (variables), fields zinazorudishwa na kurasa za GIMIS zinazoitumia.
- `gimis_call`: inaendesha API ya katalogi kwa jina. Paging (`pageableParam`) na `exportDocType: XLSX` vinajazwa kiotomatiki; vigezo visivyojulikana na tarehe zisizo YYYY-MM-DD vinakataliwa; matokeo yanakuwa dataset (kisha dataset_query / create_file / create_chart).

**Vyanzo vitatu vya data (AI inaelekezwa kuchagua):** (a) extension storage + Firebase `gpsaQueue` (token zilizohifadhiwa), (b) collections nyingine za Firebase zilizoruhusiwa, (c) seva ya GIMIS kupitia API za katalogi. Kwenye jibu AI inataja takwimu imetoka wapi.

**Usalama:**
- API 157 zinaweza kuendeshwa (za kusoma). 41 zimezuiwa: mutations zote 35 + queries 6 zinazobadilisha data kwa jina (regenerateIssueNoteToken, removeRequisitionRequestByUuid, deactivate*, sendWalletTransactionToGfmsByUuid). AI inaweza kuzieleza na kuonyesha mahali pa kuzifanyia kwenye GIMIS.
- `issueNoteItemsInShopPageable` na `issueNoteTokensUsed` zinaanza na "issue" lakini ni orodha za kusoma (vigezo ni paging/tarehe tu); zimeruhusiwa kwa makusudi (`ALLOW_READ` kwenye ai-engine.js). Hili ni hitimisho kutokana na jina na vigezo, si uthibitisho kutoka seva.
- Barua pepe, simu, NIDA, password na secrets kwenye majibu ya GIMIS vinafichwa (`[hidden]`) kabla AI kuviona (JSON na safu za Excel).
- Orodha ya zilizozuiwa inatoka kwenye kinga ile ile ya runtime (`guardQuery`), kwa hiyo katalogi na kinga haziwezi kutofautiana.

**Kusasisha katalogi baadaye:** weka JSON mpya kwenye `dev/`, endesha `node dev/build-catalog.js dev/<faili>.json`, ongeza `version` kwenye manifest.json, Reload, kisha Owner console > Updates > Publish. `dev/` ina JSON ya awali na script ya kuzalisha; haipo kwenye auto-update (zinasambazwa `gimis-api-catalog.js` na mafaili ya extension tu).
**Hali ya uwezo** (kitufe kwenye elapsAI) sasa pia inakagua katalogi.
**Faili:** `gimis-api-catalog.js` (mpya, imezalishwa), `dev/` (mpya), `ai-tools.js`, `ai-core.js`, `ai-engine.js`, `manifest.json`.
**Si ya kuthibitishwa bado:** maelezo ya Kiswahili ya API ~85 yameandikwa kwa mkono; nyingine zimetokana na jina. Kwenye GIMIS halisi, `sortBy: updatedAt` ni chaguo-msingi lililothibitishwa kwa bin card na haijajaribiwa kwa kila API; ikikataliwa AI inaona kosa na kujaribu tena.

## v2.20.3 - icon mpya na Cloud storage kiotomatiki
- Icon mpya (logo ya "C") inatumika kila mahali: toolbar ya Chrome, kitufe cha elapsAI kinachoelea, kitufe cha "Gimis Charms", na vichwa vya madirisha.
- Sehemu ya "Cloud storage" imeondolewa kwenye paneli. Mtu akiingia (email + password) na kujisajili, akaunti yake inaunganishwa na Firebase yenyewe, na data inalandanishwa (sync) kiotomatiki.
- Kubadilisha akaunti: GPSA Control > "Sign out (email)", au kitufe cha "Use a different account" kwenye dirisha la kujisajili.

## v2.20.2 - akaunti ya kila mtu, usajili bila approval
- Kila mtu lazima aingie na **email na password yake mwenyewe** (Sign in, au Create new account kwa mara ya kwanza). Bila hapo hakuna kinachofanya kazi, hata kuhifadhi token/chassis.
- Baada ya hapo anajaza **jina lake** (lazima; simu ni hiari). Akimaliza, anaanza kutumia moja kwa moja - **hakuna approval ya owner**.
- Owner bado anaona kila mtu kwenye Devices na anaweza ku-block mtu au kompyuta. Chaguo la Approval limeondolewa kwenye Access settings.
- Rekodi ya kompyuta sasa ni kompyuta + akaunti, kwa hiyo watu wawili wakitumia kompyuta moja kila mmoja anasajiliwa kwa jina lake.
- Kompyuta ambazo bado zimeunganishwa na akaunti ya pamoja ya ofisi: bonyeza Gimis Charms > Cloud storage > Disconnect, kisha kila mtu aingie na akaunti yake.

# GPSA GIMIS Token Helper v2 (bila Firebase)
1. chrome://extensions > Developer mode > Load unpacked > chagua folda hii. (Ukiwa na toleo la zamani, lifute/Reload.)
2. Ingia GIMIS, fungua "Get Issue Note Token" mara moja (extension inachukua session).
3. Bonyeza kitufe kijani "Gimis Charms" chini kulia.
4. Bandika token + chassis (mstari mmoja kila moja), andika jina la aliye-permit, bonyeza Hifadhi.
5. "Issue zote zilizo pending" (au tiki Auto). Zilizofanikiwa zinakuwa issued; zilizoshindwa mara 5 zinakuwa failed.
Data inahifadhiwa kwenye Chrome ya kompyuta hii (chrome.storage.local). Tumia "Export CSV" kwa backup/ripoti.

## Mpya v2.1
- Token zote zinabaki kwenye Chrome ya kompyuta hii hata ukizima/kuwasha (hakuna kinachofutwa kiotomatiki).
- Tiki token (au tiki juu ya jedwali kuchagua zote) kisha "Futa zilizochaguliwa" kufuta zilizochaguliwa tu.
- "Backup (JSON)" / "Rudisha Backup" kulinda data ukibadilisha kompyuta au ukifuta data ya Chrome.

## Mpya v2.2 - Check token if issued (automation)
- Kitufe "Check issued (GIMIS)": kinasoma GIMIS na kuweka **issued** zile token zilizokwisha issue (hata kama ziliissue kwa mkono GIMIS). Bila uchaguzi: pending + failed + issued zisizothibitishwa. Ukichagua token (tiki): zilizochaguliwa tu; issued isiyothibitika inarudi pending.
- "Auto-check kila dakika 10": inajikagua yenyewe nyuma ya pazia (inahitaji ukurasa wa GIMIS uwe wazi na umeingia).
- "Issue zote zilizo pending" sasa inacheck kwanza (inaruka zilizokwisha issue) na kuthibitisha kila moja baada ya Save.
- Jedwali: ✓ = imethibitishwa GIMIS, ⚠ = tuliweka issued lakini GIMIS haijathibitisha. Hover kuona ref ya GIN na aliyepokea.
- Siku zilizobaki sasa zinatumia tarehe halisi ya expiry ya GIMIS (expireOn) zinapopatikana.

## Mpya v2.3 - Tarehe za token
- Bonyeza safu yoyote kwenye jedwali kufungua section ya maelezo chini yake: **token ilitengenezwa lini (na mteja)**, inaisha lini, **ilipo-issue GIMIS (confirmed)**, muda uliochukua, namba ya GIN, aliyepokea, na ilihifadhiwa lini hapa. "Refresh kutoka GIMIS" inasasisha token hiyo moja.
- Tooltip (kipanya juu ya safu) nayo inaonyesha tarehe hizo mbili.
- "Check issued" inajaza tarehe kwa token zilizokuwepo tayari (mara moja kwa kila token), kisha haizirudii.
- CSV ina safu mpya: tokenCreatedAt, gimisIssuedAt.
- "≈" inamaanisha tarehe imetoka kwenye issue note (karibu na kutengenezwa) kwa sababu GIMIS haikurudisha tarehe ya token yenyewe.

## Mpya v2.4 - Dashboard kubwa + GIN details (English)
- Dashboard sasa ni kubwa (upana hadi 1320px, karibu urefu wote wa skrini): kushoto vitufe vyote na log, kulia jedwali la token na maelezo chini - vyote vinaonekana pamoja.
- Jedwali lina safu mpya: Institution, Fuel, Litres, Unit price kwa kila token.
- Baada ya **Check issued** (token moja / Refresh) au baada ya **Issue**, maelezo ya token yanaonekana mara moja chini ya jedwali (English): Institution / Station / Wallet, Request (title, tracking number, type), Vehicle chassis, Requester (name, email), Fuel (type, litres, unit price, estimated total), Dates (created, issued) na namba ya GIN.
- Token zilizokuwepo kabla ya v2.4 zinajaza maelezo mara moja zikichekiwa (Check issued) au kwa kubonyeza safu kisha "Refresh from GIMIS".
- Estimated total = litres x unit price, ni makadirio tu, si kiasi kilicholipwa rasmi.
- CSV ina safu mpya: shop, wallet, requestTitle, trackingNumber, requisitionType, requesterName, requesterEmail, fuelType, litres, unitPrice, estimatedTotal.

## v2.6 - Cloud storage (Firebase), pamoja na backup iliyokuwepo
Sasa data ya token inahifadhiwa kwa **njia mbili tofauti**, kama ambavyo zilivyoombwa:
1. **Cloud storage ndani ya extension** (mpya): token na maelezo yake yote (chassis, status, GIN, institution, fuel, tarehe n.k.) zinahifadhiwa kwenye Firestore (Firebase), chini ya akaunti moja ya pamoja ya ofisi. Kompyuta yoyote iliyounganishwa na akaunti hiyo hiyo inaona token zilezile papo hapo - hakuna kutuma faili kwa mkono.
2. **External backup** (ilivyokuwepo): kitufe "Backup (JSON)" / "Rudisha Backup" bado kinafanya kazi kama kawaida, kwa ajili ya nakala ya nje (kompyuta nyingine, hifadhi ya ziada).

### Jinsi ya kuwasha Cloud storage
1. Tengeneza mradi wa Firebase (console.firebase.google.com) - washa **Authentication > Email/Password** na tengeneza akaunti moja ya ofisi (email + password), kisha washa **Firestore Database** (mode: production, na rules zinazoruhusu tu watumiaji walioingia - request.auth != null).
2. Chukua **Web API key** na **Project ID** kwenye Firebase console (Project settings).
3. Kwenye extension, bonyeza "☁ Cloud storage" > jaza API key, Project ID, Email, Password > "Connect". Hii inafanyika **mara moja tu kwa kila kompyuta** - password haihifadhiwi, inatumika mara moja tu kuingia kisha extension inatunza "refresh token" peke yake.
4. Baada ya kuunganisha: kila "Save", "Issue", "Check" au "Delete" inasasisha cloud kiotomatiki (baada ya sekunde ~1), na kila kufungua dirisha la "Gimis Charms" kunavuta (pull) data mpya kutoka cloud na kuichanganya (merge) na iliyoko kwenye kompyuta hii - kwa kutumia muda wa badiliko la mwisho (last-write-wins) kuepusha mgongano.
5. "Sync now" ndani ya paneli ya Cloud inalazimisha usasishaji wa papo hapo pande zote mbili. "Disconnect" inazima muunganiko kwenye kompyuta hiyo tu (data kwenye Firestore na kwenye kompyuta nyingine haziguswi).

**Usalama:** akaunti ya Firebase inayotumika hapa ina uwezo wa kusoma/kuandika token zote za ofisi - itumike kwa kompyuta za ofisini pekee, isishirikishwe nje, na Firestore Security Rules zihakikishe ni watumiaji walioruhusiwa pekee wanaosoma/kuandika.

## v2.6.1 - SMS/WhatsApp alert ya token zinazokaribia expire (siku 5)
Hii ni sehemu inayoendesha **Firebase (Cloud Function)**, si ndani ya extension, kwa sababu
alert ya uhakika lazima ifanye kazi hata kama hakuna kompyuta iliyo wazi siku hiyo.

### Jinsi inavyofanya kazi
- Kila siku saa 08:00 (saa za Dar es Salaam), function `expiryAlerts` inasoma token zote za
  `status: pending` kwenye Firestore (collection ileile inayotumiwa na extension - `gpsaQueue`).
- Zenye siku 5 au chache kubaki kabla ya expire zinatumiwa:
  1. **Muhtasari mmoja** (SMS + WhatsApp) kwa namba za ofisi/msimamizi ulizoweka.
  2. **Alert ya mtu binafsi** kwa "aliye-permit" wa token hiyo, IKIWA ulijaza namba yake ya
     simu kwenye sehemu mpya "Permitter phone (optional)" uliyoongezwa kwenye fomu ya Save
     ndani ya extension.
- Token hairudishiwi alert siku hiyo hiyo mara ya pili (inawekewa `alertedOn`), lakini itaendelea
  kupata alert kila siku mpaka itakapo-issue au i-expire kabisa.

### Hatua za kuwasha (mara moja)
1. **Firebase Blaze**: console.firebase.google.com > mradi wako > Project settings > Usage and
   billing > Modify plan > chagua **Blaze** (unaongeza njia ya malipo; Spark haifanyi kazi hapa
   kwa sababu Cloud Functions za Spark haziruhusiwi kupiga API za nje kama Twilio).
2. **Twilio**: fungua akaunti www.twilio.com > chukua **Account SID** na **Auth Token**
   (Console Dashboard) > nunua namba moja ya SMS (Phone Numbers) > washa **WhatsApp**
   (Messaging > Try it out > WhatsApp Sandbox kwa majaribio, au WhatsApp Business API
   iliyoidhinishwa kwa matumizi rasmi ya uzalishaji).
3. **Firebase CLI**: `npm install -g firebase-tools` kisha `firebase login` na
   `firebase use --add` (chagua mradi wako wa Firebase - ule ule wa Cloud storage).
4. **Weka siri (secrets)** - hazitaonekana kwenye code wala kwenye extension:
   ```
   firebase functions:secrets:set TWILIO_ACCOUNT_SID
   firebase functions:secrets:set TWILIO_AUTH_TOKEN
   firebase functions:secrets:set TWILIO_SMS_FROM        # mfano +15017122661
   firebase functions:secrets:set TWILIO_WHATSAPP_FROM   # namba ya WhatsApp, BILA "whatsapp:" mbele
   firebase functions:secrets:set OFFICE_SMS_TO           # mfano +255700000000,+255700000001
   firebase functions:secrets:set OFFICE_WHATSAPP_TO      # namba hizo hizo au nyingine, comma-separated
   ```
5. **Firestore rules**: `firebase deploy --only firestore:rules` (zinaruhusu kusoma/kuandika kwa
   akaunti iliyoingia tu - ndiyo akaunti ya ofisi iliyotumika kwenye "Cloud storage" ya extension).
6. **Deploy function**: kutoka kwenye folda ya mradi (ile inayo `functions/` na `firebase.json`):
   ```
   cd functions && npm install && cd ..
   firebase deploy --only functions
   ```
7. Jaribu mara moja bila kusubiri saa 08:00: Firebase Console > Functions > `expiryAlerts` >
   "Run now" / "Test function" (au Cloud Scheduler > trigger manually).

**Gharama:** Firebase Cloud Functions ina kiwango cha bure kila mwezi (kinatosha kazi hii ndogo
ya mara moja kwa siku). Unacholipa ni hasa Twilio - kwa SMS/WhatsApp chache kwa siku gharama ni
ndogo; angalia bei za sasa kwenye twilio.com/pricing kwa namba za Tanzania.

## v2.5 - Separate mandatory inputs + English interface
- The old single box is now two required boxes: "Token numbers" and "Chassis numbers (vehicle)", one value per line, matched by line order. Each token must have exactly one chassis number.
- Save is refused (nothing is stored) if the permitter name, the tokens or the chassis numbers are missing, if the counts differ, or if a line contains spaces/separators. Missing fields turn red and the log explains why.
- All labels, messages, confirmations and tooltips are now in English.


## v2.7.0 - Built-in Firebase project + Cloud storage records tab
- The Firebase Web API key and Project ID (project gpsa-fuel-record) are now built into the extension. On "Cloud storage" you only type the email and the password. A "Use a different Firebase project (optional)" section is there only if the project ever changes.
- New tab "Cloud storage records" on the dashboard: lists everything saved in the cloud (token, chassis, institution, status, permitter, last updated) with a search box and a status filter. The last column shows whether each record is not on this computer, newer in the cloud, up to date or newer on this computer.
- "Pull selected" copies only the ticked records to this computer, "Pull all" brings every missing record and every record that is newer in the cloud, "Refresh from cloud" reloads the list.
- Firebase must have: Authentication > Email/Password switched on with one office user, and Firestore Database created. Rules: allow read, write on gpsaQueue/{doc} if request.auth != null.


## v2.8.0 - Storage rules, search, exact reasons, bigger log
**1. Storage (cloud + this computer) now follows one simple rule set**
- The token number is the one unique key. Saving a token that already exists with a different chassis is refused with a clear message.
- A record's "last updated" time changes only when that record really changes (before, every Save re-stamped every record, so cloud and computer copies kept overwriting each other).
- One sync routine (Save/Issue/Check/Delete trigger it automatically ~4 s later, "Sync now" runs it at once): read cloud, newest copy wins per token, upload only what is newer on this computer.
- Deletes are remembered, so a token deleted here is not brought back from the cloud (and the other way round).

**2. Search** (box above the table, "This computer" tab)
- Type part of a token, a chassis number, institution, GIN or permitter. Statuses can be filtered.
- Type a full token: its details open automatically. Type a full chassis number: a vehicle overview lists every token of that vehicle (status, institution, fuel, litres, dates, GIN, last result); click a row for full details. In a token's details, "All tokens of this vehicle" does the same.
- No match? One click searches the Cloud storage records.

**3. Exact reasons instead of guesses**
When GIMIS returns "not found" the extension asks GIMIS again in other ways to find the real cause and reports one of: wrong chassis number (and which vehicle GIMIS has for that token), token not known to GIMIS (does not exist or expired), token already used, token expired when issuing, GIMIS refused (with GIMIS' own message). Wrong chassis / expired / refused tokens become **failed** at once (no 5 useless retries); use "Reset failed to pending" after correcting.
- The activity log merges repeated lines (x2, x3), colours results, and is cleared when you start something else (new action, search, click another token or tab) - old results do not pile up. Automatic runs never wipe your log and stay silent when there is nothing to do.

**4. Bigger log**
The log is now a separate panel (about 42% of the left column, larger text) with a Clear button and a button to make it taller.


## v2.8.1 - One exact reason + GIMIS pop-up messages kept per token
- A token that is not issued now shows ONE reason in the new **Reason** column (and in its details / vehicle overview / cloud list): GIMIS' own message, e.g. "No Record Found (GIMIS code 9002)", or the exact finding when it is proven (e.g. "Wrong chassis number: this token belongs to vehicle X, not Y").
- GIMIS answers only with a code; its page turns it into a pop-up that vanishes after a few seconds. The extension reads that pop-up once, remembers "code = message" (9002 = No Record Found is built in; others are learned the first time GIMIS shows them) and keeps the result on the token for good.
- If you press Request by hand in GIMIS for a saved token (same chassis), GIMIS' answer is stored on that token automatically.
- CSV has a new column: code.


## v2.9.0 - Pull to this computer, Excel export, Excel restore
- **Pull from cloud**: on "Cloud storage records" use Pull selected / Pull pending only / Pull all. The extension then jumps to "This computer" and shows the pulled tokens highlighted in blue at the top (never hidden), ready for Check issued / Issue all pending. "Show only these" filters to them, "Clear highlight" removes the blue.
- **Export Excel**: real .xlsx with sheet "All tokens" and sheet "Failed". Column "Reason (recorded by GIMIS)" holds the message GIMIS gave (e.g. No Record Found, GIMIS code 9002) or the exact finding (e.g. wrong chassis). "Export cloud to Excel" does the same for the cloud list.
- **Restore from Excel**: reads the file made by Export Excel (also a CSV, or the same file saved again in Excel). New records are added, existing ones are kept, and all are shown highlighted on "This computer" straight away. Restored "issued" tokens show ⚠ until Check issued confirms them with GIMIS.
- Restore Backup (JSON) now also shows the restored records right away.


## v2.10.0 - Two parts: Failed to issue / Issued successfully
- Two new tabs next to "This computer", each with a live count:
  - **Failed to issue (n)**: every token that did not get issued - status failed, or still pending with a GIMIS reason (e.g. No Record Found). The Reason column shows why.
  - **Issued successfully (n)**: every token that GIMIS issued.
- Search, status filter, details, select/delete and Check issued work inside each tab. "This computer" still shows everything.
- Export Excel now has 3 sheets: All tokens, Failed, Issued.


## v2.11.0 - One "Upload" button
- New **⬆ Upload** button: (1) sends everything to the cloud storage, (2) automatically downloads an **Excel** file and a **JSON** backup to this device (gpsa-tokens-DATE.xlsx, gpsa-backup-DATE.json). If the cloud is not connected the two files are still saved and the log says so.
- The Excel has the same columns as the old CSV (token, chassis, institution, permittedBy, status, error, code, dates, shop, wallet, requestTitle, trackingNumber, requesterName/Email, fuelType, litres, unitPrice, estimatedTotal ...) with sheets All tokens, Failed, Issued.
- **Restore (Excel / JSON)** is now one button: pick the Excel (or JSON, or old CSV). Every token + chassis number is read and loaded straight into the list, highlighted, and waits for your command: Issue all pending or Check issued.
- Removed: Export Excel, Export CSV, Backup, Restore Backup, Restore from Excel, Export cloud to Excel (all covered by Upload / Restore).
- Chrome may ask once to "allow multiple downloads" from gimis.gpsa.go.tz - choose Allow.


## v2.12.0 - Three parts, expiry watch, duplicate protection
**1. Three parts (tabs) for saved tokens** - each with a live count, next to "This computer" (which still shows everything):
- **Not issued yet (n)**: saved, waiting to be issued, no GIMIS problem recorded (status pending, no reason).
- **Failed to issue (n)**: status failed, or pending with a GIMIS reason (e.g. No Record Found).
- **Issued successfully (n)**: issued by GIMIS.
Every token is in exactly one of the three. Upload (Excel) now has 4 sheets: All tokens, Not issued, Failed, Issued.

**2. Expiry watch (automatic)**
- New bar above the table: how many unissued tokens are expired / expire within 2 days, which one expires next, and when the dates were last read.
- New **Expires** column (all tabs). A plain date = real expiry date read from GIMIS. "≈" = estimate (7 days after saving) because GIMIS has no date for that token.
- The extension reads the real expiry date of every NOT issued token from GIMIS: 20 s after the page opens, then every 30 minutes (switch off with "Auto every 30 minutes"), right after you Save new tokens, and with the **Track expiry now** button. It needs GIMIS open and logged in. It only updates expiry dates - a token is moved to "Issued successfully" only if GIMIS says it was already issued.
- Expired / expiring tokens are listed in the Activity log.

**3. Duplicate protection when saving**
- Before Save, every token is checked in: (a) the list on this computer (all three parts), and (b) the Firebase cloud storage (gpsaQueue) - looked up directly, not only what was pulled earlier.
- A token that already exists is NOT saved. A red notice shows where it is (this computer + which part, or cloud storage), its chassis, who permitted it and when it was saved. The other tokens in the same Save are saved; the refused ones stay in the boxes.
- The check also runs while you type or paste tokens (before pressing Save). A token written twice in the boxes is saved once.
- If the cloud is not connected, only this computer is checked and the log says so. If the cloud check fails (e.g. no internet), you are asked whether to save anyway.
- Tokens deleted on this computer but not yet removed from the cloud count as deleted, not as saved.


## v2.13.0 - Real expiry dates only, Issue selected, short log, Regenerate
**1. No more guessed dates.** The "Expires" column and the Expiry watch bar show ONLY dates read from GIMIS. If GIMIS gives no date for a token (e.g. "No Record Found"), the column says "Not available" and the bar counts it under "no date from GIMIS". Dates are read with `getIssueNoteToken` (token + chassis) and, when that has nothing, from GIMIS' own "my tokens" list (`myIssueNoteTokens`).

**2. Issue selected.** "Issue all pending" is now **Issue selected (n)**. Tick the tokens you want (tick the top box to select everything shown) and press the button. Nothing is issued unless it is ticked; tokens that are already issued are skipped; a failed token you tick again is retried from the start. "Auto every 5 minutes" now issues the tokens that are ticked at that time.

**3. Short activity log.** One line per token result and one final line. No codes, no technical words, no repeated notices (the duplicate-token details are only in the red box; Upload no longer prints file names).

**4. Regenerate selected.** Tick tokens that expired before they were issued and press **Regenerate selected** (or **Regenerate** in a token's details). GIMIS is asked to renew a token only when GIMIS itself shows it as NOT used and ALREADY expired; valid or used tokens are left alone. You are asked to confirm first. After renewing, the extension reads the token back and stores the new expiry date; the token goes back to "pending". If GIMIS gives the token a new number, the log says so (save the new number as a token).


## v2.13.1 - Expiry dates hidden, "P.I.M.P" button
- Expiry dates of tokens that are NOT issued are no longer shown: the "Expires" and "Days left" columns, the Expiry watch bar, the "Expired on ..." text in the Reason column, the expiry lines in the Activity log and the "Expires" row in the details panel (it still shows for issued tokens).
- Automatic expiry reading (20 s after the page opens, every 30 minutes, after Save) is switched off because nothing displays it any more.
- The "Regenerate selected" button is now called **P.I.M.P (n)**. Its behaviour is unchanged (the Regenerate button inside a token's details is also unchanged).


## v2.14.0 - GPSA AI (Gemini) - msaidizi wa Kiswahili
Tab mpya **🤖 AI Assistant** kwenye dashboard (kando ya "Cloud storage records"). Unauliza kwa Kiswahili, AI inajibu kwa kutumia **data halisi**.

### Inavyofanya kazi
- **Ubongo** ni Google Gemini. Maombi yanapita kwenye `background.js` (service worker), kwa hiyo CSP ya GIMIS haiyazuii. Funguo ya Gemini inakaa kwenye kompyuta hii tu (chrome.storage.local).
- Gemini haioni data zote kwa mkupuo. Inapewa **zana za KUSOMA tu** na yenyewe huchagua ipi itumie (function calling):
  1. `data_overview`, `search_tokens`, `vehicle_history`, `group_stats` - token zilizohifadhiwa (kompyuta hii + Firebase `gpsaQueue`, nakala mpya zaidi inashinda).
  2. `gimis_lookup_token`, `gimis_my_tokens`, `gimis_requisition`, `gimis_issue_notes`, `gimis_error_codes` - maswali **ya moja kwa moja kwa seva ya GIMIS** kupitia API za API.xlsx (`findUsedIssueNoteToken`, `getIssueNoteToken`, `myIssueNoteTokens`, `findRequisitionRequestById`, `findIssueNotesByRequsitionId`) kwa session ya GIMIS iliyonaswa na extension.
  3. `firebase_read_collection` - kusoma collection nyingine za Firebase ulizoruhusu (mfano rekodi za mafuta) ili kujifunza muundo wake na kujibu kutokana nazo.
  4. `remember_lesson` - kuhifadhi somo ukimfundisha.
- **Haiwezi** ku-issue, ku-save, kufuta wala kurenew token. Hizo ni vitufe vya dashboard pekee. (Hakuna mutation yoyote kwenye msimbo wa AI.)

### "Kujifunza" - kunafanyaje (kwa uaminifu)
Gemini yenyewe haifundishwi upya; inajifunza kwa **kumbukumbu** inayoshirikiwa na kompyuta zote za ofisi:
- **Learn now** (na kiotomatiki kila baada ya saa 6 ukifungua tab): inasoma token zote, inahesabu mifumo (taasisi kuu, sababu za kushindwa, wastani wa muda hadi issue, magari yenye token nyingi, idadi kwa mwezi, misimbo ya GIMIS, muundo wa collections) na kuhifadhi **muhtasari** - unatumwa kwa AI kila swali.
- **Masomo**: andika "kumbuka kuwa ..." au bonyeza 👍 (inakumbuka zana zilizofanikiwa) / 👎 (unaandika marekebisho). Yanaonekana kwenye Settings > "What the AI has learned" (✕ kufuta). Yanahifadhiwa Firebase collection **gpsaAI** hivyo kompyuta nyingine zinayapata.

### Kuwasha (mara moja kwa kompyuta)
1. Chukua Gemini API key bure: https://aistudio.google.com/apikey
2. Dashboard > **AI Assistant** > Settings > bandika key > **Save** > **Test connection**. Model ya kawaida ni `gemini-flash-latest`; Google ikibadilisha jina, extension inachagua Flash inayofanya kazi yenyewe.
3. Ili kujifunza kwenye Firebase: ruhusu collection mpya kwenye Firestore Rules (ongeza mstari huu, mengine yabaki):
   ```
   match /gpsaAI/{doc} { allow read, write: if request.auth != null; }
   ```
   Bila hii AI inafanya kazi lakini masomo yanabaki kwenye kompyuta hii tu (itakuambia).
4. Collection nyingine (mfano ya Fuel Record): andika majina yake kwenye "Other Firebase collections the AI may READ". AI inaweza kuzisoma tu (rules zako lazima ziruhusu watumiaji walioingia kusoma).
5. Kwa GIMIS ya moja kwa moja: fungua ukurasa "Get Issue Note Token" mara moja baada ya kuingia GIMIS (kama ilivyo kwa Check issued).

### Faragha
Swali lako na data ambayo AI inaitafuta (token, chassis, taasisi, lita, majina ya waombaji) hutumwa kwa Google Gemini ili kuandika jibu. **Barua pepe, namba za simu na funguo za login ya GIMIS HAZITUMWI kamwe.** Kama sera ya ofisi hairuhusu data hii kwenda nje, usiweke API key (tab haitafanya kazi).

### Faili mpya / zilizobadilika
`ai-core.js` (ubongo + zana + prompt ya Kiswahili), `ai.js` (tab ya mazungumzo), `background.js` (Gemini + Firestore ya jumla), `injected.js` (maswali ya kusoma ya GIMIS), `content.js` (tab + madaraja), `manifest.json` (ruhusa ya generativelanguage.googleapis.com).


## v2.14.1 - Mipangilio ya kawaida (config.js)
- Faili mpya **config.js**: jaza mara moja Gemini API key, model, collections za AI, na (si lazima) email + password ya Cloud storage. Extension inazitumia moja kwa moja - hutaandika tena kwenye Settings.
- Vilivyowekwa kwenye Settings vinapewa kipaumbele; config.js ni "default" tu.
- Kwa nini ulilazimika kuandika upya? Chrome huhifadhi mipangilio kwa kila **folda ya extension**. Ukipakia toleo jipya kutoka folda tofauti, Chrome huliona kama extension mpya na mipangilio hupotea. Njia salama: toa zip juu ya folda ile ile, kisha chrome://extensions > Reload. Au nakili config.js yako kwenye toleo jipya.
- USALAMA: config.js ina siri (key / password). Isitumwe nje wala GitHub ya umma.

## v2.15.0 - elapsAI
- AI imepewa jina elapsAI na logo mpya; ujumbe wa kukaribisha umebadilishwa.
- Kitufe cha logo kinaelea kwenye kurasa zote za GIMIS; kukibonyeza kunafungua elapsAI nzima (skrini nzima). Funga kwa X au Esc.

## v2.15.1
- Tab ya elapsAI imeondolewa kwenye Gimis Charms; kitufe cha logo kinaelea hata Gimis Charms ikiwa wazi (karibu na Activity log).

## v2.16.0 - Backup AI
- Gemini ikijaa quota (429) au ikishindwa, elapsAI inabadilisha kiotomatiki kwenda Groq, OpenRouter au Mistral (zile zenye key). Weka key kwenye Settings > Backup AI, kisha Test connection.

## v2.17.0
- Settings za AI (API key, model, backup, collections) zimeondolewa kwenye skrini; zinasomwa kutoka config.js tu na watumiaji hawawezi kuziona wala kuzibadilisha. Kitufe cha Masomo kinaonyesha tu mambo ambayo elapsAI imejifunza.

## v2.18
- Maandishi yote yameongezwa ukubwa (+3px) ili yasomeke kwa urahisi kwa wenye changamoto ya kuona.
- Vitufe vya "Back" na "Forward" juu ya dashboard na juu ya elapsAI: vinakurudisha/kukupeleka kwenye skrini zilizotangulia (tab, cloud records, maelezo ya token, elapsAI).
- elapsAI inajibu salamu kwa usahihi ("Habari" -> "Salama", "Shikamoo" -> "Marahaba", "Hujambo" -> "Sijambo") na inatumia Kiswahili fasaha zaidi.
- Aikoni ya elapsAI imehamishiwa kati ya upande wa kushoto na jedwali (haizuii tena Activity log na notification).

## v2.18.1
- Mstari wa maelezo ya mtoa huduma wa AI (Gemini/Groq/model/lessons) umefichwa kwa mtumiaji.
- Vitufe vya Back/Forward vya elapsAI sasa viko kwa Kiingereza.

## v2.19.0 - elapsAI sasa ni mfanyakazi-dijitali kamili (Generative AI + Tool Use + Code Interpreter + Multimodal)
elapsAI haijibu maswali tu; sasa inapanga kazi, inasoma data ya GIMIS, inachambua na **kutengeneza faili**: Excel, Word, PDF, CSV, ukurasa wa HTML (dashboard), chati (PNG) na picha/michoro (PNG+SVG).

**Jinsi inavyofanya kazi (mtiririko wa kila ombi):** elewa -> panga -> kusanya data -> chambua -> tengeneza -> thibitisha -> jibu. Hadi hatua 16 kwa ombi moja.

**Zana mpya (function calling)** - zote za KUSOMA tu:
- `load_data`: pakia ripoti kwenye "workspace": issue_notes_report (miezi yoyote, inagawanywa kwa mwezi), depot_lpo_report, bin_card (diesel/petrol), token zilizohifadhiwa, token za GIMIS, Firebase.
- `gimis_query`: query yoyote ya GraphQL ya GIMIS (kusoma tu). `mutation`, `subscription` na field zinazobadilisha (issue*, save*, regenerate*, update*, delete*...) zinakataliwa na kinga mbili (kwenye extension na kwenye ukurasa wa GIMIS).
- `gimis_schema`: inagundua API zote za GIMIS kwa introspection (ikiwa GIMIS inaruhusu).
- `gimis_find_api`: inatafuta query zinazotumiwa na ukurasa wa GIMIS wenyewe (inaskani scripts zake) - njia mbadala introspection ikikataliwa; query iliyofanya kazi huhifadhiwa kwa matumizi yajayo.
- `dataset_query`: kuchuja/kupanga/kujumlisha data (kama SQL) bila code; tarehe zinaweza kupangwa kwa mwezi ("Issue Date:month").
- `run_code`: Code Interpreter - JavaScript inayoendeshwa kwenye sandbox ISIYO na mtandao (haiwezi kutuma data nje wala kugusa GIMIS).
- `create_file`, `create_chart`, `create_image`: Excel (jumla kwa formula, vichwa, filter, freeze), Word, PDF (jedwali + chati), CSV, HTML, SVG->PNG.

**Data kubwa haipiti kwa AI**: inakaa kwenye workspace ndani ya kivinjari; AI inaona muhtasari (safu, aina, jumla, sampuli) tu, na faili zinajengwa hapa hapa kwenye kompyuta yako.

**Viambatisho (Multimodal):** kitufe cha 📎, buruta-dondosha, au bandika (paste) - picha na PDF (AI inaziona), Excel/CSV (zinakuwa dataset), Word/txt/json (maandishi yanasomwa).

**Vitufe vipya:** "Workspace" (angalia/pakua data kama Excel) na "Hali ya uwezo" (inajaribu GIMIS, introspection, sandbox, michoro, usomaji wa Excel - bonyeza hiki kwanza ukisakinisha).

Faili: ai-files.js (injini ya Excel/Word/PDF/chati), ai-engine.js (kinga ya GraphQL, uchambuzi), ai-tools.js (zana), ai-sandbox.html/js (code interpreter), ai-core.js (ubongo + prompt), ai.js (kiolesura). Manifest imeongezewa "sandbox" yenye CSP isiyoruhusu mtandao.


## v2.20.0 - Devices & access control (like WhatsApp "linked devices") + Auto-update
**1. Every computer is registered.** First time (after Cloud storage is connected) the user types their name (phone optional). The owner sees, for every computer: name, phone, GIMIS account (if found), browser + computer type, IP address, version, first seen, last seen, Online now, status.
**2. Owner console** = toolbar icon of the extension (or "Control" button on the dashboard) > sign in with the OWNER Firebase account. Tabs: Devices (Approve / Block / Unblock / Block account / Edit / Remove), Access settings (Open or Approval mode, contact shown to blocked users, blocked accounts), Updates (Publish).
- Block takes effect within ~5 minutes while GIMIS is open (2 minutes for a blocked computer that is checking). A blocked computer cannot use Gimis Charms, elapsAI, cloud data or AI.
- Approval mode: new computers wait until the owner approves. Safest, because a blocked person cannot come back by reinstalling.
- If a computer cannot reach the server it keeps working for 24 hours, then locks until it is online.
**3. Auto-update.** Change the extension, raise "version" in manifest.json, reload it on your computer, test, then Owner console > Updates > Publish. Every computer sees the new version within minutes and shows "Update available". The updater page copies the new files into the extension folder (hash-checked, old files restored if anything fails) and reloads the extension and the GIMIS tabs. First time on each computer: press "Update now" and choose the extension folder once; afterwards the update starts by itself.
- "Force this update" locks computers on older versions until they update.
- config.js is never overwritten by an update (it holds local keys/passwords).
**One-time setup (owner):** (a) Firebase > Authentication > create an OWNER user (email + password), copy its UID. (b) Add the blocks in firestore-rules-v2.20.txt to your Firestore rules (put the UID) and Publish. (c) Distribute v2.20.0 once the old way; later versions go through Publish.
**Limits:** Chrome only auto-updates extensions from the Chrome Web Store; for a folder-loaded extension the updater above is the closest possible. Blocking is enforced inside the extension: someone who edits the extension code on their own computer could bypass it, so use Approval mode and change the shared office password if someone must be cut off completely.
**New files:** access-bg.js, access.js, owner.html/js, updater.html/js, firestore-rules-v2.20.txt.
