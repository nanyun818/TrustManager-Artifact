const hre = require("hardhat");

async function main() {
    console.log("🕸️ Testing EigenTrust Lite (One-Hop Neighbor Aggregation)");
    console.log("---------------------------------------------------------");

    const [deployer, userA, userB, userC] = await hre.ethers.getSigners();
    const TrustManager = await hre.ethers.getContractFactory("TrustManager");
    const contract = await TrustManager.deploy();
    await contract.deployed();
    console.log(`Contract deployed at: ${contract.address}`);

    // 1. Setup Nodes
    // Node A: The Target (High Performance)
    // Node B: The Recommender (Low Trust)
    // Node C: The Recommender (Low Trust)
    
    console.log("\n1. Registering Nodes...");
    await contract.connect(userA).registerNode(userA.address);
    await contract.connect(userB).registerNode(userB.address);
    await contract.connect(userC).registerNode(userC.address);

    // 2. Establish Baseline Trust
    console.log("2. Establishing Baseline Metrics...");
    
    // Node A: Perfect stats (100% success, 10ms latency)
    await contract.connect(userA).updateNodeMetrics(userA.address, 100, 10, 3600);
    const trustA_Initial = (await contract.nodes(userA.address)).trustValue;
    console.log(`   Node A (Target) Trust: ${trustA_Initial} (Expected ~200)`);

    // Node B: Mediocre stats (Keep above blacklist threshold 80)
    // 85% success, 200ms latency
    await contract.connect(userB).updateNodeMetrics(userB.address, 85, 200, 1000);
    const trustB = (await contract.nodes(userB.address)).trustValue;
    console.log(`   Node B (Mediocre) Trust: ${trustB}`);

    // Node C: Mediocre stats
    await contract.connect(userC).updateNodeMetrics(userC.address, 85, 200, 1000);
    const trustC = (await contract.nodes(userC.address)).trustValue;
    console.log(`   Node C (Mediocre) Trust: ${trustC}`);

    // 3. Form Trust Links (EigenTrust Step)
    console.log("\n3. Forming Trust Links (Bad actors endorsing A)...");
    // B trusts A
    await contract.connect(userB).trustNode(userA.address);
    // C trusts A
    await contract.connect(userC).trustNode(userA.address);
    console.log("   B -> Trusts -> A");
    console.log("   C -> Trusts -> A");

    // 4. Trigger Recalculation for A
    console.log("\n4. Recalculating A's Trust...");
    // We call updateNodeMetrics again with same stats to trigger _calculateAndUpdateTrustValue
    await contract.connect(userA).updateNodeMetrics(userA.address, 100, 10, 3600);

    const trustA_Final = (await contract.nodes(userA.address)).trustValue;
    console.log(`   Node A Final Trust: ${trustA_Final}`);

    // 5. Verification
    // Logic: λ=0.7. Self=200. Social=Avg(B,C) approx 60 (depends on calculation).
    // Formula: 0.7 * 200 + 0.3 * 60 = 140 + 18 = 158.
    // If it dropped from 200, EigenTrust is working (reputation dilution by low-trust neighbors).
    
    const drop = trustA_Initial.sub(trustA_Final);
    console.log(`\n📉 Trust Delta: -${drop.toString()}`);
    
    if (drop.gt(0)) {
        console.log("✅ SUCCESS: Node A's trust was influenced (dampened) by low-trust neighbors.");
    } else {
        console.log("❌ FAILURE: Node A's trust did not change.");
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
