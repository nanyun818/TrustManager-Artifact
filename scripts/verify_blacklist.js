const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Helper to handle .env if needed (same as deploy.js)
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

async function main() {
    const rpcUrl = process.env.RPC_URL;
    const privateKey = process.env.PRIVATE_KEY;
    
    if (!rpcUrl || !privateKey) {
        throw new Error("Missing RPC_URL or PRIVATE_KEY");
    }

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    // Load contract address
    const contractAddress = fs.readFileSync(path.join(ROOT, 'contract_address.txt'), 'utf8').trim();
    console.log(`Using Contract: ${contractAddress}`);
    console.log(`Using Wallet: ${wallet.address}`);

    // Load ABI
    // Try standard Hardhat path first, then flat path
    let buildInfoPath = path.join(ROOT, 'artifacts', 'contracts', 'TrustManager.sol', 'TrustManager.json');
    if (!fs.existsSync(buildInfoPath)) {
        buildInfoPath = path.join(ROOT, 'artifacts', 'TrustManager.json');
    }
    console.log(`Loading ABI from: ${buildInfoPath}`);
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    const contract = new ethers.Contract(contractAddress, buildInfo.abi, wallet);

    // 1. Generate Victim
    const victim = ethers.Wallet.createRandom();
    console.log(`\n🎯 Victim Node: ${victim.address}`);

    // 2. Register Victim
    console.log("Registering Victim...");
    try {
        const tx1 = await contract.registerNode(victim.address, { gasLimit: 500000 });
        console.log(`Tx sent: ${tx1.hash}`);
        await tx1.wait();
        console.log("✅ Registered.");
    } catch (e) {
        console.error("Registration failed:", e.message);
        return;
    }

    // 3. Check Initial Status
    let info = await contract.nodes(victim.address);
    console.log(`Initial Status: Active=${info.isActive}, Blacklisted=${info.isBlacklisted}, Trust=${info.trustValue}`);

    // 4. Update Metrics to Trigger Blacklist
    // Success=0, Response=10000 (very bad), Online=0
    console.log("\n📉 Sending BAD metrics (Attack simulation)...");
    try {
        const tx2 = await contract.updateNodeMetrics(
            victim.address, 
            0,    // successRate
            10000,// responseTime (ms) -> will result in low score
            0,    // onlineTime
            { gasLimit: 500000 }
        );
        console.log(`Tx sent: ${tx2.hash}`);
        await tx2.wait();
        console.log("✅ Metrics updated.");
    } catch (e) {
        console.error("Update failed:", e.message);
        return;
    }

    // 5. Verify Blacklist
    info = await contract.nodes(victim.address);
    console.log(`\n🔍 Final Status: Active=${info.isActive}, Blacklisted=${info.isBlacklisted}, Trust=${info.trustValue}`);

    if (info.isBlacklisted) {
        console.log("🎉 SUCCESS: Auto-blacklist verified!");
    } else {
        console.log("❌ FAILURE: Node not blacklisted. Trust value is " + info.trustValue);
        console.log("Threshold is likely 80.");
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
