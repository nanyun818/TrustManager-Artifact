const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
    const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:7545';
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

    const keys = [
        process.env.PRIVATE_KEY,
        '0x65eda5dc63f9a97d4bd33cf899958c979ddfcaab704358d699428835e6cf0a0a',
        '0x4b5d5f49d824f05c7c0a1d627ef17d570718955a6e481d9a454f4863b567d418'
    ];

    console.log(`Checking ${keys.length} wallets on ${rpcUrl}...`);

    for (let i = 0; i < keys.length; i++) {
        try {
            const wallet = new ethers.Wallet(keys[i], provider);
            const balance = await wallet.getBalance();
            console.log(`Wallet ${i} (${wallet.address}): ${ethers.utils.formatEther(balance)} ETH`);
            
            // Try a simple network call
            const net = await provider.getNetwork();
            console.log(`  Network: ${net.name} (${net.chainId})`);
            
        } catch (e) {
            console.error(`Error with wallet ${i}:`, e.message);
        }
    }
}

main();
