const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// --- Configuration ---
const TARGET_NODES = 50; // Scaled down for reliability on public RPC (can loop for 500)
const BATCH_SIZE = 5; 
const DELAY_BETWEEN_BATCHES = 3000;

// --- Model / Behavior Config ---
const HONEST_BEHAVIOR = { success: 100, latency: 50, online: 3600 };
const MALICIOUS_BEHAVIOR = { success: 30, latency: 2000, online: 3600 };

const OUT_DIR = path.join(process.cwd(), 'out');
const LOG_FILE = path.join(OUT_DIR, 'mega_simulation_results.json');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    console.log(`\n🚀 STARTING ROBUST SCALE SIMULATION (${TARGET_NODES} Nodes)`);
    
    // 1. Setup
    const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY, provider);
    
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

    // 2. Generate Identities
    const honestCount = Math.floor(TARGET_NODES * 0.7);
    const nodes = [];
    for (let i = 0; i < TARGET_NODES; i++) {
        nodes.push({
            wallet: ethers.Wallet.createRandom(),
            type: i < honestCount ? 'Honest' : 'Malicious',
            behavior: i < honestCount ? HONEST_BEHAVIOR : MALICIOUS_BEHAVIOR
        });
    }

    // 3. Execution
    let currentNonce = await wallet.getTransactionCount('pending');
    const results = [];

    for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
        const batch = nodes.slice(i, i + BATCH_SIZE);
        console.log(`\n--- Batch ${Math.floor(i/BATCH_SIZE)+1} ---`);

        // A. Register (Check first)
        for (const node of batch) {
            try {
                // Optimistic: Just try register. If fails, assume registered.
                // To save RPC calls, we skip check and handle error.
                const tx = await contract.registerNode(node.wallet.address, {
                    nonce: currentNonce++,
                    gasLimit: 250000
                });
                // Don't await wait() yet
                node.regTx = tx;
            } catch (e) {
                console.log(`   ⚠️ Register Skip/Fail: ${e.message.split('(')[0]}`);
                // If nonce was used (tx sent but failed later), fine. 
                // If send failed (nonce not used), we might have a gap. 
                // Safe approach: Refresh nonce if error.
                currentNonce = await wallet.getTransactionCount('pending');
            }
        }
        
        // Wait for registrations
        const regTxs = batch.filter(n => n.regTx).map(n => n.regTx);
        if (regTxs.length > 0) {
            console.log(`   ⏳ Waiting for ${regTxs.length} Registrations...`);
            await Promise.all(regTxs.map(tx => tx.wait().catch(e => console.log(`   ❌ Reg Revert: ${e.code}`))));
        }

        // B. Update Metrics
        for (const node of batch) {
            try {
                const { success, latency, online } = node.behavior;
                const tx = await contract.updateNodeMetrics(node.wallet.address, success, latency, online, {
                    nonce: currentNonce++,
                    gasLimit: 250000
                });
                node.upTx = tx;
            } catch (e) {
                console.log(`   ⚠️ Update Skip/Fail: ${e.message.split('(')[0]}`);
                currentNonce = await wallet.getTransactionCount('pending');
            }
        }

        // Wait for updates
        const upTxs = batch.filter(n => n.upTx).map(n => n.upTx);
        if (upTxs.length > 0) {
            console.log(`   ⏳ Waiting for ${upTxs.length} Updates...`);
            await Promise.all(upTxs.map(tx => tx.wait().catch(e => console.log(`   ❌ Up Revert: ${e.code}`))));
        }

        // C. Verify (Fast Response Check)
        for (const node of batch) {
            try {
                const trust = await contract.getTrustValue(node.wallet.address);
                results.push({
                    type: node.type,
                    trust: trust.toNumber()
                });
                process.stdout.write(node.type === 'Honest' ? 'H' : 'M');
            } catch (e) {
                process.stdout.write('?');
            }
        }
        console.log('');
        
        await wait(DELAY_BETWEEN_BATCHES);
    }

    // 4. Analysis
    const honest = results.filter(r => r.type === 'Honest').map(r => r.trust);
    const malicious = results.filter(r => r.type === 'Malicious').map(r => r.trust);
    
    const avgH = honest.reduce((a,b)=>a+b,0)/honest.length || 0;
    const avgM = malicious.reduce((a,b)=>a+b,0)/malicious.length || 0;

    console.log(`\n📊 RESULTS:`);
    console.log(`   Honest Avg Trust:    ${avgH.toFixed(1)}`);
    console.log(`   Malicious Avg Trust: ${avgM.toFixed(1)}`);
    
    if (avgH > avgM + 10) {
        console.log(`   ✅ SUCCESS: System differentiated behaviors.`);
    } else {
        console.log(`   ⚠️ CHECK: Distinction unclear.`);
    }
}

main().catch(console.error);
