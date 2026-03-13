const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Target nodes for different attack types
const TARGETS = {
  // On-off Attack: Behaves well then badly periodically
  // Target: 0x7B9EB440516A1e5f3Cb1e3593189943Da8574A64 (High trust, row 3)
  ON_OFF: '0x7B9EB440516A1e5f3Cb1e3593189943Da8574A64',
  
  // Bad-mouthing Attack: Provides low recommendations despite good service
  // Target: 0x71090B985Ec887977AAE1d20C141cf7a11a27380 (High trust, row 4)
  BAD_MOUTH: '0x71090B985Ec887977AAE1d20C141cf7a11a27380',
  
  // Sybil Attack: Creates multiple fake identities (simulated by updating metrics for new random addresses)
  SYBIL_ROOT: '0x3018018c44338B9728d02be12d632C6691E020d1' // (High trust, row 5)
};

async function main() {
  const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:7545';
  const privateKey = process.env.PRIVATE_KEY;
  const contractAddress = process.env.CONTRACT_ADDRESS;

  if (!privateKey || !contractAddress) {
    console.error('Missing env vars');
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const abi = [
    'function updateNodeMetrics(address _node, uint _successRate, uint _responseTime, uint _onlineTime) public',
    'function addRecommendation(address _node, uint _recommendValue, uint _weight) public',
    'function registerNode(address _node) public',
    'function fastRespond(address _node, uint _risk, uint _bp, uint _until) public'
  ];
  const contract = new ethers.Contract(contractAddress, abi, wallet);

  const args = process.argv.slice(2);
  const loop = parseInt(args[0] || '0', 10);
  
  console.log(`--- Attack Injection Loop ${loop} ---`);

  // 1. On-off Attack (Oscillates every 3 loops)
  // Good: Success=100, Resp=100 | Bad: Success=20, Resp=5000
  const isBadPeriod = (loop % 6) >= 3; 
  console.log(`[On-off] Node: ${TARGETS.ON_OFF}, State: ${isBadPeriod ? 'MALICIOUS' : 'HONEST'}`);
  if (isBadPeriod) {
    // Degrade performance significantly
    await (await contract.updateNodeMetrics(TARGETS.ON_OFF, 20, 5000, 10)).wait();
  } else {
    // Restore good performance
    await (await contract.updateNodeMetrics(TARGETS.ON_OFF, 100, 100, 60)).wait();
  }

  // 2. Bad-mouthing Attack (Always active in this phase)
  // Node provides very low recommendation value (10/200) to a good node (ON_OFF target)
  // attempting to lower its score via social trust
  console.log(`[Bad-mouth] Node: ${TARGETS.BAD_MOUTH} -> Target: ${TARGETS.ON_OFF}`);
  await (await contract.addRecommendation(TARGETS.ON_OFF, 10, 50)).wait(); // Weight 50 (high influence attempt)

  // 3. Sybil Attack (Create 1 new fake node per loop)
  const fakeNode = ethers.Wallet.createRandom().address;
  console.log(`[Sybil] Created Fake Node: ${fakeNode}`);
  try {
    await (await contract.registerNode(fakeNode)).wait();
    // Fake node immediately gives high recommendation to the Sybil Root
    await (await contract.addRecommendation(TARGETS.SYBIL_ROOT, 200, 100)).wait();
    // And fake node pretends to be perfect to gain trust quickly
    await (await contract.updateNodeMetrics(fakeNode, 100, 50, 100)).wait();
  } catch (e) {
    console.log(`Sybil error: ${e.message}`);
  }

  console.log('Attack cycle completed.');
}

main().catch(console.error);
