const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

function parseArgs() {
  const out = { n: 20, label: '', plan: '' };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  out.n = Number(out.n || 20);
  return out;
}

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

async function main() {
  const args = parseArgs();
  const ROOT = process.cwd();
  const OUT = path.join(ROOT, 'out');
  const RPC_URL = String(args.rpc || process.env.RPC_URL || 'http://127.0.0.1:8545');
  const CONTRACT = String(args.contract || process.env.CONTRACT_ADDRESS || '');
  const N = Number(args.n || 20);
  const LABEL = String(args.label || '');
  const PREV = String(args.prev || '');
  const PLAN_FILE = String(args.plan || '');
  const planArg = PLAN_FILE ? readJson(path.join(OUT, PLAN_FILE)) : null;
  const plan = readJson(path.join(OUT, 'onchain_plan.json')) || { calls: [], recs: [] };
  const callPlan = readJson(path.join(OUT, 'onchain_call_plan.json')) || { calls: [], recs: [] };
  const srcPlan = planArg && ((Array.isArray(planArg.calls) && planArg.calls.length) || (Array.isArray(planArg.recs) && planArg.recs.length))
    ? planArg
    : (((Array.isArray(plan.calls) && plan.calls.length) || (Array.isArray(plan.recs) && plan.recs.length)) ? plan : callPlan);
  if (!CONTRACT) throw new Error('Missing contract address');

  const abi = [
    'function getNodeInfo(address _node) public view returns (uint,uint,uint,uint,uint,bool,bool)',
    'function getRecommendationCount(address _node) public view returns (uint)',
    'function getTrustHistoryCount(address _node) public view returns (uint)',
    'function getTrustLevel(address _node) public view returns (uint)'
  ];
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const c = new ethers.Contract(CONTRACT, abi, provider);

  const picks = (Array.isArray(srcPlan.recs) && srcPlan.recs.length > 0)
    ? [...srcPlan.recs].sort((a,b) => (b.value||0) - (a.value||0)).slice(0, N)
    : (Array.isArray(srcPlan.calls) ? srcPlan.calls.slice(0, N) : []);

  const callByAddr = new Map();
  if (Array.isArray(srcPlan.calls)) {
    for (const c of srcPlan.calls) {
      const addr = ethers.utils.getAddress(String(c.address));
      callByAddr.set(addr, c);
    }
  }

  const rows = [];
  for (const p of picks) {
    const addr = ethers.utils.getAddress(String(p.address || p.addr));
    const info = await c.getNodeInfo(addr);
    const recCount = await c.getRecommendationCount(addr);
    const histCount = await c.getTrustHistoryCount(addr);
    const level = await c.getTrustLevel(addr);
    const callArgs = callByAddr.get(addr) || {};
    rows.push({
      address: addr,
      trustValue: Number(info[0]),
      successRate: Number(info[1]),
      responseTime: Number(info[2]),
      onlineTime: Number(info[3]),
      interactionCount: Number(info[4]),
      isActive: Boolean(info[5]),
      isBlacklisted: Boolean(info[6]),
      recommendationValue: Number(p.value || 0),
      recommendationWeight: Number(p.weight || 0),
      successRateParam: Number(callArgs.successRate || 0),
      responseTimeParam: Number(callArgs.responseTime || 0),
      onlineDeltaParam: Number(callArgs.onlineDelta || 0),
      recommendationCount: Number(recCount),
      trustHistoryCount: Number(histCount),
      trustLevel: Number(level)
    });
  }

  const suffix = LABEL && LABEL.length > 0 ? `top${N}_${LABEL}` : 'topN';
  const snapCsv = path.join(OUT, `onchain_snapshot_${suffix}.csv`);
  const callCsv = path.join(OUT, `onchain_call_params_${suffix}.csv`);
  const header = [
    'address','trustValue','successRate','responseTime','onlineTime','interactionCount','isActive','isBlacklisted',
    'recommendationValue','recommendationWeight','successRateParam','responseTimeParam','onlineDeltaParam',
    'recommendationCount','trustHistoryCount','trustLevel'
  ];
  const toCsv = (arr) => [header.join(',')].concat(arr.map((r) => header.map((h) => String(r[h])).join(','))).join('\n');
  fs.writeFileSync(snapCsv, toCsv(rows));
  fs.writeFileSync(callCsv, toCsv(rows));
  let comparePath = '';
  if (PREV && fs.existsSync(PREV)) {
    const prevTxt = fs.readFileSync(PREV, 'utf8');
    const prevLines = prevTxt.split(/\r?\n/).filter((x) => x.trim().length > 0);
    const prevHeader = prevLines[0].split(',');
    const prevIdx = {};
    for (let i = 0; i < prevHeader.length; i++) prevIdx[prevHeader[i]] = i;
    const prevMap = new Map();
    for (let i = 1; i < prevLines.length; i++) {
      const cols = prevLines[i].split(',');
      const addr = cols[prevIdx['address']];
      if (addr) prevMap.set(addr, cols);
    }
    const compHeader = [
      'address',
      'trust_before','trust_after','delta_trust',
      'isBlacklisted_before','isBlacklisted_after',
      'successRate_before','successRate_after',
      'responseTime_before','responseTime_after',
      'onlineTime_before','onlineTime_after',
      'recommendationCount_before','recommendationCount_after',
      'trustLevel_before','trustLevel_after'
    ];
    const compRows = [];
    for (const r of rows) {
      const p = prevMap.get(r.address);
      if (!p) continue;
      const getPrev = (name) => {
        const idx = prevIdx[name];
        return idx === undefined ? '' : p[idx];
      };
      const trustBefore = Number(getPrev('trustValue'));
      const trustAfter = Number(r.trustValue);
      const delta = trustAfter - trustBefore;
      compRows.push({
        address: r.address,
        trust_before: trustBefore,
        trust_after: trustAfter,
        delta_trust: delta,
        isBlacklisted_before: getPrev('isBlacklisted'),
        isBlacklisted_after: String(r.isBlacklisted),
        successRate_before: getPrev('successRate'),
        successRate_after: String(r.successRate),
        responseTime_before: getPrev('responseTime'),
        responseTime_after: String(r.responseTime),
        onlineTime_before: getPrev('onlineTime'),
        onlineTime_after: String(r.onlineTime),
        recommendationCount_before: getPrev('recommendationCount'),
        recommendationCount_after: String(r.recommendationCount),
        trustLevel_before: getPrev('trustLevel'),
        trustLevel_after: String(r.trustLevel)
      });
    }
    const toCsvComp = (arr) => [compHeader.join(',')]
      .concat(arr.map((r) => compHeader.map((h) => String(r[h])).join(','))).join('\n');
    comparePath = path.join(OUT, `onchain_compare_${suffix}.csv`);
    fs.writeFileSync(comparePath, toCsvComp(compRows));
  }
  process.stdout.write(JSON.stringify({ snapshot: snapCsv, params: callCsv, count: rows.length, compare: comparePath }) + '\n');
}

main().catch((e) => { process.stderr.write(String(e && e.message ? e.message : e) + '\n'); process.exit(1); });
