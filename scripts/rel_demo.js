const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const ROOT = process.cwd();
  const OUT = path.join(ROOT, 'out');
  const rpc = String(args.rpc || process.env.RPC_URL || 'http://127.0.0.1:8545');
  const pk = String(args.pk || process.env.PRIVATE_KEY || '');
  const addr = String(args.contract || process.env.CONTRACT_ADDRESS || '');
  const target = ethers.utils.getAddress(String(args.target));
  const rels = String(args.rels || '0,1,2').split(',').map((x) => Number(x.trim()));
  if (!pk || !addr || !target) throw new Error('Missing PRIVATE_KEY, CONTRACT_ADDRESS or --target');
  const provider = new ethers.providers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);

  const abi = [
    'function registerNode(address _node) public',
    'function updateNodeMetricsRel(address _node,uint8 _rel,uint _successRate,uint _responseTime,uint _onlineDelta) public',
    'function addRecommendationRel(address _node,uint8 _rel,uint _recommendValue,uint _weight) public',
    'function getRelState(address _node,uint8 _rel) public view returns (uint,uint,uint,uint,uint,uint)'
  ];
  const c = new ethers.Contract(addr, abi, wallet);
  try { const r = await c.registerNode(target); await r.wait(); } catch (e) {}

  const rows = [];
  for (const rel of rels) {
    const t1 = await c.updateNodeMetricsRel(target, rel, 80, 200, 120);
    await t1.wait();
    const t2 = await c.addRecommendationRel(target, rel, 160, 30);
    await t2.wait();
    const st = await c.getRelState(target, rel);
    rows.push({
      address: target,
      rel,
      trustValue: Number(st[0]),
      successRate: Number(st[1]),
      responseTime: Number(st[2]),
      onlineTime: Number(st[3]),
      interactionCount: Number(st[4]),
      lastUpdated: Number(st[5])
    });
  }

  const csvPath = path.join(OUT, 'onchain_rel_snapshot.csv');
  const header = ['address','rel','trustValue','successRate','responseTime','onlineTime','interactionCount','lastUpdated'];
  const csv = [header.join(',')].concat(rows.map((r) => header.map((h) => String(r[h])).join(','))).join('\n');
  fs.writeFileSync(csvPath, csv);
  process.stdout.write(csvPath + '\n');
}

main().catch((e) => { process.stderr.write(String(e && e.message ? e.message : e) + '\n'); process.exit(1); });

