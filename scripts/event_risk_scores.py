import json, csv, argparse, os
import math

def sigmoid(z):
    return 1.0 / (1.0 + math.exp(-z))

def predict_tree(x, node):
    if "value" in node:
        return node["value"]
    if x[node["feature_idx"]] <= node["threshold"]:
        return predict_tree(x, node["left"])
    return predict_tree(x, node["right"])

def predict_rf_proba(x, model):
    trees = model["trees"]
    preds = [predict_tree(x, tree) for tree in trees]
    return sum(preds) / len(trees)

def risk(row, model):
    # Check for Random Forest
    if model.get('type') == 'random_forest':
        # Determine if graph or standard
        # Heuristic: check if 'cliqueScore' is present and non-empty
        is_graph = False
        if row.get('cliqueScore') and str(row.get('cliqueScore')).strip() != '':
            is_graph = True
            
        if is_graph:
             try:
                f = [
                    float(row.get('degree', 0) or 0),
                    float(row.get('uniquePartners', 0) or 0),
                    float(row.get('cliqueScore', 0) or 0),
                    float(row.get('failed', 0) or 0),
                    float(row.get('gasRatio', 0) or 0)
                ]
             except: f = [0.0]*5
        else:
             def to_float(val):
                 if isinstance(val, str):
                     return 1.0 if val.lower() == 'true' else 0.0
                 return float(val or 0)
             f = [
                to_float(row.get('unlimited', 0)),
                to_float(row.get('freshSpender', 0)),
                to_float(row.get('freqSpike', 0)),
                to_float(row.get('unknownTarget', 0))
             ]
        return predict_rf_proba(f, model)

    failed = float(row.get('failed', 0) or 0)
    gasRatio = float(row.get('gasRatio', 0) or 0)
    isSwap = float(row.get('isSwap', 0) or 0)
    isApprove = float(row.get('isApprove', 1) or 1)
    approveToUnusual = row.get('approveToUnusual')
    if approveToUnusual is None:
        approveToUnusual = 1.0 if str(row.get('unknownTarget','')).lower() == 'true' else 0.0
    else:
        approveToUnusual = float(approveToUnusual or 0)
    freqNorm = row.get('freqNorm')
    if freqNorm is None:
        freqNorm = 1.0 if str(row.get('freqSpike','')).lower() == 'true' else 0.0
    else:
        freqNorm = float(freqNorm or 0)
    f = {
        'failed': failed,
        'gasRatio': gasRatio,
        'isSwap': isSwap,
        'isApprove': isApprove,
        'approveToUnusual': approveToUnusual,
        'freqNorm': freqNorm,
        'unlimited': 1.0 if str(row.get('unlimited','')).lower() == 'true' else 0.0,
        'freshSpender': 1.0 if str(row.get('freshSpender','')).lower() == 'true' else 0.0,
        'freqSpike': 1.0 if str(row.get('freqSpike','')).lower() == 'true' else 0.0,
        'unknownTarget': 1.0 if str(row.get('unknownTarget','')).lower() == 'true' else 0.0,
        'score': float(row.get('score', 0) or 0),
    }
    z = model['bias'] + sum(model['weights'].get(k,0.0)*f[k] for k in f)
    return sigmoid(z)

def read_csv(path):
    rows = []
    with open(path, newline='', encoding='utf-8') as f:
        r = csv.DictReader(f)
        for row in r:
            rows.append(row)
    return rows

def write_csv(path, headers, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(headers)
        for r in rows:
            w.writerow(r)

def to_lower(x):
    return (x or '').lower()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--model', required=True)
    ap.add_argument('--threshold', default=0.6, type=float)
    args = ap.parse_args()
    rows = read_csv(args.input)
    with open(args.model, encoding='utf-8') as f:
        model = json.load(f)
    out_rows = []
    agg = {}
    for row in rows:
        owner = to_lower(row.get('owner') or row.get('from') or row.get('address'))
        spender = to_lower(row.get('spender') or row.get('to'))
        token = to_lower(row.get('token'))
        block = row.get('block') or row.get('blockNumber') or ''
        p = risk(row, model)
        yhat = 1 if p >= args.threshold else 0
        lbl = row.get('label')
        if lbl is not None and str(lbl).strip() != '':
            y = 1 if str(lbl).strip() in ('1','true','True','HIGH','high','High') else 0
        else:
            y = 1 if (row.get('finalLabel','')=='high_risk') else 0
        out_rows.append([owner, spender, token, block, y, yhat, round(p,6)])
        for addr in (owner, spender):
            if not addr: continue
            a = agg.get(addr)
            if a is None:
                a = {'count':0,'sum':0.0,'high':0}
                agg[addr] = a
            a['count'] += 1
            a['sum'] += float(p)
            if yhat==1:
                a['high'] += 1
    write_csv(os.path.join('out','event_risk_scores.csv'), ['owner','spender','token','block','label','pred','risk'], out_rows)
    agg_rows = []
    for addr, a in agg.items():
        avg = a['sum'] / max(1,a['count'])
        agg_rows.append([addr, a['high'], round(avg,6), round(a['sum'],6), a['count']])
    write_csv(os.path.join('out','node_risk_agg.csv'), ['address','high_count','avg_risk','sum_risk','event_count'], agg_rows)
    print('Wrote: out/event_risk_scores.csv and out/node_risk_agg.csv')

if __name__ == '__main__':
    main()