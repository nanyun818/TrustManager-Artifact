const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

async function main() {
  const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:7545';
  const privateKey = process.env.PRIVATE_KEY;
  const contractAddress = process.env.CONTRACT_ADDRESS;

  if (!privateKey || !contractAddress) {
    console.error('Missing PRIVATE_KEY or CONTRACT_ADDRESS env vars');
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const abi = [
    'function fastRespond(address _node, uint _risk, uint _bp, uint _until) public',
    'function updateNodeMetrics(address _node, uint _successRate, uint _responseTime, uint _onlineTime) public',
    'function getTrustValue(address _node) public view returns (uint256)',
    'function registerNode(address _node) public'
  ];

  const contract = new ethers.Contract(contractAddress, abi, wallet);

  // Target Node: 0x10AAe54E3F84C39C51936538b64C90c780315306 (High trust node from snapshot)
  const targetNode = '0x10AAe54E3F84C39C51936538b64C90c780315306';
  
  console.log(`Targeting Node: ${targetNode}`);
  
  // 1. Check initial trust
  try {
    const initialTrust = await contract.getTrustValue(targetNode);
    console.log(`Initial Trust Value: ${initialTrust.toString()}`);
  } catch (e) {
    console.log('Node might not be registered, registering...');
    await (await contract.registerNode(targetNode)).wait();
  }

  // 2. Inject Malicious Behavior
  // Scenario: Node suddenly starts failing all requests and is flagged with high risk
  console.log('Injecting malicious behavior...');
  
  // A. Fast Response (Risk = 100/100, Penalty = 5000 bps = 50% trust reduction immediately)
  // Lockout until 1 hour from now
  const until = Math.floor(Date.now() / 1000) + 3600; 
  const tx1 = await contract.fastRespond(targetNode, 100, 5000, until);
  await tx1.wait();
  console.log(`Executed fastRespond (Risk: 100, Penalty: 50%) - Tx: ${tx1.hash}`);

  // B. Update Metrics to reflect failure (Success: 0, Response: 10000ms, Online: 0)
  const tx2 = await contract.updateNodeMetrics(targetNode, 0, 10000, 0);
  await tx2.wait();
  console.log(`Updated metrics to failure state - Tx: ${tx2.hash}`);

  // 3. Check final trust
  const finalTrust = await contract.getTrustValue(targetNode);
  console.log(`Final Trust Value: ${finalTrust.toString()}`);
}

main().catch(console.error);
