# Sepolia Testnet Complex Attack Simulation Report

**Date:** 2025-12-21
**Network:** Sepolia Testnet
**Total Nodes:** 19 (Historical + New Batch)
**Experiment Scale:** 12 Active Nodes in this session.

## Experiment Design
We expanded the scale to test **4 Distinct Behavioral Patterns** simultaneously to evaluate the contract's robustness against diverse attacks.

| Group | Nodes | Strategy | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **A. Honest** | 4 | Always 100% Success, <50ms | Max Trust (200) |
| **B. Oscillating** | 2 | Good -> Bad -> Good | Trust fluctuates, should recover slowly |
| **C. Stealth** | 2 | Marginal (85% Success, 450ms) | Trust degrades slowly, evades Blacklist |
| **D. Sybil** | 2+2 | Bad -> Abandon -> New Identity | New IDs should have clean history (Whitewashing) |

## Results Analysis (Based on Chain Data)

### 1. Honest Group (Baseline)
- **Status:** ✅ Perfect
- **Trust Value:** `200` (Max)
- **Observation:** The system correctly rewards consistent good behavior.

### 2. Stealth Attack (The "Grey Zone")
- **Nodes:** `0xeACd...`, `0xB2DF...`
- **Behavior:** 85% Success, 450ms Latency.
- **Trust Value:** `188`
- **Insight:** The trust dropped from 200 to 188.
- **Critical Finding:** The penalty for "mediocre" performance is mild. These nodes **successfully evaded the blacklist** (Threshold 80). This confirms that without an AI agent, "Stealth" attackers can maintain a respectable score while providing sub-optimal service.

### 3. Sybil / Whitewash Attack
- **Phase 1 (Old IDs):** `0x9317...`, `0x5C5e...`
    - Behaved maliciously (0% success).
    - Trust dropped to `118`. (Note: Not yet blacklisted because they had a good history in Round 1).
- **Phase 2 (New IDs):** `0xa80b...`, `0x75Fd...`
    - The attacker generated new wallets and registered.
    - **Trust Value:** `200` (After 1 round of good behavior).
- **Critical Finding:** The contract treats them as fresh, high-quality nodes. **Whitewashing is effective** against the raw contract logic. This validates the need for the "Graph-based" or "AI-based" defenses we discussed (analyzing registration timing or IP clustering).

### 4. Oscillating Attack
- **Nodes:** `0x366b...`, `0x98e2...`
- **Trust Value:** `200` (Recovered)
- **Observation:** They dipped during the bad round but recovered quickly in Round 3.
- **Insight:** The "Recovery Rate" might be too high. We may need to adjust `gamma` (History Weight) or implement a "Probation Period" where trust recovers slower than it falls.

## Conclusion & Recommendations
1.  **Scale:** Successfully managed ~20 nodes on Testnet.
2.  **Vulnerabilities Confirmed:**
    - **Stealth:** Needs stricter penalties for <90% success.
    - **Whitewashing:** Needs external identity binding or "Newcomer Probation".
    - **Oscillation:** Needs "Sticky Penalty" (trust rises slower than it drops).

## Next Steps
- **Visualize:** I have generated `network_state.csv` which can be plotted.
- **Defend:** Deploy the `ai_agent_detect.js` to flag the Sybil nodes (based on "New Node + High Activity" heuristics).
