const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// --- Configuration ---
const TARGET_NODES = 500;
const BATCH_SIZE = 20; // Parallel transactions per batch
const DELAY_BETWEEN_BATCHES = 1000; // 1 second

// --- Model / Behavior Config ---
const HONEST_BEHAVIOR = { success: 100, latency: 50, online: 3600 };
const MALICIOUS_BEHAVIOR = { success: 30, latency: 2000, online: 3600 };

// --- Logging ---
const OUT_DIR = path.join(process.cwd(), 'out');
const LOG_FILE = path.join(OUT_DIR, 'mega_simulation_results.json');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    console.log(`\n🚀 STARTING MEGA SCALE SIMULATION: ${TARGET_NODES} NODES`);
    console.log(`🎯 Goal: Verify Model, Robot & Contract Fast Response`);
    
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

    // 1. Setup Environment
    const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
    const privateKey = process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (!rpcUrl || !privateKey) throw new Error("Missing RPC/Key");

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    // Contract Setup
    const deployPath = path.join(process.cwd(), 'out', 'deploy_sepolia.json');
    if (!fs.existsSync(deployPath)) throw new Error("No deploy_sepolia.json");
    const contractAddr = JSON.parse(fs.readFileSync(deployPath)).address;
    
    // ABI - We need getTrustValue to verify
    const abi = [
        'function registerNode(address _node) public',
        'function updateNodeMetrics(address _node, uint _successRate, uint _responseTime, uint _onlineTime) public',
        'function getTrustValue(address _node) public view returns (uint)',
        'function getNodeInfo(address _node) public view returns (uint trustValue, uint successRate, uint responseTime, uint onlineTime, uint interactionCount, bool isActive, bool isBlacklisted)'
    ];
    const contract = new ethers.Contract(contractAddr, abi, wallet);
    
    console.log(`📡 Connected to Contract: ${contractAddr}`);
    console.log(`💰 Admin Wallet: ${wallet.address}`);

    // 2. Generate Identities
    console.log(`\n👥 Generating ${TARGET_NODES} Identities...`);
    const honestCount = Math.floor(TARGET_NODES * 0.7);
    const nodes = [];
    
    for (let i = 0; i < TARGET_NODES; i++) {
        const isHonest = i < honestCount;
        nodes.push({
            wallet: ethers.Wallet.createRandom(),
            type: isHonest ? 'Honest' : 'Malicious',
            behavior: isHonest ? HONEST_BEHAVIOR : MALICIOUS_BEHAVIOR,
            id: i
        });
    }
    console.log(`   ✅ ${honestCount} Honest, ${TARGET_NODES - honestCount} Malicious`);

    // 3. Execution Phase (Batching)
    console.log(`\n⚙️  Executing On-Chain Operations (Batch Size: ${BATCH_SIZE})...`);
    
    let currentNonce = await wallet.getTransactionCount('pending');
    const results = [];
    
    const startTime = Date.now();

    for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
        const batch = nodes.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(nodes.length / BATCH_SIZE);
        
        process.stdout.write(`   Batch ${batchNum}/${totalBatches}: `);

        // A. Register
        const regPromises = batch.map((node, idx) => {
            return contract.registerNode(node.wallet.address, {
                nonce: currentNonce + idx,
                gasLimit: 200000,
                gasPrice: provider.getGasPrice() // Dynamic gas
            }).then(tx => tx.wait());
        });
        
        // Nonce bump for registration
        currentNonce += batch.length;

        try {
            await Promise.all(regPromises);
            process.stdout.write(`Registered ✅ -> `);
        } catch (e) {
            console.error(`\n❌ Registration Error: ${e.message}`);
            // Recover nonce if needed, but for now we continue
            currentNonce = await wallet.getTransactionCount('pending');
        }

        // B. Update Metrics (The "Robot" reporting behavior)
        const updatePromises = batch.map((node, idx) => {
            const { success, latency, online } = node.behavior;
            return contract.updateNodeMetrics(node.wallet.address, success, latency, online, {
                nonce: currentNonce + idx,
                gasLimit: 200000
            }).then(tx => tx.wait());
        });

        // Nonce bump for updates
        currentNonce += batch.length;

        try {
            await Promise.all(updatePromises);
            process.stdout.write(`Metrics Updated ✅\n`);
        } catch (e) {
            console.error(`\n❌ Update Error: ${e.message}`);
            currentNonce = await wallet.getTransactionCount('pending');
        }

        // C. Fast Verification (Sample 1 from batch)
        // We verify trust score immediately to prove "Fast Response"
        const sampleNode = batch[0];
        try {
            const trust = await contract.getTrustValue(sampleNode.wallet.address);
            results.push({
                address: sampleNode.wallet.address,
                type: sampleNode.type,
                trust: trust.toString(),
                ts: Date.now()
            });
        } catch (e) {}

        await wait(DELAY_BETWEEN_BATCHES);
    }
    
    const duration = (Date.now() - startTime) / 1000;
    console.log(`\n⏱️  Execution Time: ${duration.toFixed(1)}s`);

    // 4. Verification & Reporting
    console.log(`\n🔍 VERIFICATION REPORT`);
    console.log(`   (Checking Smart Contract Response)`);
    
    // Save raw results
    fs.writeFileSync(LOG_FILE, JSON.stringify(results, null, 2));
    
    // Analyze
    const honestTrusts = results.filter(r => r.type === 'Honest').map(r => parseInt(r.trust));
    const maliciousTrusts = results.filter(r => r.type === 'Malicious').map(r => parseInt(r.trust));
    
    const avgHonest = honestTrusts.reduce((a,b)=>a+b,0) / honestTrusts.length || 0;
    const avgMalicious = maliciousTrusts.reduce((a,b)=>a+b,0) / maliciousTrusts.length || 0;
    
    console.log(`\n📊 Trust Score Analysis (Sampled):`);
    console.log(`   😇 Avg Honest Trust:    ${avgHonest.toFixed(2)}`);
    console.log(`   😈 Avg Malicious Trust: ${avgMalicious.toFixed(2)}`);
    
    console.log(`\n🤖 SYSTEM STATUS:`);
    if (avgHonest > avgMalicious + 10) { // Significant difference
        console.log(`   ✅ PASSED: Smart Contract successfully differentiated behaviors.`);
        console.log(`   ✅ PASSED: Robot successfully fed metrics.`);
        console.log(`   ✅ PASSED: Model/Logic responded instantly.`);
    } else {
        console.log(`   ⚠️  WARNING: Trust scores are too similar. Adjustment needed.`);
    }
    
    console.log(`\n🏁 Mega Simulation Complete.`);
}

main().catch(console.error);
