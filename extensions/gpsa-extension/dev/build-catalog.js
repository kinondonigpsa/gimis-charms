#!/usr/bin/env node
// dev/build-catalog.js - turns a captured GIMIS API catalog (JSON exported by your capture tool) into ../gimis-api-catalog.js,
// the file elapsAI reads at run time (window.GIMIS_API_CATALOG).
//
// Use:   node dev/build-catalog.js dev/gimis-api-catalog-2026-10-22.json
// Later: capture a new catalog, drop the JSON in dev/, run the same command with the new file name, raise "version" in
//        manifest.json, reload the extension, then Owner console > Updates > Publish.
//
// What it adds on top of the raw capture: group, short description, argument list (from the query header), the fields each
// query returns, normalised pages that use it, safe defaults (paging, XLSX), and a READ-ONLY verdict from the SAME guard
// that the extension uses at run time (ai-engine.js guardQuery), so the catalog and the runtime can never disagree.
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const C = require(path.join(root, 'ai-engine.js'));
const src = process.argv[2] || path.join(__dirname, 'gimis-api-catalog-2026-10-22.json');
const outFile = process.argv[3] || path.join(root, 'gimis-api-catalog.js');
const raw = JSON.parse(fs.readFileSync(src, 'utf8'));

const GROUPS = {
  tokens: 'Token za Issue Note (kuangalia, hali, tarehe)',
  issue_notes: 'Issue notes na vitu vilivyotolewa (GIN)',
  requisitions: 'Maombi ya mafuta/bidhaa (requisition requests)',
  fuel_forms: 'Fuel requisition forms na stock taking ya mafuta',
  lpo_receiving: 'LPO, kupokea mali na receipt vouchers',
  stores_stock: 'Stoo, bin cards, depot na stock taking',
  transfers_indents: 'Uhamisho (DTCV), dispatch na draft indents',
  wallets_bills: 'Wallets, malipo na bills (GePG)',
  reports: 'Ripoti za GIMIS (Excel/PDF, kipindi cha tarehe)',
  committees: 'Kamati na wajumbe',
  catalogue_items: 'Katalogi ya bidhaa na item groups',
  admin_org: 'Taasisi, watumiaji, maeneo, wasambazaji na mipangilio',
  other: 'Nyingine'
};
function groupOf(n, type) {
  const t = n;
  if (/token/i.test(t)) return 'tokens';
  if (/Report$|Report[A-Z]|^export|FilePdf|PermitsPdf|ReportBy|PendingPayments|CollectionsByServiceType/.test(t)) return 'reports';
  if (/FuelRequisitionForm|FuelDailyStock/.test(t)) return 'fuel_forms';
  if (/issueNote|IssueNote|issuedItem|issueItems/.test(t)) return 'issue_notes';
  if (/requisition|RequestItem|requestItem/i.test(t)) return 'requisitions';
  if (/committee/i.test(t) && !/lpo/i.test(t)) return 'committees';
  if (/lpo|LocalPurchaseOrder|receiptVoucher|StoreReceipt|listVehicleOrder/i.test(t)) return 'lpo_receiving';
  if (/dtcv|dispatch|draftIndent|DraftIndent/i.test(t)) return 'transfers_indents';
  if (/binCard|BinCard|stockTaking|StockTaking|shopStore|ShopStore|shed|Shed|reconciliation|Reconciliation|depot/i.test(t)) return 'stores_stock';
  if (/wallet|bill|gepg|CNRequest|Payment|CollectionsBy/i.test(t)) return 'wallets_bills';
  if (/catalogue|itemGroup|allItems|ItemsBy/i.test(t)) return 'catalogue_items';
  if (/user|institution|department|designation|administrativeArea|approvalConfiguration|supplier|myDetails|handOver|Notification|password|renting|Renting|getDocumentContent/i.test(t)) return 'admin_org';
  return 'other';
}

