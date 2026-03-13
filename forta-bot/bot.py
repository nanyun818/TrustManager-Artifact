import json
import os
import argparse
from typing import Dict, Tuple, Set, List, Any
import math

try:
    from forta_agent import (
        Finding,
        FindingType,
        FindingSeverity,
        TransactionEvent,
    )
except Exception:
    class FindingSeverity:
        Critical = "Critical"
        High = "High"
        Medium = "Medium"
        Low = "Low"
        Info = "Info"

    class FindingType:
        Suspicious = "Suspicious"
        Degraded = "Degraded"

    class Finding(dict):
        pass

    class TransactionEvent:
        pass
from web3 import Web3
from eth_utils import to_checksum_address
from dotenv import load_dotenv


# In-memory recent approvals tracking: (owner, spender, token) -> last_block, count
recent_approvals: Dict[Tuple[str, str, str], Tuple[int, int]] = {}
recent_block_owners_stables: Dict[int, Dict[str, Set[str]]] = {}
recent_transfers_window: Dict[str, Dict[int, int]] = {}
recent_fanout_window: Dict[str, Dict[int, Set[str]]] = {}
recent_net_flow_window: Dict[str, Dict[int, float]] = {}

CONFIG: Dict = {}
KNOWN_SAFE_SPENDERS: Set[str] = set()
STABLECOINS: Set[str] = set()
KNOWN_PERMIT2: Set[str] = set()
PERMIT_SELECTORS: Set[str] = set()
KNOWN_BRIDGES: Set[str] = set()
MODEL: Dict[str, Any] = {}

web3 = None


def _strip_json_comments(text: str) -> str:
    # Remove // line comments for permissive JSON config
    lines = []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith('//'):
            continue
        # remove inline // comments
        if '//' in line:
            idx = line.find('//')
            line = line[:idx]
        lines.append(line)
    return '\n'.join(lines)

def _load_config():
    global CONFIG, KNOWN_SAFE_SPENDERS, STABLECOINS, KNOWN_PERMIT2, PERMIT_SELECTORS, KNOWN_BRIDGES
    cfg_path = os.path.join(os.path.dirname(__file__), 'config.json')
    with open(cfg_path, 'r', encoding='utf-8') as f:
        CONFIG = json.load(f)
    KNOWN_SAFE_SPENDERS = set([addr.lower() for addr in CONFIG.get('known_safe_spenders', [])])
    STABLECOINS = set([addr.lower() for addr in CONFIG.get('stablecoins', [])])
    KNOWN_PERMIT2 = set([addr.lower() for addr in CONFIG.get('known_permit2', [])])
    PERMIT_SELECTORS = set([sel.lower() for sel in CONFIG.get('permit_selectors', [])])
    KNOWN_BRIDGES = set([addr.lower() for addr in CONFIG.get('known_bridges', [])])
    try:
        env_br = os.getenv('KNOWN_BRIDGES', '')
        if env_br:
            extra = [a.strip().lower() for a in env_br.split(',') if a.strip()]
            KNOWN_BRIDGES.update(extra)
    except Exception:
        pass

def _load_model():
    global MODEL
    model_path = CONFIG.get('model_path', None) or os.path.join(os.path.dirname(__file__), '..', 'models', 'logreg.json')
    enable_model = bool(CONFIG.get('enable_model', False))
    if not enable_model:
        MODEL = {}
        return
    try:
        with open(model_path, 'r', encoding='utf-8') as f:
            MODEL = json.load(f)
    except Exception:
        MODEL = {}


def _init_web3():
    global web3
    # Prefer env RPC_URL, else config, else localhost
    rpc_url = os.getenv('RPC_URL')
    if not rpc_url:
        try:
            primary = CONFIG.get('rpc_url_primary')
            backup = CONFIG.get('rpc_url_backup')
            rpc_url = primary or backup
        except Exception:
            rpc_url = None
    web3 = Web3(Web3.HTTPProvider(rpc_url or "http://localhost:8545"))


def initialize():
    load_dotenv()
    _load_config()
    _init_web3()
    _load_model()


