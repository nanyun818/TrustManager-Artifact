const fs = require('fs');
const path = require('path');
// const csv = require('csv-parser'); // Removed dependency
const hre = require("hardhat");

async function main() {
    console.log("🚀 Starting AI Oracle Bridge...");

    // 1. Get Contract Address
    const addressPath = path.join(__dirname, '../contract_address.txt');
    if (!fs.existsSync(addressPath)) {
        console.error("❌ Contract address file not found.");
        return;
    }
    const contractAddress = fs.readFileSync(addressPath, 'utf8').trim();
    console.log(`📍 Contract Address: ${contractAddress}`);

    // 2. Get Signer
    const [deployer] = await hre.ethers.getSigners();
    console.log(`👤 AI Agent (Signer): ${deployer.address}`);

    // 3. Attach Contract
    const TrustManager = await hre.ethers.getContractFactory("TrustManager");
    const contract = TrustManager.attach(contractAddress);

    // 4. Verify/Set AI Agent Role
    const currentAiAgent = await contract.aiAgent();
    if (currentAiAgent !== deployer.address) {
        console.log(`⚠️ Current AI Agent is ${currentAiAgent}. Updating to ${deployer.address}...`);
        try {
            const tx = await contract.setAiAgent(deployer.address);
            await tx.wait();
            console.log("✅ AI Agent updated successfully.");
        } catch (e) {
            console.error("❌ Failed to set AI Agent (Are you the owner?):", e.message);
            // Continue anyway, maybe we are already authorized or it's a simulation stub
        }
    } else {
        console.log("✅ Signer is already authorized as AI Agent.");
    }

    // 5. Read Risk Data
    const riskDataPath = path.join(__dirname, '../out/node_risk_agg.csv');
    if (!fs.existsSync(riskDataPath)) {
        console.error("❌ Risk data file not found:", riskDataPath);
        return;
    }

    console.log("📂 Reading risk data...");
    const updates = [];
    
    // Simple CSV Parser
    const fileContent = fs.readFileSync(riskDataPath, 'utf8');
    const lines = fileContent.split('\n');
    const headers = lines[0].split(',');
    
    // Find indices
    const idxAddress = headers.indexOf('address');
    const idxAvgRisk = headers.indexOf('avg_risk');
    
    if (idxAddress === -1 || idxAvgRisk === -1) {
        console.error("❌ Invalid CSV headers.");
        return;
    }

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(',');
        
        const nodeAddr = cols[idxAddress];
        const avgRisk = parseFloat(cols[idxAvgRisk]);
        
        if (avgRisk > 0) {
            // Convert 0.0-1.0 to 0-100
            let riskScore = Math.floor(avgRisk * 100);
            if (riskScore > 100) riskScore = 100;
            // if (riskScore < 1) riskScore = 1; // Minimum 1 if detected? Or allow 0?
            
            updates.push({ node: nodeAddr, score: riskScore });
        }
    }

    console.log(`🔍 Found ${updates.length} nodes with risk > 0.`);

    // 6. Batch Update (Simulated loop)
    // In production, we might want to batch this or use a multicall.
    // Here we loop one by one.
    
    let successCount = 0;
    
    // Limit updates to avoid long waits in demo
    const LIMIT = 20; 
    const targets = updates.slice(0, LIMIT);
    
    if (updates.length > LIMIT) {
        console.log(`⚠️ Limiting updates to first ${LIMIT} nodes for demo purposes.`);
    }

    for (const update of targets) {
        // Check if node is active
        const nodeInfo = await contract.nodes(update.node);
        if (!nodeInfo.isActive) {
            console.log(`🆕 Registering new node: ${update.node}`);
            try {
                const txReg = await contract.registerNode(update.node);
                await txReg.wait();
                console.log(`✅ Registered ${update.node}`);
            } catch (e) {
                console.error(`❌ Failed to register node ${update.node}:`, e.message);
                continue;
            }
        }

        console.log(`⚡ Updating risk for ${update.node} to ${update.score}%...`);
        try {
            const tx = await contract.setNodeRiskScore(update.node, update.score);
            await tx.wait();
            console.log(`✅ Updated ${update.node}: Risk=${update.score}`);
            successCount++;
        } catch (e) {
            console.error(`❌ Failed to update ${update.node}:`, e.message);
        }
    }

    console.log(`🎉 Finished. Updated ${successCount}/${targets.length} nodes.`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
