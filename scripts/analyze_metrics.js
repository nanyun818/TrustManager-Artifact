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
    if (l) out.push({ ...l, _risk: Number(r.risk || r.score || 0) });
  }
  return out;
}

function computeMetrics(rows, thr) {
  let tp=0, fp=0, tn=0, fn=0;
  for (const r of rows) {
    const y = Number(r.label || r.y || 0);
    const s = Number(r._risk || 0);
    const pred = s >= thr ? 1 : 0;
    if (pred === 1 && y === 1) tp++; else if (pred === 1 && y === 0) fp++; else if (pred === 0 && y === 0) tn++; else fn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const tpr = recall;
  const fpr = fp + tn > 0 ? fp / (fp + tn) : 0;
  return { thr, tp, fp, tn, fn, precision, recall, f1, tpr, fpr };
}

function aucRoc(curve) {
  const pts = [...curve].sort((a,b) => a.fpr - b.fpr);
  let area = 0;
  for (let i = 1; i < pts.length; i++) {
    const x1 = pts[i-1].fpr, y1 = pts[i-1].tpr;
    const x2 = pts[i].fpr, y2 = pts[i].tpr;
    area += (x2 - x1) * (y1 + y2) / 2; // trapezoid
  }
  return area;
}

function main() {
  const ROOT = process.cwd();
  const OUT = path.join(ROOT, 'out');
  const labeled = readCsv(path.join(OUT, 'labeled_dataset.csv'));
  const scores = readCsv(path.join(OUT, 'event_risk_scores.csv'));
  const rows = joinByKey(labeled, scores, ['owner','spender','token','block']);
  const thrs = [0,0.05,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1];
  const curve = thrs.map((t) => computeMetrics(rows, t));
  const rocAuc = aucRoc(curve);
  let importance = [];
  const runDir = path.join(OUT, 'runs');
  let logregPath = path.join(OUT, 'logreg.json');
  try {
    const runs = fs.readdirSync(runDir).filter((d) => /\d{8}_\d{6}/.test(d)).sort();
    if (runs.length) logregPath = path.join(runDir, runs[runs.length-1], 'logreg.json');
  } catch {}
  try {
    const lr = JSON.parse(fs.readFileSync(logregPath, 'utf8'));
    const entries = Object.entries(lr.weights || {});
    importance = entries.map(([k,v]) => ({ feature: k, weight: Number(v), abs: Math.abs(Number(v)) }))
      .sort((a,b) => b.abs - a.abs);
  } catch {}
  const report = { total: rows.length, roc_auc: rocAuc, curve, feature_importance: importance };
  fs.writeFileSync(path.join(OUT, 'metrics_report.json'), JSON.stringify(report, null, 2));
  const header = 'thr,tp,fp,tn,fn,precision,recall,f1,tpr,fpr';
  const csv = [header].concat(curve.map((m) => [m.thr,m.tp,m.fp,m.tn,m.fn,m.precision,m.recall,m.f1,m.tpr,m.fpr].join(','))).join('\n');
  fs.writeFileSync(path.join(OUT, 'metrics_curves.csv'), csv);
  process.stdout.write('OK\n');
}

main();
