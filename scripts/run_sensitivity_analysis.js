const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    console.log("🔬 Starting Parameter Sensitivity Analysis...");
    console.log("   Goal: Determine optimal Alpha (Success Rate) vs Beta (Latency) weights.");

    // 1. Deploy
    const TrustManager = await ethers.getContractFactory("TrustManager");
    const contract = await TrustManager.deploy();
    await contract.deployed();

    // 2. Setup Test Node (Scenario: High Success but High Latency)
    // This represents a "Congested Honest Node" or "Laggy Node"
    // We want to see at what weight balance the system flags it as "Low Trust" vs "High Trust"
    const [owner, testNode] = await ethers.getSigners();
    await contract.registerNode(testNode.address);

    // Node Performance: 100% Success, but 2000ms Latency (Poor)
    const SUCCESS = 100;
    const LATENCY = 2000; 
    const ONLINE = 3600;

    const results = [];
    const step = 1000; // 0.1 step (weights are 0-10000)

    console.log("\n   Running Grid Search...");
    
    // Vary Alpha (Weight for Success)
    for (let alpha = 0; alpha <= 10000; alpha += step) {
        // Vary Beta (Weight for Latency)
        // Constrain: alpha + beta <= 10000 (Gamma takes the rest)
        for (let beta = 0; beta <= (10000 - alpha); beta += step) {
            const gamma = 10000 - alpha - beta;
            
            // Set Weights
            await contract.updateWeights(alpha, beta, gamma); // Theta fixed
            
            // Update Node
            await contract.updateNodeMetrics(testNode.address, SUCCESS, LATENCY, ONLINE);
            
            // Read Trust
            const node = await contract.nodes(testNode.address);
            const score = node.trustValue.toNumber();

            results.push({
                alpha: alpha / 10000,
                beta: beta / 10000,
                gamma: gamma / 10000,
                score: score
            });
            
            process.stdout.write('.');
        }
    }

    console.log("\n✅ Grid Search Complete.");

    // Save Data
    const outDir = path.join(__dirname, '../out/paper_data');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    let csvContent = "alpha,beta,gamma,trust_score\n";
    results.forEach(r => {
        csvContent += `${r.alpha},${r.beta},${r.gamma},${r.score}\n`;
    });

    fs.writeFileSync(path.join(outDir, 'sensitivity_analysis.csv'), csvContent);
    console.log(`📄 Data saved to out/paper_data/sensitivity_analysis.csv`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
