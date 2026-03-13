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

    # Same fallback mapping as training (Logistic Regression)
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

def _eval_threshold(rows, model, thr):
    tp=fp=tn=fn=0
    for row in rows:
        lbl = row.get('label')
        if lbl is not None and str(lbl).strip() != '':
            y = 1 if str(lbl).strip() in ('1','true','True','HIGH','high','High') else 0
        else:
            y = 1 if (row.get('finalLabel','')=='high_risk') else 0
        p = risk(row, model)
        yhat = 1 if p >= thr else 0
        if yhat==1 and y==1: tp+=1
        elif yhat==1 and y==0: fp+=1
        elif yhat==0 and y==0: tn+=1
        else: fn+=1
    precision = tp / max(1, tp+fp)
    recall = tp / max(1, tp+fn)
    f1 = 2*precision*recall / max(1e-9, precision+recall)
    return tp, fp, tn, fn, precision, recall, f1

def _derived_metrics(rows, model, thr):
    pp=0
    sp=0
    ft=0
    ftp=0
    for row in rows:
        src = str(row.get('label_source','')).lower()
        if src == 'forta':
            ft += 1
        p = risk(row, model)
        yhat = 1 if p >= thr else 0
        if yhat == 1:
            pp += 1
            if src in ('forta','rules'):
                sp += 1
            if src == 'forta':
                ftp += 1
    rule_consistency = sp / max(1, pp)
    safety_recall = ftp / max(1, ft)
    explain_coverage = 0.0
    try:
        cnt = 0
        with open(os.path.join('out','reason_samples.jsonl'), 'r', encoding='utf-8') as f:
            for _ in f:
                cnt += 1
        explain_coverage = cnt / max(1, len(rows))
    except Exception:
        explain_coverage = 0.0
    return {
        'rule_consistency': round(rule_consistency,6),
        'safety_recall': round(safety_recall,6),
        'explain_coverage': round(explain_coverage,6),
        'pred_positive': pp,
        'supported_positive': sp,
        'forta_total': ft,
        'forta_pred_positive': ftp
    }

def _scores_and_labels(rows, model):
    ys = []
    ps = []
    for row in rows:
        lbl = row.get('label')
        if lbl is not None and str(lbl).strip() != '':
            y = 1 if str(lbl).strip() in ('1','true','True','HIGH','high','High') else 0
        else:
            y = 1 if (row.get('finalLabel','')=='high_risk') else 0
        ys.append(y)
        ps.append(risk(row, model))
    return ys, ps

def _roc_pr_curves(ys, ps, thrs):
    curve = []
    for thr in thrs:
        tp=fp=tn=fn=0
        for i in range(len(ys)):
            yhat = 1 if ps[i] >= thr else 0
            if yhat==1 and ys[i]==1: tp+=1
            elif yhat==1 and ys[i]==0: fp+=1
            elif yhat==0 and ys[i]==0: tn+=1
            else: fn+=1
        precision = tp / max(1, tp+fp)
        recall = tp / max(1, tp+fn)
        tpr = recall
        fpr = fp / max(1, fp+tn)
        curve.append({'thr':thr,'tp':tp,'fp':fp,'tn':tn,'fn':fn,'precision':precision,'recall':recall,'f1':(2*precision*recall/max(1e-9,precision+recall)),'tpr':tpr,'fpr':fpr})
    return curve

def _auc_xy(points, xkey, ykey):
    pts = sorted(points, key=lambda p: p[xkey])
    auc = 0.0
    for i in range(1, len(pts)):
        x0 = pts[i-1][xkey]; y0 = pts[i-1][ykey]
        x1 = pts[i][xkey]; y1 = pts[i][ykey]
        auc += (x1 - x0) * (y0 + y1) * 0.5
    return auc

def _ks_stat(ys, ps):
    pos = sorted([ps[i] for i in range(len(ps)) if ys[i]==1])
    neg = sorted([ps[i] for i in range(len(ps)) if ys[i]==0])
    if not pos or not neg:
        return 0.0
    i=j=0
    ks=0.0
    npos=len(pos); nneg=len(neg)
    vals = sorted(set(pos+neg))
    for v in vals:
        while i<npos and pos[i] <= v: i+=1
        while j<nneg and neg[j] <= v: j+=1
        cdf_pos = i/max(1,npos)
        cdf_neg = j/max(1,nneg)
        d = abs(cdf_pos - cdf_neg)
        if d > ks: ks = d
    return ks

