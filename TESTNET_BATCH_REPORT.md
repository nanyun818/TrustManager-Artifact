# Sepolia Testnet Batch Simulation Report

**Date:** 2025-12-21
**Network:** Sepolia Testnet
**Contract:** `0x6D3fef1582b4d58c356b35Dd44446dF783666Ff0`

## Overview
A "Mini-Batch" simulation was executed to validate the TrustManager contract with multiple concurrent nodes (Honest vs Malicious) on a public testnet.

## Participants
- **Honest Nodes (3):**
  - `0xb458...`
  - `0x8238...`
  - `0x2B8F...`
- **Malicious Nodes (2):**
  - `0x90D2...`
  - `0x5554...`

## Execution Phases

### Phase 1: Registration
- **Status:** ✅ Success
- All 5 nodes were successfully registered on-chain.
- **Gas Used:** ~0.0001 ETH per registration.

### Phase 2: Trust Building (Round 1)
- **Action:** All nodes performed high-quality interactions (Success: 100%, Latency: 50ms).
- **Result:**
  - All nodes reached **Trust Value: 200**.
  - Verified the reward logic works correctly on-chain.

### Phase 3: Attack Scenario (Round 2)
- **Honest Nodes:** Continued good behavior.
- **Malicious Nodes:**
  - Simulated failure (Success: 10%, Latency: 5000ms).
  - **Result:** Trust dropped from **200 → 126**.
  - **Observation:** The penalty mechanism effectively degraded the trust score immediately after bad behavior.

## Key Findings
1. **Multi-Node Logic:** The contract correctly handles independent state for multiple nodes.
2. **Gas Efficiency:** The batch of ~15 transactions consumed less than 0.01 ETH, making it feasible for larger testnet trials.
3. **Trust Dynamics:** The "Drop" (Penalty) is sharp enough to be effective but didn't immediately blacklist (Threshold < 80) because the nodes had built up a "buffer" in Round 1. This confirms the system favors established nodes but punishes them for degradation.

## Next Steps
- View these transactions on Etherscan to see the "Burst" of activity.
- The contract is ready for integration with the frontend dashboard.
