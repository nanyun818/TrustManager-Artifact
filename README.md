# TrustManager: Resilient and Explainable Trust Management for Blockchain

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Artifact Evaluation](https://img.shields.io/badge/Artifact-Available-blue.svg)](https://github.com/nanyun818/TrustManager-Artifact)

This repository contains the experimental artifacts for **TrustManager**, a blockchain trust-management framework that combines graph-enhanced risk features, lightweight ML models, decentralized oracle voting, and on-chain enforcement.

The repository is intended to support **inspection, partial reruns, and artifact evaluation**. It is **not** a single-command reproduction package for every paper result. Some experiments depend on external APIs, RPC endpoints, or regenerated datasets.

---

## What Is Included

- `contracts/`: Solidity implementations of the TrustManager contract and Merkle-root based verification contract.
- `scripts/`: data preparation, model training, evaluation, ablation, gas measurement, simulation, and testnet utilities.
- `forta-bot/`: a Forta-style monitoring bot implementation.
- `etl/`: extraction utilities for explorer or on-chain data collection.
- `models/`: lightweight pre-trained JSON model artifacts used by the included demo/inference scripts.
- committed data artifacts such as `graph_features_dataset.csv`, `graph_interactions.csv`, `network_state.csv`, and generated JSON/CSV outputs that help inspect the pipeline without rebuilding everything from scratch.

Note: the paper source is maintained separately and is not required to inspect or run the code in this repository.

---

## Reproducibility Scope

Use the following tiers when interpreting this artifact:

- **Tier 1: Code inspection**. You can review the smart contracts, scripts, model files, and intermediate artifacts directly from the repository.
- **Tier 2: Local reruns**. You can rerun several scripts on included or regenerated data, and you can compile/deploy the contracts locally.
- **Tier 3: Full paper-style reproduction**. This may require additional API keys, RPC endpoints, longer-running data regeneration, and environment-specific setup.

In other words, this repository is closer to a **research artifact with runnable components** than a turnkey "download and reproduce every final number" package.

---

## Quick Start

### 1. Install dependencies

```bash
git clone https://github.com/nanyun818/TrustManager-Artifact.git
cd TrustManager-Artifact
npm install
pip install -r requirements.txt
```

### 2. Compile the contracts locally

```bash
npx hardhat compile
```

### 3. Run a lightweight evaluation path

If you already have `out/multichain_dataset.csv`, you can run:

```bash
python scripts/evaluate_models.py
python scripts/run_rigorous_evaluation.py
```

If the dataset is missing in `out/`, regenerate or prepare it first using the scripts described in `README_ARTIFACT.md`.

---

## Environment Requirements

### Software

- **Node.js**: 18+
- **Python**: 3.10+
- **Solidity / Hardhat**: contract compilation uses Hardhat and `solc`

### Hardware

- **Local contract compilation / demo scripts**: standard developer machine is sufficient.
- **Larger graph-processing experiments**: more memory is recommended; the original full-scale transaction graph workflow may require substantially more RAM than the quick-start path.

---

## External Dependencies

Some scripts require external credentials or network access:

- explorer APIs such as `ETHERSCAN_API_KEY`, `BSCSCAN_API_KEY`, and `POLYGONSCAN_API_KEY`
- RPC endpoints such as `SEPOLIA_RPC_URL`
- optional `.env` configuration for testnet deployment and live data collection

You can start from `.env.example` and only fill the keys needed by the scripts you plan to run.

---

## Dataset Notes

This repository contains **committed intermediate datasets and generated artifacts**, but not every raw upstream crawl used during the broader research workflow.

- included files help users inspect graph construction, labeled transactions, and downstream outputs without starting from zero
- some "real data" rebuild scripts still require explorer APIs or external sources
- some scripts also support synthetic or demo-style generation for pipeline inspection

Please treat the repository as providing a **practical artifact subset** plus regeneration code, rather than a mirrored dump of all upstream raw traces.

---

## Paper Result Mapping

The following commands are the closest entry points for rerunning major result categories:

| Result Category | Script |
| :--- | :--- |
| Baseline comparison on prepared dataset | `python scripts/evaluate_models.py` |
| General metric report / cross-validation | `python scripts/run_rigorous_evaluation.py` |
| Graph-enhanced model training | `python scripts/train_gnn.py` |
| Advanced baselines | `python scripts/train_advanced_baselines.py` |
| Graph ablation | `python scripts/run_graph_ablation.py` |
| Temporal-aware model | `python scripts/train_temporal_rf.py` |
| Forta external validation | `python scripts/forta_external_validation.py` |
| Merkle proof gas measurement | `npx hardhat run scripts/gas_prove_node_risk.js` |

For a more detailed artifact-oriented workflow, see `README_ARTIFACT.md`.

---

## Citation

If you use this code or dataset in your research, please cite the accompanying paper:

```bibtex
@inproceedings{zhang2026trustmanager,
  title={TrustManager: Resilient and Explainable Trust Management for Blockchain Networks via Hybrid AI-Oracle Consensus},
  author={Anonymous Authors},
  booktitle={Proceedings of the XXth International Conference on XXX (XXX '26)},
  year={2026}
}
```

---

## License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE).

## Contact

For questions about the artifact, please open an issue in this repository.
