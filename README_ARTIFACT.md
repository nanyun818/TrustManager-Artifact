# TrustManager: Artifact Reproduction Guide

This document explains what can be rerun directly from this repository, what requires external services, and how to execute the main artifact paths in a fair and reproducible way.

## 1. Reproduction Expectations

This repository supports three levels of reproduction:

- **Artifact inspection**: read the contracts, scripts, models, and committed data artifacts.
- **Component reruns**: rerun contract compilation, gas measurements, training scripts, and evaluation scripts on prepared datasets.
- **Extended reproduction**: rebuild larger datasets or rerun network-dependent workflows using external APIs or RPC endpoints.

It should not be interpreted as a one-click package for every final paper result.

## 2. Environment Setup

### Prerequisites

- Python 3.10+
- Node.js 18+

### Installation

1. Create and activate a virtual environment:

   ```bash
   python -m venv .venv
   .venv\Scripts\activate
   ```

2. Install dependencies:

   ```bash
   npm install
   pip install -r requirements.txt
   ```

3. Optional: prepare environment variables for data collection or testnet workflows:

   ```bash
   copy .env.example .env
   ```

   Fill only the keys required by the scripts you plan to run.

## 3. Data Availability

The repository includes several committed CSV/JSON artifacts that allow local inspection and some downstream reruns without fetching all upstream raw data again.

Examples include:

- `graph_features_dataset.csv`
- `graph_interactions.csv`
- `network_state.csv`
- `network_state.json`
- `node_risk_outputs.csv`

At the same time:

- some scripts expect a prepared file such as `out/multichain_dataset.csv`
- some rebuild paths depend on explorer APIs or RPC endpoints
- some pipeline scripts fall back to demo or synthetic data generation for inspection purposes

## 4. Preparing a Dataset

Several training and evaluation scripts expect:

```text
out/multichain_dataset.csv
```

Depending on your goal, you can reach that state in different ways.

### Option A: Use existing committed artifacts

This is the fastest path for code inspection and partial reruns. Inspect the committed CSV/JSON files and adapt paths if you want to feed them into a specific script.

### Option B: Regenerate a larger local scenario

Some local scripts are intended for simulated or controlled reruns. For example:

```bash
node scripts/bootstrap_large.js
```

This prepares large-scale contract-side state and simulation inputs, but it is not by itself a guaranteed drop-in replacement for every paper table.

### Option C: Rebuild data from external services

Scripts under `etl/` and several `scripts/` utilities can fetch or rebuild data using explorer APIs and RPC endpoints. This path is closer to extended reproduction but depends on external availability and credentials.

## 5. Recommended Execution Paths

### A. Smart contract compilation

```bash
npx hardhat compile
```

This verifies the Solidity contracts build locally.

### B. Lightweight baseline evaluation

Requires a prepared dataset in `out/multichain_dataset.csv`.

```bash
python scripts/evaluate_models.py
```

This script prints baseline metrics and produces a simple comparison over prepared features.

### C. Cross-validation style evaluation

Requires a prepared dataset in `out/multichain_dataset.csv`.

```bash
python scripts/run_rigorous_evaluation.py
```

This is a stronger artifact entry point for reproducing aggregated metrics on the prepared dataset.

### D. Graph-enhanced model training

Requires a prepared dataset in `out/multichain_dataset.csv`.

```bash
python scripts/train_gnn.py
```

### E. Advanced baseline comparison

Requires a prepared dataset in `out/multichain_dataset.csv`.

```bash
python scripts/train_advanced_baselines.py
```

### F. Graph ablation

Requires a prepared dataset in `out/multichain_dataset.csv`.

```bash
python scripts/run_graph_ablation.py
```

### G. Temporal-aware evaluation

Requires a prepared dataset in `out/multichain_dataset.csv`.

```bash
python scripts/train_temporal_rf.py
```

### H. External Forta-oriented validation

Requires a prepared Forta-style labeled dataset. By default:

```text
out/labeled_dataset_test.csv
```

Run:

```bash
python scripts/forta_external_validation.py
```

### I. Merkle proof gas measurement

```bash
npx hardhat run scripts/gas_prove_node_risk.js
```

This exercises the on-chain proof path and reports gas usage for `proveNodeRisk`.

## 6. External Services Required by Some Scripts

Depending on which scripts you use, you may need:

- `ETHERSCAN_API_KEY`
- `BSCSCAN_API_KEY`
- `POLYGONSCAN_API_KEY`
- `SEPOLIA_RPC_URL`
- a funded testnet account for deployment scripts

Network-dependent scripts should be treated as optional reproduction extensions, not as prerequisites for basic artifact inspection.

## 7. Determinism Notes

Several training and evaluation scripts fix seeds such as `random_state=42`, but exact outputs can still vary across:

- library versions
- regenerated datasets
- external data source freshness
- hardware and execution environment

For artifact evaluation, prefer comparing the **workflow and output shape** first, then compare numeric results within reasonable tolerance when datasets or dependencies differ.

## 8. Directory Notes

- `contracts/`: core Solidity logic
- `scripts/`: training, evaluation, simulation, deployment, and utility scripts
- `models/`: lightweight JSON model artifacts
- `etl/`: data extraction helpers
- `forta-bot/`: monitoring bot implementation

## 9. Practical Interpretation

The fairest summary of this repository is:

- the codebase is substantive and not a placeholder
- the smart contract and several evaluation components are directly inspectable and runnable
- full end-to-end paper-style reproduction still requires additional setup, data preparation, and external connectivity
