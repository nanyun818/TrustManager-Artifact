const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Helper to handle .env
const ROOT = process.cwd();
try {
  const envPath = path.resolve(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const dotenv = require('dotenv');
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    for (const k in envConfig) {
      if (!process.env[k] || process.env[k] === '') {
        process.env[k] = envConfig[k];
      }
    }
  }
} catch (e) {
  console.warn("Manual .env load failed:", e);
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    console.log("🚀 Starting On-Chain Batch Simulation (5 Nodes)");
    
    const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
    const privateKey = process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (!rpcUrl || !privateKey) throw new Error("Missing env vars");

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const adminWallet = new ethers.Wallet(privateKey, provider);
    
    // Load contract
    let contractAddress;
    const sepoliaInfoPath = path.join(ROOT, 'out', 'deploy_sepolia.json');
    if (fs.existsSync(sepoliaInfoPath)) {
        const info = JSON.parse(fs.readFileSync(sepoliaInfoPath, 'utf8'));
        contractAddress = info.address;
    } else {
        throw new Error("No deployment found in out/deploy_sepolia.json");
    }

    // Load ABI
    let buildInfoPath = path.join(ROOT, 'artifacts', 'contracts', 'TrustManager.sol', 'TrustManager.json');
    if (!fs.existsSync(buildInfoPath)) {
        buildInfoPath = path.join(ROOT, 'artifacts', 'TrustManager.json');
    }
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    const contract = new ethers.Contract(contractAddress, buildInfo.abi, adminWallet);

    console.log(`📡 Connected to: ${contractAddress}`);
    console.log(`💰 Admin Balance: ${ethers.utils.formatEther(await adminWallet.getBalance())} ETH`);

    // Generate 5 random nodes
    const honestNodes = Array(3).fill(0).map(() => ethers.Wallet.createRandom().address);
    const maliciousNodes = Array(2).fill(0).map(() => ethers.Wallet.createRandom().address);
    const allNodes = [...honestNodes, ...maliciousNodes];

    console.log(`\n📋 Batch Plan:`);
    console.log(`   3 Honest Nodes: ${honestNodes.map(n => n.slice(0,6)).join(', ')}...`);
    console.log(`   2 Malicious Nodes: ${maliciousNodes.map(n => n.slice(0,6)).join(', ')}...`);
    console.log(`   Total Est. Transactions: ${allNodes.length * 3}`);

    // Phase 1: Registration
    console.log(`\n--- Phase 1: Batch Registration ---`);
    for (const node of allNodes) {
        try {
            console.log(`Registering ${node}...`);
            const tx = await contract.registerNode(node, { gasLimit: 500000 }); // Increased Gas
            console.log(`   Tx: ${tx.hash}`);
            await tx.wait();
            await wait(2000); // Slow down for nonce safety
        } catch (e) {
            console.error(`   Failed: ${e.message}`);
        }
    }

    // Phase 2: Initial Trust Building (All behave well)
    console.log(`\n--- Phase 2: Trust Building (Round 1) ---`);
    for (const node of allNodes) {
        try {
            console.log(`Updating metrics for ${node} (Good Behavior)...`);
            // Success: 100, Response: 50ms, Online: 3600s
            const tx = await contract.updateNodeMetrics(node, 100, 50, 3600, { gasLimit: 500000 });
            await tx.wait();
            const trust = await contract.getTrustValue(node);
            console.log(`   ✅ Trust: ${trust}`);
            await wait(2000);
        } catch (e) {
            console.error(`   Failed: ${e.message}`);
        }
    }

    // Phase 3: The Attack (Malicious nodes fail)
    console.log(`\n--- Phase 3: Attack Scenario (Round 2) ---`);
    
    // Honest nodes continue being good
    for (const node of honestNodes) {
        try {
            console.log(`Honest Node ${node.slice(0,6)}... continuing service.`);
            const tx = await contract.updateNodeMetrics(node, 100, 45, 3600, { gasLimit: 500000 });
            await tx.wait();
            await wait(2000);
        } catch(e) { console.error(e.message); }
    }

    // Malicious nodes fail
    for (const node of maliciousNodes) {
        try {
            console.log(`😈 Malicious Node ${node.slice(0,6)}... FAILING!`);
            // Success: 10, Response: 5000ms
            const tx = await contract.updateNodeMetrics(node, 10, 5000, 100, { gasLimit: 500000 });
            await tx.wait();
            
            const info = await contract.nodes(node);
            console.log(`   📉 Trust dropped to: ${info.trustValue}`);
            if (info.isBlacklisted) {
                console.log(`   🚫 AUTO-BLACKLIST TRIGGERED!`);
            }
            await wait(2000);
        } catch(e) { console.error(e.message); }
    }

    console.log(`\n✅ Batch Simulation Complete.`);
    console.log(`Check Etherscan for the burst of activity!`);
}

main().catch(console.error);
