const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'simulation_state.json');

async function main() {
    const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:7545';
    const contractAddress = fs.readFileSync(path.join(__dirname, '../contract_address.txt'), 'utf8').trim();
    
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const signer = provider.getSigner(0); // Use account 0 (Owner)
    
    const abi = [
        'function registerNode(address _node) public',
        'function updateNodeMetrics(address _node, uint _successRate, uint _responseTime, uint _onlineTime) public',
        'function getNodeInfo(address _node) public view returns (uint trustValue, uint successRate, uint responseTime, uint onlineTime, uint interactionCount, bool isActive, bool isBlacklisted)',
        'function getTrustLevel(address _node) public view returns (uint)'
    ];
    
    const contract = new ethers.Contract(contractAddress, abi, signer);
    
    // 1. Reset State File
    const HONEST_NODES = [
        '0x10AAe54E3F84C39C51936538b64C90c780315306',
        '0x7B9EB440516A1e5f3Cb1e3593189943Da8574A64',
        '0x71090B985Ec887977AAE1d20C141cf7a11a27380',
        '0x3018018c44338B9728d02be12d632C6691E020d1',
        '0x4aC094fB46784E74B7F3b6dEDEb1DfF42B00f5B1'
    ];
    
    const COLLUSION_NODES = [
        '0x4a585e0F7c18e2C414221D6402652D5e0990E5F8',
        '0xeA5B523263bea6a5574858528bd591A3c2BEa0f6',
        '0x9107192584DE051e2b50E6293A3A19bf400bF034'
    ];
    
    // We also need "Whitewash" group addresses (New Identities)
    // We'll generate them or pick from unused accounts.
    // Let's pick some random ones or just hardcode new ones.
    const WHITEWASH_NODES = [
        '0x8eB950f72BE808C896582d8bFC66e53344C3008E',
        ethers.utils.getAddress('0x96c42c56fdb78294f96b9c31552c71d30c999c76')
    ];

    const newState = {
        loop: 109, // Fast forward to 109
        groups: {
            honest: HONEST_NODES,
            collusion: COLLUSION_NODES,
            whitewash: WHITEWASH_NODES,
            on_off: []
        },
        whitewash_active_map: {}
    };
    
    fs.writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2));
    console.log("State file reset to Loop 109.");

    // 2. Register & Bootstrap Trust on-chain
    console.log("Bootstrapping Trust on-chain...");
    
    const allNodes = [...HONEST_NODES, ...COLLUSION_NODES]; // Whitewash nodes join later (Loop 110)
    
    for (const node of allNodes) {
        try {
            // Register
            // We use try-catch in case already registered (should be empty though)
            try { await (await contract.registerNode(node)).wait(); } catch(e) {}
            
            // Update Metrics multiple times to build trust
            // Simulate 5 updates
            for (let i=0; i<3; i++) {
                await (await contract.updateNodeMetrics(node, 100, 100, 1000)).wait();
            }
            
            const info = await contract.getNodeInfo(node);
            console.log(`Node ${node.substring(0,8)}... Trust=${info.trustValue} (Level ${await contract.getTrustLevel(node)})`);
        } catch (e) {
            console.error(`Failed to bootstrap ${node}: ${e.message}`);
        }
    }
    
    console.log("Bootstrap Complete!");
}

main().catch(console.error);