// curated Swahili descriptions for the operations that matter most (the rest get a description built from the name)
const HINTS = {
  getIssueNoteToken: 'Angalia token pamoja na namba ya gari (vehicleRegNo = chassis): inarudisha issue note, lita, taasisi na tarehe za token. Ndiyo REQUEST ya ukurasa wa Get Issue Note Token.',
  findUsedIssueNoteToken: 'Angalia kama token imeshatumika/issued. Code 9002 = No Record Found.',
  myIssueNoteTokens: 'Token zote za mtumiaji wa GIMIS aliyeingia: used, createdAt, expireOn.',
  myIssueNoteTokensPageable: 'Token za mtumiaji wa GIMIS aliyeingia kwa kurasa (pageableParam).',
  myIssueNoteTokenByUuid: 'Token moja kwa uuid ya token (tokenByUuid).',
  issueNoteTokensUsed: 'Orodha ya token zilizotumika, kwa kurasa (pageableParam).',
  regenerateIssueNoteToken: 'Inarenew token ya issue note. INABADILISHA data (jina linaonekana kama query lakini ni kitendo).',
  issueNoteItemsInShopPageable: 'Vitu vilivyotolewa (issue note items) kwenye kituo kwa kipindi: startDate/endDate (YYYY-MM-DD), kwa kurasa.',
  exportIssueNoteItemsInShop: 'Ripoti ya Issue Note items za kituo kwa kipindi, kama Excel (exportDocType XLSX).',
  findIssueNotesByRequsitionId: 'Issue notes za request moja (requisitionRequestId): vitu, lita, token, aliyepokea.',
  findInstIssueNotesByRequisitionId: 'Issue notes za request moja, mtazamo wa taasisi.',
  findIssueNoteByUuid: 'Issue note moja kwa uuid.',
  findRequisitionRequestById: 'Request (requisition) moja kwa id: taasisi, kituo, wallet, kiasi, vitu, hali.',
  findInstRequisitionRequestById: 'Request moja kwa id, mtazamo wa taasisi.',
  findRequestItemByRequestId: 'Vitu vya request moja (requestId).',
  findInstRequestItemByRequestId: 'Vitu vya request moja, mtazamo wa taasisi.',
  allRequisitionRequestsPageable: 'Requests zote kwa kurasa; chuja kwa requisitionType.',
  allShopRequisitionRequestsPageable: 'Requests za kituo kwa kurasa; requisitionTypes ni orodha.',
  allShopRequisitionRequestsStageType: 'Requests za kituo kwa hatua (stage) na aina (requisitionType), kwa kurasa.',
  allInstRequisitionRequestsPageable: 'Requests za taasisi kwa kurasa.',
  allInstRequisitionRequestsAndStage: 'Requests za taasisi kwa hatua (stage), kwa kurasa.',
  privateCustomsRequisitionRequestsInMyShop: 'Requests za private/customs kwenye kituo changu, kwa kurasa.',
  getBillByBillNumber: 'Bill (control number) moja kwa billNumber: kiasi, hali ya malipo.',
  findBillsByShopAndType: 'Bills za kituo kwa aina ya rejea (billRefferenceType), kwa kurasa.',
  getWalletsByUserInstitution: 'Wallets za taasisi ya mtumiaji aliyeingia.',
  getWalletByWalletUuid: 'Wallet moja kwa uuid.',
  getAllWalletList: 'Wallets zote kwa kurasa.',
  getAllWalletTransactionsPageable: 'Miamala ya wallet moja (walletUuid), kwa kurasa.',
  getWalletStatementByDates: 'Statement ya wallet kwa kipindi (uuid, startDate, endDate).',
  walletDepotBalances: 'Salio la wallets kwa kila depot.',
  walletRechargeRequestsByStatusPageable: 'Maombi ya kuweka fedha kwenye wallet kwa hali ya idhini (requestApprovalStatus) na billed.',
  findAllLocalPurchaseOrdersPageable: 'LPO zote kwa kurasa; chuja kwa itemGroupType (mfano Fuel).',
  findLpoByUuid: 'LPO moja kwa uuid: msambazaji, thamani, hali, kamati.',
  findLpoItemsByLpoId: 'Vitu vya LPO moja (lpoid).',
  lpoItemReceivedByLpoId: 'Vitu vya LPO vilivyopokelewa (lpoId).',
  findStoreReceiptVoucherByLpoId: 'Store receipt vouchers za LPO moja (lpoId).',
  lposRegisterPageable: 'Rejista ya LPO kwa kipindi (startDate, endDate), kwa kurasa.',
  currentAssignedLpos: 'LPO zilizokabidhiwa kwa mtumiaji sasa.',
  readyToReceiveMyDepotLocalPurchaseOrders: 'LPO za depot yangu zilizo tayari kupokelewa, kwa kurasa.',
  getLpoFilteredByDepotsReport: 'Ripoti ya LPO kwa depot(s): shopStoreUuids, fromDate, toDate, itemGroupType, exportDocType.',
  getLpoFilteredByVehiclesReport: 'Ripoti ya LPO kwa magari (fromDate, toDate, taasisi/msambazaji).',
  binCardItemTransactionsMyShopByItemId: 'Miamala ya bin card ya kituo changu kwa item: itemId (Diesel = 5, Petrol = 6), startDate/endDate, kwa kurasa.',
  binCardItemTransactionsByShopUuidAndItemId: 'Miamala ya bin card ya kituo fulani (shopStoreUuid) kwa item.',
  binCardItemTransactionsByLpo: 'Miamala ya bin card ya LPO moja (lpoId).',
  exportBinCardTransactionsReport: 'Ripoti ya miamala ya bin card (binCardUuid, kipindi) kama Excel.',
  myShopStoreBinCardsPageable: 'Bin cards za kituo changu kwa kurasa.',
  allBinCardsPageable: 'Bin cards zote kwa kurasa.',
  shopStores: 'Vituo/depots (shop stores) kwa kurasa.',
  shopStoreByUuid: 'Kituo/depot kimoja kwa uuid.',
  allFuelDailyStockTakingsPageable: 'Stock taking ya kila siku ya mafuta kwa kurasa.',
  allFuelRequisitionFormsByPageable: 'Fuel requisition forms kwa kurasa (itemGroupType).',
  findFuelRequisitionFormByUuid: 'Fuel requisition form moja kwa uuid.',
  allDtcvsByPageable: 'DTCV (depot transfer credit vouchers) zote kwa kurasa.',
  findDtcvByUuid: 'DTCV moja kwa uuid.',
  myDtcvsToReceiveByPageable: 'DTCV ninazopaswa kupokea, kwa kurasa.',
  allDraftIndentsPageable: 'Draft indents zote kwa kurasa.',
  findDraftIndentByUuid: 'Draft indent moja kwa uuid.',
  getOverallRevenueReport: 'Ripoti ya mapato ya jumla kwa kipindi (fromDate, toDate).',
  getRevenueReport: 'Ripoti ya mapato kwa kituo/eneo/item group na kipindi.',
  getSalesReportAllRegions: 'Ripoti ya mauzo ya mikoa yote kwa kipindi.',
  getDetailedCollectionReport: 'Ripoti ya makusanyo kwa undani kwa kipindi.',
  getCollectionsByServiceType: 'Makusanyo kwa aina ya huduma na kipindi.',
  getPendingPayments: 'Malipo yanayosubiri kwa kituo na kipindi.',
  getAllWalletBalanceReport: 'Ripoti ya salio la wallets zote kwa tarehe (balanceDate).',
  getItemBalanceByClassAllShopsReport: 'Salio la bidhaa kwa daraja kwenye vituo vyote kwa tarehe (balanceDate).',
  getTransferInOutReport: 'Ripoti ya uhamisho wa kuingia/kutoka kwa kipindi.',
  userList: 'Watumiaji wa taasisi (institutionId, enabled). Barua pepe na simu hufichwa kwa AI.',
  users: 'Watumiaji wa GIMIS. Barua pepe na simu hufichwa kwa AI.',
  myDetails: 'Taarifa za mtumiaji aliyeingia. Barua pepe na simu hufichwa kwa AI.',
  institutionList: 'Taasisi zote (code, jina).',
  institutionListPageable: 'Taasisi kwa kurasa.',
  findInstitutionByUuid: 'Taasisi moja kwa uuid.',
  allSuppliersByStatus: 'Wasambazaji kwa hali (status).',
  allSuppliersPageable: 'Wasambazaji kwa kurasa.',
  administrativeAreaAll: 'Maeneo ya utawala (mikoa/wilaya) kwa aina na kurasa.',
  listAppNotifications: 'Arifa za mfumo wa GIMIS kwa mtumiaji.',
  checkPasswordExpiryRemainingDay: 'Siku zilizobaki kabla password ya mtumiaji kuisha (pia hutumika kupima kikao cha GIMIS).',
  findAllCataloguesPageable: 'Katalogi za bidhaa kwa kurasa.',
  findAllItemGroupsPageable: 'Item groups kwa kurasa.',
  allItemsByGroupId: 'Bidhaa za item group moja.',
  allItemsByStatusPageable: 'Bidhaa kwa hali (status), kwa kurasa.',
  getBase64LpoByUuid: 'LPO kama faili ya PDF (base64) - AI haiwezi kuisoma kama jedwali.',
  getDocumentContentByFileName: 'Maudhui ya hati kwa jina la faili (base64) - AI haiwezi kuisoma kama jedwali.'
};
const BLOCK_HINT = {
  issueItemsSelected: 'Kutoa/issue token: tumia "Issue selected" kwenye dashboard ya GPSA Queue au SAVE kwenye ukurasa wa Get Issue Note Token.',
  regenerateIssueNoteToken: 'Kurenew token: tumia kitufe cha P.I.M.P kwenye dashboard ya GPSA Queue.'
};

