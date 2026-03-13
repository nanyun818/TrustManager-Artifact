const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config();

const STATE_FILE = path.join(__dirname, 'simulation_state.json');
const OUT_DIR = path.join(__dirname, '../out');
const HISTORY_FILE = path.join(OUT_DIR, 'trust_trend.csv');
const DETECTION_RESULT = path.join(__dirname, 'ai_detection_result.json');

// Whitewash Configuration
const ATTACK_MODE = process.env.ATTACK_MODE || 'standard';
const WHITEWASH_TRIGGER_LOOP = 110; 
const AI_DETECTION_LOOP = 115;      
const PENALTY_BP = 8500;            
const RISK_LEVEL = 95;              

// Attack Parameters based on Mode
const METRIC_PROB = ATTACK_MODE === 'stealth' ? 0.3 : 0.5;
const REC_PROB = ATTACK_MODE === 'stealth' ? 0.1 : 0.5;

async function main() {
  const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:7545';
  let privateKey = process.env.PRIVATE_KEY;
  let contractAddress = process.env.CONTRACT_ADDRESS;

  if (!contractAddress) {
    try {
      contractAddress = fs.readFileSync(path.join(__dirname, '../contract_address.txt'), 'utf8').trim();
    } catch (e) {
      console.log('Could not read contract_address.txt');
    }
  }

  if (!contractAddress) {
    console.error("Missing CONTRACT_ADDRESS env or file");
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
   const contractTemp = new ethers.Contract(contractAddress, ['function owner() public view returns (address)'], provider);
  let ownerAddress;
  try {
      ownerAddress = await contractTemp.owner();
      console.log(`Contract Owner: ${ownerAddress}`);
  } catch(e) {
      console.error("Failed to fetch owner:", e.message);
  }

  const providerAccounts = await provider.listAccounts();
  if (privateKey) {
    signer = new ethers.Wallet(privateKey, provider);
  } else if (ownerAddress && providerAccounts.find(a => a.toLowerCase() === ownerAddress.toLowerCase())) {
    console.log(`Using Owner Account from Provider: ${ownerAddress}`);
    signer = provider.getSigner(ownerAddress);
  } else {
    // Fallback to Ganache account 0
    signer = provider.getSigner(0);
  }
  
  const abi = [
    'function updateNodeMetrics(address _node, uint _successRate, uint _responseTime, uint _onlineTime) public',
    'function addRecommendation(address _node, uint _recommendValue, uint _weight) public',
    'function registerNode(address _node) public',
    'function deactivateNode(address _node) public',
    'function fastRespond(address _node, uint _risk, uint _bp, uint _until) public',
    'function getTrustValue(address _node) public view returns (uint256)',
    'function getNodeInfo(address _node) public view returns (uint trustValue, uint successRate, uint responseTime, uint onlineTime, uint interactionCount, bool isActive, bool isBlacklisted)',
    'function owner() public view returns (address)'
  ];
  const contract = new ethers.Contract(contractAddress, abi, signer);
  
  // Debug Owner
  try {
      const owner = await contract.owner();
      const signerAddr = await signer.getAddress();
      console.log(`Debug: Owner=${owner}, Signer=${signerAddr}`);
      if (owner.toLowerCase() !== signerAddr.toLowerCase()) {
          console.error("WARNING: Signer is NOT owner!");
      }
  } catch (e) { console.log("Could not check owner"); }

  // Read State
  if (!fs.existsSync(STATE_FILE)) {
    console.error('State file not found.');
    process.exit(1);
  }
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  const currentLoop = state.loop + 1;
  console.log(`\n=== WHITEWASH SIMULATION LOOP ${currentLoop} ===`);

  // --- WHITEWASH ATTACK LOGIC ---
  if (currentLoop === WHITEWASH_TRIGGER_LOOP) {
      console.log(`\n👺 [ATTACK] Loop ${currentLoop}: Collusion Nodes attempting Whitewash...`);
      
      // 1. Deactivate Old Collusion Nodes (Simulate them abandoning addresses)
      for (const badNode of state.groups.collusion) {
          try {
              console.log(`   -> Deactivating old node ${badNode}...`);
              const info = await contract.getNodeInfo(badNode);
              if (info.isActive) {
                  // Simulate node deactivating itself
                  const nodeSigner = provider.getSigner(badNode);
                  await (await contract.connect(nodeSigner).deactivateNode(badNode, { gasLimit: 500000 })).wait();
              } else {
                  console.log(`      Node already inactive.`);
              }
          } catch(e) { console.error(`Failed to deactivate: ${e.message}`); }
      }

      // 2. Register New "Whitewash" Nodes
      // We use the 'whitewash' group from state as the "New Identities"
      for (const newNode of state.groups.whitewash) {
          try {
              console.log(`   -> Registering NEW identity ${newNode}...`);
              // Check if active first to avoid revert
              const info = await contract.getNodeInfo(newNode);
              if (!info.isActive) {
                  await (await contract.registerNode(newNode)).wait();
              }
          } catch(e) { console.error(`Failed to register: ${e.message}`); }
      }
  }

  // --- AI DEFENSE (DYNAMIC DETECTION) ---
  if (currentLoop === AI_DETECTION_LOOP) {
      console.log(`\n🚨 [AI ALERT] Loop ${currentLoop}: Running AI Detection Agent...`);
      
      try {
          // 1. Run the detection script
          execSync('node scripts/ai_agent_detect.js', { stdio: 'inherit' });

          // 2. Read results
          if (fs.existsSync(DETECTION_RESULT)) {
              const detected = JSON.parse(fs.readFileSync(DETECTION_RESULT, 'utf8'));
              console.log(`   -> AI Agent flagged ${detected.length} suspicious nodes.`);
              
              for (const suspect of detected) {
                  const hiddenNode = suspect.address;
                  const until = Math.floor(Date.now()/1000) + 31536000;
                  try {
                      console.log(`   -> Punishing Suspicious Node ${hiddenNode}...`);
                      // Use owner to punish
                      const tx = await contract.fastRespond(hiddenNode, RISK_LEVEL, PENALTY_BP, until, { gasLimit: 500000 });
                      await tx.wait();
                  } catch (e) {
                      console.error(`   Failed to punish ${hiddenNode}: ${e.message}`);
                  }
              }
              
              // Clean up result file
              fs.unlinkSync(DETECTION_RESULT);
          } else {
              console.log("   -> No anomalies reported by AI Agent.");
          }

      } catch (e) {
          console.error(`   AI Agent failed: ${e.message}`);
      }
  }

  // --- STANDARD SIMULATION ---
  
  // 1. Honest Nodes (Baseline)
  for (const node of state.groups.honest) {
    if (Math.random() < 0.3) {
      try { await (await contract.updateNodeMetrics(node, 100, 100, 100, { gasLimit: 500000 })).wait(); } catch(e){}
    }
  }

  // 2. New Whitewash Nodes (Acting Maliciously)
  // Only active after loop 110
  if (currentLoop >= WHITEWASH_TRIGGER_LOOP) {
      for (const node of state.groups.whitewash) {
          // High performance metrics to build trust quickly
          if (Math.random() < METRIC_PROB) {
              try { await (await contract.updateNodeMetrics(node, 100, 50, 100, { gasLimit: 500000 })).wait(); } catch(e){}
          }
          // Mutual Recommendation (forming a new clique)
          if (Math.random() < REC_PROB) {
              const target = state.groups.whitewash[Math.floor(Math.random() * state.groups.whitewash.length)];
              if (target !== node) {
                  try { 
                      const nodeSigner = provider.getSigner(node);
                      await (await contract.connect(nodeSigner).addRecommendation(target, 200, 80, { gasLimit: 500000 })).wait(); 
                  } catch(e){}
              }
          }
      }
  }

  // 3. Update State
  state.loop = currentLoop;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  // 4. Snapshot
  const snapshotFile = path.join(OUT_DIR, `onchain_snapshot_ww_loop_${currentLoop}.csv`);
  const header = 'address,trustValue,successRate,responseTime,onlineTime,isActive,isBlacklisted';
  const rows = [header];
  
  // Capture all groups
  const allNodes = [...state.groups.honest, ...state.groups.collusion, ...state.groups.whitewash, ...state.groups.on_off];
  const uniqueNodes = [...new Set(allNodes)];

  const groupMap = {};
  state.groups.honest.forEach(a => groupMap[a] = 'Honest');
  state.groups.collusion.forEach(a => groupMap[a] = 'Collusion');
  state.groups.whitewash.forEach(a => groupMap[a] = 'Whitewash');

  let historyData = '';

  for (const addr of uniqueNodes) {
    try {
        const info = await contract.getNodeInfo(addr);
        rows.push(`${addr},${info.trustValue},${info.successRate},${info.responseTime},${info.onlineTime},${info.isActive},${info.isBlacklisted}`);
        
        // Append to history
        const group = groupMap[addr] || 'Unknown';
        historyData += `${currentLoop},${addr},${group},${info.trustValue},${info.isBlacklisted}\n`;
    } catch (e) {}
  }
  
  fs.writeFileSync(snapshotFile, rows.join('\n'));
  console.log(`Snapshot saved: ${snapshotFile}`);

  if (historyData) {
      fs.appendFileSync(HISTORY_FILE, historyData);
      console.log(`History appended to: ${HISTORY_FILE}`);
  }
}

main().catch(console.error);
