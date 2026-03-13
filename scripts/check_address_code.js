#!/usr/bin/env node
// Quick on-chain address presence check and optional getPoolId() probe.
const { ethers } = require('ethers');

function parseArgs() {
  const argv = process.argv.slice(2);
  const opts = { rpc: process.env.RPC_URL, addresses: [], tryPoolId: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rpc') opts.rpc = argv[++i];
    else if (a === '--address') opts.addresses.push(String(argv[++i]).toLowerCase());
    else if (a === '--tryPoolId') opts.tryPoolId = true;
  }
  if (!opts.rpc) throw new Error('Missing --rpc');
  if (opts.addresses.length === 0) throw new Error('Missing --address');
  return opts;
}

async function main() {
  const opts = parseArgs();
  const provider = new ethers.providers.JsonRpcProvider(opts.rpc);
  const results = [];
  for (const addr of opts.addresses) {
    const code = await provider.getCode(addr);
    const exists = code && code !== '0x';
    let poolId = null;
    if (exists && opts.tryPoolId) {
      try {
        const iface = new ethers.utils.Interface(['function getPoolId() view returns (bytes32)']);
        const data = iface.encodeFunctionData('getPoolId', []);
        const ret = await provider.call({ to: addr, data });
        const [pid] = iface.decodeFunctionResult('getPoolId', ret);
        poolId = pid;
      } catch (e) {
        // ignore if not a pool or call fails
        poolId = null;
      }
    }
    results.push({ address: addr, exists, codeLength: code.length, poolId });
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});