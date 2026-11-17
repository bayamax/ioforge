const assert = require('assert');
const F = require('../core.js');
const fs = require('fs'); const path = require('path');
const rows = F.parseCsv(fs.readFileSync(path.join(__dirname, '../sample/io_list_sample.csv'), 'utf8'));
const { points, headerMap } = F.rowsToPoints(rows);
assert.deepStrictEqual(Object.keys(headerMap).sort(), ['datatype','description','device','iotype','name','point','slot'].sort());
assert.strictEqual(points.length, 17);
const issues = F.validate(points);
const errRows = new Set(issues.filter(i => i.level === 'error').map(i => i.row));
assert.ok(errRows.has(15), 'bad name'); assert.ok(errRows.has(16), 'dup'); assert.ok(errRows.has(17), 'bool analog');
assert.ok(!errRows.has(2));
assert.strictEqual(F.normIoType('Digital Input'), 'DI');
// addresses
assert.strictEqual(F.abAddress(points[0], F.DEFAULT_SETTINGS), 'Local:1:I.Data.0');
assert.strictEqual(F.abAddress(points[9], F.DEFAULT_SETTINGS), 'Local:3:I.Ch0Data');
assert.strictEqual(F.s7Address(points[0], F.DEFAULT_SETTINGS), '%I0.0');
const ST = F.prep(points, {}); assert.strictEqual(F.s7Address(points[6], ST), '%Q0.0');
assert.strictEqual(F.s7Address(points[12], ST), '%QW64');
assert.strictEqual(F.s7Address(points[6], F.prep(points,{packS7:false})), '%Q2.0');
assert.strictEqual(F.s7Address(points[16], ST), '%I1.0'); // Spare_1 slot1 pt8
assert.strictEqual(F.s7Address(points[10], ST), '%IW66'); // 1st AI card pt1
// outputs
const csv = F.abTagCsv(points, {}, 'base');
assert.ok(csv.text.includes('TYPE,SCOPE,NAME,DESCRIPTION,DATATYPE,SPECIFIER,ATTRIBUTES'));
assert.strictEqual(csv.count, 14);
const alias = F.abTagCsv(points, {}, 'alias');
assert.ok(alias.text.includes('ALIAS,,LS_101,"Tank 101 high level switch","","Local:1:I.Data.0"'));
const l5x = F.abRoutineL5X(points, {});
assert.ok(l5x.text.includes('XIC(Local:1:I.Data.0)OTE(LS_101);'));
assert.ok(l5x.text.includes('XIC(M101_Run_Cmd)OTE(Local:2:O.Data.0);'));
assert.ok(l5x.text.includes('MOV(FCV_104_SP,Local:4:O.Ch0Data);'));
assert.strictEqual(l5x.count, 14);
const tia = F.tiaTagRows(points, {}, 'IO');
assert.strictEqual(tia[0][3], 'Logical Address'); assert.strictEqual(tia.length, 16); // 2nd_Pump is legal in TIA
const loop = F.loopCheckCsv(points, {});
assert.ok(loop.startsWith('﻿')); assert.strictEqual(loop.trim().split('\r\n').length, 18);
// explicit S7 address validation
const bad = F.validate([{row:2,name:'A',description:'',ioTypeRaw:'DI',ioType:'DI',slot:'',point:'',address:'%IX0.0',dataType:'',device:''}]);
assert.ok(bad.some(i => i.target==='s7' && i.field==='address'));
// well-formed XML
const { execSync } = require('child_process');
fs.writeFileSync('/tmp/ioforge_test.l5x', l5x.text);
execSync('python3 -c "import xml.dom.minidom,sys;xml.dom.minidom.parse(\'/tmp/ioforge_test.l5x\')"');
console.log('all tests passed');
