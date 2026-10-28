// Lightweight dependency-free XLSX writer for the GIMIS Depot Bin Card export.
window.GimisXlsxExport = (() => {
  const enc = new TextEncoder();
  const u16 = n => new Uint8Array([n & 255, (n >>> 8) & 255]);
  const u32 = n => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  const concat = (...parts) => { const len=parts.reduce((s,p)=>s+p.length,0); const out=new Uint8Array(len); let o=0; for(const p of parts){out.set(p,o);o+=p.length;} return out; };
  const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}return t;})();
  const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
  const xml=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};

  function sheetXml(rows){
    const widths=[7,15,24,18,12,14,18,16,20];
    let out='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cols>';
    widths.forEach((w,i)=>out+=`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`);
    out+='</cols><sheetData>';
    rows.forEach((r,ri)=>{
      const rowNo=ri+1;
      const isHeader=ri===6;
      const isTitle=ri===0;
      out+=`<row r="${rowNo}">`;
      r.forEach((v,ci)=>{
        if(v===''||v===null||v===undefined)return;
        const ref=col(ci)+rowNo;
        const numeric=typeof v==='number'&&Number.isFinite(v);
        let style='';
        if(isTitle) style=' s="1"';
        else if(isHeader) style=' s="2"';
        else if(numeric && ci>=4) style=' s="3"';
        if(numeric) out+=`<c r="${ref}"${style}><v>${v}</v></c>`;
        else out+=`<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
      });
      out+='</row>';
    });
    out+='</sheetData><autoFilter ref="A7:I'+Math.max(7,rows.length)+'"/><freezePane xSplit="0" ySplit="7" topLeftCell="A8" activePane="bottomLeft" state="frozen"/></worksheet>';
    return out;
  }

  function makeZip(files){
    const chunks=[],central=[];let offset=0;
    for(const [name,text] of files){const nb=enc.encode(name),data=enc.encode(text),crc=crc32(data);const local=concat(u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(nb.length),u16(0),nb,data);chunks.push(local);central.push({nb,data,crc,offset});offset+=local.length;}
    const cd=concat(...central.map(e=>concat(u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(e.crc),u32(e.data.length),u32(e.data.length),u16(e.nb.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(e.offset),e.nb)));
    const eocd=concat(u32(0x06054b50),u16(0),u16(0),u16(central.length),u16(central.length),u32(cd.length),u32(offset),u16(0));
    return concat(...chunks,cd,eocd);
  }

  function download(filename,rows){
    const files=[
      ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Depot Bin Card" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="4" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="D9EAF7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>'],
      ['xl/worksheets/sheet1.xml',sheetXml(rows)]
    ];
    const blob=new Blob([makeZip(files)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  return {download};
})();