def _topic_hex(text_sig: str) -> str:
    return Web3.keccak(text=text_sig).hex()


APPROVAL_TOPIC = _topic_hex("Approval(address,address,uint256)")
TRANSFER_TOPIC = _topic_hex("Transfer(address,address,uint256)")


def _addr_from_topic(topic_hex: str) -> str:
    # topics are 32-byte values; address is right-encoded in last 20 bytes
    return to_checksum_address('0x' + topic_hex[-40:])


def _is_unlimited(value_hex: str) -> bool:
    try:
        value_int = int(value_hex, 16)
        return value_int == (2 ** 256 - 1)
    except Exception:
        return False


def _is_eoa(address: str) -> bool:
    try:
        code = web3.eth.get_code(address)
        return code == b'' or code == b'0x' or len(code) == 0
    except Exception:
        # If RPC unavailable, conservatively return False to avoid over-flagging
        return False


def _is_permit2_context(tx_event: TransactionEvent) -> bool:
    try:
        to_addr = (tx_event.to or '').lower()
        if to_addr in KNOWN_PERMIT2:
            return True
        input_data = (tx_event.transaction.get('input') or '').lower()
        if input_data.startswith('0x') and len(input_data) >= 10:
            selector = input_data[:10]
            return selector in PERMIT_SELECTORS
    except Exception:
        pass
    return False

