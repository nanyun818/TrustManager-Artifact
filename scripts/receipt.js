// Query a transaction receipt by hash and print the contract address
// Usage: node scripts/receipt.js <txHash>

require('dotenv').config();
const { ethers } = require('ethers');

async function main() {
  const hash = process.argv[2];
  if (!hash) {
    console.error('Usage: node scripts/receipt.js <txHash>');
    process.exit(1);
  }
  const RPC_URL = process.env.PROVIDER_URL || process.env.RPC_URL || 'http://127.0.0.1:8545';
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt) {
    console.log('Receipt not found yet. The transaction may still be pending.');
    process.exit(2);
  }
  console.log('Status:', receipt.status === 1 ? 'success' : 'failed');
  console.log('Block:', receipt.blockNumber);
  console.log('Contract Address:', receipt.contractAddress || '(none)');
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});