const words = (n) => n.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\bUuid\b/i, 'uuid').toLowerCase();
const collapse = (q) => q.replace(/\s+/g, ' ').replace(/\s*([{}(),:])\s*/g, '$1 ').replace(/\s+/g, ' ').trim();

// variables with their GraphQL types, from the operation header
function argsOf(q) {
  const m = /^\s*(?:query|mutation)\s+\w+\s*\(([^)]*)\)/.exec(q.replace(/\s+/g, ' '));
  if (!m) return [];
  const out = []; const re = /\$(\w+)\s*:\s*([\[\]\w!]+)/g; let x; while ((x = re.exec(m[1]))) out.push([x[1], x[2]]); return out;
}
// field paths the query returns (depth <= 3, max 40) - tells the AI which columns it will get
function fieldsOf(q) {
  const tk = q.match(/[A-Za-z_]\w*|[{}()]/g) || [], out = []; let i = 0;
  while (i < tk.length && tk[i] !== '{') i++;                  // start of the operation body
  i++;                                                          // inside the body: first token is the root field
  if (tk[i] === undefined) return out;
  i++;                                                          // skip the root field name
  if (tk[i] === '(') { let d = 0; do { if (tk[i] === '(') d++; if (tk[i] === ')') d--; i++; } while (i < tk.length && d > 0); }
  if (tk[i] !== '{') return out;
  const stack = []; let cur = '';
  for (i = i + 1; i < tk.length; i++) {
    const t = tk[i];
    if (t === '(') { let d = 0; do { if (tk[i] === '(') d++; if (tk[i] === ')') d--; i++; } while (i < tk.length && d > 0); i--; continue; }
    if (t === '{') { stack.push(cur); continue; }
    if (t === '}') { if (!stack.length) break; stack.pop(); continue; }
    const base = stack.filter(Boolean).join('.'); cur = t;
    const next = tk[i + 1];
    if (next !== '{' && next !== '(') out.push((base ? base + '.' : '') + t);
    if (next === '(') { /* field with arguments followed by a selection */ }
  }
  return out.filter((p) => p.split('.').length <= 4).slice(0, 40);
}
const idLike = (s) => /%|=|^[A-Za-z0-9+]{16,}$/.test(s);
function pagesOf(pages) {
  const seen = new Set(); (pages || []).forEach((p) => { const n = String(p).split('?')[0].split('/').map((s) => idLike(s) ? ':id' : s).join('/'); seen.add(n); });
  return [...seen].slice(0, 4);
}

