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

const STATE_FILE = path.join(__dirname, 'simulation_state.json');

// Utils
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    console.log("🎬 Starting Testnet Scenario: The Redemption Arc");
    
    const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
    const privateKey = process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (!rpcUrl || !privateKey) throw new Error("Missing env vars (SEPOLIA_RPC_URL/SEPOLIA_PRIVATE_KEY)");

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    // Load contract
    let contractAddress;
    const sepoliaInfoPath = path.join(ROOT, 'out', 'deploy_sepolia.json');
    const localInfoPath = path.join(ROOT, 'contract_address.txt');

    if (fs.existsSync(sepoliaInfoPath)) {
        const info = JSON.parse(fs.readFileSync(sepoliaInfoPath, 'utf8'));
        contractAddress = info.address;
        console.log(`Using Sepolia deployment at: ${contractAddress}`);
    } else if (fs.existsSync(localInfoPath)) {
        contractAddress = fs.readFileSync(localInfoPath, 'utf8').trim();
        console.log(`Using Local deployment at: ${contractAddress}`);
    } else {
        throw new Error("No deployment found (checked out/deploy_sepolia.json and contract_address.txt)");
    }
    
    let buildInfoPath = path.join(ROOT, 'artifacts', 'contracts', 'TrustManager.sol', 'TrustManager.json');
    if (!fs.existsSync(buildInfoPath)) {
        buildInfoPath = path.join(ROOT, 'artifacts', 'TrustManager.json');
    }
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    const contract = new ethers.Contract(contractAddress, buildInfo.abi, wallet);

    // Load Nodes
    if (!fs.existsSync(STATE_FILE)) throw new Error("No state file");
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    
    // Pick actors
    const honestNode = state.groups.honest[0];
    const maliciousNode = state.groups.whitewash[0]; // Let's use the whitewash node as the bad actor

    console.log(`\n🎭 Cast of Characters:`);
    console.log(`😇 Honest Node: ${honestNode}`);
    console.log(`😈 Bad Actor:  ${maliciousNode}`);
    console.log(`👮 Admin:      ${wallet.address}`);

    // --- PRELUDE: Registration ---
    console.log(`\n--- PRELUDE: Registration ---`);
    for (const node of [honestNode, maliciousNode]) {
        try {
            const info = await contract.nodes(node);
            if (!info.isActive) {
                console.log(`Registering ${node}...`);
                const tx = await contract.registerNode(node);
                await tx.wait();
                console.log(`✅ Registered ${node}`);
            } else {
                console.log(`ℹ️  ${node} already registered.`);
            }
        } catch (e) {
            console.error(`Failed to register ${node}: ${e.message}`);
        }
    }

    // --- SCENE 1: Normal Operations ---
    console.log(`\n--- SCENE 1: Business as Usual ---`);
    console.log(`Generating healthy traffic for Honest Node...`);
    
    try {
        // Honest node performs well
        const tx1 = await contract.updateNodeMetrics(honestNode, 100, 50, 3600);
        console.log(`Honest update sent: ${tx1.hash}`);
        await tx1.wait();
        console.log(`✅ Honest node metrics updated.`);
        
        const info = await contract.nodes(honestNode);
        console.log(`😇 Honest Trust: ${info.trustValue}`);
    } catch (e) { console.error("Scene 1 failed:", e.message); }

    // --- SCENE 2: The Betrayal ---
    console.log(`\n--- SCENE 2: The Betrayal ---`);
    console.log(`Bad Actor starts misbehaving (Service failing, High latency)...`);

    try {
        // Bad actor fails hard
        const tx2 = await contract.updateNodeMetrics(maliciousNode, 0, 5000, 100);
        console.log(`Malicious update sent: ${tx2.hash}`);
        await tx2.wait();
        console.log(`⚠️ Bad metrics recorded.`);

        let info = await contract.nodes(maliciousNode);
        console.log(`😈 Bad Actor Trust: ${info.trustValue}`);
        console.log(`🚫 Blacklisted? ${info.isBlacklisted}`);
        
        if (!info.isBlacklisted) {
            console.log("... Not blacklisted yet? Hitting them again!");
             const tx3 = await contract.updateNodeMetrics(maliciousNode, 0, 8000, 0);
             await tx3.wait();
             info = await contract.nodes(maliciousNode);
             console.log(`😈 Bad Actor Trust: ${info.trustValue}`);
             console.log(`🚫 Blacklisted? ${info.isBlacklisted}`);
        }
    } catch (e) { console.error("Scene 2 failed:", e.message); }

    // --- SCENE 3: The Redemption ---
    console.log(`\n--- SCENE 3: The Redemption ---`);
    console.log(`Admin notices the issue, talks to the node operator. Operator fixes the server.`);
    console.log(`Admin manually removing from blacklist...`);

    try {
        const tx4 = await contract.removeFromBlacklist(maliciousNode, { gasLimit: 200000 });
        console.log(`Unban tx sent: ${tx4.hash}`);
        await tx4.wait();
        console.log(`✨ Node removed from blacklist.`);

        // Check status
        const info = await contract.nodes(maliciousNode);
        console.log(`😈 Bad Actor Status:`);
        console.log(`   Trust: ${info.trustValue}`);
        console.log(`   Active: ${info.isActive}`);
        console.log(`   Blacklisted: ${info.isBlacklisted}`);

        if (!info.isBlacklisted && info.trustValue >= 100) {
             console.log(`🎉 Redemption successful! Node is back to default trust.`);
        }
    } catch (e) { console.error("Scene 3 failed:", e.message); }

    // --- SCENE 4: AI Defense Intervention ---
    console.log(`\n--- SCENE 4: AI Defense Intervention ---`);
    console.log(`Simulating AI Agent detecting a stealth attack...`);
    // We'll use the honest node as the target for this test (to spare the malicious one or vice versa)
    // Actually, let's use the malicious node again (assuming it was unbanned, or even if not, fastRespond might work?)
    // If Scene 3 failed, maliciousNode is still blacklisted.
    // fastRespond checks nothing? It updates risk.
    // Let's use the honest node to show how AI can penalize a "good" node that turns bad suddenly.
    
    try {
        console.log(`AI Agent flags Honest Node for 'Sybil Behavior'...`);
        // fastRespond(node, risk=100, penalty=5000 (50%), until=now+1year)
        const until = Math.floor(Date.now()/1000) + 31536000;
        const tx5 = await contract.fastRespond(honestNode, 100, 5000, until, { gasLimit: 200000 });
        console.log(`AI Defense tx sent: ${tx5.hash}`);
        await tx5.wait();
        console.log(`🤖 AI Defense executed.`);

        const info = await contract.nodes(honestNode);
        console.log(`😇 Honest Node Post-Defense:`);
        console.log(`   Trust: ${info.trustValue}`);
        console.log(`   Blacklisted: ${info.isBlacklisted}`);
        console.log(`   Risk Exposure: 100`);
    } catch (e) { console.error("Scene 4 failed:", e.message); }


    console.log(`\n🎬 End of Scenario.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
