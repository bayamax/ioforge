/* IOForge UI */
(function () {
  'use strict';
  const F = window.IOForge;
  const $ = id => document.getElementById(id);
  const FIELDS = [['name', 'タグ名 *'], ['iotype', 'IO種別 *'], ['description', '説明'], ['slot', 'スロット'], ['point', '点番号'], ['address', 'アドレス'], ['datatype', 'データ型'], ['device', '機器番号']];
  let rows = null, mapping = {}, points = [], issues = [], tab = 'issues', baseName = 'io_list';

  const SAMPLE = 'Tag,Description,IO Type,Slot,Point,Data Type,Device\nLS_101,Tank 101 high level switch,DI,1,0,,LSH-101\nLS_102,Tank 101 low level switch,DI,1,1,,LSL-102\nPB_Start,Start pushbutton,DI,1,2,,HS-001\nPB_Stop,Stop pushbutton,DI,1,3,,HS-002\nES_Main,Main E-stop healthy,DI,1,4,,ES-001\nM101_Run_FB,Pump 101 run feedback,DI,1,5,,M-101\nM101_Run_Cmd,Pump 101 run command,DO,2,0,,M-101\nXV101_Open,Inlet valve 101 open,DO,2,1,,XV-101\nHorn,Alarm horn,DO,2,2,,AH-001\nLT_101,Tank 101 level,AI,3,0,,LT-101\nPT_102,Discharge pressure,AI,3,1,,PT-102\nFT_103,Flow,AI,3,2,,FT-103\nFCV_104_SP,Flow control valve output,AO,4,0,,FCV-104\n2nd_Pump,Bad name (starts with digit),DI,1,6,,\nLS_101,Duplicate of row 2,DI,1,7,,\nTT_105,Temp (bad type),AI,3,3,BOOL,TT-105\nSpare_1,,Digital Input,1,8,,\n';

  function initSettingsInputs() {
    const d = F.DEFAULT_SETTINGS;
    for (const k of ['DI', 'DO', 'AI', 'AO']) { $('t_' + k).value = d.abTemplates[k]; $('d_' + k).value = d.defaultTypes[k]; }
    for (const k of Object.keys(d.s7)) $('k_' + k).value = d.s7[k];
    document.querySelectorAll('#setCard input').forEach(el => el.addEventListener('input', recompute));
  }

  function settings() {
    const s7 = {};
    for (const k of Object.keys(F.DEFAULT_SETTINGS.s7)) s7[k] = parseInt($('k_' + k).value, 10) || 0;
    const ab = {}, dt = {};
    for (const k of ['DI', 'DO', 'AI', 'AO']) { ab[k] = $('t_' + k).value.trim() || F.DEFAULT_SETTINGS.abTemplates[k]; dt[k] = ($('d_' + k).value.trim() || F.DEFAULT_SETTINGS.defaultTypes[k]).toUpperCase(); }
    return { packS7: $('k_pack').checked, controllerName: $('s_controller').value.trim() || 'PLC', programName: $('s_program').value.trim() || 'MainProgram', routineName: $('s_routine').value.trim() || 'IO_Buffer', abTemplates: ab, s7, defaultTypes: dt };
  }

  function loadRows(r, label) {
    rows = r.filter(x => x && x.length);
    if (rows.length < 2) { alert('見出し行＋データ行が必要です'); return; }
    mapping = F.guessMapping(rows[0]);
    $('srcInfo').textContent = `${label}: ${rows.length - 1} 行`;
    renderMapping();
    ['mapCard', 'setCard', 'resCard', 'outCard'].forEach(id => $(id).hidden = false);
    recompute();
  }

  function renderMapping() {
    const g = $('mapGrid'); g.innerHTML = '';
    FIELDS.forEach(([f, label]) => {
      const l = document.createElement('label'); l.textContent = label;
      const s = document.createElement('select');
      s.innerHTML = '<option value="-1">（なし）</option>' + rows[0].map((h, i) => `<option value="${i}">${esc(String(h))}</option>`).join('');
      s.value = mapping[f] === undefined ? '-1' : String(mapping[f]);
      s.addEventListener('change', () => { const v = +s.value; if (v < 0) delete mapping[f]; else mapping[f] = v; recompute(); });
      l.appendChild(s); g.appendChild(l);
    });
  }

  function recompute() {
    if (!rows) return;
    points = F.rowsToPoints(rows, mapping).points;
    issues = F.validate(points, settings());
    renderStats(); renderTable();
  }

  function renderStats() {
    const s = F.summary(points);
    const e = issues.filter(i => i.level === 'error').length, w = issues.filter(i => i.level === 'warn').length;
    const st = (label, v, color) => `<div class="stat"><span class="mut">${label}</span><b style="${color ? 'color:' + color : ''}">${v}</b></div>`;
    $('stats').innerHTML = st('点数', points.length) + st('DI', s.DI) + st('DO', s.DO) + st('AI', s.AI) + st('AO', s.AO) + st('スロット', Object.keys(s.slots).length) + st('エラー', e, e ? 'var(--err)' : 'var(--ok)') + st('警告', w, w ? 'var(--warn)' : '');
  }

  function renderTable() {
    const st = F.prep(points, settings());
    let html;
    if (tab === 'issues') {
      if (!issues.length) html = '<p style="padding:10px;color:var(--ok)">問題は見つかりませんでした。</p>';
      else html = '<table><tr><th>行</th><th>タグ</th><th>レベル</th><th>対象</th><th>項目</th><th>内容</th></tr>' +
        issues.slice().sort((a, b) => (a.level === b.level ? a.row - b.row : a.level === 'error' ? -1 : 1)).map(i =>
          `<tr><td>${i.row}</td><td>${esc(i.name)}</td><td class="lvl-${i.level}">${i.level === 'error' ? 'エラー' : '警告'}</td><td>${{ all: '共通', ab: 'Logix', s7: 'TIA' }[i.target]}</td><td>${i.field}</td><td>${esc(i.msg)}</td></tr>`).join('') + '</table>';
    } else {
      const byRow = {}; issues.forEach(i => { byRow[i.row] = byRow[i.row] === 'error' ? 'error' : i.level; });
      html = '<table><tr><th>行</th><th>タグ</th><th>IO</th><th>型</th><th>Logix アドレス</th><th>S7 アドレス</th><th>説明</th></tr>' +
        points.map(p => `<tr class="${byRow[p.row] === 'error' ? 'e' : byRow[p.row] === 'warn' ? 'w' : ''}"><td>${p.row}</td><td>${esc(p.name)}</td><td>${p.ioType || esc(p.ioTypeRaw)}</td><td>${p.dataType || (p.ioType ? st.defaultTypes[p.ioType] : '')}</td><td><code>${p.ioType ? esc(F.abAddress(p, st)) : ''}</code></td><td><code>${p.ioType ? esc(F.s7Address(p, st)) : ''}</code></td><td>${esc(p.description)}</td></tr>`).join('') + '</table>';
    }
    $('tbl').innerHTML = html;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function download(name, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function show(text, note) { $('preview').textContent = (note ? note + '\n\n' : '') + text.slice(0, 6000) + (text.length > 6000 ? '\n…' : ''); }

  async function readFile(f) {
    baseName = f.name.replace(/\.[^.]+$/, '');
    if (/\.(xlsx|xls)$/i.test(f.name)) {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      loadRows(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }), `${f.name} [${wb.SheetNames[0]}]`);
    } else loadRows(F.parseCsv(await f.text()), f.name);
  }

  // wiring
  const drop = $('drop');
  drop.addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', e => e.target.files[0] && readFile(e.target.files[0]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]); });
  $('loadSample').addEventListener('click', () => { baseName = 'sample'; loadRows(F.parseCsv(SAMPLE), 'サンプル'); });
  $('togglePaste').addEventListener('click', () => $('pasteBox').hidden = !$('pasteBox').hidden);
  $('usePaste').addEventListener('click', () => { baseName = 'pasted'; loadRows(F.parseCsv($('paste').value), '貼り付け'); });
  $('tabIssues').addEventListener('click', () => { tab = 'issues'; $('tabIssues').classList.add('on'); $('tabPoints').classList.remove('on'); renderTable(); });
  $('tabPoints').addEventListener('click', () => { tab = 'points'; $('tabPoints').classList.add('on'); $('tabIssues').classList.remove('on'); renderTable(); });

  $('o_l5x').addEventListener('click', () => { const r = F.abRoutineL5X(points, settings()); download(`${settings().routineName}.L5X`, r.text, 'application/xml'); show(r.text, `${r.count} rungs`); });
  $('o_csv').addEventListener('click', () => { const r = F.abTagCsv(points, settings(), 'base'); download(`${baseName}_logix_tags.csv`, r.text, 'text/csv'); show(r.text, `${r.count} tags`); });
  $('o_alias').addEventListener('click', () => { const r = F.abTagCsv(points, settings(), 'alias'); download(`${baseName}_logix_alias.csv`, r.text, 'text/csv'); show(r.text, `${r.count} alias tags`); });
  $('o_tia').addEventListener('click', () => {
    const rowsOut = F.tiaTagRows(points, settings(), $('s_table').value.trim() || 'IO');
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rowsOut), 'PLC Tags');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(`${baseName}_tia_tags.xlsx`, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    show(rowsOut.map(r => r.join('\t')).join('\n'), `${rowsOut.length - 1} tags (sheet "PLC Tags")`);
  });
  $('o_loop').addEventListener('click', () => { const t = F.loopCheckCsv(points, settings()); download(`${baseName}_loop_check.csv`, t, 'text/csv'); show(t.replace(/^﻿/, '')); });

  initSettingsInputs();
})();
