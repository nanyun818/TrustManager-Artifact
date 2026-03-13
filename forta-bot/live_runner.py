import os
import json
import time
import argparse
from types import SimpleNamespace

from web3 import Web3

import bot as fb
import signal


def make_tx_event_from_log(w3: Web3, log):
    # Fetch transaction details for 'to' and 'input'
    tx = w3.eth.get_transaction(log['transactionHash'])
    tx_hash = tx['hash'].hex()
    to_addr = (tx['to'] or '').lower()
    input_data = tx['input'] or ''

    # Build topics and data in the shape bot expects
    topics = [t.hex().lower() for t in log['topics']]
    data_hex = log['data'] if isinstance(log['data'], str) else log['data'].hex()
    token_addr = log['address']

    log_ns = SimpleNamespace(topics=topics, data=data_hex, address=token_addr)
    tx_event = SimpleNamespace(
        block_number=log['blockNumber'],
        hash=tx_hash,
        logs=[log_ns],
        to=to_addr,
        transaction={'input': input_data}
    )
    return tx_event


def _read_last_to_block(health_path: str):
    try:
        if not os.path.exists(health_path):
            return None
        with open(health_path, 'r', encoding='utf-8') as hf:
            # Read last non-empty JSON line
            lines = [ln.strip() for ln in hf.readlines() if ln.strip()]
            if not lines:
                return None
            last_line = lines[-1]
            obj = json.loads(last_line)
            return int(obj.get('to_block')) if obj and 'to_block' in obj else None
    except Exception:
        return None


def _provider_urls():
    env = os.getenv('RPC_URLS') or ''
    if env:
        urls = [u.strip() for u in env.split(',') if u.strip()]
        if urls:
            return urls
    try:
        primary = fb.CONFIG.get('rpc_url_primary')
        backup = fb.CONFIG.get('rpc_url_backup')
    except Exception:
        primary = None
        backup = None
    urls = [u for u in [primary, backup, os.getenv('RPC_URL')] if u]
    return urls or ["http://localhost:8545"]

def _build_providers(urls):
    provs = []
    for u in urls:
        provs.append(Web3(Web3.HTTPProvider(u, request_kwargs={'timeout': 20})))
    return provs

def _safe_latest(provs, start_idx):
    n = len(provs)
    idx = start_idx
    for _ in range(n):
        try:
            return provs[idx].eth.block_number, idx
        except Exception:
            idx = (idx + 1) % n
    raise RuntimeError('all providers failed for block_number')

def _safe_block(provs, start_idx, bn):
    n = len(provs)
    idx = start_idx
    for _ in range(n):
        try:
            return provs[idx].eth.get_block(bn), idx
        except Exception:
            idx = (idx + 1) % n
    return None, start_idx

def _get_logs_chunk(provs, start_idx, flt, retries=3, backoff=0.5):
    n = len(provs)
    idx = start_idx
    last_err = None
    for _ in range(n):
        for a in range(retries):
            try:
                logs = provs[idx].eth.get_logs(flt)
                return logs, idx
            except Exception as e:
                last_err = e
                time.sleep(backoff * (a + 1))
        idx = (idx + 1) % n
    raise last_err if last_err else RuntimeError('get_logs failed')

def _get_tx(prov, txh):
    return prov.eth.get_transaction(txh)

STOP = False

def _flush_fsync(f):
    try:
        f.flush()
        os.fsync(f.fileno())
    except Exception:
        pass

def _on_sig(_sig, _frm):
    global STOP
    STOP = True

