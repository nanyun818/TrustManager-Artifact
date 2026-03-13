// Simple rule engine for anomaly pre-judgement and feature extraction
// Reads approvals from outputs/approvals.csv (preferred) or out/approvals_*.json
// Produces out/pipeline_results.json and out/pipeline_results.csv with basic scoring

const fs = require('fs');
const path = require('path');

function fileExists(p) {
  try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; }
}

function ensureDir(dir) {
  if (!fileExists(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < Math.min(lines.length, 500000); i++) {
    const cols = parseCSVLine(lines[i]);
    // Skip if columns mismatch
    if (cols.length !== headers.length) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx]; });
    rows.push(obj);
  }
  return { headers, rows };
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { // escaped quote
          current += '"'; i++;
        } else { inQuotes = false; }
      } else {
        current += ch;
      }
    } else {
      if (ch === ',') { result.push(current); current = ''; }
      else if (ch === '"') { inQuotes = true; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

function toLowerKeys(obj) {
  const out = {};
  Object.keys(obj).forEach(k => { out[k.toLowerCase()] = obj[k]; });
  return out;
}

function getField(o, candidates) {
  for (const c of candidates) {
    const v = o[c.toLowerCase()];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

const MAX_UINT256_DEC = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
const HALF_MAX_UINT256_DEC = MAX_UINT256_DEC >> BigInt(1);

function parseAmount(raw) {
  if (raw === undefined) return undefined;
  try {
    if (/^0x[0-9a-fA-F]+$/.test(raw)) return BigInt(raw);
    // decimal string
    return BigInt(raw);
  } catch { return undefined; }
}

function isUnlimited(amountBig) {
  if (amountBig === undefined) return false;
  return amountBig >= HALF_MAX_UINT256_DEC; // heuristic near-unlimited
}

function computeFeatures(rows) {
  const spenderStats = new Map();
  const tokenStats = new Map();
  const events = [];

  for (const r of rows) {
    const o = toLowerKeys(r);
    const block = parseInt(getField(o, ['blocknumber','block_number','block'] ) || '0', 10);
    const ts = parseInt(getField(o, ['timestamp','time'] ) || '0', 10);
    const owner = getField(o, ['owner','from','account','holder']);
    const spender = (getField(o, ['spender','spender_address','to']) || '').toLowerCase();
    const token = (getField(o, ['token','contract_address','token_address']) || '').toLowerCase();
    const valueRaw = getField(o, ['value','amount','raw_value','approvalvalue']);
    const amountBig = parseAmount(valueRaw);

    const unlimited = isUnlimited(amountBig);

    const sp = spenderStats.get(spender) || { count:0, unlimited:0, blocks:[], timestamps:[] };
    sp.count++; if (unlimited) sp.unlimited++;
    if (block) sp.blocks.push(block); if (ts) sp.timestamps.push(ts);
    spenderStats.set(spender, sp);

    const tk = tokenStats.get(token) || { count:0 };
    tk.count++;
    tokenStats.set(token, tk);

    events.push({ block, ts, owner, spender, token, unlimited });
  }

  // Frequency spike detection per spender: last-window vs historical mean/std
  const spikes = new Set();
  for (const [spender, st] of spenderStats.entries()) {
    const arr = st.blocks.sort((a,b)=>a-b);
    if (arr.length < 10) continue;
    const last = arr.slice(-50); // last 50 occurrences
    const prev = arr.slice(0, Math.max(0, arr.length-50));
    const bucketSize = 200; // blocks per bucket
    const countBuckets = (blocks) => {
      const byBucket = new Map();
      for (const b of blocks) {
        const k = Math.floor(b / bucketSize);
        byBucket.set(k, (byBucket.get(k)||0)+1);
      }
      return Array.from(byBucket.values());
    };
    const prevBuckets = countBuckets(prev);
    const lastBuckets = countBuckets(last);
    const mean = prevBuckets.length ? (prevBuckets.reduce((a,b)=>a+b,0)/prevBuckets.length) : 0;
    const std = prevBuckets.length ? Math.sqrt(prevBuckets.reduce((a,b)=>a+(b-mean)*(b-mean),0)/prevBuckets.length) : 0;
    const lastMax = lastBuckets.length ? Math.max(...lastBuckets) : 0;
    if (lastMax > mean + 3*std && lastMax >= 5) spikes.add(spender);
  }

  // Score events
  const scored = events.map(e => {
    const sp = spenderStats.get(e.spender);
    const freshSpender = sp && sp.count <= 3; // heuristic
    const freqSpike = spikes.has(e.spender);
    // unknown target: token seen rarely
    const tk = tokenStats.get(e.token);
    const unknownTarget = tk ? (tk.count <= 10) : true;

    let score = 0;
    if (e.unlimited) score += 0.6;
    if (freshSpender) score += 0.2;
    if (unknownTarget) score += 0.1;
    if (freqSpike) score += 0.2;
    if (score > 1) score = 1;

    let level = 'low';
    if (score >= 0.8) level = 'high';
    else if (score >= 0.5) level = 'medium';

    return { ...e, freshSpender, freqSpike, unknownTarget, score, level };
  });

  const totals = {
    events_count: events.length,
    unlimited_count: events.filter(e=>e.unlimited).length,
    fresh_spender_count: scored.filter(e=>e.freshSpender).length,
    spike_spender_count: Array.from(spikes).length,
  };

  const topSpenders = Array.from(spenderStats.entries())
    .map(([spender, st]) => ({ spender, count: st.count, unlimited_ratio: st.count? (st.unlimited/st.count):0 }))
    .sort((a,b)=> b.count - a.count)
    .slice(0, 10);

  return { totals, topSpenders, events: scored };
}

function writeOutputs(result) {
  ensureDir(path.join(__dirname, '..', 'out'));
  const outJson = path.join(__dirname, '..', 'out', 'pipeline_results.json');
  const outCsv = path.join(__dirname, '..', 'out', 'pipeline_results.csv');
  const sampleLimit = 20000;

  fs.writeFileSync(outJson, JSON.stringify({
    totals: result.totals,
    topSpenders: result.topSpenders,
    // cap events for JSON to avoid huge file; full CSV contains more
    events: result.events.slice(-sampleLimit)
  }, null, 2));

  const header = ['block','timestamp','owner','spender','token','unlimited','freshSpender','freqSpike','unknownTarget','score','level'];
  const csvLines = [header.join(',')];
  for (const e of result.events) {
    const row = [e.block, e.ts, safe(e.owner), safe(e.spender), safe(e.token), e.unlimited, e.freshSpender, e.freqSpike, e.unknownTarget, e.score, e.level];
    csvLines.push(row.join(','));
  }
  fs.writeFileSync(outCsv, csvLines.join('\n'));
}

function safe(v) { return (v===undefined || v===null) ? '' : String(v); }

function main() {
  const outputsCsv = path.join(__dirname, '..', 'outputs', 'approvals.csv');
  let rows = [];

  if (fileExists(outputsCsv)) {
    const { headers, rows: csvRows } = readCSV(outputsCsv);
    if (!csvRows.length) {
      console.warn('approvals.csv found but empty, falling back to out/approvals_*.json');
    } else {
      rows = csvRows;
    }
  }

  if (!rows.length) {
    // Fallback: merge out/approvals_*.json arrays
    const outDir = path.join(__dirname, '..', 'out');
    if (!fileExists(outDir)) {
      console.error('No outputs or out directory found.');
      process.exit(1);
    }
    const files = fs.readdirSync(outDir).filter(f => /^approvals_.*\.json$/i.test(f));
    for (const f of files.slice(0, 50)) { // cap for safety
      try {
        const arr = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'));
        if (Array.isArray(arr)) {
          // Normalize array of event objects
          rows.push(...arr.map(x=>{
            const o = toLowerKeys(x);
            return {
              blockNumber: getField(o, ['blocknumber','block_number','block'] ),
              timestamp: getField(o, ['timestamp','time'] ),
              owner: getField(o, ['owner','from','account','holder'] ),
              spender: getField(o, ['spender','spender_address','to'] ),
              token: getField(o, ['token','contract_address','token_address'] ),
              value: getField(o, ['value','amount','raw_value','approvalvalue'] ),
            };
          }));
        }
      } catch (e) {
        console.warn('Failed to parse', f, e.message);
      }
    }
  }

  if (!rows.length) {
    console.error('No approval events found to process.');
    process.exit(2);
  }

  const result = computeFeatures(rows);
  writeOutputs(result);
  console.log(`Pipeline: events=${result.totals.events_count}, unlimited=${result.totals.unlimited_count}, spikes=${result.totals.spike_spender_count}`);
}

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('rules_engine failed:', e); process.exit(3); }
}

const KNOWN_ROUTERS = new Set([
  '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'.toLowerCase(), // Uniswap V2
  '0xE592427A0AEce92De3Edee1F18E0157C05861564'.toLowerCase(), // Uniswap V3
  '0x000000000022d473030f116ddee9f6b43ac78ba3'.toLowerCase(), // Permit2
  '0x00000000006c3852cbEf3e08E8dF289169EdE581'.toLowerCase(), // Seaport
  '0x1111111254fb6c44bac0bed2854e76f90643097d'.toLowerCase(), // 1inch Router
]);

const SAFE_SPENDERS = KNOWN_ROUTERS;

function decodeApprove(input) {
  try {
    if (!input || typeof input !== 'string' || !input.startsWith('0x')) return null;
    const clean = input.slice(2);
    const methodId = clean.slice(0, 8);
    if (methodId.toLowerCase() !== '095ea7b3') return null; // approve(spender,value)
    const arg1 = clean.slice(8, 8 + 64); // spender
    const arg2 = clean.slice(8 + 64, 8 + 64 * 2); // value
    const spender = '0x' + arg1.slice(24);
    const valueHex = arg2.padStart(64, '0');
    const valueBig = BigInt('0x' + valueHex);
    return { spender: spender.toLowerCase(), valueHex, valueBig };
  } catch (e) {
    return null;
  }
}

function applyRules(rows) {
  // Aggregate by from for frequency-based heuristics
  const freq = new Map();
  for (const r of rows) {
    const k = (r.from || '').toLowerCase();
    freq.set(k, (freq.get(k) || 0) + 1);
  }

  return rows.map(r => {
    const hits = [];
    const features = {};

    // Failure base rule
    const failed = r.status === '0' || r.status === 0;
    if (failed) hits.push('FailedTx');
    features.failed = failed ? 1 : 0;

    // Gas pressure
    features.gasRatio = Number(r.gasRatio || 0);
    if (features.gasRatio > 0.95 && failed) hits.push('HighGasRatioFailure');

    // Method-based hints
    const m = (r.method || '').toLowerCase();
    features.isSwap = /swap/.test(m) ? 1 : 0;
    features.isApprove = m === 'approve' ? 1 : 0;

    // Approve deep analysis (spender/value)
    let approveDecoded = null;
    if (features.isApprove) {
      approveDecoded = decodeApprove(r.input || '');
      if (approveDecoded) {
        const spenderSafe = SAFE_SPENDERS.has(approveDecoded.spender);
        features.spenderSafe = spenderSafe ? 1 : 0;
        const unlimited = approveDecoded.valueHex.toLowerCase() === 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
        features.approveUnlimited = unlimited ? 1 : 0;
        // large threshold ~ 1e30 (just heuristic across decimals)
        const large = approveDecoded.valueBig > BigInt('0x' + (10n**30n).toString(16));
        features.approveLarge = large ? 1 : 0;
        const approveToUnusual = !spenderSafe;
        features.approveToUnusual = approveToUnusual ? 1 : 0;
        if (approveToUnusual) hits.push('UnusualApproveSpender');
        if (unlimited) hits.push('UnlimitedApprove');
        if (large && !unlimited) hits.push('LargeApprove');
      } else {
        // Fallback: infer unusual from `to` when unable to decode
        const to = (r.to || '').toLowerCase();
        const approveToUnusual = !KNOWN_ROUTERS.has(to);
        features.approveToUnusual = approveToUnusual ? 1 : 0;
        if (approveToUnusual) hits.push('UnusualApproveTarget');
      }
    }

    // Frequency-based bot pattern
    const f = freq.get((r.from || '').toLowerCase()) || 0;
    features.freqNorm = Math.min(1, f / 50); // cap at 50
    if (features.freqNorm > 0.6 && (features.isSwap || features.isApprove)) hits.push('BotPatternLike');

    return { ...r, ruleHits: hits, features };
  });
}

module.exports = { applyRules };
