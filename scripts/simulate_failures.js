// Simulate a burst of failed transactions against TrustManager for a registered node
// Steps:
// - Register a test node address (no funds required)
// - Send N failing calls (addRecommendation with weight=0) quickly
// - Bot should detect 3 failures in window and mitigate
//
// Env:
// PROVIDER_URL (default http://127.0.0.1:8545)
// CONTRACT_ADDRESS (required)
// PRIVATE_KEY (optional; else uses unlocked account[0])
// FAIL_COUNT (default 3)

require('dotenv').config();
const { ethers } = require('ethers');

async function main() {
  const RPC_URL = process.env.PROVIDER_URL || process.env.RPC_URL || 'http://127.0.0.1:8545';
  const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS || '').trim();
  if (!CONTRACT_ADDRESS) throw new Error('CONTRACT_ADDRESS must be set');
  const PRIVATE_KEY = process.env.PRIVATE_KEY_OVERRIDE || process.env.PRIVATE_KEY || '';
  const FAIL_COUNT = Number(process.env.FAIL_COUNT || 3);

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  let signer;
  if (PRIVATE_KEY) signer = new ethers.Wallet(PRIVATE_KEY, provider);
  else signer = provider.getSigner(0);

  // Load ABI from artifacts
  const fs = require('fs');
  const path = require('path');
  const ROOT = __dirname ? path.resolve(__dirname, '..') : process.cwd();
  const artifact = path.join(ROOT, 'artifacts', 'TrustManager.json');
  const abi = JSON.parse(fs.readFileSync(artifact, 'utf8')).abi;
  const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, signer);

  // Create a deterministic test node address (no need for funded wallet)
  const wallet = ethers.Wallet.createRandom();
  const testNode = wallet.address;
  console.log('Provider:', RPC_URL);
  console.log('Contract:', CONTRACT_ADDRESS);
  console.log('Signer:', await signer.getAddress());
  console.log('Test node to register:', testNode);

  // Register the test node
  try {
    const tx = await contract.registerNode(testNode);
    console.log('[tx] registerNode sent:', tx.hash);
    await tx.wait(1);
    console.log('[ok] test node registered');
  } catch (e) {
    console.log('[warn] registerNode failed (ignored if already active):', e && e.message ? e.message : e);
  }

  // Send failing transactions: call onlyOwner function as non-owner (updateLambda) to trigger revert
  for (let i = 1; i <= FAIL_COUNT; i++) {
    try {
      const data = contract.interface.encodeFunctionData('updateLambda', [10001]);
      const tx = await signer.sendTransaction({ to: contract.address, data });
      console.log(`[tx] updateLambda(>10000, onlyOwner) sent:`, tx.hash);
      const rc = await tx.wait(1);
      const st = rc && rc.status === 1 ? 'success' : 'failed';
      console.log(`[rc] status=${st} attempt ${i}/${FAIL_COUNT}`);
    } catch (e) {
      if (e && e.receipt) {
        console.log(`[fail(expected)] attempt ${i}/${FAIL_COUNT}: status=${e.receipt.status} tx=${e.receipt.transactionHash}`);
      } else {
        console.log(`[fail(expected)] attempt ${i}/${FAIL_COUNT}:`, e && e.message ? e.message : e);
      }
    }
    // Small delay to stay within bot window
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('Simulation completed. Check bot logs for mitigation actions.');
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});