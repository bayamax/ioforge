/* IOForge core: IO list -> validated PLC artifacts. Pure functions, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IOForge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const IO_TYPES = ['DI', 'DO', 'AI', 'AO'];

  // Header aliases (lower-cased, spaces/underscores stripped) -> canonical field
  const HEADER_ALIASES = {
    name: ['tag', 'tagname', 'name', 'signal', 'signalname', 'symbol', 'タグ', 'タグ名', '信号名'],
    description: ['description', 'desc', 'comment', 'service', '説明', 'コメント', '名称'],
    iotype: ['iotype', 'type', 'io', 'signaltype', 'kind', '種別', '入出力'],
    slot: ['slot', 'module', 'card', 'スロット'],
    point: ['point', 'channel', 'ch', 'bit', 'terminal', 'pt', '点', 'チャンネル'],
    address: ['address', 'addr', 'logicaladdress', 'ioaddress', 'アドレス'],
    datatype: ['datatype', 'dtype', 'plctype', 'データ型'],
    device: ['device', 'devicetag', 'instrument', 'loop', '機器']
  };

  function normHeader(h) {
    return String(h == null ? '' : h).toLowerCase().replace(/[\s_\-\.\/()]/g, '');
  }

  function guessMapping(headers) {
    const map = {};
    headers.forEach((h, i) => {
      const n = normHeader(h);
      for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        if (map[field] === undefined && aliases.includes(n)) { map[field] = i; break; }
      }
    });
    return map;
  }

  function normIoType(v) {
    const s = String(v == null ? '' : v).trim().toUpperCase();
    const table = {
      DI: 'DI', DIN: 'DI', 'DIGITAL INPUT': 'DI', 'DIGITALINPUT': 'DI', IN: 'DI', INPUT: 'DI', I: 'DI', X: 'DI',
      DO: 'DO', DOUT: 'DO', 'DIGITAL OUTPUT': 'DO', 'DIGITALOUTPUT': 'DO', OUT: 'DO', OUTPUT: 'DO', O: 'DO', Q: 'DO', Y: 'DO',
      AI: 'AI', AIN: 'AI', 'ANALOG INPUT': 'AI', 'ANALOGINPUT': 'AI', 'ANALOGUE INPUT': 'AI',
      AO: 'AO', AOUT: 'AO', 'ANALOG OUTPUT': 'AO', 'ANALOGOUTPUT': 'AO', 'ANALOGUE OUTPUT': 'AO'
    };
    return table[s] || null;
  }

  function cell(row, idx) {
    if (idx === undefined || idx === null || idx < 0) return '';
    const v = row[idx];
    return v == null ? '' : String(v).trim();
  }

  // rows: array of arrays (first row = header). returns {points, headerMap}
  function rowsToPoints(rows, mapping) {
    const headers = rows[0] || [];
    const map = mapping || guessMapping(headers);
    const points = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (row.every(c => String(c == null ? '' : c).trim() === '')) continue;
      points.push({
        row: r + 1,
        name: cell(row, map.name),
        description: cell(row, map.description),
        ioTypeRaw: cell(row, map.iotype),
        ioType: normIoType(cell(row, map.iotype)),
        slot: cell(row, map.slot),
        point: cell(row, map.point),
        address: cell(row, map.address),
        dataType: cell(row, map.datatype).toUpperCase(),
        device: cell(row, map.device)
      });
    }
    return { points, headerMap: map };
  }

  const DEFAULT_SETTINGS = {
    controllerName: 'PLC',
    programName: 'MainProgram',
    routineName: 'IO_Buffer',
    // Rockwell address templates. {slot} {point} placeholders.
    abTemplates: {
      DI: 'Local:{slot}:I.Data.{point}',
      DO: 'Local:{slot}:O.Data.{point}',
      AI: 'Local:{slot}:I.Ch{point}Data',
      AO: 'Local:{slot}:O.Ch{point}Data'
    },
    // Siemens auto-addressing when no Address column: per slot byte base
    packS7: true,
    s7: { diStartByte: 0, doStartByte: 0, aiStartByte: 64, aoStartByte: 64, digitalBytesPerSlot: 2, analogBytesPerSlot: 16, firstSlot: 1 },
    defaultTypes: { DI: 'BOOL', DO: 'BOOL', AI: 'REAL', AO: 'REAL' }
  };

  function slotRanks(points) {
    const r = {};
    for (const t of IO_TYPES) {
      const slots = [...new Set(points.filter(p => p.ioType === t && /^\d+$/.test(p.slot) && !p.address).map(p => +p.slot))].sort((a, b) => a - b);
      r[t] = {}; slots.forEach((sl, i) => { r[t][sl] = i; });
    }
    return r;
  }

  // packS7: true -> S7 auto addresses are packed per IO type (k-th DI card, k-th AI card...)
  function prep(points, s) {
    const st = mergeSettings(s);
    if (st.packS7 !== false) st._ranks = slotRanks(points);
    return st;
  }

  function mergeSettings(s) {
    s = s || {};
    return {
      ...DEFAULT_SETTINGS, ...s,
      abTemplates: { ...DEFAULT_SETTINGS.abTemplates, ...(s.abTemplates || {}) },
      s7: { ...DEFAULT_SETTINGS.s7, ...(s.s7 || {}) },
      defaultTypes: { ...DEFAULT_SETTINGS.defaultTypes, ...(s.defaultTypes || {}) }
    };
  }

  function fillTemplate(t, p) {
    return t.replace(/\{slot\}/g, p.slot).replace(/\{point\}/g, p.point);
  }

  function abAddress(p, st) {
    if (p.address && !/^%/.test(p.address)) return p.address;
    if (!p.ioType || p.slot === '' || p.point === '') return '';
    return fillTemplate(st.abTemplates[p.ioType], p);
  }

  function s7Address(p, st) {
    if (p.address && /^%/.test(p.address)) return p.address.toUpperCase();
    if (!p.ioType || p.slot === '' || p.point === '') return '';
    const slot = parseInt(p.slot, 10), pt = parseInt(p.point, 10);
    if (!Number.isFinite(slot) || !Number.isFinite(pt)) return '';
    const k = st.s7;
    const cls = p.ioType;
    // packed mode: position of this slot among slots carrying the same IO type
    const rel = st._ranks && st._ranks[cls] && st._ranks[cls][slot] !== undefined ? st._ranks[cls][slot] : slot - k.firstSlot;
    if (rel < 0) return '';
    if (p.ioType === 'DI' || p.ioType === 'DO') {
      const base = (p.ioType === 'DI' ? k.diStartByte : k.doStartByte) + rel * k.digitalBytesPerSlot;
      return `%${p.ioType === 'DI' ? 'I' : 'Q'}${base + Math.floor(pt / 8)}.${pt % 8}`;
    }
    const base = (p.ioType === 'AI' ? k.aiStartByte : k.aoStartByte) + rel * k.analogBytesPerSlot;
    return `%${p.ioType === 'AI' ? 'I' : 'Q'}W${base + pt * 2}`;
  }

  const AB_TYPES = ['BOOL', 'SINT', 'INT', 'DINT', 'LINT', 'REAL', 'LREAL'];
  const S7_TYPES = ['BOOL', 'BYTE', 'WORD', 'DWORD', 'INT', 'DINT', 'UINT', 'UDINT', 'REAL', 'LREAL', 'SINT', 'USINT'];
  const AB_RESERVED = new Set(['IF', 'THEN', 'ELSE', 'ELSIF', 'END_IF', 'CASE', 'OF', 'END_CASE', 'FOR', 'TO', 'BY', 'DO', 'END_FOR', 'WHILE', 'END_WHILE', 'REPEAT', 'UNTIL', 'END_REPEAT', 'EXIT', 'RETURN', 'AND', 'OR', 'XOR', 'NOT', 'MOD', 'TRUE', 'FALSE']);

  function resolvedType(p, st) {
    if (p.dataType) return p.dataType;
    return p.ioType ? st.defaultTypes[p.ioType] : '';
  }

  // Returns array of {row, level:'error'|'warn', target:'all'|'ab'|'s7', field, msg}
  function validate(points, settings) {
    const st = settings && settings._ranks ? settings : prep(points, settings);
    const issues = [];
    const add = (p, level, target, field, msg) => issues.push({ row: p.row, name: p.name, level, target, field, msg });
    const nameSeen = new Map(), abAddrSeen = new Map(), s7AddrSeen = new Map();

    points.forEach(p => {
      if (!p.name) add(p, 'error', 'all', 'name', 'タグ名が空');
      else {
        // Rockwell naming rules (Logix 5000 Controllers I/O and Tag Data, 1756-PM004)
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name)) add(p, 'error', 'ab', 'name', 'Logix: 英数字と_のみ、先頭は英字か_');
        if (p.name.length > 40) add(p, 'error', 'ab', 'name', `Logix: 40文字超 (${p.name.length})`);
        if (/__/.test(p.name)) add(p, 'error', 'ab', 'name', 'Logix: __(連続アンダースコア)不可');
        if (/_$/.test(p.name)) add(p, 'error', 'ab', 'name', 'Logix: 末尾の_不可');
        if (AB_RESERVED.has(p.name.toUpperCase())) add(p, 'error', 'ab', 'name', 'Logix: 予約語');
        if (p.name.length > 128) add(p, 'error', 's7', 'name', 'TIA: 128文字超');
        if (/["\\]/.test(p.name)) add(p, 'error', 's7', 'name', 'TIA: " や \\ は使用不可');
        const key = p.name.toUpperCase();
        if (nameSeen.has(key)) add(p, 'error', 'all', 'name', `タグ名重複 (行${nameSeen.get(key)}、大文字小文字は区別されない)`);
        else nameSeen.set(key, p.row);
      }
      if (!p.ioType) add(p, 'error', 'all', 'iotype', p.ioTypeRaw ? `IO種別 "${p.ioTypeRaw}" を解釈できない` : 'IO種別が空 (DI/DO/AI/AO)');
      if (!p.address && (p.slot === '' || p.point === '')) add(p, 'error', 'all', 'address', 'アドレス列も スロット+点番号 も無い');
      if (p.slot !== '' && !/^\d+$/.test(p.slot)) add(p, 'warn', 'all', 'slot', `スロット "${p.slot}" が数値でない`);
      if (p.point !== '' && !/^\d+$/.test(p.point)) add(p, 'warn', 'all', 'point', `点番号 "${p.point}" が数値でない`);
      if (p.point !== '' && /^\d+$/.test(p.point) && (p.ioType === 'DI' || p.ioType === 'DO') && +p.point > 31) add(p, 'warn', 'all', 'point', `点番号 ${p.point} は32点カードの範囲外`);

      const t = resolvedType(p, st);
      if (t) {
        if (!AB_TYPES.includes(t)) add(p, 'error', 'ab', 'datatype', `Logix: データ型 "${t}" 不明`);
        if (!S7_TYPES.includes(t)) add(p, 'error', 's7', 'datatype', `TIA: データ型 "${t}" 不明`);
        if ((p.ioType === 'DI' || p.ioType === 'DO') && t !== 'BOOL') add(p, 'warn', 'all', 'datatype', `デジタル点なのに ${t}`);
        if ((p.ioType === 'AI' || p.ioType === 'AO') && t === 'BOOL') add(p, 'error', 'all', 'datatype', 'アナログ点なのに BOOL');
      }
      if (p.description.length > 128) add(p, 'warn', 'all', 'description', `説明が長い (${p.description.length}文字)`);

      if (p.ioType) {
        const a = abAddress(p, st);
        if (a) {
          if (abAddrSeen.has(a)) add(p, 'error', 'ab', 'address', `Logix: アドレス ${a} 重複 (行${abAddrSeen.get(a)})`);
          else abAddrSeen.set(a, p.row);
        }
        const s = s7Address(p, st);
        if (p.address && /^%/.test(p.address) && !/^%(I|Q|M)(\d+\.[0-7]|[BWD]\d+)$/i.test(p.address)) add(p, 'error', 's7', 'address', `TIA: アドレス書式 "${p.address}" 不正 (例 %I0.0 / %IW64)`);
        if (s) {
          if (/^%[IQ]\d+\.\d$/.test(s) && t && t !== 'BOOL') add(p, 'warn', 's7', 'address', `TIA: ビットアドレス ${s} に ${t}`);
          if (s7AddrSeen.has(s)) add(p, 'error', 's7', 'address', `TIA: アドレス ${s} 重複 (行${s7AddrSeen.get(s)})`);
          else s7AddrSeen.set(s, p.row);
          const isIn = p.ioType === 'DI' || p.ioType === 'AI';
          if ((isIn && /^%Q/.test(s)) || (!isIn && /^%I/.test(s))) add(p, 'error', 's7', 'address', `TIA: ${p.ioType} なのに ${s}`);
        }
      }
    });
    return issues;
  }

  function xmlEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function cdata(s) { return '<![CDATA[' + String(s).replace(/\]\]>/g, ']]]]><![CDATA[>') + ']]>'; }
  function csvQ(s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; }

  function radixFor(t) { return t === 'REAL' || t === 'LREAL' ? 'Float' : 'Decimal'; }
  function zeroFor(t) { return t === 'REAL' || t === 'LREAL' ? '0.0' : '0'; }

  function isValidFor(p, issues, target) {
    return !issues.some(i => i.row === p.row && i.level === 'error' && (i.target === 'all' || i.target === target));
  }

  // ---- Rockwell: tag import CSV (Tools > Import > Tags and Logic Comments)
  // mode 'base': project base tags + buffer routine maps IO -> tags
  // mode 'alias': alias tags pointing directly at module IO
  function abTagCsv(points, settings, mode, now) {
    const st = prep(points, settings);
    const issues = validate(points, st);
    const d = (now || new Date()).toString();
    const lines = [
      'remark,"CSV-Import-Export"',
      `remark,"Date = ${d.replace(/"/g, '')}"`,
      'remark,"Version = RSLogix 5000 v32.00"',
      'remark,"Owner = "',
      'remark,"Company = "',
      'remark,"Generated by IOForge"',
      '0.3',
      'TYPE,SCOPE,NAME,DESCRIPTION,DATATYPE,SPECIFIER,ATTRIBUTES'
    ];
    let n = 0;
    points.filter(p => isValidFor(p, issues, 'ab')).forEach(p => {
      const t = resolvedType(p, st);
      if (mode === 'alias') {
        lines.push(['ALIAS', '', p.name, csvQ(p.description), '""', csvQ(abAddress(p, st)), csvQ(`(RADIX := ${radixFor(t)}, ExternalAccess := Read/Write)`)].join(','));
      } else {
        lines.push(['TAG', '', p.name, csvQ(p.description), csvQ(t), '""', csvQ(`(RADIX := ${radixFor(t)}, Constant := false, ExternalAccess := Read/Write)`)].join(','));
      }
      n++;
    });
    return { text: lines.join('\r\n') + '\r\n', count: n };
  }

  function abRungText(p, st) {
    const a = abAddress(p, st);
    switch (p.ioType) {
      case 'DI': return `XIC(${a})OTE(${p.name});`;
      case 'DO': return `XIC(${p.name})OTE(${a});`;
      case 'AI': return `MOV(${a},${p.name});`;
      case 'AO': return `MOV(${p.name},${a});`;
    }
    return 'NOP();';
  }

  // ---- Rockwell: L5X routine export (Right-click Program > Import Routine)
  function abRoutineL5X(points, settings, now) {
    const st = prep(points, settings);
    const issues = validate(points, st);
    const ok = points.filter(p => isValidFor(p, issues, 'ab'));
    const date = (now || new Date()).toUTCString().replace('GMT', '').trim();
    const order = { DI: 0, AI: 1, DO: 2, AO: 3 };
    const sorted = ok.slice().sort((a, b) => order[a.ioType] - order[b.ioType] || a.row - b.row);
    const tags = sorted.map(p => {
      const t = resolvedType(p, st);
      return `<Tag Name="${xmlEsc(p.name)}" TagType="Base" DataType="${t}" Radix="${radixFor(t)}" Constant="false" ExternalAccess="Read/Write">\n` +
        (p.description ? `<Description>\n${cdata(p.description)}\n</Description>\n` : '') +
        `<Data Format="Decorated">\n<DataValue DataType="${t}" Radix="${radixFor(t)}" Value="${zeroFor(t)}"/>\n</Data>\n</Tag>`;
    }).join('\n');
    let lastType = null;
    const rungs = sorted.map((p, i) => {
      let comment = `${p.ioType} ${p.name}` + (p.description ? ` - ${p.description}` : '') + (p.device ? ` [${p.device}]` : '');
      if (p.ioType !== lastType) { comment = `===== ${p.ioType} buffering =====\n` + comment; lastType = p.ioType; }
      return `<Rung Number="${i}" Type="N">\n<Comment>\n${cdata(comment)}\n</Comment>\n<Text>\n${cdata(abRungText(p, st))}\n</Text>\n</Rung>`;
    }).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="32.00" TargetName="${xmlEsc(st.routineName)}" TargetType="Routine" TargetSubType="RLL" ContainsContext="true" ExportDate="${xmlEsc(date)}" ExportOptions="References NoRawData L5KData DecoratedData Context Dependencies ForceProtectedEncoding AllProjDocTrans">
<Controller Use="Context" Name="${xmlEsc(st.controllerName)}">
<DataTypes Use="Context">
</DataTypes>
<Tags Use="Context">
${tags}
</Tags>
<Programs Use="Context">
<Program Use="Context" Name="${xmlEsc(st.programName)}">
<Routines Use="Context">
<Routine Use="Target" Name="${xmlEsc(st.routineName)}" Type="RLL">
<RLLContent>
${rungs}
</RLLContent>
</Routine>
</Routines>
</Program>
</Programs>
</Controller>
</RSLogix5000Content>
`;
    return { text: xml, count: sorted.length };
  }

  // ---- Siemens TIA Portal: PLC tag table rows (import via "Import" in PLC tags, .xlsx)
  const TIA_HEADERS = ['Name', 'Path', 'Data Type', 'Logical Address', 'Comment', 'Hmi Visible', 'Hmi Accessible', 'Hmi Writeable', 'Typeobject ID', 'Version ID'];
  function tiaTagRows(points, settings, tableName) {
    const st = prep(points, settings);
    const issues = validate(points, st);
    const rows = [TIA_HEADERS];
    points.filter(p => isValidFor(p, issues, 's7')).forEach(p => {
      rows.push([p.name, tableName || 'IO', resolvedType(p, st), s7Address(p, st), p.description, 'True', 'True', 'True', '', '']);
    });
    return rows;
  }

  // ---- Commissioning loop-check sheet (CSV, UTF-8 BOM for Excel)
  function loopCheckCsv(points, settings) {
    const st = prep(points, settings);
    const head = ['No', 'Tag', 'Description', 'Device', 'IO', 'Slot', 'Point', 'Logix Address', 'S7 Address', 'Wiring OK', 'Signal OK', 'HMI OK', 'Checked By', 'Date', 'Remarks'];
    const lines = [head.map(csvQ).join(',')];
    points.forEach((p, i) => {
      lines.push([i + 1, p.name, p.description, p.device, p.ioType || p.ioTypeRaw, p.slot, p.point, p.ioType ? abAddress(p, st) : '', p.ioType ? s7Address(p, st) : '', '', '', '', '', '', ''].map(csvQ).join(','));
    });
    return '\ufeff' + lines.join('\r\n') + '\r\n';
  }

  function summary(points) {
    const s = { DI: 0, DO: 0, AI: 0, AO: 0, unknown: 0, slots: {} };
    points.forEach(p => {
      if (p.ioType) s[p.ioType]++; else s.unknown++;
      if (p.slot !== '') {
        s.slots[p.slot] = s.slots[p.slot] || { DI: 0, DO: 0, AI: 0, AO: 0 };
        if (p.ioType) s.slots[p.slot][p.ioType]++;
      }
    });
    return s;
  }

  // Simple CSV parser (handles quotes, CRLF)
  function parseCsv(text) {
    text = text.replace(/^\ufeff/, '');
    const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f.replace(/\r$/, '')); rows.push(row); }
    return rows;
  }

  return {
    IO_TYPES, DEFAULT_SETTINGS, guessMapping, normIoType, rowsToPoints, validate, abAddress, s7Address,
    abTagCsv, abRoutineL5X, tiaTagRows, loopCheckCsv, summary, parseCsv, mergeSettings, prep, TIA_HEADERS
  };
});
