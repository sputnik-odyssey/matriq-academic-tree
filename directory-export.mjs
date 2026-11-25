const encoder = new TextEncoder();
const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const spreadsheetNS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationshipsNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function escapeXML(value) {
  return String(value ?? '').replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/[&<>]/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;'}[character]));
}

const crcTable = Uint32Array.from({length: 256}, (_, value) => {
  for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const records = [], directory = [];
  let offset = 0, directorySize = 0;
  for (const [path, xml] of Object.entries(files)) {
    const name = encoder.encode(path), data = encoder.encode(xmlHeader + xml);
    const checksum = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(12, 33, true);
    local.setUint32(14, checksum, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    records.push(local.buffer, name, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(14, 33, true);
    central.setUint32(16, checksum, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    directory.push(central.buffer, name);
    offset += local.byteLength + name.length + data.length;
    directorySize += central.byteLength + name.length;
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, directory.length / 2, true);
  end.setUint16(10, directory.length / 2, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...records, ...directory, end.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

const headers = [
  'Legal Name', '中文名', 'PhD', 'Bachelor location', 'Bachelor', 'High School',
  'CurrentAffiliation', 'AffiliationType', 'Location', '匹配方向', '匹配度', '周期',
  '回国展望', 'Research Line', 'Industry Line', 'Website', 'ORCID', 'LinkedIn',
  'Status', 'Scholar', 'Citation Count', 'Paper', 'Citation Count', 'Year Cited',
  'Notes', 'Position', 'Progress', 'Source'
];
const missing = /^(?:\s*|\/|[-–—]|none|null|undefined|n\/?a|not provided|unknown)$/i;
function firstValue(...values) {
  return values.find(value => (typeof value === 'string' || typeof value === 'number') && !missing.test(String(value).trim())) ?? 'None';
}

function columnName(index) {
  if (index < 26) return String.fromCharCode(65 + index);
  return 'A' + String.fromCharCode(65 + index - 26);
}

function exportRow(person) {
  const records = (person.records || []).map(record => record.fields || {});
  const field = key => firstValue(...records.map(record => record[key]));
  const paperRecord = records.find(record => firstValue(record.V) !== 'None');
  const paper = firstValue(paperRecord?.V, ...(person.publications || []));
  const reviewed = person.displayAffiliationSource === 'reviewed_history';
  return [
    firstValue(person.name, field('A')), firstValue(person.nameZh, field('B')),
    firstValue(person.phd, field('C')), field('D'), firstValue(person.bachelor, field('E')), 'None',
    firstValue(person.displayAffiliation, person.affiliation, field('G')),
    reviewed ? firstValue(person.jobTitle, person.statusLabel) : firstValue(person.jobTitle, person.role, field('H'), person.statusLabel),
    firstValue(person.location, field('I')), firstValue(person.research), 'None', 'None', 'None',
    field('N'), field('O'), firstValue(person.website, field('P')), firstValue(person.orcid, field('Q')),
    firstValue(person.linkedin, field('R')), 'None', firstValue(person.scholar, field('T')), field('U'),
    paper, firstValue(paperRecord?.W), firstValue(paperRecord?.X), 'None', 'None', 'None', field('AB')
  ];
}

export function directoryWorkbook(people) {
  const rows = [headers, ...people.map(exportRow)];
  const sheetData = rows.map((row, index) => {
    const number = index + 1;
    const cells = row.map((value, column) => {
      const ref = columnName(column) + number;
      return typeof value === 'number' && Number.isFinite(value)
        ? '<c r="' + ref + '"><v>' + value + '</v></c>'
        : '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + escapeXML(value) + '</t></is></c>';
    }).join('');
    return '<row r="' + number + '">' + cells + '</row>';
  }).join('');
  const packageNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const relationship = (path, type) => '<Relationships xmlns="' + packageNS + '"><Relationship Id="rId1" Type="' + relationshipsNS + '/' + type + '" Target="' + path + '"/></Relationships>';
  return zip({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': relationship('xl/workbook.xml', 'officeDocument'),
    'xl/workbook.xml': '<workbook xmlns="' + spreadsheetNS + '" xmlns:r="' + relationshipsNS + '"><sheets><sheet name="人物名录" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': relationship('worksheets/sheet1.xml', 'worksheet'),
    'xl/worksheets/sheet1.xml': '<worksheet xmlns="' + spreadsheetNS + '"><sheetData>' + sheetData + '</sheetData><autoFilter ref="A1:AB' + rows.length + '"/></worksheet>'
  });
}
