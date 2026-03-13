const hre = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
    console.log("🎬 Starting AI Intervention Demo Scenario...");
    console.log("-------------------------------------------");

    const [deployer] = await hre.ethers.getSigners();
    const TrustManager = await hre.ethers.getContractFactory("TrustManager");
    
    // Deploy fresh for clean data
    const contract = await TrustManager.deploy();
    await contract.deployed();
    console.log(`Contract deployed at: ${contract.address}`);

    // Register Target Node
    const targetNode = deployer.address;
    await contract.registerNode(targetNode);
    
    // Set AI Agent to deployer
    await contract.setAiAgent(deployer.address);

    const data = [];
    data.push("round,trust_score,phase");

    console.log("Phase 1: Normal Operation (Rounds 1-5)");
    for (let i = 1; i <= 5; i++) {
        // Good Metrics: 100% Success, 50ms Latency
        await contract.updateNodeMetrics(targetNode, 100, 50, 3600);
        const node = await contract.nodes(targetNode);
        console.log(`Round ${i}: Trust=${node.trustValue}`);
        data.push(`${i},${node.trustValue},Normal`);
    }

    console.log("\nPhase 2: Performance Degradation (Rounds 6-10)");
    for (let i = 6; i <= 10; i++) {
        // Bad Metrics: 80% Success, 800ms Latency (Should drop trust slightly)
        // Adaptive logic might kick in too
        await contract.updateNodeMetrics(targetNode, 80, 800, 3600);
        const node = await contract.nodes(targetNode);
        console.log(`Round ${i}: Trust=${node.trustValue}`);
        data.push(`${i},${node.trustValue},Degradation`);
    }

    console.log("\n⚠️ AI INTERVENTION DETECTED RISK! (Injecting Risk Score=80)");
    // Simulate AI Bridge call
    await contract.setNodeRiskScore(targetNode, 80);

    console.log("\nPhase 3: AI Penalized State (Rounds 11-15)");
    for (let i = 11; i <= 15; i++) {
        // Metrics remain bad, but now Risk Penalty is applied
        await contract.updateNodeMetrics(targetNode, 80, 800, 3600);
        const node = await contract.nodes(targetNode);
        console.log(`Round ${i}: Trust=${node.trustValue}`);
        data.push(`${i},${node.trustValue},AI_Penalized`);
    }

    console.log("\nPhase 4: Recovery (Rounds 16-20)");
    // Remove Risk Score (AI determines threat is gone)
    await contract.setNodeRiskScore(targetNode, 0);
    
    for (let i = 16; i <= 20; i++) {
        // Good Metrics return
        await contract.updateNodeMetrics(targetNode, 100, 50, 3600);
        const node = await contract.nodes(targetNode);
        console.log(`Round ${i}: Trust=${node.trustValue}`);
        data.push(`${i},${node.trustValue},Recovery`);
    }

    // Ensure output directory exists
    const outDir = path.join(__dirname, '../out/paper_data');
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }
    
    fs.writeFileSync(path.join(outDir, 'experiment_ai_intervention.csv'), data.join('\n'));
    console.log(`\n✅ Data saved to out/paper_data/experiment_ai_intervention.csv`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
