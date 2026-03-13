const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
    const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
    const targetAddress = "0x0402Ab23a93AAFFF89b8AF0e2D4CEd63A82D2200";

    if (!rpcUrl) {
        console.error("❌ Error: No RPC URL found in .env (checked SEPOLIA_RPC_URL and RPC_URL)");
        process.exit(1);
    }

    console.log(`Checking balance for: ${targetAddress}`);
    console.log(`Using RPC: ${rpcUrl}`);

    try {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
        const balance = await provider.getBalance(targetAddress);
        const balanceEth = ethers.utils.formatEther(balance);
        
        console.log(`✅ Balance: ${balanceEth} Sepolia ETH`);
        
        if (balance.gt(0)) {
            console.log("🎉 Good news! This account has funds.");
        } else {
            console.log("⚠️  Warning: Balance is 0.");
        }
    } catch (error) {
        console.error("❌ Error fetching balance:", error.message);
    }
}

main();
