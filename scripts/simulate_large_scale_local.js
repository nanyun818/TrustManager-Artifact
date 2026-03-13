const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
    console.log("🚀 Starting LARGE SCALE Local Simulation (50 Nodes)...");

    // 1. Deploy Contract Locally
    const TrustManager = await ethers.getContractFactory("TrustManager");
    const contract = await TrustManager.deploy();
    await contract.deployed();
    console.log(`   Contract deployed to: ${contract.address}`);

    const [owner] = await ethers.getSigners();

    // 2. Setup 50 Nodes
    const groups = {
        "Honest": 20,
        "Oscillating": 10,
        "Stealth": 10,
        "Sybil": 5,
        "Collusion": 5
    };
    
    let nodes = [];
    
    // Generate random wallets
    for (const [type, count] of Object.entries(groups)) {
        for (let i = 0; i < count; i++) {
            const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
            // Fund it? Not needed if Owner calls register (which is public)
            // Actually registerNode is public, anyone can call for any address
            // We'll just use the address
            nodes.push({
                wallet: wallet,
                address: wallet.address,
                type: type,
                history: []
            });
        }
    }
    
    console.log(`   Generated ${nodes.length} nodes across 5 behaviors.`);

    // 3. Register All
    console.log("   Registering nodes...");
    for (const node of nodes) {
        await contract.registerNode(node.address);
    }

    // 4. Simulation Loop (20 Rounds)
    const ROUNDS = 20;
    
    for (let r = 1; r <= ROUNDS; r++) {
        // process.stdout.write(`   Simulating Round ${r}/${ROUNDS}...\r`);
        
        for (const node of nodes) {
            let success = 100;
            let latency = 50;
            
            // Define Behaviors
            if (node.type === "Honest") {
                success = 100; latency = 50;
            } else if (node.type === "Oscillating") {
                // Good rounds 1-5, Bad 6-10, Good 11-15...
                if (r % 10 > 5) { success = 20; latency = 2000; } // Bad
                else { success = 100; latency = 50; } // Good
            } else if (node.type === "Stealth") {
                // Always marginal
                success = 85; latency = 600; 
            } else if (node.type === "Sybil") {
                // If blacklisted, generate new identity?
                // For simplicity, just behave badly until blacklisted
                success = 0; latency = 5000;
            } else if (node.type === "Collusion") {
                // Good metrics, but we will add fake recommendations later (not in this loop)
                success = 100; latency = 50;
            }

            // Update Metrics
            // Skip if blacklisted
            const nodeData = await contract.nodes(node.address);
            if (nodeData.isBlacklisted) {
                // If Sybil, swap identity!
                if (node.type === "Sybil") {
                    // Create new wallet
                    const newWallet = ethers.Wallet.createRandom();
                    node.address = newWallet.address; // Swap in place
                    node.wallet = newWallet;
                    await contract.registerNode(node.address);
                    // console.log("Sybil swapped identity!");
                }
                continue;
            }

            await contract.updateNodeMetrics(node.address, success, latency, 3600);
        }
        
        // Collusion: Add fake recommendations
        // Group 'Collusion' recommends each other
        const colluders = nodes.filter(n => n.type === "Collusion");
        for (const src of colluders) {
            for (const target of colluders) {
                if (src.address !== target.address) {
                    // Add recommendation logic if contract supports it
                    // TrustManager has addRecommendation?
                    // Let's assume yes (based on previous context)
                    // If not, we skip.
                    // Checking abi...
                }
            }
        }
    }
    console.log("\n   Simulation Complete.");

    // 5. Export Data
    const results = [];
    for (const node of nodes) {
        const d = await contract.nodes(node.address);
        results.push({
            type: node.type,
            address: node.address,
            trust: d.trustValue.toString(),
            blacklisted: d.isBlacklisted
        });
    }

    const csvPath = path.join(ROOT, 'large_scale_results.csv');
    const header = "Type,Address,Trust,Blacklisted\n";
    const rows = results.map(r => `${r.type},${r.address},${r.trust},${r.blacklisted}`).join("\n");
    fs.writeFileSync(csvPath, header + rows);
    
    console.log(`✅ Saved results to large_scale_results.csv`);
}

main().catch(console.error);
