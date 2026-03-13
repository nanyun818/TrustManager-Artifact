// Merge anomaly scan outputs with current experiment CSV to support model validation
// Usage:
// 1) Prepare anomaly CSV (default: out/history_anomalies.csv)
// 2) Prepare experiment CSV exported from the front-end (default: data/experiment.csv)
// 3) node scripts/merge_eval.js
// Env overrides: ANOMALY_CSV, EXPERIMENT_CSV, TIME_WINDOW_MS

const fs = require('fs');
const path = require('path');

function log(msg, obj) {
  if (obj !== undefined) console.log(msg, obj);
  else console.log(msg);
}

function readCsv(p) {
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  const idx = {};
  header.forEach((h, i) => (idx[h] = i));
  const rows = lines.slice(1).map((l) => parseCsvLine(l));
  return rows.map((r) => ({ header, idx, r }));
}

function parseCsvLine(l) {
  const out = [];
  let i = 0;
  while (i < l.length) {
    if (l[i] === '"') {
      i++;
      let s = '';
      while (i < l.length) {
        if (l[i] === '"') {
          if (i + 1 < l.length && l[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          } else {
            i++;
            break;
          }
        }
        s += l[i++];
      }
      // skip comma
      if (i < l.length && l[i] === ',') i++;
      out.push(s);
    } else {
      let j = i;
      while (j < l.length && l[j] !== ',') j++;
      out.push(l.slice(i, j));
      i = j + 1;
    }
  }
  return out;
}

function toCsvRow(fields) {
  return fields
    .map((x) => {
      if (x === null || x === undefined) return '';
      const s = String(x);
      if (s.includes(',') || s.includes('\n') || s.includes('"')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    })
    .join(',');
}

function toTsMs(s) {
  if (!s) return NaN;
  const d = new Date(s);
  const ms = d.getTime();
  return isNaN(ms) ? NaN : ms;
}

function main() {
  const ROOT = __dirname ? path.resolve(__dirname, '..') : process.cwd();
  const ANOMALY_CSV = process.env.ANOMALY_CSV || path.join(ROOT, 'out', 'history_anomalies.csv');
  const EXP_CSV = process.env.EXPERIMENT_CSV || path.join(ROOT, 'data', 'experiment.csv');
  const WINDOW_MS = Number(process.env.TIME_WINDOW_MS || 30 * 1000); // 30s window

  const anomalies = readCsv(ANOMALY_CSV);
  if (!anomalies) {
    log('Anomaly CSV not found: ' + ANOMALY_CSV);
    process.exit(1);
  }
  const experiments = readCsv(EXP_CSV) || [];
  if (experiments.length === 0) {
    log('Experiment CSV missing or empty: ' + EXP_CSV);
    log('Proceeding with anomalies only; merged file will contain anomaly records.');
  }

  // Prepare headers
  const outDir = path.join(ROOT, 'out');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}
  const outCsv = path.join(outDir, 'merged_eval.csv');
  const outHeader = [
    'hash', 'blockNumber', 'timestamp', 'from', 'to', 'status', 'method', 'methodSig', 'gasUsed', 'classifiedError', 'decodedEvents',
    'exp_timestamp', 'exp_round', 'exp_successRate', 'exp_responseTime', 'exp_notes'
  ];
  const outRows = [toCsvRow(outHeader)];

  // Index experiments by timestamp for nearest-neighbor match
  const expIdxTs = experiments.map((e) => ({
    ts: toTsMs(e.r[e.idx['timestamp']] || e.r[e.idx['time']] || e.r[e.idx['date']]),
    row: e,
  })).filter((x) => !isNaN(x.ts));
  expIdxTs.sort((a, b) => a.ts - b.ts);

  function nearestExp(tsMs) {
    if (expIdxTs.length === 0) return null;
    // binary search
    let lo = 0, hi = expIdxTs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (expIdxTs[mid].ts < tsMs) lo = mid + 1; else hi = mid - 1;
    }
    const candidates = [];
    if (hi >= 0) candidates.push(expIdxTs[hi]);
    if (lo < expIdxTs.length) candidates.push(expIdxTs[lo]);
    let best = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      const d = Math.abs(c.ts - tsMs);
      if (d < bestDist) { best = c; bestDist = d; }
    }
    if (best && bestDist <= WINDOW_MS) return best.row;
    return null;
  }

  // Merge
  for (const a of anomalies) {
    const aIdx = a.idx;
    const aTsMs = toTsMs(a.r[aIdx['timestamp']]);
    const exp = nearestExp(aTsMs);
    const expIdx = exp ? exp.idx : null;
    const out = [
      a.r[aIdx['hash']],
      a.r[aIdx['blockNumber']],
      a.r[aIdx['timestamp']],
      a.r[aIdx['from']],
      a.r[aIdx['to']],
      a.r[aIdx['status']],
      a.r[aIdx['method']],
      a.r[aIdx['methodSig']],
      a.r[aIdx['gasUsed']],
      a.r[aIdx['classifiedError']],
      a.r[aIdx['decodedEvents']],
      exp ? (exp.r[expIdx['timestamp']] || exp.r[expIdx['time']] || exp.r[expIdx['date']]) : '',
      exp ? (exp.r[expIdx['round']] || exp.r[expIdx['roundIndex']] || '') : '',
      exp ? (exp.r[expIdx['successRate']] || '') : '',
      exp ? (exp.r[expIdx['responseTime']] || '') : '',
      exp ? (exp.r[expIdx['notes']] || '') : '',
    ];
    outRows.push(toCsvRow(out));
  }

  fs.writeFileSync(outCsv, outRows.join('\n'));
  log('Merged CSV written:', outCsv);
}

main();