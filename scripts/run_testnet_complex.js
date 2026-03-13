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
    console.log("🚀 Starting Complex Attack Simulation (12 Nodes Total)");
    
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

    // --- Define Groups ---
    // Group A: Honest (4)
    const honestNodes = Array(4).fill(0).map(() => ethers.Wallet.createRandom().address);
    // Group B: Oscillating (2) - Good -> Bad -> Good
    const oscillatingNodes = Array(2).fill(0).map(() => ethers.Wallet.createRandom().address);
    // Group C: Stealth (2) - Marginal behavior
    const stealthNodes = Array(2).fill(0).map(() => ethers.Wallet.createRandom().address);
    // Group D: Sybil (2 initial + 2 replacements)
    const sybilOldNodes = Array(2).fill(0).map(() => ethers.Wallet.createRandom().address);
    const sybilNewNodes = Array(2).fill(0).map(() => ethers.Wallet.createRandom().address);

    const initialNodes = [...honestNodes, ...oscillatingNodes, ...stealthNodes, ...sybilOldNodes];
    
    console.log(`\n📋 Complex Scenario Plan:`);
    console.log(`   A. Honest: ${honestNodes.length} nodes`);
    console.log(`   B. Oscillating: ${oscillatingNodes.length} nodes`);
    console.log(`   C. Stealth: ${stealthNodes.length} nodes`);
    console.log(`   D. Sybil: ${sybilOldNodes.length} nodes (will swap later)`);

    // --- Helper for Batch Transactions ---
    // We send transactions sequentially to ensure nonce correctness and reliability
    async function updateBatch(nodes, success, latency, label) {
        for (const node of nodes) {
            try {
                // Check if node is blacklisted first to avoid revert?
                // The updateNodeMetrics modifier 'onlyActiveNode' reverts if blacklisted.
                // We should check blacklist status first to avoid wasting gas on reverts.
                const nodeData = await contract.nodes(node);
                if (nodeData.isBlacklisted) {
                    console.log(`   ⏭️ Skipping ${node.slice(0,6)}... (Blacklisted)`);
                    continue;
                }

                console.log(`   📝 Updating ${node.slice(0,6)}... [${label}]`);
                // uptime is always 3600 for simplicity
                const tx = await contract.updateNodeMetrics(node, success, latency, 3600, { gasLimit: 300000 });
                await tx.wait();
                process.stdout.write("."); // Progress indicator
            } catch (e) {
                console.log(`\n   ❌ Error updating ${node.slice(0,6)}: ${e.message.split('(')[0]}`);
            }
        }
        console.log(""); // Newline
    }

    // --- Phase 1: Registration (Initial Batch) ---
    console.log(`\n--- Phase 1: Registration (${initialNodes.length} nodes) ---`);
    for (const node of initialNodes) {
        try {
            console.log(`Registering ${node}...`);
            const tx = await contract.registerNode(node, { gasLimit: 300000 });
            await tx.wait();
        } catch (e) {
            console.log(`   Already registered or failed: ${e.message.split('(')[0]}`);
        }
    }

    // --- Phase 2: Round 1 - Trust Building (All Good) ---
    console.log(`\n--- Phase 2: Round 1 (Bootstrap Trust) ---`);
    await updateBatch(initialNodes, 100, 50, "Perfect");

    // --- Phase 3: Round 2 - Attacks Begin ---
    console.log(`\n--- Phase 3: Round 2 (Attacks Launch) ---`);
    // Honest: Good
    await updateBatch(honestNodes, 100, 50, "Honest");
    // Oscillating: Bad
    await updateBatch(oscillatingNodes, 20, 2000, "Oscillating-Bad");
    // Stealth: Marginal (90% success, 400ms) - trying to stay just above penalty
    await updateBatch(stealthNodes, 90, 400, "Stealth-Marginal");
    // Sybil: Terrible (0% success) -> Will likely get blacklisted
    await updateBatch(sybilOldNodes, 0, 5000, "Sybil-Fail");

    // --- Phase 4: Round 3 - Evasion & Persistence ---
    console.log(`\n--- Phase 4: Round 3 (Evasion & Whitewashing) ---`);
    // Honest: Good
    await updateBatch(honestNodes, 100, 50, "Honest");
    // Oscillating: Good (Trying to recover)
    await updateBatch(oscillatingNodes, 100, 50, "Oscillating-Recover");
    // Stealth: Slightly worse (85% success)
    await updateBatch(stealthNodes, 85, 450, "Stealth-Worse");
    
    // Sybil: Abandon Old, Register New
    console.log(`   🔄 Sybil Attack: Switching Identities...`);
    for (const node of sybilNewNodes) {
        console.log(`   Registering New Sybil ${node.slice(0,6)}...`);
        const tx = await contract.registerNode(node, { gasLimit: 300000 });
        await tx.wait();
    }
    // New Sybils behave Good immediately to trick system
    await updateBatch(sybilNewNodes, 100, 50, "Sybil-New-FakeGood");

    // --- Phase 5: Final Status Check ---
    console.log(`\n--- Phase 5: Final Status Report ---`);
    const allInvolved = [...honestNodes, ...oscillatingNodes, ...stealthNodes, ...sybilOldNodes, ...sybilNewNodes];
    
    console.log(`Type\t\tAddress\t\tTrust\tBlacklisted?`);
    console.log(`--------------------------------------------------------`);
    
    for (const node of allInvolved) {
        const d = await contract.nodes(node);
        let type = "Unknown";
        if (honestNodes.includes(node)) type = "Honest";
        if (oscillatingNodes.includes(node)) type = "Oscillat";
        if (stealthNodes.includes(node)) type = "Stealth";
        if (sybilOldNodes.includes(node)) type = "Sybil-Old";
        if (sybilNewNodes.includes(node)) type = "Sybil-New";

        console.log(`${type}\t${node.slice(0,8)}...\t${d.trustValue}\t${d.isBlacklisted ? '⛔ YES' : '✅ NO'}`);
    }

    console.log("\n✅ Complex Simulation Complete.");
}

main().catch(console.error);
