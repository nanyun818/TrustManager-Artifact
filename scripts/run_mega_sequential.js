const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// --- Configuration ---
const TARGET_NODES = 500; // Goal
const BATCH_SIZE = 1; 
const DELAY_MS = 2000;

// --- Model / Behavior Config ---
const HONEST_BEHAVIOR = { success: 100, latency: 50, online: 3600 };
const MALICIOUS_BEHAVIOR = { success: 30, latency: 2000, online: 3600 };

const OUT_DIR = path.join(process.cwd(), 'out');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    console.log(`\n🚀 STARTING SEQUENTIAL SCALE SIMULATION`);
    
    // 1. Setup
    const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY, provider);
    
    // Check Funds
    const balance = await wallet.getBalance();
    const gasPrice = await provider.getGasPrice();
    const estCostPerNode = gasPrice.mul(200000); // ~200k gas per node
    const maxNodes = balance.div(estCostPerNode).toNumber();
    
    console.log(`💰 Balance: ${ethers.utils.formatEther(balance)} ETH`);
    console.log(`⛽ Gas Price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`);
    console.log(`🔢 Max Affordable Nodes: ~${maxNodes}`);
    
    let runCount = Math.min(TARGET_NODES, maxNodes);
    if (runCount < 5) runCount = 5; // Try at least 5 even if tight
    
    console.log(`🎯 Running for ${runCount} Nodes (limited by funds/time)...`);
    
    const deployPath = path.join(process.cwd(), 'out', 'deploy_sepolia.json');
    const contractAddr = JSON.parse(fs.readFileSync(deployPath)).address;
    
    const abi = [
        'function registerNode(address _node) public',
        'function updateNodeMetrics(address _node, uint _successRate, uint _responseTime, uint _onlineTime) public',
        'function getTrustValue(address _node) public view returns (uint)',
        'function getNodeInfo(address _node) public view returns (uint trustValue, uint successRate, uint responseTime, uint onlineTime, uint interactionCount, bool isActive, bool isBlacklisted)'
    ];
    const contract = new ethers.Contract(contractAddr, abi, wallet);
    
    console.log(`📡 Contract: ${contractAddr}`);

    // 2. Execution Loop
    const results = [];
    const honestCount = Math.floor(runCount * 0.7);
    
    console.log(`\n--- Execution Started ---`);

    for (let i = 0; i < runCount; i++) {
        const isHonest = i < honestCount;
        const type = isHonest ? 'Honest' : 'Malicious';
        const behavior = isHonest ? HONEST_BEHAVIOR : MALICIOUS_BEHAVIOR;
        
        // Generate a new identity
        const nodeWallet = ethers.Wallet.createRandom();
        const address = nodeWallet.address;
        
        process.stdout.write(`[${i+1}/${runCount}] ${type} Node (${address.slice(0,6)})... `);
        
        try {
            // A. Register
            const txReg = await contract.registerNode(address);
            await txReg.wait();
            process.stdout.write(`Reg✅ `);
            
            // B. Update Metrics
            const txUp = await contract.updateNodeMetrics(address, behavior.success, behavior.latency, behavior.online);
            await txUp.wait();
            process.stdout.write(`Upd✅ `);
            
            // C. Verify
            const trustBN = await contract.getTrustValue(address);
            const trust = trustBN.toNumber();
            
            results.push({ type, trust });
            process.stdout.write(`Trust: ${trust}\n`);
            
        } catch (e) {
            console.log(`❌ Failed: ${e.message.split('(')[0]}`);
            if (e.code) console.log(`   Code: ${e.code}`);
        }
        
        await wait(DELAY_MS);
    }

    // 3. Analysis
    const honest = results.filter(r => r.type === 'Honest').map(r => r.trust);
    const malicious = results.filter(r => r.type === 'Malicious').map(r => r.trust);
    
    const avgH = honest.reduce((a,b)=>a+b,0)/honest.length || 0;
    const avgM = malicious.reduce((a,b)=>a+b,0)/malicious.length || 0;

    console.log(`\n📊 FINAL ANALYSIS:`);
    console.log(`   Honest Avg Trust:    ${avgH.toFixed(1)}`);
    console.log(`   Malicious Avg Trust: ${avgM.toFixed(1)}`);
    
    if (avgH > avgM + 10) {
        console.log(`   ✅ SUCCESS: Robot & Contract correctly penalized malicious nodes.`);
    } else {
        console.log(`   ⚠️ WARNING: Differentiation failed.`);
    }
}

main().catch(console.error);
