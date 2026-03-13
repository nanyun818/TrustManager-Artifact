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
  const rpc = String(args.rpc || process.env.RPC_URL || 'http://127.0.0.1:8545');
  const ownerPk = String(args.owner || process.env.PRIVATE_KEY || '');
  const addr = String(args.contract || process.env.CONTRACT_ADDRESS || '');
  const target = ethers.utils.getAddress(String(args.target));
  const lambda = Number(args.lambda || 5000);
  const recValue = Number(args.value || 180);
  const recWeight = Number(args.weight || 20);
  const keys = String(args.keys || '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const unblacklist = String(args.unblacklist || 'true').toLowerCase() === 'true';
  if (!ownerPk || !addr || !target || keys.length === 0) throw new Error('Missing owner PRIVATE_KEY, contract, target or keys');

  const provider = new ethers.providers.JsonRpcProvider(rpc);
  const owner = new ethers.Wallet(ownerPk, provider);
  const abiOwner = [
    'function removeFromBlacklist(address _node) public',
    'function updateLambda(uint _lambda) public',
    'function registerNode(address _node) public',
    'function getNodeInfo(address _node) public view returns (uint,uint,uint,uint,uint,bool,bool)'
  ];
  const cOwner = new ethers.Contract(addr, abiOwner, owner);

  if (unblacklist) {
    try { const tx0 = await cOwner.removeFromBlacklist(target); await tx0.wait(); } catch {}
    try { const tx1 = await cOwner.registerNode(target); await tx1.wait(); } catch {}
    const tx2 = await cOwner.updateLambda(lambda); await tx2.wait();
  }

  const abiUser = [
    'function addRecommendation(address _node,uint _recommendValue,uint _weight) public',
    'function getNodeInfo(address _node) public view returns (uint,uint,uint,uint,uint,bool,bool)'
  ];

  const results = [];
  for (const pk of keys) {
    const w = new ethers.Wallet(pk, provider);
    const c = new ethers.Contract(addr, abiUser, w);
    const t = await c.addRecommendation(target, recValue, recWeight);
    await t.wait();
    const info = await c.getNodeInfo(target);
    results.push({ signer: w.address, trustValue: Number(info[0]), isBlacklisted: Boolean(info[6]) });
  }

  process.stdout.write(JSON.stringify({ target, lambda, recValue, recWeight, results }, null, 2) + '\n');
}

main().catch((e) => { process.stderr.write(String(e && e.message ? e.message : e) + '\n'); process.exit(1); });

