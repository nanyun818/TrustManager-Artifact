const hre = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
    console.log("📊 Starting Gas Cost Analysis: Full On-Chain vs. Merkle Root");
    console.log("-------------------------------------------------------------");

    const [deployer] = await hre.ethers.getSigners();

    // 1. Measure TrustManager (Full On-Chain) Cost
    // We'll use the already deployed contract or deploy a new one if needed. 
    // For clean metrics, let's deploy a fresh instance of TrustManager to avoid state pollution affecting gas (though mostly constant).
    const TrustManager = await hre.ethers.getContractFactory("TrustManager");
    const trustManager = await TrustManager.deploy();
    await trustManager.deployed();
    
    // Register a node first
    const nodeAddress = deployer.address;
    await (await trustManager.registerNode(nodeAddress)).wait();

    // Measure updateNodeMetrics
    // Params: address _node, uint _successRate, uint _responseTime, uint _onlineTime
    const txFull = await trustManager.updateNodeMetrics(nodeAddress, 99, 50, 3600);
    const receiptFull = await txFull.wait();
    const gasUsedFull = receiptFull.gasUsed;

    console.log(`\n🔹 [Scenario A: Full On-Chain]`);
    console.log(`   Operation: Update metrics for 1 SINGLE node`);
    console.log(`   Gas Used: ${gasUsedFull.toString()}`);
    
    // 2. Measure MerkleTrust (Root Only) Cost
    const MerkleTrust = await hre.ethers.getContractFactory("MerkleTrust");
    const merkleTrust = await MerkleTrust.deploy();
    await merkleTrust.deployed();

    // Measure updateStateRoot
    // Random 32-byte hash
    const mockRoot = "0x" + "1".repeat(64); 
    const txRoot = await merkleTrust.updateStateRoot(mockRoot);
    const receiptRoot = await txRoot.wait();
    const gasUsedRoot = receiptRoot.gasUsed;

    console.log(`\n🔹 [Scenario B: Merkle Root / L2 Style]`);
    console.log(`   Operation: Update State Root (Batch of N nodes)`);
    console.log(`   Gas Used: ${gasUsedRoot.toString()}`);

    // 3. Comparative Analysis
    console.log(`\n📈 [Economic Feasibility Analysis]`);
    
    const batchSizes = [10, 100, 1000];
    const gasPriceGwei = 20; // Assume 20 Gwei
    const ethPriceUsd = 3000; // Assume $3000 ETH

    console.log(`\nAssuming Gas Price: ${gasPriceGwei} gwei, ETH Price: $${ethPriceUsd}`);
    console.log(`\n| Batch Size (Nodes) | Full On-Chain Cost ($) | Merkle Root Cost ($) | Savings (%) |`);
    console.log(`|-------------------|------------------------|----------------------|-------------|`);

    for (const n of batchSizes) {
        // Full Chain: N * gas per tx
        const totalGasFull = gasUsedFull.mul(n);
        const costFullEth = totalGasFull.mul(gasPriceGwei).div(1000000000); // in ETH (approx)
        // Actually, let's do precise float calc for display
        const costFullEthFloat = parseFloat(totalGasFull.toString()) * gasPriceGwei * 1e-9;
        const costFullUsd = costFullEthFloat * ethPriceUsd;

        // Merkle: Fixed cost for 1 tx (plus off-chain computation which is free in gas terms)
        // We assume the root update covers the whole batch.
        const totalGasRoot = gasUsedRoot; 
        const costRootEthFloat = parseFloat(totalGasRoot.toString()) * gasPriceGwei * 1e-9;
        const costRootUsd = costRootEthFloat * ethPriceUsd;

        const savings = ((costFullUsd - costRootUsd) / costFullUsd * 100).toFixed(2);

        console.log(`| ${n.toString().padEnd(17)} | $${costFullUsd.toFixed(2).padEnd(21)} | $${costRootUsd.toFixed(2).padEnd(19)} | ${savings}%      |`);
    }

    console.log("\n✅ Conclusion: The Merkle Root approach effectively makes the marginal cost of adding a node near-zero on-chain.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
