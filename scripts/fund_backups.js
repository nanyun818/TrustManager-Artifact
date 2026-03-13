const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
    const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:7545';
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    
    const mainKey = process.env.PRIVATE_KEY;
    const wallet = new ethers.Wallet(mainKey, provider);
    
    const backupKeys = [
        '0x65eda5dc63f9a97d4bd33cf899958c979ddfcaab704358d699428835e6cf0a0a',
        '0x4b5d5f49d824f05c7c0a1d627ef17d570718955a6e481d9a454f4863b567d418'
    ];
    
    console.log(`Main Wallet: ${wallet.address}`);
    const balance = await wallet.getBalance();
    console.log(`Balance: ${ethers.utils.formatEther(balance)} ETH`);
    
    for (const pk of backupKeys) {
        const recipient = new ethers.Wallet(pk).address;
        console.log(`Funding ${recipient}...`);
        
        try {
            const tx = await wallet.sendTransaction({
                    to: recipient,
                    value: ethers.utils.parseEther("50.0"),
                    gasLimit: 21000
                });
            await tx.wait();
            console.log(`✅ Sent 50 ETH to ${recipient}`);
        } catch (e) {
            console.error(`❌ Failed to fund ${recipient}: ${e.message}`);
        }
    }
}

main();
