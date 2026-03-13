import json
import os
from types import SimpleNamespace

# Import bot
import sys
sys.path.append(os.path.dirname(__file__))
import bot as fb

def make_topics(owner_hex, spender_hex):
    # owner_hex, spender_hex are 0x-address strings
    # topics[0] is Approval topic from bot module
    t0 = fb.APPROVAL_TOPIC
    o = '0x' + ('0' * 24) + owner_hex[2:].lower()
    s = '0x' + ('0' * 24) + spender_hex[2:].lower()
    return [t0.lower(), o.lower(), s.lower()]

def main():
    fb.initialize()
    # Config: use first stablecoin address from config for token
    cfg = fb.CONFIG
    stables = cfg.get('stablecoins', [])
    token = stables[0] if stables else '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'  # USDC mainnet fallback
    owner = '0x5B3eDf5c626B0700957B0c9B6c1Bf2cA08B1f8fB'
    # Use an unknown spender to trigger unusual_spender
    spender = '0xDeaDbeefdEAdbeefdEAdbeefdEAdbeefdeadbeef'

    topics = make_topics(owner, spender)
    # Unlimited value hex (2^256 - 1)
    amount_hex = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    log = SimpleNamespace(topics=topics, data=amount_hex, address=token)

    tx_event = SimpleNamespace(
        block_number=18000000,
        hash='0x' + 'ab'*32,
        logs=[log],
        to=spender,
        transaction={'input': '0x095ea7b3'}
    )

    findings = fb.handle_transaction(tx_event)
    print(json.dumps(findings, indent=2))

if __name__ == '__main__':
    main()