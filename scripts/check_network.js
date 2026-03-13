const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
    const rpcUrl = process.env.RPC_URL || process.env.PROVIDER_URL;
    const privateKey = process.env.PRIVATE_KEY;

    console.log("🔍 Checking Network Connection...");
    console.log(`RPC URL: ${rpcUrl}`);

    if (!rpcUrl) {
        console.error("❌ No RPC_URL found in .env");
        process.exit(1);
    }

    try {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
        const network = await provider.getNetwork();
        console.log(`✅ Connected to Network: ${network.name} (Chain ID: ${network.chainId})`);

        if (privateKey) {
            const wallet = new ethers.Wallet(privateKey, provider);
            const balance = await wallet.getBalance();
            const balanceEth = ethers.utils.formatEther(balance);
            console.log(`👛 Wallet Address: ${wallet.address}`);
            console.log(`💰 Balance: ${balanceEth} ETH`);

            if (balance.eq(0)) {
                console.warn("⚠️  Warning: Wallet balance is 0. You need testnet ETH to deploy.");
            } else {
                console.log("✅ Wallet ready for deployment.");
            }
        } else {
            console.log("⚠️  No PRIVATE_KEY found in .env. You can only read from blockchain.");
        }

    } catch (error) {
        console.error("❌ Failed to connect to network:", error.message);
        if (error.message.includes("could not detect network")) {
            console.error("   -> Check if your RPC URL is correct and accessible.");
        }
    }
}

main();