def _calibrate_temperature(ys, ps):
    bestT = 1.0
    bestLoss = float('inf')
    for T in [x/10.0 for x in range(5, 31)]:
        loss = 0.0
        for i in range(len(ps)):
            p = ps[i]
            p = min(0.999999, max(1e-6, p))
            logit = math.log(p/(1.0-p))
            pc = 1.0/(1.0+math.exp(-logit/T))
            pc = min(0.999999, max(1e-6, pc))
            y = ys[i]
            loss += -(y*math.log(pc) + (1-y)*math.log(1.0-pc))
        if loss < bestLoss:
            bestLoss = loss
            bestT = T
    psCal = []
    for i in range(len(ps)):
        p = ps[i]
        p = min(0.999999, max(1e-6, p))
        logit = math.log(p/(1.0-p))
        pc = 1.0/(1.0+math.exp(-logit/bestT))
        psCal.append(pc)
    return bestT, psCal

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--model', required=True)
    ap.add_argument('--threshold', default=0.6, type=float)
    ap.add_argument('--grid', action='store_true', help='Run threshold grid search and report best F1')
    args = ap.parse_args()
    rows = read_csv(args.input)
    with open(args.model) as f:
        model = json.load(f)
    ys, ps = _scores_and_labels(rows, model)

    if args.grid:
        thrs = [round(x,2) for x in [0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8]]
        best = None
        print('Threshold grid search:')
        for thr in thrs:
            tp, fp, tn, fn, precision, recall, f1 = _eval_threshold(rows, model, thr)
            print(f"thr={thr} tp={tp} fp={fp} tn={tn} fn={fn} precision={precision:.4f} recall={recall:.4f} f1={f1:.4f}")
            if (best is None) or (f1 > best[2]):
                best = (thr, (tp,fp,tn,fn,precision,recall), f1)
        bthr, (tp,fp,tn,fn,precision,recall), f1 = best
        print('Best threshold:', bthr)
        print('Best metrics: TP',tp,'FP',fp,'TN',tn,'FN',fn,'precision',round(precision,4),'recall',round(recall,4),'f1',round(f1,4))
        try:
            out = {
                'summary': {
                    'best_threshold': bthr,
                    'tp': tp, 'fp': fp, 'tn': tn, 'fn': fn,
                    'precision': round(precision, 6), 'recall': round(recall, 6), 'f1': round(f1, 6)
                },
                'grid': []
            }
            out['summary_ext'] = _derived_metrics(rows, model, bthr)
            curve = _roc_pr_curves(ys, ps, thrs)
            roc_auc = _auc_xy(curve, 'fpr', 'tpr')
            pr_auc = _auc_xy(curve, 'recall', 'precision')
            ks = _ks_stat(ys, ps)
            T, psCal = _calibrate_temperature(ys, ps)
            curveCal = _roc_pr_curves(ys, psCal, thrs)
            roc_auc_cal = _auc_xy(curveCal, 'fpr', 'tpr')
            pr_auc_cal = _auc_xy(curveCal, 'recall', 'precision')
            out['summary_ext']['roc_auc'] = round(roc_auc,6)
            out['summary_ext']['pr_auc'] = round(pr_auc,6)
            out['summary_ext']['ks'] = round(ks,6)
            out['summary_ext']['calibration_T'] = round(T,6)
            out['summary_ext']['roc_auc_cal'] = round(roc_auc_cal,6)
            out['summary_ext']['pr_auc_cal'] = round(pr_auc_cal,6)
            for thr in thrs:
                tpp, fpp, tnn, fnn, pre, rec, fone = _eval_threshold(rows, model, thr)
                out['grid'].append({
                    'threshold': thr,
                    'tp': tpp, 'fp': fpp, 'tn': tnn, 'fn': fnn,
                    'precision': round(pre, 6), 'recall': round(rec, 6), 'f1': round(fone, 6)
                })
            os.makedirs('out', exist_ok=True)
            with open(os.path.join('out', 'metrics_report.json'), 'w', encoding='utf-8') as fjson:
                json.dump(out, fjson, indent=2)
            header = 'thr,tp,fp,tn,fn,precision,recall,f1,tpr,fpr'
            csv = [header] + [','.join([str(m['thr']),str(m['tp']),str(m['fp']),str(m['tn']),str(m['fn']),str(round(m['precision'],6)),str(round(m['recall'],6)),str(round(m['f1'],6)),str(round(m['tpr'],6)),str(round(m['fpr'],6))]) for m in curve]
            with open(os.path.join('out','metrics_curves.csv'),'w',encoding='utf-8') as fc:
                fc.write('\n'.join(csv))
            print('Wrote: out/metrics_report.json')
        except Exception as e:
            print('metrics_report write failed:', e)
    else:
        tp, fp, tn, fn, precision, recall, f1 = _eval_threshold(rows, model, args.threshold)
        print('Eval results:')
        print('TP:',tp,'FP:',fp,'TN:',tn,'FN:',fn)
        print('precision:',round(precision,4),'recall:',round(recall,4),'f1:',round(f1,4))
        try:
            out = {
                'summary': {
                    'threshold': args.threshold,
                    'tp': tp, 'fp': fp, 'tn': tn, 'fn': fn,
                    'precision': round(precision, 6), 'recall': round(recall, 6), 'f1': round(f1, 6)
                }
            }
            out['summary_ext'] = _derived_metrics(rows, model, args.threshold)
            curve = _roc_pr_curves(ys, ps, [round(x,2) for x in [0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8]])
            out['summary_ext']['roc_auc'] = round(_auc_xy(curve, 'fpr', 'tpr'),6)
            out['summary_ext']['pr_auc'] = round(_auc_xy(curve, 'recall', 'precision'),6)
            out['summary_ext']['ks'] = round(_ks_stat(ys, ps),6)
            os.makedirs('out', exist_ok=True)
            with open(os.path.join('out', 'metrics_report.json'), 'w', encoding='utf-8') as fjson:
                json.dump(out, fjson, indent=2)
            print('Wrote: out/metrics_report.json')
        except Exception as e:
            print('metrics_report write failed:', e)

if __name__ == '__main__':
    main()
