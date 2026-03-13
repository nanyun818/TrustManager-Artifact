const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const STATE_FILE = path.join(__dirname, 'simulation_state.json');

async function main() {
  const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:7545';
  let privateKey = process.env.PRIVATE_KEY;
  let contractAddress = process.env.CONTRACT_ADDRESS;

  // Fallback: Read contract address from file if env missing
  if (!contractAddress) {
    try {
      const addrPath = path.join(__dirname, '../contract_address.txt');
      if (fs.existsSync(addrPath)) {
        contractAddress = fs.readFileSync(addrPath, 'utf8').trim();
      }
    } catch (e) {}
  }

  if (!privateKey || !contractAddress) {
    console.error("❌ Error: Missing PRIVATE_KEY or CONTRACT_ADDRESS");
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  
  // Wallet Pool for Rotation (Avoid Nonce Stuck issues)
  const PRIVATE_KEYS = [
      process.env.PRIVATE_KEY
  ];
  const wallets = PRIVATE_KEYS.map(pk => new ethers.Wallet(pk, provider));
  
  // Helper to get random wallet
  const getSigner = () => wallets[0];

  const mainWallet = wallets[0]; // For gas checks and admin tasks if any
  const abi = [
    'function updateNodeMetrics(address _node, uint _successRate, uint _responseTime, uint _onlineTime) public',
    'function addRecommendation(address _node, uint _recommendValue, uint _weight) public',
    'function registerNode(address _node) public',
    'function getTrustValue(address _node) public view returns (uint256)'
  ];
  const contract = new ethers.Contract(contractAddress, abi, mainWallet);

  // --- GAS AUTO-REFILL MECHANISM ---
  try {
      const balance = await mainWallet.getBalance();
      const balanceEth = parseFloat(ethers.utils.formatEther(balance));
      console.log(`⛽ Current Gas Balance: ${balanceEth.toFixed(4)} ETH`);

      if (balanceEth < 10.0) {
          console.warn(`⚠️ Low Gas (<10 ETH). Attempting auto-refill from backup accounts...`);
          const backupKeys = [
              '0x65eda5dc63f9a97d4bd33cf899958c979ddfcaab704358d699428835e6cf0a0a',
              '0x4b5d5f49d824f05c7c0a1d627ef17d570718955a6e481d9a454f4863b567d418'
          ];
          
          for (const pk of backupKeys) {
              try {
                  const funder = new ethers.Wallet(pk, provider);
                  const fBal = await funder.getBalance();
                  const fBalEth = parseFloat(ethers.utils.formatEther(fBal));
                  
                  if (fBalEth > 5.0) {
                      const amountToSend = fBal.sub(ethers.utils.parseEther("1.0")); // Keep 1 ETH for safety
                      console.log(`💰 Refilling ${ethers.utils.formatEther(amountToSend)} ETH from backup ${funder.address}...`);
                      const tx = await funder.sendTransaction({
                          to: wallet.address,
                          value: amountToSend
                      });
                      await tx.wait();
                      console.log(`✅ Refill successful! New Balance: ${(await wallet.getBalance()) / 1e18} ETH`);
                      break; // Refill once is enough for now
                  }
              } catch (err) {
                  console.error(`❌ Refill failed from backup: ${err.message}`);
              }
          }
      }
  } catch (err) {
      console.error(`Gas check error: ${err.message}`);
  }
  // ---------------------------------

  // Read State
  if (!fs.existsSync(STATE_FILE)) {
    console.error('State file not found. Run init_simulation.js first.');
    process.exit(1);
  }
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  let currentLoop = state.loop + 1;
  try {
    const historyFile = path.join(__dirname, '../out/trust_trend_overnight.csv');
    if (fs.existsSync(historyFile)) {
      const data = fs.readFileSync(historyFile, 'utf-8');
      const lines = data.trim().split(/\r?\n/);
      if (lines.length > 1) {
        let i = lines.length - 1;
        while (i > 0 && (!lines[i] || lines[i].startsWith('timestamp'))) i--;
        if (i > 0) {
          const parts = lines[i].split(',');
          if (parts.length >= 2) {
            const csvLoop = parseInt(parts[1], 10);
            if (!isNaN(csvLoop)) {
              currentLoop = Math.max(currentLoop, csvLoop + 1);
            }
          }
        }
      }
    }
  } catch (_) {}
  console.log(`\n=== EXTENDED SIMULATION LOOP ${currentLoop} ===`);

  // 1. Process Honest Nodes (Consistently Good)
  // Success: 98-100%, Resp: 50-150ms
  console.log('Processing Honest Nodes...');
  for (const node of state.groups.honest) {
    if (Math.random() < 0.3) { // Update 30% of nodes per block to save time/gas
      console.log(`> Honest Node ${node.slice(0,6)}...`);
       try {
         await (await contract.connect(getSigner()).updateNodeMetrics(node, 100, 100, 100, { gasLimit: 3000000 })).wait();
       } catch (e) { console.error(`Failed Honest: ${e.message}`); }
    }
  }

  // 2. Process On-Off Nodes (Good 10 loops, Bad 5 loops)
  // Cycle length = 15
  const onOffCycle = currentLoop % 15;
  const isOn = onOffCycle < 10;
  console.log(`[On-Off Group] State: ${isOn ? 'GOOD' : 'BAD'}`);
  for (const node of state.groups.on_off) {
    if (Math.random() < 0.5) {
      console.log(`> OnOff Node ${node.slice(0,6)}...`);
       try {
         if (isOn) {
             await (await contract.connect(getSigner()).updateNodeMetrics(node, 100, 100, 100, { gasLimit: 3000000 })).wait();
         } else {
             await (await contract.connect(getSigner()).updateNodeMetrics(node, 10, 5000, 10, { gasLimit: 3000000 })).wait();
         }
       } catch (e) { console.error(`Failed OnOff: ${e.message}`); }
    }
  }

  // 3. Process Collusion Nodes (Mediocre Perf, High Mutual Recs, Low Recs to Honest)
  // Perf: 60-80% Success
  console.log('Processing Collusion Nodes...');
  for (const node of state.groups.collusion) {
    // A. Update Metrics (Mediocre)
    if (Math.random() < 0.2) {
      console.log(`> Collusion Metrics ${node.slice(0,6)}...`);
      try {
        await (await contract.connect(getSigner()).updateNodeMetrics(node, 70, 500, 80, { gasLimit: 3000000 })).wait();
      } catch (e) { console.error(`Failed Collusion Metrics: ${e.message}`); }
    }
    
    // B. Ballot Stuffing (Praise each other)
    if (Math.random() < 0.3) {
      const target = state.groups.collusion[Math.floor(Math.random() * state.groups.collusion.length)];
      if (target !== node) {
        try {
            await (await contract.connect(getSigner()).addRecommendation(target, 200, 50, { gasLimit: 3000000 })).wait(); // High praise
        } catch(e) {}
      }
    }

    // C. Bad-mouthing (Bash Honest Nodes)
    if (Math.random() < 0.3) {
      const target = state.groups.honest[Math.floor(Math.random() * state.groups.honest.length)];
      try {
          await (await contract.connect(getSigner()).addRecommendation(target, 10, 50, { gasLimit: 3000000 })).wait(); // Low praise
      } catch(e) {}
    }
  }

  // 4. Process Whitewashing Nodes (Bad for 5 loops, then Reborn)
  // Manage list size 5
  console.log('Processing Whitewash Nodes...');
  
  // Ensure map exists
  if (!state.whitewash_active_map) state.whitewash_active_map = {};

  while (state.groups.whitewash.length < 5) {
    const w = ethers.Wallet.createRandom().address;
    let registered = false;
    
    // Retry logic for registration
    for (let attempt = 1; attempt <= 3; attempt++) {
        try { 
            // Small delay to be gentle on provider
            await new Promise(r => setTimeout(r, 500));
            
            const tx = await contract.connect(getSigner()).registerNode(w, { gasLimit: 3000000 });
            await tx.wait();
            
            console.log(`[Whitewash] New Node: ${w}`);
            state.groups.whitewash.push(w);
            state.whitewash_active_map[w] = currentLoop;
            registered = true;
            break; // Success, exit retry loop
        } catch(e) {
            console.warn(`[Whitewash] Attempt ${attempt} failed for ${w}: ${e.message}`);
            await new Promise(r => setTimeout(r, 1000)); // Wait before retry
        }
    }
    
    if (!registered) {
        console.error(`[Whitewash] Failed to register ${w} after 3 attempts. Skipping.`);
        // Break main loop to avoid infinite loop if network is down
        break;
    }
  }

  // Filter out old whitewashers
  const nextWhitewash = [];
  for (const node of state.groups.whitewash) {
    const start = state.whitewash_active_map[node];
    const age = currentLoop - start;
    
    if (age > 5) {
      console.log(`[Whitewash] Node ${node} exiting (Age: ${age})`);
      delete state.whitewash_active_map[node];
      // Do not add to nextWhitewash, effectively removing it
    } else {
      // Act badly
      if (Math.random() < 0.5) {
        console.log(`> Whitewash Node ${node.slice(0,6)}...`);
        try {
            await (await contract.connect(getSigner()).updateNodeMetrics(node, 0, 10000, 0, { gasLimit: 3000000 })).wait();
        } catch (e) { console.error(`Failed Whitewash: ${e.message}`); }
      }
      nextWhitewash.push(node);
    }
  }
  state.groups.whitewash = nextWhitewash;

  // Save State
  state.loop = currentLoop;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  // --- Record Data to CSV ---
  // We need to fetch trust values for all active nodes to plot the trend
  const historyFile = path.join(__dirname, '../out/trust_trend_overnight.csv');
  
  // Collect all active nodes
  const allActiveNodes = [
      ...state.groups.honest,
      ...state.groups.on_off,
      ...state.groups.collusion,
      ...state.groups.whitewash
  ];

  // Helper to map group name
  const getGroup = (addr) => {
      if (state.groups.honest.includes(addr)) return 'Honest';
      if (state.groups.on_off.includes(addr)) return 'On-Off';
      if (state.groups.collusion.includes(addr)) return 'Collusion';
      if (state.groups.whitewash.includes(addr)) return 'Whitewash';
      return 'Unknown';
  };

  // Convert to Beijing Time (Asia/Shanghai)
  const now = new Date();
  // Offset +8 hours for Beijing
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().replace('Z', '+08:00');
  
  let csvContent = '';
  console.log('📝 Collecting trust data for CSV...');

  for (const node of allActiveNodes) {
      try {
          const trust = await contract.getTrustValue(node);
          csvContent += `${beijingTime},${currentLoop},${node},${getGroup(node)},${trust.toString()}\n`;
      } catch (e) {
          console.error(`⚠️ Failed to fetch trust for ${node}: ${e.message}`);
      }
  }

  if (csvContent) {
      fs.appendFileSync(historyFile, csvContent);
      console.log(`📊 Recorded trust data for loop ${currentLoop}`);
  } else {
      console.warn('⚠️ No trust data collected this loop.');
  }
}

main().catch(console.error);
