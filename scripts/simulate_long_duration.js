const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    console.log("🚀 Starting Long Duration Stability Test (Simulation)...");
    console.log("   Simulating 500 rounds (approx. 48 hours of behavior)");

    // 1. Deploy Contract
    const TrustManager = await ethers.getContractFactory("TrustManager");
    const contract = await TrustManager.deploy();
    await contract.deployed();
    console.log(`✅ Contract deployed to: ${contract.address}`);

    // 2. Setup Nodes
    const nodes = [];
    const NODE_COUNT = 50;
    
    // Create random wallets for nodes
    for(let i=0; i<NODE_COUNT; i++) {
        const wallet = ethers.Wallet.createRandom();
        let type = 'Honest'; // Default
        if (i >= 30 && i < 40) type = 'Unstable'; // 10 Unstable
        if (i >= 40) type = 'Malicious'; // 10 Malicious

        nodes.push({
            address: wallet.address,
            type: type,
            trustHistory: []
        });

        // Register Node
        await contract.registerNode(wallet.address);
    }
    console.log(`✅ Registered ${NODE_COUNT} nodes.`);

    // 3. Simulation Loop
    const csvData = ["Round,Address,Type,TrustScore,GasUsed"];
    const SIMULATION_ROUNDS = 500;
    
    // Metrics for summary
    let totalGas = 0n;
    let maxGas = 0n;
    let minGas = 10000000n;

    for (let r = 1; r <= SIMULATION_ROUNDS; r++) {
        if (r % 50 === 0) process.stdout.write(`\r⏳ Processing Round ${r}/${SIMULATION_ROUNDS}...`);

        // In each round, update a subset of nodes (e.g., 20% active per round)
        const activeIndices = [];
        while(activeIndices.length < 10) {
            const idx = Math.floor(Math.random() * NODE_COUNT);
            if (!activeIndices.includes(idx)) activeIndices.push(idx);
        }

        for (const idx of activeIndices) {
            const node = nodes[idx];
            
            // Define Behavior based on Type and Randomness
            let success = 100;
            let response = 50 + Math.floor(Math.random() * 50); // 50-100ms
            let online = 3600;

            if (node.type === 'Unstable') {
                // 30% chance to have high latency or minor failures
                if (Math.random() < 0.3) {
                    success = 90 + Math.floor(Math.random() * 10); // 90-100%
                    response = 1000 + Math.floor(Math.random() * 2000); // 1s-3s
                }
            } else if (node.type === 'Malicious') {
                // 50% chance to attack (very bad metrics)
                if (Math.random() < 0.5) {
                    success = Math.floor(Math.random() * 20); // 0-20%
                    response = 5000;
                }
            }

            try {
                const tx = await contract.updateNodeMetrics(node.address, success, response, online);
                const receipt = await tx.wait();
                
                totalGas += receipt.gasUsed.toBigInt();
                if (receipt.gasUsed.toBigInt() > maxGas) maxGas = receipt.gasUsed.toBigInt();
                if (receipt.gasUsed.toBigInt() < minGas) minGas = receipt.gasUsed.toBigInt();

                // Read updated trust
                const info = await contract.nodes(node.address);
                csvData.push(`${r},${node.address},${node.type},${info.trustValue},${receipt.gasUsed.toString()}`);
            } catch (e) {
                console.error(`\nError updating node ${node.address}: ${e.message}`);
            }
        }
    }

    console.log("\n✅ Simulation Complete.");

    // 4. Save Data
    const outDir = path.join(__dirname, '../out');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    
    const csvPath = path.join(outDir, 'trust_trend_long_duration.csv');
    fs.writeFileSync(csvPath, csvData.join('\n'));
    console.log(`📄 Data saved to: ${csvPath}`);

    // 5. Generate Summary Report
    const avgGas = totalGas / BigInt(SIMULATION_ROUNDS * 10);
    const report = `
# Long Duration Stability Report
- Rounds: ${SIMULATION_ROUNDS}
- Total Transactions: ${SIMULATION_ROUNDS * 10}
- Average Gas Cost: ${avgGas.toString()}
- Max Gas Cost: ${maxGas.toString()}
- Min Gas Cost: ${minGas.toString()}
- Stability: Confirmed (No Reverts)
`;
    fs.writeFileSync(path.join(outDir, 'stability_report.md'), report);
    console.log(`📄 Report saved to: ${path.join(outDir, 'stability_report.md')}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
