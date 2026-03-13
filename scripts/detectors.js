const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'out');
const DATA = path.join(ROOT, 'data');

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function readCsvSafe(p) {
  try {
    const txt = fs.readFileSync(p, 'utf8');
    const lines = txt.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
      const cols = line.split(',');
      const obj = {};
      headers.forEach((h, i) => obj[h] = (cols[i] || '').trim());
      return obj;
    });
  } catch (e) { return []; }
}

function toLower(a) { return (a || '').toLowerCase(); }
function add(map, key, field, inc = 1) {
  if (!key) return;
  if (!map[key]) map[key] = { address: key };
  map[key][field] = (map[key][field] || 0) + inc;
}

function max1(x) { return x > 1 ? 1 : x; }
function normCount(x, k = 10) { return max1((x || 0) / (k + (x || 0))); }

function loadBlacklist() {
  const p = path.join(DATA, 'blacklist.json');
  const j = readJsonSafe(p) || { addresses: [] };
  const set = new Set((j.addresses || []).map(a => toLower(a.address)));
  return { list: j.addresses || [], set };
}

function collectFailures(indicators) {
  const files = fs.readdirSync(OUT).filter(f => /failures.*\.(json|csv)$/i.test(f));
  files.forEach(f => {
    const p = path.join(OUT, f);
    if (f.endsWith('.json')) {
      const j = readJsonSafe(p);
      if (!j) return;
      const arr = Array.isArray(j) ? j : (j.records || j.items || []);
      arr.forEach(rec => {
        const from = toLower(rec.from || rec.sender || rec.addr || rec.address);
        const method = (rec.method || rec.signature || '').toString();
        add(indicators, from, 'fail_count', 1);
        if (method) add(indicators, from, `fail_method_${method}`, 1);
      });
    } else {
      const rows = readCsvSafe(p);
      rows.forEach(r => {
        const from = toLower(r.from || r.sender || r.addr || r.address);
        const method = (r.method || r.signature || '').toString();
        add(indicators, from, 'fail_count', 1);
        if (method) add(indicators, from, `fail_method_${method}`, 1);
      });
    }
  });
}

