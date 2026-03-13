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
  const pk = String(args.pk || process.env.PRIVATE_KEY || '');
  const addr = String(args.contract || process.env.CONTRACT_ADDRESS || '');
  const node = ethers.utils.getAddress(String(args.node));
  const lambda = Number(args.lambda || 3000);
  const recValue = Number(args.value || 200);
  const recWeight = Number(args.weight || 20);
  if (!pk || !addr || !node) throw new Error('Missing PRIVATE_KEY, CONTRACT_ADDRESS or --node');
  const provider = new ethers.providers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);
  const abi = [
    'function updateLambda(uint _lambda) public',
    'function addRecommendation(address _node,uint _recommendValue,uint _weight) public',
    'function getNodeInfo(address _node) public view returns (uint,uint,uint,uint,uint,bool,bool)'
  ];
  const c = new ethers.Contract(addr, abi, wallet);
  const t1 = await c.updateLambda(lambda);
  await t1.wait();
  const t2 = await c.addRecommendation(node, recValue, recWeight);
  await t2.wait();
  const info = await c.getNodeInfo(node);
  process.stdout.write(JSON.stringify({
    address: node,
    trustValue: Number(info[0]),
    successRate: Number(info[1]),
    responseTime: Number(info[2]),
    onlineTime: Number(info[3])
  }) + '\n');
}

main().catch((e) => { process.stderr.write(String(e && e.message ? e.message : e) + '\n'); process.exit(1); });

