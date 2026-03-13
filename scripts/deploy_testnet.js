const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();

// Load ABI/Bytecode
function loadArtifacts() {
    const artifactPath = path.join(__dirname, '../artifacts/TrustManager.json');
    if (!fs.existsSync(artifactPath)) {
        throw new Error("Artifacts not found. Please run 'node scripts/compile.js' first.");
    }
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    return { abi: artifact.abi, bytecode: artifact.bytecode };
}

async function main() {
    console.log("=== Sepolia Testnet Deployment ===");

    // 1. Configuration Check
    const RPC_URL = process.env.SEPOLIA_RPC_URL;
    const PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY;
    const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;

    if (!RPC_URL) {
        console.error("❌ Error: SEPOLIA_RPC_URL is missing in .env");
        process.exit(1);
    }
    if (!PRIVATE_KEY) {
        console.error("❌ Error: SEPOLIA_PRIVATE_KEY is missing in .env");
        process.exit(1);
    }

    // 2. Provider & Wallet
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    const network = await provider.getNetwork();
    console.log(`\n📡 Connected to Network: ${network.name} (Chain ID: ${network.chainId})`);
    
    if (network.chainId !== 11155111) { // Sepolia Chain ID
        console.warn("⚠️  WARNING: You are NOT connected to Sepolia (Chain ID 11155111).");
        console.warn(`   Current Chain ID: ${network.chainId}`);
        // In a real interactive shell we might ask for confirmation, 
        // but for this script we just warn.
    }

    const balance = await wallet.getBalance();
    console.log(`👤 Deployer Address: ${wallet.address}`);
    console.log(`💰 Balance: ${ethers.utils.formatEther(balance)} ETH`);

    if (balance.lt(ethers.utils.parseEther("0.01"))) {
        console.error("❌ Error: Low balance. Please get at least 0.01 Sepolia ETH from a faucet.");
        process.exit(1);
    }

    // 3. Deploy
    console.log("\n🚀 Deploying TrustManager...");
    const { abi, bytecode } = loadArtifacts();
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);

    // Estimate Gas
    const gasPrice = await provider.getGasPrice();
    const gasLimit = await factory.signer.estimateGas(factory.getDeployTransaction());
    const estimatedCost = gasPrice.mul(gasLimit);
    
    console.log(`   Gas Price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`);
    console.log(`   Estimated Cost: ${ethers.utils.formatEther(estimatedCost)} ETH`);

    const contract = await factory.deploy();
    console.log(`\n⏳ Transaction sent: ${contract.deployTransaction.hash}`);
    console.log("   Waiting for confirmation...");

    await contract.deployed();
    console.log(`\n✅ TrustManager Deployed to: ${contract.address}`);

    // 4. Wait for Block Confirmations (for Etherscan verification reliability)
    console.log("\n⏳ Waiting for 5 block confirmations...");
    await contract.deployTransaction.wait(5);
    console.log("   Confirmed!");

    // 5. Verification Instructions
    console.log("\n=== Verification Instructions ===");
    console.log(`To verify on Etherscan, run:`);
    console.log(`npx hardhat verify --network sepolia ${contract.address}`);
    console.log(`(Ensure you have installed hardhat-etherscan and configured hardhat.config.js)`);

    // Save address
    const deployData = {
        network: network.name,
        chainId: network.chainId,
        address: contract.address,
        timestamp: new Date().toISOString(),
        deployer: wallet.address
    };
    fs.writeFileSync(path.join(__dirname, '../out/deploy_sepolia.json'), JSON.stringify(deployData, null, 2));
    console.log(`\n📄 Deployment info saved to out/deploy_sepolia.json`);
}

main().catch(console.error);
