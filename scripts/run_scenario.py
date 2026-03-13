import os
import json
import time
import argparse
from dataclasses import dataclass
from typing import Dict, List, Optional

from web3 import Web3
from web3.contract import Contract
from dotenv import load_dotenv
import matplotlib.pyplot as plt
from solcx import install_solc, set_solc_version, compile_standard
import statistics
from typing import Optional

try:
    from eth_account.signers.local import LocalAccount  # type: ignore
except Exception:
    LocalAccount = None  # fallback typing when eth-account not available


ARTIFACT_METADATA_PATH = os.path.join("artifacts", "TrustManager_metadata.json")
CONTRACT_SOURCE_PATH = "TrustManager.sol"

# Context presets for weights and lambda (sum of weights = 10000; 0<=lambda<=10000)
CONTEXT_PRESETS = {
    "b2c": {"weights": {"alpha": 5000, "beta": 3000, "gamma": 2000}, "lambda": 6000},
    "c2c": {"weights": {"alpha": 4000, "beta": 2000, "gamma": 4000}, "lambda": 8000},
    "b2b": {"weights": {"alpha": 6000, "beta": 3000, "gamma": 1000}, "lambda": 5000},
}


@dataclass
class NodeDef:
    label: str
    address: str


def load_metadata_abi(path: str) -> List[dict]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    abi = data.get("output", {}).get("abi")
    if not abi:
        raise RuntimeError("ABI not found in metadata. Please compile contract in Remix to update artifacts/TrustManager_metadata.json")
    return abi


