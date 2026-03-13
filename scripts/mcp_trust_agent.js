const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Configuration
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:7545';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0x41d67493fF618029D8A98A918DC4b4ca56101FFC';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '0x85f9ae77d4bac69be3fd8070a8315d1f1c3e70af4f4cfefc05313c97f546d1d2';

// ABI for TrustManager (Simplified for Agent Tools)
const ABI = [
    'function getNodeInfo(address _node) public view returns (uint trustValue, uint successRate, uint responseTime, uint onlineTime, uint interactionCount, bool isActive, bool isBlacklisted)',
    'function fastRespond(address _node, uint _risk, uint _bp, uint _until) public',
    'function updatePenaltyBpFor(address _node, uint _bp) public',
    'function nodeRiskExposure(address) public view returns (uint)',
    'function penaltyBpPerNode(address) public view returns (uint)'
];

// 1. Tool Definitions (Schema for LLM)
// This follows the MCP / OpenAI Function Calling format
const TOOLS = [
    {
        name: "get_node_trust_info",
        description: "Retrieve comprehensive trust metrics for a specific blockchain node.",
        input_schema: {
            type: "object",
            properties: {
                node_address: { type: "string", description: "The Ethereum address of the node (0x...)" }
            },
            required: ["node_address"]
        }
    },
    {
        name: "report_malicious_activity",
        description: "Report a node for malicious behavior, triggering immediate risk adjustment and potential penalty.",
        input_schema: {
            type: "object",
            properties: {
                node_address: { type: "string", description: "The malicious node address" },
                risk_score: { type: "integer", description: "Risk score (0-100), higher is riskier" },
                penalty_bp: { type: "integer", description: "Penalty in basis points (e.g. 5000 = 50%)" },
                duration_seconds: { type: "integer", description: "Duration of the penalty window in seconds" }
            },
            required: ["node_address", "risk_score"]
        }
    },
    {
        name: "check_node_risk_status",
        description: "Check the current risk exposure and penalty configuration for a node.",
        input_schema: {
            type: "object",
            properties: {
                node_address: { type: "string", description: "The node address" }
            },
            required: ["node_address"]
        }
    }
];

// 2. Tool Implementation (The "Server" Logic)
class TrustManagerMCP {
    constructor() {
        this.provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        this.wallet = new ethers.Wallet(PRIVATE_KEY, this.provider);
        this.contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, this.wallet);
    }

    async callTool(name, args) {
        console.log(`[MCP Server] Handling tool call: ${name}`, args);
        try {
            switch (name) {
                case "get_node_trust_info":
                    return await this.getNodeTrustInfo(args.node_address);
                case "report_malicious_activity":
                    return await this.reportMaliciousActivity(args.node_address, args.risk_score, args.penalty_bp || 1000, args.duration_seconds || 3600);
                case "check_node_risk_status":
                    return await this.checkNodeRiskStatus(args.node_address);
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        } catch (error) {
            return { error: error.message };
        }
    }

    async getNodeTrustInfo(address) {
        const info = await this.contract.getNodeInfo(address);
        return {
            address,
            trust_value: info.trustValue.toString(),
            success_rate: info.successRate.toString(),
            is_active: info.isActive,
            is_blacklisted: info.isBlacklisted
        };
    }

    async reportMaliciousActivity(address, risk, bp, duration) {
        const until = Math.floor(Date.now() / 1000) + duration;
        const tx = await this.contract.fastRespond(address, risk, bp, until);
        console.log(`[MCP Server] Transaction sent: ${tx.hash}`);
        const receipt = await tx.wait();
        return {
            status: "success",
            tx_hash: tx.hash,
            block_number: receipt.blockNumber,
            message: `Node ${address} penalized with risk ${risk} and penalty ${bp}bp`
        };
    }

    async checkNodeRiskStatus(address) {
        const risk = await this.contract.nodeRiskExposure(address);
        const penalty = await this.contract.penaltyBpPerNode(address);
        return {
            address,
            current_risk_exposure: risk.toString(),
            penalty_basis_points: penalty.toString()
        };
    }
}

// 3. Simulation (Mocking an LLM Client)
async function runDemo() {
    const server = new TrustManagerMCP();
    
    // Simulate: User asks "How is node 0x... performing?"
    // LLM decides to call "get_node_trust_info"
    const demoNode = "0x10AAe54E3F84C39C51936538b64C90c780315306"; // One of the active nodes
    
    console.log("--- Demo Step 1: Query Node Info ---");
    const info = await server.callTool("get_node_trust_info", { node_address: demoNode });
    console.log("Result:", JSON.stringify(info, null, 2));

    // Simulate: User says "This node is attacking! Slash it by 50%!"
    // LLM decides to call "report_malicious_activity"
    console.log("\n--- Demo Step 2: Report Malicious Activity ---");
    const report = await server.callTool("report_malicious_activity", {
        node_address: demoNode,
        risk_score: 80,
        penalty_bp: 5000, // 50%
        duration_seconds: 7200
    });
    console.log("Result:", JSON.stringify(report, null, 2));

    // Simulate: Verify status
    console.log("\n--- Demo Step 3: Verify New Status ---");
    const status = await server.callTool("check_node_risk_status", { node_address: demoNode });
    console.log("Result:", JSON.stringify(status, null, 2));
}

if (require.main === module) {
    runDemo().catch(console.error);
}

module.exports = { TOOLS, TrustManagerMCP };
