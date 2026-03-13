// Balancer detector (skeleton): subscribe to Vault/Pool addresses and emit heuristic findings
// Usage: const det = createDetector(provider, cfg, (finding) => { /* write/alert */ }); det.start();

const { ethers } = require('ethers');

function createDetector(provider, cfg, emitFinding) {
  const chain = (cfg.network || '').toLowerCase();
  const bal = (cfg.balancer || {});
  const set = (bal[chain] || { vaults: [], pools: [] });
  const vaults = (set.vaults || []).map((x) => String(x).toLowerCase());
  const pools = (set.pools || []).map((x) => String(x).toLowerCase());
  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  // Balancer Vault Swap signature uses uint256 amounts
  const SWAP_TOPIC = ethers.utils.id('Swap(bytes32,address,address,uint256,uint256)');
  const POOL_BALANCE_CHANGED_TOPIC = ethers.utils.id('PoolBalanceChanged(bytes32,address[],int256[],int256[])');

  function onLog(log) {
    try {
      const addr = String(log.address).toLowerCase();
      const isVault = vaults.includes(addr);
      const isPool = pools.includes(addr);
      if (!isVault && !isPool) return;
      const bn = (typeof log.blockNumber === 'number') ? log.blockNumber : parseInt(log.blockNumber || '0');
      const topics = log.topics || [];
      const t0 = String(topics[0] || '').toLowerCase();
      if (t0 === TRANSFER_TOPIC) {
        const from = ethers.utils.getAddress('0x' + topics[1].slice(26));
        const to = ethers.utils.getAddress('0x' + topics[2].slice(26));
        const amountHex = (typeof log.data === 'string') ? log.data.toLowerCase() : (log.data.hex || '').toLowerCase();
        const unlimitedLike = amountHex.length > 66 && amountHex.startsWith('0x000');
        emitFinding({
          name: 'Balancer Activity Heuristic',
          description: `Vault/Pool transfer tx=${log.transactionHash} unlimitedLike=${unlimitedLike}`,
          alert_id: 'FAST-BALANCER-HEUR',
          severity: unlimitedLike ? 'High' : 'Medium',
          type: 'Suspicious',
          metadata: { address: ethers.utils.getAddress(log.address), from, to, block: String(bn), tx_hash: log.transactionHash }
        });
      } else if (t0 === String(SWAP_TOPIC).toLowerCase()) {
        emitFinding({
          name: 'Balancer Swap Event',
          description: `Swap observed at ${ethers.utils.getAddress(log.address)}`,
          alert_id: 'FAST-BALANCER-SWAP',
          severity: 'Medium',
          type: 'Suspicious',
          metadata: { address: ethers.utils.getAddress(log.address), block: String(bn), tx_hash: log.transactionHash }
        });
      } else if (t0 === String(POOL_BALANCE_CHANGED_TOPIC).toLowerCase()) {
        emitFinding({
          name: 'Balancer Join/Exit Event',
          description: `PoolBalanceChanged at ${ethers.utils.getAddress(log.address)}`,
          alert_id: 'FAST-BALANCER-JOINEXIT',
          severity: 'Medium',
          type: 'Suspicious',
          metadata: { address: ethers.utils.getAddress(log.address), block: String(bn), tx_hash: log.transactionHash }
        });
      }
    } catch (_) {}
  }

  function start() {
    for (const v of vaults) provider.on({ address: v }, onLog);
    for (const p of pools) provider.on({ address: p }, onLog);
  }

  return { start };
}

module.exports = { createDetector };