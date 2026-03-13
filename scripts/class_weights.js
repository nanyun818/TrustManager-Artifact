const fs = require('fs');
const path = require('path');

function readCsv(p) {
  const s = fs.readFileSync(p, 'utf8');
  const lines = s.split(/\r?\n/).filter((x) => x.trim().length > 0);
  const header = lines[0].split(',').map((x) => x.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const o = {};
    for (let j = 0; j < header.length; j++) o[header[j]] = (cols[j] || '').trim();
    out.push(o);
  }
  return out;
}

function main() {
  const ROOT = process.cwd();
  const OUT = path.join(ROOT, 'out');
  const labeled = readCsv(path.join(OUT, 'labeled_dataset.csv'));
  let pos = 0, neg = 0;
  for (const r of labeled) {
    const y = Number(r.label || 0);
    if (y === 1) pos++; else neg++;
  }
  const total = pos + neg;
  const wPos = total / (2 * (pos || 1));
  const wNeg = total / (2 * (neg || 1));
  const weights = { positive: wPos, negative: wNeg, pos: pos, neg: neg, total };
  fs.writeFileSync(path.join(OUT, 'class_weights.json'), JSON.stringify(weights, null, 2));
  process.stdout.write('OK\n');
}

main();

