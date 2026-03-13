#!/usr/bin/env node
/**
 * Forta-first labeling script
 * - Inputs: pipeline CSV (from rules_engine) and Forta alerts CSV/JSON (supports multiple sources)
 * - Output: labeled CSV/JSON with `label` (1=positive, 0=negative) and `label_source`
 * - Matching: owner+spender+token triple, optional block window; case-insensitive
 *
 * Usage:
 *   node scripts/label_from_forta.js \
 *     --input out/pipeline_results.csv \
 *     --forta out/forta_alerts.csv,out/forta_alerts_live.json \
 *     --output out/labeled_dataset.csv \
 *     --blockWindow 1 \
 *     --timeWindowSec 0 \
 *     --enableRuleFallback true
 */

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const k = a.replace(/^--/, '');
      const v = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      opts[k] = v;
    }
  }
  return Object.assign({
    input: 'out/pipeline_results.csv',
    forta: 'out/forta_alerts.csv',
    output: 'out/labeled_dataset.csv',
    blockWindow: '1',
    timeWindowSec: '0',
    enableRuleFallback: 'false',
  }, opts);
}

// Minimal CSV parser that handles quoted fields and commas inside quotes
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = cols[idx] !== undefined ? cols[idx] : '';
    });
    rows.push(obj);
  }
  return rows;
}

function splitCSVLine(line) {
  const res = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { // escaped quote
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        res.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
  }
  res.push(cur);
  return res;
}

function toLowerAddr(x) {
  if (!x || typeof x !== 'string') return '';
  const s = x.trim();
  return s.toLowerCase();
}

