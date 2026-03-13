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

function joinByKey(a, b, keys) {
  const idx = new Map();
  for (const r of a) {
    const k = keys.map((k) => String(r[k] || '')).join('|');
    idx.set(k, r);
  }
  const out = [];
  for (const r of b) {
    const k = keys.map((k) => String(r[k] || '')).join('|');
    const l = idx.get(k);
    if (l) out.push({ ...l, _risk: Number(r.risk || r.score || 0), _label: Number(l.label || 0) });
  }
  return out;
}

function metrics(rows, thr) {
  let tp=0, fp=0, tn=0, fn=0;
  for (const r of rows) {
    const y = Number(r._label || 0);
    const s = Number(r._risk || 0);
    const p = s >= thr ? 1 : 0;
    if (p===1 && y===1) tp++; else if (p===1 && y===0) fp++; else if (p===0 && y===0) tn++; else fn++;
  }
  const precision = tp+fp>0 ? tp/(tp+fp) : 0;
  const recall = tp+fn>0 ? tp/(tp+fn) : 0;
  const f1 = precision+recall>0 ? 2*precision*recall/(precision+recall) : 0;
  return { tp, fp, tn, fn, precision, recall, f1 };
}

function main() {
  const ROOT = process.cwd();
  const OUT = path.join(ROOT, 'out');
  const labeled = readCsv(path.join(OUT, 'labeled_dataset.csv'));
  const scores = readCsv(path.join(OUT, 'event_risk_scores.csv'));
  const rows = joinByKey(labeled, scores, ['owner','spender','token','block']);
  const k = 5;
  const folds = [];
  for (let i = 0; i < k; i++) folds.push([]);
  rows.sort((a,b) => {
    const ta = Number(a.timestamp || a.block || 0);
    const tb = Number(b.timestamp || b.block || 0);
    return ta - tb;
  });
  const n = rows.length;
  const seg = Math.max(1, Math.floor(n / k));
  for (let i = 0; i < k; i++) {
    const start = i * seg;
    const end = i === k-1 ? n : Math.min(n, (i+1)*seg);
    folds[i] = rows.slice(start, end);
  }
  const thr = 0.5;
  const res = folds.map((fold) => metrics(fold, thr));
  const sum = res.reduce((a,r) => ({
    tp: a.tp + r.tp,
    fp: a.fp + r.fp,
    tn: a.tn + r.tn,
    fn: a.fn + r.fn,
    precision: a.precision + r.precision,
    recall: a.recall + r.recall,
    f1: a.f1 + r.f1
  }), { tp:0,fp:0,tn:0,fn:0,precision:0,recall:0,f1:0 });
  const avg = {
    tp: sum.tp / k,
    fp: sum.fp / k,
    tn: sum.tn / k,
    fn: sum.fn / k,
    precision: sum.precision / k,
    recall: sum.recall / k,
    f1: sum.f1 / k
  };
  const std = {
    precision: Math.sqrt(res.reduce((acc,r)=>acc+Math.pow(r.precision-avg.precision,2),0)/Math.max(1,k)),
    recall: Math.sqrt(res.reduce((acc,r)=>acc+Math.pow(r.recall-avg.recall,2),0)/Math.max(1,k)),
    f1: Math.sqrt(res.reduce((acc,r)=>acc+Math.pow(r.f1-avg.f1,2),0)/Math.max(1,k))
  };
  const summary = {
    folds: res,
    avg,
    std
  };
  fs.writeFileSync(path.join(OUT, 'cv_report.json'), JSON.stringify(summary, null, 2));
  process.stdout.write('OK\n');
}

main();