def load_scenario(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def connect_web3(provider_url: str) -> Web3:
    w3 = Web3(Web3.HTTPProvider(provider_url))
    if not w3.is_connected():
        raise RuntimeError(f"Cannot connect to provider: {provider_url}")
    return w3


def _get_signer(w3: Web3) -> Optional["LocalAccount"]:
    """Return signer from PRIVATE_KEY when provider has no local accounts.
    If PRIVATE_KEY is not set, return None and rely on local unlocked accounts.
    """
    pk = os.environ.get("PRIVATE_KEY")
    if pk:
        try:
            return w3.eth.account.from_key(pk)
        except Exception:
            raise RuntimeError("Invalid PRIVATE_KEY. Check your .env setting.")
    return None


def _send_or_sign(w3: Web3, tx: dict, signer: Optional["LocalAccount"]) -> str:
    """Send transaction using local account or sign with provided private key."""
    if signer:
        signed = w3.eth.account.sign_transaction(tx, signer.key)  # type: ignore[attr-defined]
        tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
    else:
        tx_hash = w3.eth.send_transaction(tx)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    return receipt.transactionHash.hex()


def deploy_contract(w3: Web3, abi: List[dict], bytecode: Optional[str], gas_price_wei: Optional[int] = None) -> str:
    if not bytecode:
        raise RuntimeError("Bytecode not provided. Compile locally or deploy in Remix, or include bytecode in scenario.json.transactions[0].record.bytecode")
    signer = _get_signer(w3)
    acct = signer.address if signer else w3.eth.accounts[0]
    contract = w3.eth.contract(abi=abi, bytecode=bytecode)
    # Explicit gas configuration to avoid Ganache gas estimate issues
    tx = contract.constructor().build_transaction({
        "from": acct,
        "nonce": w3.eth.get_transaction_count(acct),
        "gas": 6_000_000,
        "gasPrice": gas_price_wei or w3.to_wei(2, "gwei"),
        "chainId": w3.eth.chain_id,
    })
    if signer:
        signed = w3.eth.account.sign_transaction(tx, signer.key)  # type: ignore[attr-defined]
        tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    else:
        tx_hash = w3.eth.send_transaction(tx)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    return receipt.contractAddress


def contract_at(w3: Web3, abi: List[dict], address: str) -> Contract:
    return w3.eth.contract(address=Web3.to_checksum_address(address), abi=abi)


def ensure_nodes_registered(w3: Web3, contract: Contract, nodes: List[NodeDef], payer_mode: str = "admin", gas_price_wei: Optional[int] = None):
    signer = _get_signer(w3)
    for node in nodes:
        try:
            current = contract.functions.getTrustValue(Web3.to_checksum_address(node.address)).call()
        except Exception:
            current = None
        # If trust value returns 0 and node might not be active, try to register
        # Registration is idempotent guarded by require(!nodes[_node].isActive)
        try:
            accounts = w3.eth.accounts
            from_acct = (signer.address if signer else accounts[0])
            if payer_mode == "per_node" and not signer:
                from_acct = next((acct for acct in accounts if acct.lower() == node.address.lower()), accounts[0])
            tx = contract.functions.registerNode(Web3.to_checksum_address(node.address)).build_transaction({
                "from": from_acct,
                "nonce": w3.eth.get_transaction_count(from_acct),
                "gas": 600000,
                "gasPrice": gas_price_wei or w3.to_wei(2, "gwei"),
                "chainId": w3.eth.chain_id,
            })
            if signer:
                signed = w3.eth.account.sign_transaction(tx, signer.key)  # type: ignore[attr-defined]
                tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
                w3.eth.wait_for_transaction_receipt(tx_hash)
            else:
                tx_hash = w3.eth.send_transaction(tx)
                w3.eth.wait_for_transaction_receipt(tx_hash)
            print(f"Registered {node.label} at {node.address}")
        except Exception as e:
            # Likely already registered
            print(f"Register skip {node.label}: {e}")


def run_steps(w3: Web3, contract: Contract, nodes_by_label: Dict[str, NodeDef], steps: List[dict], payer_mode: str = "admin", gas_price_wei: Optional[int] = None) -> (Dict[str, List[float]], List[dict]):
    series: Dict[str, List[float]] = {label: [] for label in nodes_by_label.keys()}
    records: List[dict] = []
    signer = _get_signer(w3)
    for idx, step in enumerate(steps):
        action = step.get("action")
        rec: Dict[str, Optional[int]] = {"step": idx + 1, "action": action}
        if action == "register":
            label = step["node"]
            addr = nodes_by_label[label].address
            try:
                accounts = w3.eth.accounts
                from_acct = accounts[0]
                if payer_mode == "per_node":
                    from_acct = next((acct for acct in accounts if acct.lower() == addr.lower()), accounts[0])
                tx = contract.functions.registerNode(Web3.to_checksum_address(addr)).transact({"from": from_acct, "gasPrice": gas_price_wei or w3.to_wei(2, "gwei")})
                w3.eth.wait_for_transaction_receipt(tx)
                print(f"[{idx}] register {label}")
            except Exception as e:
                print(f"[{idx}] register {label} skipped: {e}")
            rec.update({"node": label})
        elif action == "metrics":
            label = step["node"]
            addr = nodes_by_label[label].address
            sr = int(step["successRate"])  # 0-100
            rt = int(step["responseTime"])  # ms
            ot = int(step.get("onlineTime", 0))  # seconds increment
            accounts = w3.eth.accounts
            from_acct = (signer.address if signer else accounts[0])
            if payer_mode == "per_node" and not signer:
                from_acct = next((acct for acct in accounts if acct.lower() == addr.lower()), accounts[0])
            tx = contract.functions.updateNodeMetrics(Web3.to_checksum_address(addr), sr, rt, ot).build_transaction({
                "from": from_acct,
                "nonce": w3.eth.get_transaction_count(from_acct),
                "gas": 800000,
                "gasPrice": gas_price_wei or w3.to_wei(2, "gwei"),
                "chainId": w3.eth.chain_id,
            })
            if signer:
                signed = w3.eth.account.sign_transaction(tx, signer.key)  # type: ignore[attr-defined]
                tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
                w3.eth.wait_for_transaction_receipt(tx_hash)
            else:
                tx_hash = w3.eth.send_transaction(tx)
                w3.eth.wait_for_transaction_receipt(tx_hash)
            print(f"[{idx}] metrics {label}: successRate={sr} responseTime={rt} online+={ot}")
            rec.update({"node": label, "successRate": sr, "responseTime": rt, "onlineTime": ot})
        elif action == "recommend":
            target_label = step["target"]
            recommender_label = step["from"]
            target_addr = nodes_by_label[target_label].address
            recommend_value = int(step["value"])  # 0-200
            weight = int(step.get("weight", 50))  # 1-100
            # send from recommender account if available
            accounts = w3.eth.accounts
            # On remote networks, use signer as sender; this records recommender as signer address
            from_acct = (signer.address if signer else next((acct for acct in accounts if acct.lower() == nodes_by_label[recommender_label].address.lower()), accounts[0]))
            tx = contract.functions.addRecommendation(Web3.to_checksum_address(target_addr), recommend_value, weight).build_transaction({
                "from": from_acct,
                "nonce": w3.eth.get_transaction_count(from_acct),
                "gas": 600000,
                "gasPrice": gas_price_wei or w3.to_wei(2, "gwei"),
                "chainId": w3.eth.chain_id,
            })
            if signer:
                signed = w3.eth.account.sign_transaction(tx, signer.key)  # type: ignore[attr-defined]
                tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
                w3.eth.wait_for_transaction_receipt(tx_hash)
            else:
                tx_hash = w3.eth.send_transaction(tx)
                w3.eth.wait_for_transaction_receipt(tx_hash)
            print(f"[{idx}] recommend {recommender_label} -> {target_label}: value={recommend_value} weight={weight}")
            rec.update({"from": recommender_label, "target": target_label, "value": recommend_value, "recWeight": weight})
        elif action == "weights":
            alpha = int(step["alpha"])  # sum alpha+beta+gamma=10000
            beta = int(step["beta"]) 
            gamma = int(step["gamma"]) 
            from_acct = (signer.address if signer else w3.eth.accounts[0])
            tx = contract.functions.updateWeights(alpha, beta, gamma).build_transaction({
                "from": from_acct,
                "nonce": w3.eth.get_transaction_count(from_acct),
                "gas": 600000,
                "gasPrice": gas_price_wei or w3.to_wei(2, "gwei"),
                "chainId": w3.eth.chain_id,
            })
            if signer:
                signed = w3.eth.account.sign_transaction(tx, signer.key)  # type: ignore[attr-defined]
                tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
                w3.eth.wait_for_transaction_receipt(tx_hash)
            else:
                tx_hash = w3.eth.send_transaction(tx)
                w3.eth.wait_for_transaction_receipt(tx_hash)
            print(f"[{idx}] update weights alpha={alpha} beta={beta} gamma={gamma}")
            rec.update({"alpha": alpha, "beta": beta, "gamma": gamma})
        elif action == "lambda":
            lam = int(step["lambda"])  # 0..10000
            from_acct = (signer.address if signer else w3.eth.accounts[0])
            tx = contract.functions.updateLambda(lam).build_transaction({
                "from": from_acct,
                "nonce": w3.eth.get_transaction_count(from_acct),
                "gas": 600000,
                "gasPrice": gas_price_wei or w3.to_wei(2, "gwei"),
                "chainId": w3.eth.chain_id,
            })
            if signer:
                signed = w3.eth.account.sign_transaction(tx, signer.key)  # type: ignore[attr-defined]
                tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
                w3.eth.wait_for_transaction_receipt(tx_hash)
            else:
                tx_hash = w3.eth.send_transaction(tx)
                w3.eth.wait_for_transaction_receipt(tx_hash)
            print(f"[{idx}] update lambda={lam}")
            rec.update({"lambda": lam})
        else:
            print(f"[{idx}] unknown action: {action}")

        # after each step, sample trust for all nodes
        for label, node in nodes_by_label.items():
            try:
                tv = contract.functions.getTrustValue(Web3.to_checksum_address(node.address)).call()
            except Exception:
                tv = 0
            series[label].append(tv)
            rec[f"trust_{label}"] = tv

        records.append(rec)

    return series, records


def visualize_series(series: Dict[str, List[float]], output_path: str):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    plt.figure(figsize=(10, 6))
    for label, values in series.items():
        plt.plot(range(1, len(values) + 1), values, label=label)
    plt.xlabel("Step")
    plt.ylabel("Trust Value")
    plt.title("Node Trust Value Evolution")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(output_path)
    print(f"Saved plot to {output_path}")


def compute_stats(series: Dict[str, List[float]], records: List[dict], steady_window: int = 5, band_threshold: float = 2.0) -> List[dict]:
    """Compute per-node summary statistics.
    - convergence_step: earliest step where last `steady_window` trust values fall within `band_threshold` band
    - steady_mean/variance: mean and population variance over last `steady_window` values
    - max_drawdown: max peak-to-trough decline over the series
    - metrics_gain/recommend_gain: sum of deltas during steps with corresponding actions
    """
    stats_rows: List[dict] = []
    total_steps = len(records)
    actions = [r.get("action") for r in records]
    for label, values in series.items():
        if not values:
            continue
        # deltas aligned with actions at step index i (delta from i-1 -> i)
        deltas = [values[i] - values[i - 1] for i in range(1, len(values))]
        metrics_gain = sum(deltas[i - 1] for i in range(1, len(values)) if actions[i - 1] == "metrics")
        recommend_gain = sum(deltas[i - 1] for i in range(1, len(values)) if actions[i - 1] == "recommend")

        tail = values[-steady_window:] if len(values) >= steady_window else values
        steady_mean = statistics.mean(tail) if tail else 0.0
        steady_var = statistics.pvariance(tail) if len(tail) > 1 else 0.0

        # convergence step: first step where window width within band
        conv_step: Optional[int] = None
        if len(values) >= steady_window:
            for t in range(steady_window - 1, len(values)):
                window = values[t - steady_window + 1 : t + 1]
                if max(window) - min(window) <= band_threshold:
                    conv_step = t + 1  # 1-indexed
                    break

        # max drawdown
        peak = values[0]
        mdd = 0.0
        for v in values:
            peak = max(peak, v)
            mdd = max(mdd, peak - v)

        stats_rows.append({
            "node": label,
            "steps": total_steps,
            "initial": values[0],
            "final": values[-1],
            "gain_total": values[-1] - values[0],
            "convergence_step": conv_step,
            "steady_mean": round(steady_mean, 3),
            "steady_variance": round(steady_var, 3),
            "max_drawdown": round(mdd, 3),
            "metrics_gain": round(metrics_gain, 3),
            "recommend_gain": round(recommend_gain, 3),
            "metrics_count": actions.count("metrics"),
            "recommend_count": actions.count("recommend"),
        })

    return stats_rows


def compile_contract_locally(source_path: str, solc_version: str = "0.8.19") -> Dict[str, str]:
    if not os.path.exists(source_path):
        raise RuntimeError(f"Contract source not found: {source_path}")
    install_solc(solc_version)
    set_solc_version(solc_version)
    with open(source_path, "r", encoding="utf-8") as f:
        source = f.read()
    compiled = compile_standard(
        {
            "language": "Solidity",
            "sources": {"TrustManager.sol": {"content": source}},
            "settings": {
                "outputSelection": {"*": {"*": ["abi", "evm.bytecode.object"]}},
                "evmVersion": "berlin"
            },
        }
    )
    # Find contract outputs
    contracts = compiled.get("contracts", {}).get("TrustManager.sol", {})
    if not contracts:
        raise RuntimeError("Compilation did not produce contract outputs. Check the Solidity source.")
    # Assume primary contract named TrustManager
    artifact = contracts.get("TrustManager")
    if not artifact:
        # Fallback: pick the first contract
        name, artifact = next(iter(contracts.items()))
    abi = artifact.get("abi")
    bytecode = artifact.get("evm", {}).get("bytecode", {}).get("object")
    if not abi or not bytecode:
        raise RuntimeError("ABI or bytecode missing from local compilation.")
    return {"abi": abi, "bytecode": bytecode}


def main():
    parser = argparse.ArgumentParser(description="Run TrustManager scenario automation")
    parser.add_argument("--auto-compile", action="store_true", help="Compile TrustManager.sol locally to obtain ABI & bytecode")
    parser.add_argument("--auto-deploy", action="store_true", help="Deploy contract automatically if no address provided")
    parser.add_argument("--fill-nodes", type=int, default=0, help="Auto-fill N nodes from Ganache accounts if nodes are empty or zero addresses")
    parser.add_argument("--scenario", type=str, default=os.path.join(os.path.dirname(__file__), "..", "scenario.sample.json"), help="Path to scenario file")
    parser.add_argument("--topology", type=str, choices=["star", "ring", "small_world"], help="Select recommendation network topology: star, ring, small_world")
    parser.add_argument("--size", type=int, choices=[10, 20, 50], help="Select node size corresponding to nodes_10/nodes_20/nodes_50 in scenario")
    parser.add_argument("--context", type=str, choices=["b2c", "c2c", "b2b", "custom"], help="Apply context preset for weights & lambda or provide custom values")
    parser.add_argument("--alpha", type=int, help="Custom alpha when --context=custom; ensure alpha+beta+gamma=10000")
    parser.add_argument("--beta", type=int, help="Custom beta when --context=custom; ensure alpha+beta+gamma=10000")
    parser.add_argument("--gamma", type=int, help="Custom gamma when --context=custom; ensure alpha+beta+gamma=10000")
    parser.add_argument("--lambda-val", dest="lambda_val", type=int, help="Custom lambda (0..10000) when --context=custom")
    parser.add_argument("--export-csv", type=str, help="Export per-step trust series and metadata to CSV")
    parser.add_argument("--payer", type=str, choices=["admin", "per_node"], default="admin", help="Transaction payer: admin uses account[0]; per_node uses each node's account for node ops")
    parser.add_argument("--gas-price", type=int, help="Gas price in gwei for all transactions (default 2 gwei)")
    parser.add_argument("--export-stats", type=str, help="Export per-node summary statistics (convergence, steady-state, drawdown, phase gains) to CSV")
    args = parser.parse_args()

    load_dotenv()
    scenario_path = os.environ.get("SCENARIO_PATH", args.scenario)
    scenario = load_scenario(scenario_path)

    provider_url = scenario.get("provider_url") or os.environ.get("PROVIDER_URL") or "http://127.0.0.1:7545"
    w3 = connect_web3(provider_url)
    print(f"Connected to {provider_url}; accounts: {w3.eth.accounts[:5]}")

    abi: List[dict] = []
    bytecode: Optional[str] = None

    # Prefer local compile when requested
    if args.auto_compile:
        compiled = compile_contract_locally(CONTRACT_SOURCE_PATH, solc_version="0.8.19")
        abi = compiled["abi"]
        bytecode = compiled["bytecode"]
        print("Compiled locally: ABI & bytecode loaded.")
    else:
        # fallback to metadata abi
        abi = load_metadata_abi(ARTIFACT_METADATA_PATH)
        # try to obtain bytecode from scenario transactions
        try:
            txs = scenario.get("transactions", [])
            if txs:
                bytecode = txs[0].get("record", {}).get("bytecode")
        except Exception:
            pass

    contract_address = scenario.get("contract_address") or os.environ.get("CONTRACT_ADDRESS")

    gas_price_wei = w3.to_wei(args.gas_price if args.gas_price else 2, "gwei")

    if not contract_address and args.auto_deploy:
        print("No CONTRACT_ADDRESS; attempting automatic deployment...")
        if not bytecode:
            raise RuntimeError("Bytecode not available. Use --auto-compile or provide scenario transactions with bytecode.")
        contract_address = deploy_contract(w3, abi, bytecode, gas_price_wei=gas_price_wei)
        print(f"Deployed TrustManager at {contract_address}")
    elif not contract_address:
        raise RuntimeError("No contract address provided. Use --auto-deploy with bytecode or set CONTRACT_ADDRESS in .env")

    contract = contract_at(w3, abi, contract_address)

    # Select nodes and steps based on --topology/--size
    selected_steps: Optional[List[dict]] = None
    selected_nodes_cfg: Optional[List[dict]] = None
    if args.size or args.topology:
        size = args.size if args.size else 10
        # nodes key: nodes (10) or nodes_20 / nodes_50
        nodes_key = "nodes" if size == 10 else f"nodes_{size}"
        networks = scenario.get("networks", {})
        topo = args.topology if args.topology else "star"
        network_key = f"{topo}_{size}"
        net_entry = networks.get(network_key)
        if net_entry:
            # Use nodes_ref when provided; else use nodes_key
            ref_key = net_entry.get("nodes_ref", nodes_key)
            selected_nodes_cfg = scenario.get(ref_key) or scenario.get("nodes", [])
            selected_steps = net_entry.get("steps") or scenario.get("steps", [])
            print(f"Using topology={topo}, size={size} via networks['{network_key}'] and nodes_ref='{ref_key}'.")
        else:
            selected_nodes_cfg = scenario.get(nodes_key) or scenario.get("nodes", [])
            selected_steps = scenario.get("steps", [])
            print(f"Using topology={topo}, size={size} with nodes_key='{nodes_key}' (no networks entry found).")
    else:
        selected_nodes_cfg = scenario.get("nodes", [])
        selected_steps = scenario.get("steps", [])

    # Prepare nodes
    nodes: List[NodeDef] = [NodeDef(label=n["label"], address=n["address"]) for n in selected_nodes_cfg]

    # Auto-fill nodes if requested or zero-address placeholders provided
    if (args.fill_nodes and args.fill_nodes > 0) or (nodes and all(int(n.address, 16) == 0 for n in nodes)):
        # If size is provided and fill-nodes not set, use size
        count = args.fill_nodes if args.fill_nodes > 0 else (args.size if args.size else len(nodes))
        accounts = w3.eth.accounts
        if count > len(accounts):
            raise RuntimeError(f"Requested {count} nodes but only {len(accounts)} accounts available in Ganache")
        if nodes:
            # Replace zero addresses
            for i in range(min(count, len(nodes))):
                print(f"Filling {nodes[i].label} with {accounts[i]}")
                nodes[i].address = accounts[i]
        else:
            # Create default labels
            nodes = [NodeDef(label=f"Node{i+1}", address=accounts[i]) for i in range(count)]

    nodes_by_label: Dict[str, NodeDef] = {n.label: n for n in nodes}

    # optional: pre-register
    if scenario.get("pre_register", True):
        ensure_nodes_registered(w3, contract, nodes, payer_mode=args.payer, gas_price_wei=gas_price_wei)

    steps = selected_steps or []

    # Apply context presets at the beginning of steps when provided
    if args.context:
        if args.context == "custom":
            # Validate provided custom values
            if args.alpha is None or args.beta is None or args.gamma is None or args.lambda_val is None:
                raise RuntimeError("--context=custom requires --alpha --beta --gamma --lambda-val")
            total = int(args.alpha) + int(args.beta) + int(args.gamma)
            if total != 10000:
                raise RuntimeError("alpha+beta+gamma must equal 10000 for custom context")
            if not (0 <= int(args.lambda_val) <= 10000):
                raise RuntimeError("lambda must be between 0 and 10000")
            context_steps = [
                {"action": "weights", "alpha": int(args.alpha), "beta": int(args.beta), "gamma": int(args.gamma)},
                {"action": "lambda", "lambda": int(args.lambda_val)},
            ]
        else:
            preset = CONTEXT_PRESETS.get(args.context)
            w = preset["weights"]
            context_steps = [
                {"action": "weights", "alpha": w["alpha"], "beta": w["beta"], "gamma": w["gamma"]},
                {"action": "lambda", "lambda": preset["lambda"]},
            ]
        steps = context_steps + steps

    series, records = run_steps(w3, contract, nodes_by_label, steps, payer_mode=args.payer, gas_price_wei=gas_price_wei)

    viz = scenario.get("visualize", {"enabled": True, "output": os.path.join("plots", "trust_trend.png")})
    if viz.get("enabled", True):
        visualize_series(series, viz.get("output", os.path.join("plots", "trust_trend.png")))

    # Export CSV if requested
    if args.export_csv:
        os.makedirs(os.path.dirname(args.export_csv), exist_ok=True)
        # Determine ordered trust columns by node label
        trust_cols = [f"trust_{label}" for label in sorted(series.keys())]
        # Construct header in a stable order
        base_cols = [
            "step", "action", "node", "from", "target",
            "successRate", "responseTime", "onlineTime",
            "value", "recWeight", "alpha", "beta", "gamma", "lambda",
        ]
        header = base_cols + trust_cols
        import csv
        with open(args.export_csv, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=header)
            writer.writeheader()
            for r in records:
                # Ensure only header keys are written
                row = {k: r.get(k) for k in header}
                writer.writerow(row)
        print(f"Exported CSV to {args.export_csv}")

    # Export summary statistics if requested
    if args.export_stats:
        stats_rows = compute_stats(series, records, steady_window=5, band_threshold=2.0)
        if stats_rows:
            os.makedirs(os.path.dirname(args.export_stats), exist_ok=True)
            import csv
            header = list(stats_rows[0].keys())
            with open(args.export_stats, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=header)
                writer.writeheader()
                for row in stats_rows:
                    writer.writerow(row)
            print(f"Exported stats CSV to {args.export_stats}")


if __name__ == "__main__":
    main()