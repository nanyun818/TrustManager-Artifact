const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configuration
const BATCH_SIZE = 5; // Process 5 nodes at a time (10 txs per batch)
const TARGET_NODES = 100; // Total nodes to simulate
const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    console.log(`🚀 Starting MASSIVE Scale Testnet Simulation`);
    console.log(`🎯 Target: ${TARGET_NODES} Nodes`);
    console.log(`📦 Batch Size: ${BATCH_SIZE} nodes per group`);
    
    // 1. Setup
    const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
    const privateKey = process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (!rpcUrl || !privateKey) throw new Error("Missing env vars");

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    // Load Contract
    const ROOT = process.cwd();
    const deployPath = path.join(ROOT, 'out', 'deploy_sepolia.json');
    if (!fs.existsSync(deployPath)) throw new Error("No deploy_sepolia.json");
    const deployInfo = JSON.parse(fs.readFileSync(deployPath, 'utf8'));
    const contractAddress = deployInfo.address;
    
    // Load ABI
    let buildInfoPath = path.join(ROOT, 'artifacts', 'contracts', 'TrustManager.sol', 'TrustManager.json');
    if (!fs.existsSync(buildInfoPath)) buildInfoPath = path.join(ROOT, 'artifacts', 'TrustManager.json');
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    const contract = new ethers.Contract(contractAddress, buildInfo.abi, wallet);

    console.log(`📡 Contract: ${contractAddress}`);
    console.log(`💰 Admin: ${wallet.address}`);

    // 2. Generate Identities
    const honestCount = Math.ceil(TARGET_NODES * 0.7); // 70% Honest
    const nodes = [];
    
    for (let i = 0; i < TARGET_NODES; i++) {
        nodes.push({
            address: ethers.Wallet.createRandom().address,
            type: i < honestCount ? 'Honest' : 'Malicious',
            id: i + 1
        });
    }
    console.log(`👥 Generated ${nodes.length} identities (${honestCount} Honest, ${nodes.length - honestCount} Malicious)`);

    // 3. Execution Loop (Batching)
    let successCount = 0;
    let failCount = 0;
    
    // Get initial nonce
    let currentNonce = await wallet.getTransactionCount('pending');
    console.log(`🔢 Starting Nonce: ${currentNonce}`);

    for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
        const batch = nodes.slice(i, i + BATCH_SIZE);
        console.log(`\n--- Processing Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(nodes.length/BATCH_SIZE)} ---`);
        
        const txPromises = [];
        
        // --- Step A: Register Batch ---
        // We construct transactions manually to manage nonces for parallel sending
        console.log(`   📝 Sending Registration Txs...`);
        
        try {
            // We need to be careful with nonce management in parallel.
            // Easiest reliable way: Send one by one but don't await wait().
            // Then await all waits().
            
            const registerTxs = [];
            for (const node of batch) {
                // Estimate gas to prevent underflow errors, add buffer
                const overrides = { 
                    nonce: currentNonce++,
                    gasLimit: 300000 
                };
                
                // Fire and forget (await the send, not the receipt)
                const tx = await contract.registerNode(node.address, overrides);
                registerTxs.push(tx);
                process.stdout.write('.'); // Progress indicator
            }
            console.log(`\n   ⏳ Waiting for ${registerTxs.length} Registrations...`);
            
            // Wait for all registrations to confirm
            await Promise.all(registerTxs.map(tx => tx.wait()));
            console.log(`   ✅ Registrations Confirmed.`);
            
            // --- Step B: Update Metrics Batch ---
            console.log(`   📊 Sending Metric Updates...`);
            const updateTxs = [];
            
            for (const node of batch) {
                const isHonest = node.type === 'Honest';
                const success = isHonest ? 100 : 30;
                const latency = isHonest ? 50 : 2000;
                const online = 3600;
                
                const overrides = { 
                    nonce: currentNonce++,
                    gasLimit: 300000 
                };
                
                const tx = await contract.updateNodeMetrics(node.address, success, latency, online, overrides);
                updateTxs.push(tx);
                process.stdout.write('.');
            }
            console.log(`\n   ⏳ Waiting for ${updateTxs.length} Updates...`);
            
            await Promise.all(updateTxs.map(tx => tx.wait()));
            console.log(`   ✅ Updates Confirmed.`);
            
            successCount += batch.length;

        } catch (e) {
            console.error(`\n   ❌ Batch Failed: ${e.message}`);
            // If a batch fails (e.g. nonce error), we might need to reset nonce
            // But for this simple script, we just log and continue (though nonce might be out of sync)
            // To recover, we re-fetch nonce for next batch
            currentNonce = await wallet.getTransactionCount('pending');
            failCount += batch.length;
        }
        
        // Rate limit buffer
        await wait(DELAY_BETWEEN_BATCHES);
    }
    
    console.log(`\n🏁 MASSIVE Simulation Complete.`);
    console.log(`✅ Successful Nodes: ${successCount}`);
    console.log(`❌ Failed Nodes: ${failCount}`);
}

main().catch(console.error);
