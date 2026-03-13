import os
import csv
import json
import time
from dataclasses import dataclass
from typing import List, Dict, Any, Optional

from web3 import Web3
from eth_utils import to_checksum_address
from dotenv import load_dotenv


APPROVAL_TOPIC = Web3.keccak(text="Approval(address,address,uint256)").hex()


@dataclass
class ApprovalEvent:
    block_number: int
    tx_hash: str
    token: str
    owner: str
    spender: str
    amount: int


def hex_to_address(topic_hex: str) -> str:
    return to_checksum_address('0x' + topic_hex[-40:])


def fetch_approvals(
    w3: Web3,
    start_block: int,
    end_block: int,
    window: int = 1000,
    token_filter: List[str] = None,
    spender_filter: List[str] = None,
    csv_path: Optional[str] = None,
    checkpoint_path: Optional[str] = None,
) -> List[ApprovalEvent]:
    events: List[ApprovalEvent] = []
    current = start_block
    token_filter = token_filter or []
    token_filter_lower = set([t.lower() for t in token_filter])
    token_filter_checksum = [to_checksum_address(t) for t in token_filter]
    spender_filter_lower = set([s.lower() for s in (spender_filter or [])])

    # prepare CSV header if incremental append is enabled
    if csv_path:
        os.makedirs(os.path.dirname(csv_path) or '.', exist_ok=True)
        if not os.path.exists(csv_path):
            with open(csv_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(['block_number', 'tx_hash', 'token', 'owner', 'spender', 'amount'])

    while current <= end_block:
        to_block = min(current + window - 1, end_block)
        params = {
            'fromBlock': current,
            'toBlock': to_block,
            'topics': [APPROVAL_TOPIC]
        }
        # Some public RPCs require specifying address for eth_getLogs
        if token_filter_checksum:
            params['address'] = token_filter_checksum
        logs = w3.eth.get_logs(params)
        batch_events: List[ApprovalEvent] = []
        for lg in logs:
            if len(lg['topics']) < 3:
                continue
            token = to_checksum_address(lg['address'])
            owner = hex_to_address(lg['topics'][1].hex() if hasattr(lg['topics'][1], 'hex') else lg['topics'][1])
            spender = hex_to_address(lg['topics'][2].hex() if hasattr(lg['topics'][2], 'hex') else lg['topics'][2])
            data_hex = lg['data'].hex() if hasattr(lg['data'], 'hex') else lg['data']
            if not data_hex or data_hex.lower() in ('0x', '0x0'):
                amount = 0
            else:
                amount = int(data_hex, 16)

            if token_filter_lower and token.lower() not in token_filter_lower:
                continue
            if spender_filter_lower and spender.lower() not in spender_filter_lower:
                continue

            evt = ApprovalEvent(
                block_number=lg['blockNumber'],
                tx_hash=lg['transactionHash'].hex() if hasattr(lg['transactionHash'], 'hex') else lg['transactionHash'],
                token=token,
                owner=owner,
                spender=spender,
                amount=amount,
            )
            events.append(evt)
            batch_events.append(evt)

        # incremental append for this batch
        if csv_path and batch_events:
            with open(csv_path, 'a', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                for e in batch_events:
                    writer.writerow([e.block_number, e.tx_hash, e.token, e.owner, e.spender, str(e.amount)])

        # update checkpoint
        if checkpoint_path:
            try:
                with open(checkpoint_path, 'w', encoding='utf-8') as ck:
                    json.dump({'last_to_block': to_block}, ck)
            except Exception as e:
                print(f"Checkpoint write failed: {e}")

        print(f"Fetched logs: {len(logs)} for blocks {current}-{to_block}")
        current = to_block + 1
        time.sleep(0.05)

    return events


def export_csv(path: str, approvals: List[ApprovalEvent]):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['block_number', 'tx_hash', 'token', 'owner', 'spender', 'amount'])
        for e in approvals:
            writer.writerow([e.block_number, e.tx_hash, e.token, e.owner, e.spender, str(e.amount)])


def summarize(approvals: List[ApprovalEvent]) -> Dict[str, Any]:
    summary = {
        'count': 0,
        'unlimited': 0,
        'large': 0,  # placeholder: amount >= 1e24 (adjust as needed)
        'repeated': 0,  # same owner-spender-token appears multiple times
        'shortInterval': 0,  # repeated within close blocks
        'unusualSpender': 0
    }
    seen = {}
    last_block_for_key = {}
    for e in approvals:
        summary['count'] += 1
        key = (e.owner.lower(), e.spender.lower(), e.token.lower())
        seen[key] = seen.get(key, 0) + 1
        if e.amount == (2 ** 256 - 1):
            summary['unlimited'] += 1
        if e.amount >= 10 ** 24:
            summary['large'] += 1
        if seen[key] > 1:
            summary['repeated'] += 1
        prev_block = last_block_for_key.get(key)
        if prev_block is not None and (e.block_number - prev_block) <= 30:
            summary['shortInterval'] += 1
        last_block_for_key[key] = e.block_number

    return summary


def main():
    load_dotenv()
    rpc_url = os.getenv('RPC_URL')
    start_block = int(os.getenv('START_BLOCK', '17000000'))
    end_block = int(os.getenv('END_BLOCK', '17100000'))
    window = int(os.getenv('WINDOW', '1000'))
    resume_flag = os.getenv('RESUME', '0') == '1'

    token_filter_env = os.getenv('TOKEN_FILTER')  # comma-separated addresses
    spender_filter_env = os.getenv('SPENDER_FILTER')
    token_filter = [t.strip() for t in token_filter_env.split(',')] if token_filter_env else None
    spender_filter = [s.strip() for s in spender_filter_env.split(',')] if spender_filter_env else None

    w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={'timeout': 60}))
    os.makedirs('outputs', exist_ok=True)

    checkpoint_path = os.path.join('outputs', 'approvals_checkpoint.json')
    csv_path = os.path.join('outputs', 'approvals.csv')

    # resume from checkpoint if enabled
    if resume_flag and os.path.exists(checkpoint_path):
        try:
            with open(checkpoint_path, 'r', encoding='utf-8') as ck:
                data = json.load(ck)
                last_to = int(data.get('last_to_block', start_block - 1))
                if last_to >= start_block:
                    start_block = min(last_to + 1, end_block)
                    print(f"Resuming from checkpoint at block {start_block}")
        except Exception as e:
            print(f"Failed to read checkpoint: {e}")

    approvals = fetch_approvals(
        w3,
        start_block,
        end_block,
        window,
        token_filter,
        spender_filter,
        csv_path=csv_path,
        checkpoint_path=checkpoint_path,
    )

    # Finalize summary (CSV already appended incrementally)
    summary = summarize(approvals)
    with open('outputs/approvals_summary.json', 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print('Exported outputs/approvals.csv (incremental) and outputs/approvals_summary.json')


if __name__ == '__main__':
    main()