function normNumber(x) {
  if (x === undefined || x === null || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function keyTriple(owner, spender, token) {
  return `${toLowerAddr(owner)}|${toLowerAddr(spender)}|${toLowerAddr(token)}`;
}

function readFortaOne(fortaPath) {
  if (!fs.existsSync(fortaPath)) return [];
  const ext = path.extname(fortaPath).toLowerCase();
  if (ext === '.json') {
    const arr = JSON.parse(fs.readFileSync(fortaPath, 'utf8'));
    const alerts = Array.isArray(arr) ? arr : Array.isArray(arr.alerts) ? arr.alerts : [];
    return alerts.map(a => ({
      owner: toLowerAddr(a.owner || a.metadata?.owner),
      spender: toLowerAddr(a.spender || a.metadata?.spender),
      token: toLowerAddr(a.token || a.metadata?.token),
      block: normNumber(a.block || a.metadata?.blockNumber),
      timestamp: normNumber(a.timestamp || a.metadata?.timestamp),
      id: a.alert_id || a.id || 'forta',
      severity: a.severity || a.severityLevel || '',
    })).filter(x => x.owner && x.spender && x.token);
  } else {
    const text = fs.readFileSync(fortaPath, 'utf8');
    const rows = parseCSV(text);
    const ownerH = Object.keys(rows[0] || {}).find(h => h.toLowerCase().includes('owner')) || 'owner';
    const spenderH = Object.keys(rows[0] || {}).find(h => h.toLowerCase().includes('spender')) || 'spender';
    const tokenH = Object.keys(rows[0] || {}).find(h => h.toLowerCase().includes('token')) || 'token';
    const blockH = Object.keys(rows[0] || {}).find(h => h.toLowerCase().includes('block')) || 'block';
    const tsH = Object.keys(rows[0] || {}).find(h => h.toLowerCase().includes('time')) || 'timestamp';
    return rows.map(r => ({
      owner: toLowerAddr(r[ownerH]),
      spender: toLowerAddr(r[spenderH]),
      token: toLowerAddr(r[tokenH]),
      block: normNumber(r[blockH]),
      timestamp: normNumber(r[tsH]),
      id: r.alert_id || r.id || 'forta',
      severity: r.severity || r.level || r.risk || '',
    })).filter(x => x.owner && x.spender && x.token);
  }
}

function readFortaMultiple({ fortaArg }) {
  if (!fortaArg) return [];
  const parts = String(fortaArg).split(',').map(s => s.trim()).filter(Boolean);
  const all = [];
  for (const p of parts) {
    const arr = readFortaOne(p);
    all.push(...arr);
  }
  return all;
}

function readPipeline({ inputPath }) {
  if (!fs.existsSync(inputPath)) throw new Error(`Pipeline file not found: ${inputPath}`);
  const text = fs.readFileSync(inputPath, 'utf8');
  const rows = parseCSV(text);
  // standard headers from rules_engine: block,timestamp,owner,spender,token,unlimited,freshSpender,freqSpike,unknownTarget,score,level
  return rows.map(r => ({
    block: normNumber(r.block),
    timestamp: normNumber(r.timestamp),
    owner: toLowerAddr(r.owner),
    spender: toLowerAddr(r.spender),
    token: toLowerAddr(r.token),
    unlimited: String(r.unlimited || '').toLowerCase() === 'true',
    freshSpender: String(r.freshSpender || '').toLowerCase() === 'true',
    freqSpike: String(r.freqSpike || '').toLowerCase() === 'true',
    unknownTarget: String(r.unknownTarget || '').toLowerCase() === 'true',
    score: normNumber(r.score),
    level: r.level || '',
    _raw: r,
  }));
}

function labelByFortaAndRules(pipelineRows, fortaAlerts, { blockWindow, timeWindowSec, enableRuleFallback }) {
  const bw = Number(blockWindow);
  const tw = Number(timeWindowSec);
  const index = new Map();
  for (const a of fortaAlerts) {
    const k = keyTriple(a.owner, a.spender, a.token);
    const arr = index.get(k) || [];
    arr.push(a);
    index.set(k, arr);
  }
  let pos = 0;
  const labeled = pipelineRows.map(r => {
    const k = keyTriple(r.owner, r.spender, r.token);
    const candidates = index.get(k) || [];
    let matched = null;
    for (const a of candidates) {
      const blockOk = (r.block != null && a.block != null) ? Math.abs(r.block - a.block) <= bw : false;
      const timeOk = (tw > 0 && r.timestamp != null && a.timestamp != null) ? Math.abs(r.timestamp - a.timestamp) <= tw : false;
      if (blockOk || timeOk || (r.block == null && a.block == null && r.timestamp == null && a.timestamp == null)) {
        matched = a; break;
      }
    }
    let label = matched ? 1 : 0;
    let source = matched ? 'forta' : 'none';
    let alertId = matched ? (matched.id || '') : '';
    let alertSeverity = matched ? (matched.severity || '') : '';

    // Rule fallback: conservative weak supervision
    if (!matched && String(enableRuleFallback).toLowerCase() === 'true') {
      const unlimited = String(r._raw.unlimited || '').toLowerCase() === 'true';
      const unknownTarget = String(r._raw.unknownTarget || '').toLowerCase() === 'true';
      const freshSpender = String(r._raw.freshSpender || '').toLowerCase() === 'true';
      const freqSpike = String(r._raw.freqSpike || '').toLowerCase() === 'true';
      const score = normNumber(r._raw.score);
      // fallback condition: unlimited AND (unknownTarget OR freshSpender OR freqSpike) OR score>=0.6
      const fallback = (unlimited && (unknownTarget || freshSpender || freqSpike)) || (score != null && score >= 0.6);
      if (fallback) {
        label = 1;
        source = 'rules';
        alertId = '';
        alertSeverity = '';
      }
    }
    if (label === 1) pos += 1;
    const base = Object.assign({}, r._raw);
    base.label = label;
    base.label_source = source;
    base.label_alert_id = alertId;
    base.label_alert_severity = alertSeverity;
    return base;
  });
  return { labeled, pos, total: labeled.length };
}

function buildRationale(baseRow) {
  const feats = [];
  const unlimited = String(baseRow.unlimited || '').toLowerCase() === 'true';
  const unknownTarget = String(baseRow.unknownTarget || '').toLowerCase() === 'true';
  const freshSpender = String(baseRow.freshSpender || '').toLowerCase() === 'true';
  const freqSpike = String(baseRow.freqSpike || '').toLowerCase() === 'true';
  const score = normNumber(baseRow.score);
  if (unlimited) feats.push('无限额授权');
  if (unknownTarget) feats.push('未知/非常见目标');
  if (freshSpender) feats.push('新出现的spender');
  if (freqSpike) feats.push('频率/密度尖峰');
  if (score != null) feats.push(`规则评分=${score}`);
  const src = String(baseRow.label_source || '').toLowerCase();
  const aid = baseRow.label_alert_id || '';
  const sev = baseRow.label_alert_severity || '';
  const srcTxt = src === 'forta' ? `Forta告警(id=${aid}, severity=${sev})` : (src === 'rules' ? '规则回退触发' : '无匹配');
  const loc = `owner=${baseRow.owner} spender=${baseRow.spender} token=${baseRow.token} block=${baseRow.block || ''}`;
  const lbl = Number(baseRow.label) === 1 ? '高风险' : '低风险';
  return `事件(${loc})判定为${lbl}；来源：${srcTxt}；关键特征：${feats.join('、') || '无'}`;
}

function writeCSV(rows, outPath) {
  if (rows.length === 0) {
    fs.writeFileSync(outPath, '');
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const r of rows) {
    const vals = headers.map(h => {
      let v = r[h];
      if (v === undefined || v === null) v = '';
      v = String(v);
      // escape quotes and wrap if contains comma
      if (v.includes('"')) v = v.replace(/"/g, '""');
      if (v.includes(',')) v = `"${v}"`;
      return v;
    });
    lines.push(vals.join(','));
  }
  fs.writeFileSync(outPath, lines.join('\n'));
}

function main() {
  const opts = parseArgs();
  const inputPath = opts.input;
  const fortaArg = opts.forta;
  const outputPath = opts.output;
  const jsonOutPath = outputPath.replace(/\.csv$/i, '.json');

  const pipelineRows = readPipeline({ inputPath });
  const fortaAlerts = readFortaMultiple({ fortaArg });
  const { labeled, pos, total } = labelByFortaAndRules(pipelineRows, fortaAlerts, {
    blockWindow: opts.blockWindow,
    timeWindowSec: opts.timeWindowSec,
    enableRuleFallback: opts.enableRuleFallback,
  });

  // ensure out dir exists
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  writeCSV(labeled, outputPath);
  fs.writeFileSync(jsonOutPath, JSON.stringify({
    summary: { positives: pos, negatives: total - pos, total },
    params: { inputPath, forta: fortaArg, blockWindow: Number(opts.blockWindow), timeWindowSec: Number(opts.timeWindowSec), enableRuleFallback: String(opts.enableRuleFallback) },
  }, null, 2));

  try {
    const jsonlPath = path.join(path.dirname(outputPath), 'reason_samples.jsonl');
    const out = fs.createWriteStream(jsonlPath, { encoding: 'utf-8' });
    for (const r of labeled) {
      const item = {
        owner: toLowerAddr(r.owner),
        spender: toLowerAddr(r.spender),
        token: toLowerAddr(r.token),
        block: normNumber(r.block),
        label: Number(r.label) || 0,
        source: r.label_source || '',
        alert_id: r.label_alert_id || '',
        alert_severity: r.label_alert_severity || '',
        features: {
          unlimited: String(r.unlimited || '').toLowerCase() === 'true',
          unknownTarget: String(r.unknownTarget || '').toLowerCase() === 'true',
          freshSpender: String(r.freshSpender || '').toLowerCase() === 'true',
          freqSpike: String(r.freqSpike || '').toLowerCase() === 'true',
          score: normNumber(r.score)
        },
        rationale: buildRationale(r)
      };
      out.write(JSON.stringify(item) + "\n");
    }
    out.end();
    console.log(`Wrote: ${jsonlPath}`);
  } catch (e) {
    console.log('reason_samples.jsonl write failed:', e && e.message);
  }

  console.log(`Labeling finished: positives=${pos}, total=${total}`);
  console.log(`Wrote: ${outputPath} and ${jsonOutPath}`);
}

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('label_from_forta failed:', e); process.exit(2); }
}