def main(duration_mins: int = 0, from_block: int = 0, resume: bool = False):
    fb.initialize()
    urls = _provider_urls()
    providers = _build_providers(urls)
    pidx = 0

    # Output path
    out_path = os.path.join(os.path.dirname(__file__), '..', 'out', 'forta_alerts_live.json')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    # Prepare filters: Approval + Transfer
    approval_topic = fb.APPROVAL_TOPIC
    transfer_topic = getattr(fb, 'TRANSFER_TOPIC', None)
    topics = [approval_topic] + ([transfer_topic] if transfer_topic else [])

    # Address filter: iterate each address to satisfy providers requiring a single address
    addresses = []
    try:
        if fb.STABLECOINS:
            tmp = []
            for a in fb.STABLECOINS:
                try:
                    tmp.append(Web3.to_checksum_address(a))
                except Exception as e:
                    print(f"skip invalid address {a}: {e}")
            addresses = sorted(tmp)
    except Exception as e:
        print(f"address conversion error: {e}")
        addresses = []

    # Node health telemetry
    health_path = os.path.join(os.path.dirname(__file__), '..', 'out', 'node_health_live.json')
    os.makedirs(os.path.dirname(health_path), exist_ok=True)

    # Determine starting block
    last, pidx = _safe_latest(providers, pidx)
    resumed_from = None
    if resume:
        prev_to = _read_last_to_block(health_path)
        if prev_to and isinstance(prev_to, int) and prev_to > 0:
            last = prev_to
            resumed_from = prev_to
    elif from_block and from_block > 0:
        last = int(from_block)
        resumed_from = from_block
    end_ts = None
    if duration_mins and duration_mins > 0:
        end_ts = time.time() + duration_mins * 60
    start_msg = f"Live runner started at block {last}, address_filter={'on' if addresses else 'off'} count={len(addresses)} duration_mins={duration_mins}"
    if resumed_from is not None:
        start_msg += f" (resumed_from={resumed_from})"
    print(start_msg)

    total_logs = 0
    total_findings = 0
    req_count = 0
    err_count = 0
    latencies_ms = []

    signal.signal(signal.SIGINT, _on_sig)
    signal.signal(signal.SIGTERM, _on_sig)
    while True:
        try:
            if STOP:
                print("Live runner stopping on signal.")
                break
            if end_ts and time.time() >= end_ts:
                print("Live runner reached duration; stopping.")
                break
            latest, pidx = _safe_latest(providers, pidx)
            if latest > last:
                # Process block range [last+1, latest]
                findings_batch = []
                total_block_logs = 0
                addr_iter = addresses if addresses else []
                if not addr_iter:
                    # Fallback: USDC arbitrum
                    try:
                        addr_iter = [Web3.to_checksum_address('0xaf88d065e77c8cC2239327C5EDb3A432268e5831')]
                    except Exception:
                        addr_iter = []

                chunk = int(os.getenv('LOG_CHUNK_BLOCKS') or getattr(fb, 'CONFIG', {}).get('log_chunk_blocks', 1200))
                for addr in addr_iter:
                    for tp in topics:
                        frm = last + 1
                        while frm <= latest:
                            to_b = min(frm + chunk - 1, latest)
                            f = {
                                'fromBlock': frm,
                                'toBlock': to_b,
                                'address': addr,
                                'topics': [tp if str(tp).startswith('0x') else ('0x' + str(tp))]
                            }
                            t0 = time.time()
                            try:
                                logs, pidx = _get_logs_chunk(providers, pidx, f)
                                t1 = time.time()
                                req_count += 1
                                latencies_ms.append((t1 - t0) * 1000.0)
                                total_block_logs += len(logs)
                                for lg in logs:
                                    tx = _get_tx(providers[pidx], lg['transactionHash'])
                                    tx_hash = tx['hash'].hex()
                                    to_addr = (tx['to'] or '').lower()
                                    input_data = tx['input'] or ''
                                    topics_hex = [t.hex().lower() for t in lg['topics']]
                                    data_hex = lg['data'] if isinstance(lg['data'], str) else lg['data'].hex()
                                    token_addr = lg['address']
                                    log_ns = SimpleNamespace(topics=topics_hex, data=data_hex, address=token_addr)
                                    tx_event = SimpleNamespace(
                                        block_number=lg['blockNumber'],
                                        hash=tx_hash,
                                        logs=[log_ns],
                                        to=to_addr,
                                        transaction={'input': input_data}
                                    )
                                    findings = fb.handle_transaction(tx_event)
                                    if findings:
                                        findings_batch.extend(findings)
                            except Exception as e:
                                err_count += 1
                                print(f"runner addr {addr} topic {tp} error: {e}")
                            frm = to_b + 1

                total_logs += total_block_logs
                total_findings += len(findings_batch)

                if findings_batch:
                    with open(out_path, 'a', encoding='utf-8') as f_out:
                        for fd in findings_batch:
                            f_out.write(json.dumps(fd) + "\n")
                        _flush_fsync(f_out)

                # Node health snapshot
                avg_latency = (sum(latencies_ms) / len(latencies_ms)) if latencies_ms else 0.0
                error_rate = (err_count / req_count) if req_count else 0.0
                # Block time skew vs wall clock
                skew_sec = 0.0
                blk, pidx = _safe_block(providers, pidx, latest)
                if blk:
                    try:
                        skew_sec = max(0.0, time.time() - float(blk['timestamp']))
                    except Exception:
                        pass

                telemetry = {
                    'from_block': last + 1,
                    'to_block': latest,
                    'avg_latency_ms': round(avg_latency, 2),
                    'error_rate': round(error_rate, 4),
                    'skew_sec': round(skew_sec, 2),
                    'requests': req_count,
                    'errors': err_count,
                    'logs': total_block_logs,
                    'findings': len(findings_batch)
                }
                try:
                    with open(health_path, 'a', encoding='utf-8') as hf:
                        hf.write(json.dumps(telemetry) + "\n")
                        _flush_fsync(hf)
                except Exception:
                    pass

                # Warn on thresholds
                latency_warn_ms = float(getattr(fb, 'CONFIG', {}).get('latency_warn_ms', 800))
                err_warn = float(getattr(fb, 'CONFIG', {}).get('error_rate_warn', 0.2))
                skew_warn = float(getattr(fb, 'CONFIG', {}).get('skew_warn_sec', 20))
                warn_tags = []
                if avg_latency > latency_warn_ms:
                    warn_tags.append('latency')
                if error_rate > err_warn:
                    warn_tags.append('error_rate')
                if skew_sec > skew_warn:
                    warn_tags.append('skew')

                print(f"blocks=[{last+1},{latest}] logs={total_block_logs} findings={len(findings_batch)} total_logs={total_logs} total_findings={total_findings} avg_ms={avg_latency:.1f} err_rate={error_rate:.3f} skew={skew_sec:.1f}s warnings={','.join(warn_tags) if warn_tags else 'none'}")
                last = latest

            time.sleep(5)
        except KeyboardInterrupt:
            print("Live runner stopped by user.")
            break
        except Exception as e:
            print(f"runner error: {e}")
            time.sleep(3)
    try:
        with open(health_path, 'a', encoding='utf-8') as hf:
            hf.write(json.dumps({'from_block': last+1, 'to_block': last, 'shutdown': True, 'timestamp': int(time.time())}) + "\n")
            _flush_fsync(hf)
    except Exception:
        pass


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--duration-mins', type=int, default=0, help='Run duration in minutes before auto-exit (0 for infinite)')
    parser.add_argument('--from-block', type=int, default=0, help='Start processing from specific block (processes range [from_block+1, latest])')
    parser.add_argument('--resume', action='store_true', help='Resume from last to_block recorded in node_health_live.json')
    args = parser.parse_args()
    main(args.duration_mins, args.from_block, args.resume)