function collectForta(indicators, blacklist) {
  const files = fs.readdirSync(OUT).filter(f => /forta_alerts.*\.(json|csv)$/i.test(f));
  files.forEach(f => {
    const p = path.join(OUT, f);
    if (f.endsWith('.json')) {
      const j = readJsonSafe(p) || {};
      const arr = Array.isArray(j) ? j : (j.alerts || j.items || []);
  arr.forEach(a => {
    const spender = toLower(a.spender || a.entity || a.address || a.contract);
    const owner = toLower(a.owner || a.user || a.subject);
    const token = toLower(a.token || a.asset);
    const type = (a.type || a.alertType || '').toString().toLowerCase();
    if (type.includes('approval') || type.includes('permit')) add(indicators, owner || spender, 'approval_anomaly_count', 1);
    if (blacklist.set.has(spender) || blacklist.set.has(owner)) add(indicators, owner || spender, 'blacklist_contact_count', 1);
    const reasons = ((a.reasons || a.reasonTags || '') + '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const fromAddr = toLower(a.from || a.sender);
    const toAddr = toLower(a.to || a.recipient);
    if (type.includes('transfer')) {
      if (reasons.includes('density_spike') && fromAddr) add(indicators, fromAddr, 'transfer_density_spike_count', 1);
      if (reasons.includes('fanout_spike') && fromAddr) add(indicators, fromAddr, 'fanout_suspect_count', 1);
      if (reasons.includes('net_outflow') && fromAddr) add(indicators, fromAddr, 'transfer_net_outflow_count', 1);
      if (reasons.includes('net_inflow') && toAddr) add(indicators, toAddr, 'transfer_net_inflow_count', 1);
      if ((reasons.includes('bridge_inflow') && toAddr) || (reasons.includes('bridge_outflow') && fromAddr)) {
        add(indicators, fromAddr || toAddr, 'bridge_contact_count', 1);
      }
    }
  });
    } else {
      const rows = readCsvSafe(p);
  rows.forEach(r => {
    const spender = toLower(r.spender || r.entity || r.address || r.contract);
    const owner = toLower(r.owner || r.user || r.subject);
    const type = (r.type || r.alertType || '').toString().toLowerCase();
    if (type.includes('approval') || type.includes('permit')) add(indicators, owner || spender, 'approval_anomaly_count', 1);
    if (blacklist.set.has(spender) || blacklist.set.has(owner)) add(indicators, owner || spender, 'blacklist_contact_count', 1);
    const reasons = ((r.reasons || r.reasonTags || '') + '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const fromAddr = toLower(r.from || r.sender);
    const toAddr = toLower(r.to || r.recipient);
    if (type.includes('transfer')) {
      if (reasons.includes('density_spike') && fromAddr) add(indicators, fromAddr, 'transfer_density_spike_count', 1);
      if (reasons.includes('fanout_spike') && fromAddr) add(indicators, fromAddr, 'fanout_suspect_count', 1);
      if (reasons.includes('net_outflow') && fromAddr) add(indicators, fromAddr, 'transfer_net_outflow_count', 1);
      if (reasons.includes('net_inflow') && toAddr) add(indicators, toAddr, 'transfer_net_inflow_count', 1);
      if ((reasons.includes('bridge_inflow') && toAddr) || (reasons.includes('bridge_outflow') && fromAddr)) {
        add(indicators, fromAddr || toAddr, 'bridge_contact_count', 1);
      }
    }
  });
    }
  });
}

function collectTransfers(indicators, blacklist) {
  const files = fs.readdirSync(OUT).filter(f => /^transfers.*\.(csv|json)$/i.test(f));
  files.forEach(name => {
    const p = path.join(OUT, name);
    if (name.endsWith('.json')) {
      const j = readJsonSafe(p);
      const arr = Array.isArray(j) ? j : (j.items || j.records || []);
      const fanout = new Map();
      arr.forEach(t => {
        const from = toLower(t.from || t.sender);
        const to = toLower(t.to || t.recipient);
        const val = Number(t.value || t.amount || 0);
        if (from) {
          add(indicators, from, 'transfer_count', 1);
          if (!fanout.has(from)) fanout.set(from, new Set());
          if (to) fanout.get(from).add(to);
          if (blacklist.set.has(to) || blacklist.set.has(from)) add(indicators, from, 'blacklist_transfer_count', 1);
          if (val >= 1e24) add(indicators, from, 'large_transfer_count', 1);
        }
      });
      fanout.forEach((set, addr) => { if (set.size >= 10) add(indicators, addr, 'fanout_suspect_count', 1); });
    } else {
      const rows = readCsvSafe(p);
      const fanout = new Map();
      rows.forEach(r => {
        const from = toLower(r.from || r.sender);
        const to = toLower(r.to || r.recipient);
        const val = Number(r.value || r.amount || 0);
        if (from) {
          add(indicators, from, 'transfer_count', 1);
          if (!fanout.has(from)) fanout.set(from, new Set());
          if (to) fanout.get(from).add(to);
          if (blacklist.set.has(to) || blacklist.set.has(from)) add(indicators, from, 'blacklist_transfer_count', 1);
          if (val >= 1e24) add(indicators, from, 'large_transfer_count', 1);
        }
      });
      fanout.forEach((set, addr) => { if (set.size >= 10) add(indicators, addr, 'fanout_suspect_count', 1); });
    }
  });
}

function collectModelRisk(indicators) {
  const p = path.join(OUT, 'node_risk_agg.csv');
  if (!fs.existsSync(p)) return;
  const rows = readCsvSafe(p);
  rows.forEach(r => {
    const addr = toLower(r.address);
    if (!addr) return;
    add(indicators, addr, 'model_high_risk_count', Number(r.high_count || 0));
    indicators[addr].model_avg_risk = Number(r.avg_risk || 0);
    add(indicators, addr, 'model_sum_risk', Number(r.sum_risk || 0));
    add(indicators, addr, 'model_event_count', Number(r.event_count || 0));
  });
}

function collectBalancer(indicators) {
  const p = path.join(OUT, 'balancer_alerts_live.json');
  if (!fs.existsSync(p)) return;
  const j = readJsonSafe(p);
  const arr = Array.isArray(j) ? j : (j.items || j.alerts || []);
  arr.forEach(a => {
    const addr = toLower(a.address || a.user || a.trader);
    const type = (a.type || a.alertType || '').toString().toLowerCase();
    if (type.includes('price') || type.includes('manip')) add(indicators, addr, 'price_manip_suspect_count', 1);
  });
}

function computeScores(indicators) {
  Object.values(indicators).forEach(row => {
    const fail = row.fail_count || 0;
    const repeatPenalty = Object.keys(row).filter(k => k.startsWith('fail_method_')).reduce((s, k) => s + (row[k] || 0), 0) * 0.1;
    const blacklistHits = (row.blacklist_contact_count || 0) + (row.blacklist_transfer_count || 0);
    const transferSus = (row.fanout_suspect_count || 0) + (row.large_transfer_count || 0) + (row.transfer_density_spike_count || 0) + (row.transfer_net_outflow_count || 0) + (row.transfer_net_inflow_count || 0);
    const mevFlash = (row.price_manip_suspect_count || 0);
    const bridgeContact = (row.bridge_contact_count || 0);
    const modelHigh = row.model_high_risk_count || 0;
    const modelSum = row.model_sum_risk || 0;
    const modelAvg = row.model_avg_risk || 0;
    const gasAnom = row.gas_anomaly_count || 0;
    const respSpike = row.response_spike_count || 0;

    const R = Math.max(0, 1 - normCount(fail + repeatPenalty, 20));
    const S = max1(
      normCount(blacklistHits, 5) +
      normCount(transferSus, 5) +
      normCount(mevFlash, 3) +
      normCount(bridgeContact, 5) +
      normCount(modelHigh, 5) +
      normCount(modelSum, 10) +
      max1(modelAvg)
    );
    const D = Math.max(0, 1 - max1(normCount(gasAnom, 5) + normCount(respSpike, 5)));

    row.R = Number(R.toFixed(4));
    row.S = Number(S.toFixed(4));
    row.D = Number(D.toFixed(4));
  });
}

function writeOutputs(indicators) {
  const arr = Object.values(indicators);
  const jsonP = path.join(OUT, 'behavior_indicators.json');
  const csvP = path.join(OUT, 'behavior_indicators.csv');
  fs.writeFileSync(jsonP, JSON.stringify(arr, null, 2));
  const headers = ['address','fail_count','approval_anomaly_count','blacklist_contact_count','blacklist_transfer_count','fanout_suspect_count','large_transfer_count','transfer_density_spike_count','transfer_net_outflow_count','transfer_net_inflow_count','bridge_contact_count','price_manip_suspect_count','model_high_risk_count','model_avg_risk','model_sum_risk','model_event_count','R','S','D'];
  const rows = [headers.join(',')].concat(arr.map(r => headers.map(h => r[h] !== undefined ? r[h] : '').join(',')));
  fs.writeFileSync(csvP, rows.join('\n'));
  console.log(`Wrote: ${csvP} and ${jsonP}`);
}

function main() {
  const indicators = {};
  const blacklist = loadBlacklist();
  collectFailures(indicators);
  collectForta(indicators, blacklist);
  collectTransfers(indicators, blacklist);
  collectModelRisk(indicators);
  collectBalancer(indicators);
  computeScores(indicators);
  writeOutputs(indicators);
}

main();