def _decimals_for_token(addr: str) -> int:
    a = (addr or '').lower()
    six = {
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        '0xdac17f958d2ee523a2206206994597c13d831ec7',
        '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
        '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    }
    eighteen = {
        '0x6b175474e89094c44da98b954eedeac495271d0f',
        '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
        '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        '0x82af49447d8a07e3bd95bd0d56f35241523fbab',
    }
    if a in six:
        return 6
    if a in eighteen:
        return 18
    return 18

def _amount_tokens(data_hex: str, token_addr: str) -> float:
    try:
        val_int = int((data_hex or '0x0'), 16)
        dec = _decimals_for_token(token_addr)
        return val_int / (10 ** dec)
    except Exception:
        return 0.0

def _sigmoid(z: float) -> float:
    try:
        return 1.0 / (1.0 + math.exp(-z))
    except OverflowError:
        return 0.0 if z < 0 else 1.0

def _risk_score(features: Dict[str, float]) -> float:
    if not MODEL or 'weights' not in MODEL:
        return 0.0
    z = float(MODEL.get('bias', 0.0))
    for k, w in MODEL.get('weights', {}).items():
        z += float(w) * float(features.get(k, 0.0))
    return _sigmoid(z)


def handle_transaction(tx_event: TransactionEvent):
    findings = []
    block_number = tx_event.block_number

    # Track stablecoin approvals per owner within the block
    if block_number not in recent_block_owners_stables:
        recent_block_owners_stables[block_number] = {}

    for log in tx_event.logs:
        try:
            if len(log.topics) < 3:
                continue
            topic0 = log.topics[0].lower()
            # --- Approval detection ---
            if topic0 == APPROVAL_TOPIC:
                owner = _addr_from_topic(log.topics[1])
                spender = _addr_from_topic(log.topics[2])
                token = to_checksum_address(log.address)
                amount_hex = log.data if isinstance(log.data, str) else log.data.hex()

                is_unlimited = _is_unlimited(amount_hex)
                is_permit_context = _is_permit2_context(tx_event)
                spender_lower = spender.lower()
                token_lower = token.lower()

                # Short-interval repeated approvals
                key = (owner.lower(), spender_lower, token_lower)
                last_block, count = recent_approvals.get(key, (None, 0))
                if last_block is None or (block_number - last_block) > CONFIG.get('short_interval_blocks', 30):
                    recent_approvals[key] = (block_number, 1)
                    short_interval_repeat = False
                else:
                    recent_approvals[key] = (block_number, count + 1)
                    short_interval_repeat = True

                # Fresh spender for this (owner,spender,token)
                fresh_spender = (count == 0)

                # Unusual spender (EOA or not in known safe list)
                unusual_spender = (_is_eoa(spender) or spender_lower not in KNOWN_SAFE_SPENDERS)

                # Stablecoin combo detection within the same block
                combo_threshold = CONFIG.get('stablecoin_combo_threshold', 3)
                if token_lower in STABLECOINS:
                    owners_map = recent_block_owners_stables[block_number]
                    st_set = owners_map.get(owner.lower(), set())
                    st_set.add(token_lower)
                    owners_map[owner.lower()] = st_set
                    stable_combo_trigger = len(st_set) >= combo_threshold
                else:
                    stable_combo_trigger = False

                # Compose model features aligned with training
                features = {
                    'failed': 0.0,
                    'gasRatio': 0.0,
                    'isSwap': 0.0,
                    'isApprove': 1.0,
                    'approveToUnusual': 1.0 if unusual_spender else 0.0,
                    'freqNorm': 1.0 if short_interval_repeat else 0.0,
                    'unlimited': 1.0 if is_unlimited else 0.0,
                    'freshSpender': 1.0 if fresh_spender else 0.0,
                    'freqSpike': 1.0 if short_interval_repeat else 0.0,
                    'unknownTarget': 1.0 if unusual_spender else 0.0,
                    'score': 0.0,
                }

                risk = _risk_score(features)
                model_enabled = bool(CONFIG.get('enable_model', False))
                threshold = float(CONFIG.get('model_threshold', 0.3))

                reason_tags = []
                severity = FindingSeverity.Info

                if is_unlimited:
                    reason_tags.append('unlimited')
                    severity = FindingSeverity.Medium
                if short_interval_repeat:
                    reason_tags.append('short_repeat')
                    severity = FindingSeverity.Medium
                if unusual_spender:
                    reason_tags.append('unusual_spender')
                    severity = FindingSeverity.Low
                if stable_combo_trigger:
                    reason_tags.append('stable_combo')
                    severity = FindingSeverity.High
                if is_permit_context:
                    reason_tags.append('permit_context')

                # Gate by model when enabled: require risk>=threshold OR strong rule trigger
                should_alert = True
                if model_enabled:
                    should_alert = (risk >= threshold) or stable_combo_trigger

                if not reason_tags or not should_alert:
                    continue

                findings.append(
                    Finding({
                        'name': 'ERC20 Approval Anomaly',
                        'description': f"Approval anomaly: {', '.join(reason_tags)}; risk={risk:.3f}",
                        'alert_id': 'ERC20-APPROVAL-ANOMALY',
                        'severity': severity,
                        'type': FindingType.Suspicious,
                        'metadata': {
                            'owner': owner,
                            'spender': spender,
                            'token': token,
                            'tx_hash': tx_event.hash,
                            'block_number': str(block_number),
                            'amount_hex': amount_hex,
                            'reasons': ','.join(reason_tags),
                            'risk': f"{risk:.6f}",
                            'model_threshold': f"{threshold}",
                            'features': json.dumps(features),
                        }
                    })
                )
                continue

            # --- Transfer-based economic manipulation heuristics ---
            if topic0 == TRANSFER_TOPIC:
                from_addr = _addr_from_topic(log.topics[1])
                to_addr = _addr_from_topic(log.topics[2])
                token = to_checksum_address(log.address)
                amount_hex = log.data if isinstance(log.data, str) else log.data.hex()
                amount_tokens = _amount_tokens(amount_hex, token)

                N = int(CONFIG.get('density_blocks', 10))
                density_thr = int(os.getenv('DENSITY_THRESHOLD', CONFIG.get('density_threshold', 50)))
                fanout_thr = int(os.getenv('FANOUT_THRESHOLD', CONFIG.get('fanout_threshold', 20)))
                flow_thr = float(os.getenv('FLOW_THRESHOLD_TOKENS', CONFIG.get('flow_threshold_tokens', 100000.0)))

                # Update per-block transfer counts
                cnt_map = recent_transfers_window.get(from_addr.lower(), {})
                cnt_map[block_number] = cnt_map.get(block_number, 0) + 1
                for bn in list(cnt_map.keys()):
                    if bn < (block_number - N):
                        cnt_map.pop(bn, None)
                recent_transfers_window[from_addr.lower()] = cnt_map
                density_sum = sum(cnt_map.values())

                # Fanout unique recipients
                fan_map = recent_fanout_window.get(from_addr.lower(), {})
                recips = fan_map.get(block_number, set())
                recips.add(to_addr.lower())
                fan_map[block_number] = recips
                for bn in list(fan_map.keys()):
                    if bn < (block_number - N):
                        fan_map.pop(bn, None)
                recent_fanout_window[from_addr.lower()] = fan_map
                fanout_unique = len(set().union(*fan_map.values())) if fan_map else 0

                # Net flow per address
                flow_map = recent_net_flow_window.get(from_addr.lower(), {})
                flow_map[block_number] = flow_map.get(block_number, 0.0) - amount_tokens
                for bn in list(flow_map.keys()):
                    if bn < (block_number - N):
                        flow_map.pop(bn, None)
                recent_net_flow_window[from_addr.lower()] = flow_map
                net_out = sum(flow_map.values())

                flow_in_map = recent_net_flow_window.get(to_addr.lower(), {})
                flow_in_map[block_number] = flow_in_map.get(block_number, 0.0) + amount_tokens
                for bn in list(flow_in_map.keys()):
                    if bn < (block_number - N):
                        flow_in_map.pop(bn, None)
                recent_net_flow_window[to_addr.lower()] = flow_in_map
                net_in = sum(flow_in_map.values())

                density_spike = density_sum >= density_thr
                fanout_spike = fanout_unique >= fanout_thr
                net_outflow = (-net_out) >= flow_thr
                net_inflow = (net_in) >= flow_thr
                from_lower = from_addr.lower()
                to_lower = to_addr.lower()
                bridge_out = from_lower in KNOWN_BRIDGES
                bridge_in = to_lower in KNOWN_BRIDGES

                if not (density_spike or fanout_spike or net_outflow or net_inflow):
                    if not (bridge_out or bridge_in):
                        continue

                reason_tags = []
                severity = FindingSeverity.Low
                if density_spike:
                    reason_tags.append('density_spike')
                    severity = FindingSeverity.Medium
                if fanout_spike:
                    reason_tags.append('fanout_spike')
                    severity = FindingSeverity.Medium
                if net_outflow:
                    reason_tags.append('net_outflow')
                    severity = FindingSeverity.High
                if net_inflow:
                    reason_tags.append('net_inflow')
                    severity = FindingSeverity.High
                if bridge_out:
                    reason_tags.append('bridge_outflow')
                    severity = FindingSeverity.High
                if bridge_in:
                    reason_tags.append('bridge_inflow')
                    severity = FindingSeverity.High

                findings.append(
                    Finding({
                        'name': 'ERC20 Transfer Anomaly',
                        'description': f"Transfer anomaly: {', '.join(reason_tags)}",
                        'alert_id': 'ERC20-TRANSFER-ANOMALY',
                        'severity': severity,
                        'type': FindingType.Suspicious,
                        'metadata': {
                            'from': from_addr,
                            'to': to_addr,
                            'token': token,
                            'tx_hash': tx_event.hash,
                            'block_number': str(block_number),
                            'amount_tokens': f"{amount_tokens:.6f}",
                            'density_sum': str(density_sum),
                            'fanout_unique': str(fanout_unique),
                            'net_out_tokens': f"{(-net_out):.6f}",
                            'net_in_tokens': f"{net_in:.6f}",
                            'reasons': ','.join(reason_tags)
                        }
                    })
                )
                continue

        except Exception as e:
            findings.append(
                Finding({
                    'name': 'ERC20 Approval Analyzer Error',
                    'description': f'Error analyzing log: {str(e)}',
                    'alert_id': 'ERC20-APPROVAL-ERROR',
                    'severity': FindingSeverity.Low,
                    'type': FindingType.Degraded,
                    'metadata': {
                        'tx_hash': tx_event.hash,
                        'block_number': str(block_number)
                    }
                })
            )

    # Clear old block cache to constrain memory
    old_blocks = [bn for bn in recent_block_owners_stables.keys() if bn < block_number]
    for bn in old_blocks:
        # keep only current block
        recent_block_owners_stables.pop(bn, None)

    return findings


def _severity_from_level(level: str, score: float) -> str:
    lvl = (level or '').lower()
    if lvl == 'high' or score >= 0.8:
        return FindingSeverity.High
    if lvl == 'medium' or score >= 0.5:
        return FindingSeverity.Medium
    return FindingSeverity.Info


def _load_pipeline_events(path_in: str) -> List[Dict[str, Any]]:
    if not os.path.exists(path_in):
        return []
    try:
        raw = open(path_in, 'r', encoding='utf-8').read()
        j = json.loads(raw)
        if isinstance(j, list):
            return j
        if isinstance(j, dict) and 'events' in j and isinstance(j['events'], list):
            return j['events']
    except Exception:
        pass
    # CSV fallback
    if path_in.lower().endswith('.csv'):
        try:
            lines = [l for l in open(path_in, 'r', encoding='utf-8').read().splitlines() if l.strip()]
            if not lines:
                return []
            header = [h.strip() for h in lines[0].split(',')]
            idx = {h: i for i, h in enumerate(header)}
            events = []
            for ln in lines[1:]:
                cols = [c.strip() for c in ln.split(',')]
                def g(k, default=''):
                    return cols[idx[k]] if k in idx and idx[k] < len(cols) else default
                ev = {
                    'block': int(g('block', '0') or '0'),
                    'timestamp': g('timestamp', ''),
                    'owner': g('owner', ''),
                    'spender': g('spender', ''),
                    'token': g('token', ''),
                    'unlimited': g('unlimited', 'false').lower() == 'true',
                    'freshSpender': g('freshSpender', 'false').lower() == 'true',
                    'freqSpike': g('freqSpike', 'false').lower() == 'true',
                    'unknownTarget': g('unknownTarget', 'false').lower() == 'true',
                    'score': float(g('score', '0') or '0'),
                    'level': g('level', 'low')
                }
                events.append(ev)
            return events
        except Exception:
            return []
    return []


def generate_findings_from_pipeline(path_in: str, path_out: str) -> Dict[str, Any]:
    events = _load_pipeline_events(path_in)
    findings: List[Finding] = []
    for ev in events:
        score = float(ev.get('score', 0) or 0)
        level = str(ev.get('level', ''))
        sev = _severity_from_level(level, score)
        if score < 0.6 and level.lower() not in ('high', 'medium'):
            continue
        meta = {
            'owner': ev.get('owner', ''),
            'spender': ev.get('spender', ''),
            'token': ev.get('token', ''),
            'block': str(ev.get('block', '')),
            'score': f"{score:.2f}",
            'level': level,
            'signals': ','.join([
                s for s, flag in (
                    ('unlimited', bool(ev.get('unlimited', False))),
                    ('fresh', bool(ev.get('freshSpender', False))),
                    ('spike', bool(ev.get('freqSpike', False))),
                    ('unknown', bool(ev.get('unknownTarget', False))),
                ) if flag
            ])
        }
        finding = Finding({
            'name': 'Pipeline Approval Risk',
            'description': f"Approval risk level={level} score={score:.2f}",
            'alert_id': 'PIPELINE-APPROVAL-RISK',
            'severity': sev,
            'type': FindingType.Suspicious,
            'metadata': meta
        })
        findings.append(finding)

    out = {
        'count': len(findings),
        'source': os.path.abspath(path_in),
        'alerts': findings,
    }
    try:
        os.makedirs(os.path.dirname(path_out), exist_ok=True)
        with open(path_out, 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
    except Exception:
        pass
    return out


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--from-pipeline', dest='from_pipeline', default='', help='Path to pipeline_results.json/csv or high_risk_candidates.json/csv')
    parser.add_argument('--out', dest='out', default=os.path.join(os.path.dirname(__file__), '..', 'out', 'forta_alerts.json'))
    args = parser.parse_args()
    if args.from_pipeline:
        res = generate_findings_from_pipeline(args.from_pipeline, args.out)
        print(f"alerts={res['count']} out={args.out}")
    else:
        initialize()
        print('Forta bot initialized for runtime environment.')