const ops = {}; let safe = 0, blocked = 0; const warn = [];
Object.keys(raw.operations).sort().forEach((n) => {
  const o = raw.operations[n]; if (!o.query) { warn.push(n + ': no query text'); return; }
  const g = C.guardQuery(o.query), type = o.type === 'mutation' ? 'm' : 'q';
  const a = argsOf(o.query), v = {};
  a.forEach(([name, ty]) => { if (ty === 'PageableParamInput') v[name] = { first: 0, size: 100, sortBy: 'updatedAt', sortDirection: 'DESC' }; else if (ty === 'ExportDocType') v[name] = 'XLSX'; });
  const rec = { t: type, g: groupOf(n, type), d: HINTS[n] || words(n), a, q: collapse(o.query), p: pagesOf(o.pages), c: o.calls || 0, s: g.ok ? 1 : 0 };
  const f = fieldsOf(rec.q); if (f.length) rec.r = f;
  if (Object.keys(v).length) rec.v = v;
  if (g.ok) { safe++; if (C.ALLOW_READ && C.ALLOW_READ.has(n)) rec.n = 'Jina linaanza na kitenzi cha kubadilisha lakini ni orodha ya kusoma; imeruhusiwa kwa makusudi.'; }
  else { blocked++; rec.w = type === 'm' ? 'mutation: inabadilisha data' : 'jina la field linaonyesha kubadilisha data'; rec.h = BLOCK_HINT[n] || 'Fanya kitendo hiki kwenye ukurasa husika wa GIMIS.'; }
  ops[n] = rec;
});
const meta = { source: path.basename(src), exportedAt: raw.meta && raw.meta.exportedAt, total: Object.keys(ops).length, queries: Object.values(ops).filter((o) => o.t === 'q').length, mutations: Object.values(ops).filter((o) => o.t === 'm').length, readSafe: safe, blocked, builtAt: new Date().toISOString().slice(0, 10) };
const body = '// gimis-api-catalog.js - GENERATED by dev/build-catalog.js from ' + meta.source + ' - do not edit by hand.\n// Catalog of GIMIS GraphQL operations that elapsAI knows (read at run time by ai-tools.js / ai-core.js).\n' +
  '(function (root) {\n  root.GIMIS_API_CATALOG = ' + JSON.stringify({ meta, groups: GROUPS, ops }) + ';\n})(typeof window !== \'undefined\' ? window : globalThis);\n';
fs.writeFileSync(outFile, body);
console.log('written', outFile, Math.round(body.length / 1024) + ' KB', JSON.stringify(meta));
if (warn.length) console.log('WARN', warn);
const per = {}; Object.values(ops).forEach((o) => { per[o.g] = (per[o.g] || 0) + 1; }); console.log(per);
