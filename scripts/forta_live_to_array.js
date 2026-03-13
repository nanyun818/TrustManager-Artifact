// Convert NDJSON forta_alerts_live.json (one JSON per line) to a JSON array and CSV
// Usage: node scripts/forta_live_to_array.js [--in out/forta_alerts_live.json] [--json out/forta_alerts_live_array.json] [--csv out/forta_alerts_live.csv]

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
    in: path.join('out', 'forta_alerts_live.json'),
    json: path.join('out', 'forta_alerts_live_array.json'),
    csv: path.join('out', 'forta_alerts_live.csv'),
    limit: '200000',
  }, opts);
}

function readNdjson(filePath, limit) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
    const arr = [];
    for (let i = 0; i < lines.length && arr.length < limit; i++) {
      const ln = lines[i].trim();
      if (!ln || ln[0] !== '{') continue;
      try { arr.push(JSON.parse(ln)); } catch (_) {}
    }
    return arr;
  } catch (_) { return []; }
}

function toLower(x) { return (x || '').toLowerCase(); }

function toCsvRows(alerts) {
  const rows = [];
  const headers = ['owner','spender','token','block','severity','alert_id'];
  rows.push(headers.join(','));
  for (const a of alerts) {
    const m = a.metadata || {};
    const owner = toLower(a.owner || m.owner);
    const spender = toLower(a.spender || m.spender);
    const token = toLower(a.token || m.token);
    const block = String(a.block || m.blockNumber || m.block_number || '');
    const severity = String(a.severity || a.severityLevel || '');
    const id = String(a.alert_id || a.id || '');
    rows.push([owner, spender, token, block, severity, id].join(','));
  }
  return rows.join('\n');
}

function main() {
  const opts = parseArgs();
  const limit = Number(opts.limit);
  const alerts = readNdjson(opts.in, isFinite(limit) ? limit : 200000);
  // ensure out dir
  const outDir = path.dirname(opts.json);
  try { if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}
  fs.writeFileSync(opts.json, JSON.stringify(alerts, null, 2));
  fs.writeFileSync(opts.csv, toCsvRows(alerts));
  console.log(`Converted ${alerts.length} live alerts -> ${opts.json} and ${opts.csv}`);
}

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('forta_live_to_array failed:', e); process.exit(2); }
}