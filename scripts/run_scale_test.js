const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    console.log("🚀 Starting Scaled-Up Testnet Simulation");
    
    // 1. Setup Provider & Wallet
    const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
    const privateKey = process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY;
    
    if (!rpcUrl || !privateKey) {
        throw new Error("Missing SEPOLIA_RPC_URL or PRIVATE_KEY in .env");
    }

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    // 2. Check Balance & Gas
    const balance = await wallet.getBalance();
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice;
    
    console.log(`\n💰 Wallet Balance: ${ethers.utils.formatEther(balance)} ETH`);
    console.log(`⛽ Current Gas Price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`);
    
    // Estimate Cost per Node (Register + 1 Update)
    // Register: ~100k, Update: ~80k. Buffer: 250k
    const GAS_PER_NODE = ethers.BigNumber.from(250000);
    const COST_PER_NODE = gasPrice.mul(GAS_PER_NODE);
    
    console.log(`📉 Est. Cost per Node: ${ethers.utils.formatEther(COST_PER_NODE)} ETH`);
    
    // Calculate Max Nodes
    // Leave 0.005 ETH for buffer
    const buffer = ethers.utils.parseEther("0.005");
    let available = balance.sub(buffer);
    if (available.lt(0)) available = ethers.BigNumber.from(0);
    
    let maxNodes = available.div(COST_PER_NODE).toNumber();
    console.log(`🔢 Max Feasible Nodes (with safety buffer): ${maxNodes}`);
    
    // Target Scale
    let targetNodes = 10;
    if (maxNodes < targetNodes) {
        console.warn(`⚠️  Warning: Funds may only support ~${maxNodes} nodes. Adjusting target...`);
        if (maxNodes < 1) {
            console.error("❌ Insufficient funds for even 1 node. Please top up.");
            // process.exit(1); // Let's try anyway just in case estimates are high
            targetNodes = 1;
        } else {
            targetNodes = maxNodes;
        }
    }
    
    console.log(`🎯 Target Scale: ${targetNodes} Nodes`);
    
    // 3. Load Contract
    const ROOT = process.cwd();
    const sepoliaInfoPath = path.join(ROOT, 'out', 'deploy_sepolia.json');
    if (!fs.existsSync(sepoliaInfoPath)) throw new Error("No deploy_sepolia.json found");
    const info = JSON.parse(fs.readFileSync(sepoliaInfoPath, 'utf8'));
    const contractAddress = info.address;
    
    let buildInfoPath = path.join(ROOT, 'artifacts', 'contracts', 'TrustManager.sol', 'TrustManager.json');
    if (!fs.existsSync(buildInfoPath)) buildInfoPath = path.join(ROOT, 'artifacts', 'TrustManager.json');
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    
    const contract = new ethers.Contract(contractAddress, buildInfo.abi, wallet);
    console.log(`Contract: ${contractAddress}`);

    // 4. Generate Identity Batch
    const honestCount = Math.ceil(targetNodes * 0.6);
    const maliciousCount = targetNodes - honestCount;
    
    const honestNodes = Array(honestCount).fill(0).map(() => ethers.Wallet.createRandom().address);
    const maliciousNodes = Array(maliciousCount).fill(0).map(() => ethers.Wallet.createRandom().address);
    const allNodes = [...honestNodes, ...maliciousNodes];
    
    console.log(`\n👥 Generated Identities:`);
    console.log(`   Honest: ${honestCount}, Malicious: ${maliciousCount}`);
    
    // 5. Execution Loop
    console.log(`\n--- Execution Started ---`);
    
    for (let i = 0; i < allNodes.length; i++) {
        const node = allNodes[i];
        const isHonest = i < honestCount;
        const type = isHonest ? "Honest" : "Malicious";
        
        console.log(`[${i+1}/${allNodes.length}] Processing ${type} Node: ${node.slice(0,6)}...`);
        
        try {
            // Register
            const txReg = await contract.registerNode(node);
            console.log(`   📝 Registering... (Hash: ${txReg.hash.slice(0,10)}...)`);
            await txReg.wait();
            
            // Interaction
            // Honest: High Success, Low Latency
            // Malicious: Low Success (or Attack Pattern)
            let success = isHonest ? 100 : 40; 
            let latency = isHonest ? 50 : 2000;
            let online = 3600;
            
            const txUp = await contract.updateNodeMetrics(node, success, latency, online);
            console.log(`   📊 Updating Metrics... (Hash: ${txUp.hash.slice(0,10)}...)`);
            await txUp.wait();
            
            console.log(`   ✅ Done.`);
            
        } catch (e) {
            console.error(`   ❌ Failed: ${e.message}`);
            // Don't stop, try next
        }
        
        // Sleep to avoid rate limits
        await wait(2000);
    }
    
    console.log(`\n🏁 Simulation Complete.`);
}

main().catch(console.error);
