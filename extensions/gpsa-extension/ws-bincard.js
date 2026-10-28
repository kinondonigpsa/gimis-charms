(function(){
  // GIMIS is a SPA: do not gate the extension on the initial route.
  // The launcher is shown only on Inventory/Bin Card related routes, and
  // route changes are detected below. This prevents the tool disappearing
  // when GIMIS navigates without a full page reload.
  if(document.getElementById('gbe-launcher')) return;

  const TOKEN_KEY='gimisBinExportToken';
  const ITEMS={
    diesel:{id:5,name:'Diesel',code:'14'},
    petrol:{id:6,name:'Petrol',code:'22'}
  };

  // Keep the GraphQL request intentionally lean. We only request fields needed
  // for the depot-bin-card Excel report, which makes the export much faster.
  const QUERY=`query binCardItemTransactionsMyShopByItemId($pageableParam: PageableParamInput, $transactionStatus: ItemTransactionStatus, $endDate: String, $startDate: String, $itemId: Long) {
    binCardItemTransactionsMyShopByItemId(
      pageableParam:$pageableParam
      transactionStatus:$transactionStatus
      endDate:$endDate
      startDate:$startDate
      itemId:$itemId
    ) {
      content {
        id
        createdAt
        updatedAt
        binCard { id }
        dispatchNote { dtcv { referenceNumber } }
        item { itemCode itemName }
        quantity
        currentStock
        transactionStatus
        unitBuyPrice
        unitSalePrice
        receiptVoucher { invoiceNo receiptVoucherNo }
        issueNoteItem { requisitionRequest { trackingNumber } }
      }
      totalElements
      totalPages
      size
      number
    }
  }`;

  window.addEventListener('message',e=>{
    if(e.source!==window) return;
    const d=e.data;
    if(d&&d.source==='gimis-bin-export'&&d.type==='TOKEN') chrome.storage.local.set({[TOKEN_KEY]:d.token});
  });

  async function token(){
    const x=await chrome.storage.local.get(TOKEN_KEY);
    if(x[TOKEN_KEY]) return x[TOKEN_KEY];
    try{
      const entries=performance.getEntriesByType('resource').map(e=>e.name).reverse();
      for(const u of entries){
        if(!u.includes('/api/graphql')) continue;
        const t=new URL(u).searchParams.get('access_token');
        if(t){await chrome.storage.local.set({[TOKEN_KEY]:t});return t;}
      }
    }catch(_){ }
    return null;
  }

  async function gql(t,variables){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    try{
      const url=`https://gimis.gpsa.go.tz/api/graphql?access_token=${encodeURIComponent(t)}`;
      const r=await fetch(url,{
        method:'POST',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({operationName:'binCardItemTransactionsMyShopByItemId',variables,query:QUERY}),
        credentials:'include',cache:'no-store',signal:controller.signal
      });
      const text=await r.text();
      if(!r.ok) throw new Error('GIMIS API HTTP '+r.status+(text?': '+text.slice(0,140):''));
      let j;try{j=JSON.parse(text)}catch(_){throw new Error('GIMIS returned a non-JSON response.')}
      if(j.errors?.length) throw new Error(j.errors.map(x=>x.message).join('; '));
      return j.data?.binCardItemTransactionsMyShopByItemId||null;
    }catch(e){
      if(e.name==='AbortError') throw new Error('GIMIS API timeout. Try a shorter date range.');
      throw e;
    }finally{clearTimeout(timer)}
  }

  function iso(d){return d.toISOString().slice(0,10)}
  function today(){
    const d=new Date();
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,'0');
    const day=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function daysAgo(n){const d=new Date();d.setDate(d.getDate()-n);return todayFrom(d)}
  function todayFrom(d){
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,'0');
    const day=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function dateTime(v){if(!v)return'';const d=new Date(v);return isNaN(d)?String(v):d.toLocaleString()}

  function formatGimisDateTime(v){
    if(!v) return '';
    const d=new Date(v);
    if(Number.isNaN(d.getTime())) return String(v);
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const parts=new Intl.DateTimeFormat('en-GB',{
      timeZone:'Africa/Dar_es_Salaam',
      day:'2-digit',month:'short',year:'numeric',
      hour:'2-digit',minute:'2-digit',second:'2-digit',
      hour12:false
    }).formatToParts(d);
    const get=k=>parts.find(x=>x.type===k)?.value||'';
    return `${get('day')} ${get('month')} ${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
  }

  function transactionTime(r){
    const v=r.updatedAt||r.createdAt;
    const t=v?new Date(v).getTime():0;
    return Number.isFinite(t)?t:0;
  }

  function rowsFor(records){
    // GIMIS shows the newest transactions first. Sort on the timestamp used
    // by the ledger, with createdAt as a reliable fallback, before numbering
    // the exported rows.
    const ordered=[...(records||[])].sort((a,b)=>transactionTime(b)-transactionTime(a));
    return ordered.map((r,i)=>{
      // GIMIS Store Ledger displays Rate/Total Price/Balance Price using the
      // unitBuyPrice (not unitSalePrice). Keep the Excel export identical to
      // the visible GIMIS ledger columns.
      const qty=r.quantity==null?'':Number(r.quantity);
      const rate=r.unitBuyPrice==null?'':Number(r.unitBuyPrice);
      const balanceQty=r.currentStock==null?'':Number(r.currentStock);
      return {
        No:i+1,
        Date:formatGimisDateTime(r.updatedAt||r.createdAt),
        Voucher:r.issueNoteItem?.requisitionRequest?.trackingNumber||r.receiptVoucher?.receiptVoucherNo||r.dispatchNote?.dtcv?.referenceNumber||'',
        TransactionType:r.transactionStatus||'',
        Quantity:qty,
        Rate:rate,
        TotalPrice:(qty!==''&&rate!=='')?qty*rate:'',
        BalanceQty:balanceQty,
        BalancePrice:(balanceQty!==''&&rate!=='')?balanceQty*rate:''
      };
    });
  }

  function excelRows(records,meta){
    const headers=['SN','Date','Voucher','Transaction Type','Quantity','Rate','Total Price','Balance (Qty)','Balance (Price)'];
    const out=[
      ['GIMIS DEPOT BIN CARD REPORT'],
      ['Item',meta.name],
      ['Item Code',meta.code],
      ['From',meta.start],
      ['To',meta.end],
      [],
      headers
    ];
    for(const r of rowsFor(records)) out.push([
      r.No,r.Date,r.Voucher,r.TransactionType,r.Quantity,r.Rate,r.TotalPrice,r.BalanceQty,r.BalancePrice
    ]);
    return out;
  }

  function setStatus(kind,text,ok=false){
    const el=document.querySelector(`[data-status="${kind}"]`);
    if(!el)return;
    el.textContent=text;
    el.className='gbe-status '+(ok?'gbe-ok':'');
  }

  function setSummary(kind, records){
    const root=document.querySelector(`[data-summary="${kind}"]`);
    if(!root)return;
    const list=records||[];
    let qty=0, value=0;
    for(const r of list){
      const q=Number(r.quantity)||0;
      const rate=Number(r.unitBuyPrice)||0;
      qty+=q;
      value+=q*rate;
    }
    const cells={
      transactions:list.length.toLocaleString(),
      quantity:qty.toLocaleString(undefined,{maximumFractionDigits:3}),
      value:value.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})
    };
    root.querySelector('[data-sum="transactions"]').textContent=cells.transactions;
    root.querySelector('[data-sum="quantity"]').textContent=cells.quantity;
    root.querySelector('[data-sum="value"]').textContent=cells.value;
    root.classList.add('has-data');
  }

  function clearSummary(kind, message='0'){
    const root=document.querySelector(`[data-summary="${kind}"]`);
    if(!root)return;
    root.querySelector('[data-sum="transactions"]').textContent=message;
    root.querySelector('[data-sum="quantity"]').textContent=message;
    root.querySelector('[data-sum="value"]').textContent=message;
    root.classList.remove('has-data');
  }

  function setBusy(kind,busy){
    const card=document.querySelector(`[data-card="${kind}"]`);
    if(!card)return;
    card.classList.toggle('busy',busy);
    card.querySelectorAll('button').forEach(b=>b.disabled=busy);
  }

  async function fetchRecords(kind,start,end){
    const meta=ITEMS[kind];
    const t=await token();
    if(!t) throw new Error('Open or refresh GIMIS first so the live session token can be captured.');

    // 2,000 rows is deliberately much smaller than the 1,000,000,000 used by
    // the GIMIS screen/API sample. It keeps the browser responsive while still
    // covering the normal monthly depot-bin-card result set.
    const data=await gql(t,{pageableParam:{first:0,size:2000,sortBy:'updatedAt',sortDirection:'DESC'},transactionStatus:null,startDate:start,endDate:end,itemId:meta.id});
    let records=data?.content||[];

    // If the API reports more than the first page, fetch additional pages in
    // controlled batches. This avoids one giant response and keeps memory low.
    const total=Number(data?.totalElements||records.length);
    const pageSize=Number(data?.size||2000)||2000;
    if(total>records.length && total<=10000){
      for(let offset=records.length;offset<total;offset+=pageSize){
        const next=await gql(t,{pageableParam:{first:offset,size:pageSize,sortBy:'updatedAt',sortDirection:'DESC'},transactionStatus:null,startDate:start,endDate:end,itemId:meta.id});
        const more=next?.content||[];
        records=records.concat(more);
        if(!more.length) break;
      }
    }
    return records;
  }

  async function search(kind){
    const start=document.querySelector(`[data-start="${kind}"]`).value;
    const end=document.querySelector(`[data-end="${kind}"]`).value;
    if(!start||!end){setStatus(kind,'Select both dates.');return;}
    if(start>end){setStatus(kind,'Start date cannot be after end date.');return;}
    setBusy(kind,true);setStatus(kind,`Loading ${ITEMS[kind].name}...`);
    clearSummary(kind,'0');
    try{
      const records=await fetchRecords(kind,start,end);
      window.gbeCache[kind]={records,start,end};
      setSummary(kind,records);
      setStatus(kind,`${records.length.toLocaleString()} transaction(s) found.`,true);
      const info=document.querySelector(`[data-result="${kind}"]`);
      info.textContent=records.length?`Ready to export ${records.length.toLocaleString()} row(s).`:'No transactions found for this date range.';
    }catch(e){setStatus(kind,'Error: '+e.message);clearSummary(kind,'0');}
    finally{setBusy(kind,false)}
  }

  async function exportExcel(kind){
    const start=document.querySelector(`[data-start="${kind}"]`).value;
    const end=document.querySelector(`[data-end="${kind}"]`).value;
    if(!start||!end){setStatus(kind,'Select both dates.');return;}
    if(start>end){setStatus(kind,'Start date cannot be after end date.');return;}
    setBusy(kind,true);setStatus(kind,`Preparing ${ITEMS[kind].name} Excel...`);
    try{
      let cache=window.gbeCache[kind];
      if(!cache||cache.start!==start||cache.end!==end){
        cache={records:await fetchRecords(kind,start,end),start,end};
        window.gbeCache[kind]=cache;
      }
      setSummary(kind,cache.records);
      const meta={...ITEMS[kind],start,end};
      const fn=`GIMIS_${meta.name}_Depot_Bin_Card_${start}_to_${end}.xlsx`;
      GimisXlsxExport.download(fn,excelRows(cache.records,meta));
      setStatus(kind,`${cache.records.length.toLocaleString()} row(s) exported to Excel.`,true);
    }catch(e){setStatus(kind,'Error: '+e.message);}
    finally{setBusy(kind,false)}
  }

  function card(kind){
    const m=ITEMS[kind];
    return `<section class="gbe-card" data-card="${kind}">
      <div class="gbe-card-head"><div><strong>${m.name}</strong><span>Item ${m.code} • API itemId ${m.id}</span></div><span class="gbe-dot"></span></div>
      <div class="gbe-dates"><div class="gbe-field"><label>Start date</label><input data-start="${kind}" type="date" value="${today()}"></div><div class="gbe-field"><label>End date</label><input data-end="${kind}" type="date" value="${today()}"></div></div>
      <div class="gbe-actions"><button class="gbe-search" data-search="${kind}">Search</button><button class="gbe-export" data-export="${kind}">Export Excel</button></div>
      <div data-status="${kind}" class="gbe-status"></div>
      <div data-summary="${kind}" class="gbe-summary">
        <div class="gbe-metric"><strong data-sum="transactions">0</strong><span>Transactions</span></div>
        <div class="gbe-metric"><strong data-sum="quantity">0</strong><span>Total Quantity</span></div>
        <div class="gbe-metric"><strong data-sum="value">0</strong><span>Total Sale Value</span></div>
      </div>
      <div data-result="${kind}" class="gbe-result">Search to load report summary.</div>
    </section>`;
  }

  function build(){
    window.gbeCache={};
    const logo=chrome.runtime.getURL('logo-bin.png');
    const launch=document.createElement('button');
    launch.id='gbe-launcher';launch.textContent='GIMIS Bin Card';document.body.appendChild(launch);
    const panel=document.createElement('div');panel.id='gbe-panel';
    panel.innerHTML=`<div class="gbe-head"><div class="gbe-brand"><img class="gbe-logo" src="${logo}"><div><div class="gbe-title">Depot Bin Card Export</div><div class="gbe-sub gbe-powered">POWERED BY E-LAPS</div></div></div><button id="gbe-close" class="gbe-close">×</button></div><div class="gbe-body">${card('diesel')}${card('petrol')}<div class="gbe-note">Each item works independently. Nothing is loaded until you press Search or Export Excel. Exported files are saved by Chrome to your normal Downloads folder.</div></div>`;
    document.body.appendChild(panel);
    // Keep the launcher visible on every GIMIS route. GIMIS is a SPA and some
    // versions change the URL before/after React remounts the page. Hiding the
    // launcher by pathname was the reason it could disappear completely.
    function syncRoute(){
      if(!document.body.contains(launch)) document.body.appendChild(launch);
      if(!document.body.contains(panel)) document.body.appendChild(panel);
      launch.style.display='block';
    }
    launch.onclick=()=>panel.classList.toggle('open');
    syncRoute();
    window.addEventListener('popstate',syncRoute);
    window.addEventListener('hashchange',syncRoute);
    const domWatch=new MutationObserver(()=>{
      if(!document.getElementById('gbe-launcher') || !document.getElementById('gbe-panel')){
        if(document.body && !document.getElementById('gbe-launcher')) document.body.appendChild(launch);
        if(document.body && !document.getElementById('gbe-panel')) document.body.appendChild(panel);
      }
      if(document.getElementById('gbe-launcher')) document.getElementById('gbe-launcher').style.display='block';
    });
    domWatch.observe(document.documentElement,{childList:true,subtree:true});
    document.getElementById('gbe-close').onclick=()=>panel.classList.remove('open');
    document.querySelectorAll('[data-search]').forEach(b=>b.onclick=()=>search(b.dataset.search));
    document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>exportExcel(b.dataset.export));
  }

  function safeBuild(){try{build()}catch(err){console.error('[GIMIS Bin Card Exporter]',err);const b=document.createElement('button');b.id='gbe-launcher';b.textContent='GIMIS Bin Card';b.style.cssText='position:fixed;right:20px;bottom:20px;z-index:2147483000;display:block;padding:10px 15px;border:0;border-radius:22px;background:#0b6b93;color:#fff;font-weight:700;cursor:pointer';document.body&&document.body.appendChild(b)}}
  if(document.body)safeBuild();else addEventListener('DOMContentLoaded',safeBuild);
})();
