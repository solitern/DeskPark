"""四川麻将导师：对手模型训练。

    conda activate deskpark-ml
    python ml/sc-opponent/train.py                 # 读 ml/sc-opponent/data，训练并评估
    python ml/sc-opponent/train.py --export        # 同上，再把权重写进引擎

输入是 oppFeatures（观察者能看到的、关于某个对手的公开信息，牌种已按「缺门放最后」排好），
输出三组：
- win[k]：对手现在打出 k 就能胡的概率（不以听牌为条件，直接就是「这张会不会点炮」）；
- tenpai：对手已经听牌的概率；
- fan[k]：如果他胡 k，番数的分布（1–5 番，5 番封顶）。
与现有经验公式（opponents.ts）在同样的验证集上对比。
"""

from __future__ import annotations

import argparse
import base64
import json
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.metrics import roc_auc_score

K = 27
LIVE = 18  # 规范顺序里前 18 种是两门非缺门；缺门的 9 种永远胡不了
FAN_CLASSES = 5
ROOT = Path(__file__).resolve().parents[2]


def load(data_dir: Path):
    meta = json.loads((data_dir / "meta.json").read_text())
    nf, nl, nh = meta["features"], meta["labels"], meta["heur"]
    feat, lab, heur, gid = [], [], [], []
    for part in meta["parts"]:
        base = data_dir / part["name"]
        feat.append(np.fromfile(f"{base}.feat.f32", dtype=np.float32).reshape(-1, nf))
        lab.append(np.fromfile(f"{base}.lab.u8", dtype=np.uint8).reshape(-1, nl))
        heur.append(np.fromfile(f"{base}.heur.f32", dtype=np.float32).reshape(-1, nh))
        gid.append(np.fromfile(f"{base}.gid.u32", dtype=np.uint32))
    return meta, np.concatenate(feat), np.concatenate(lab), np.concatenate(heur), np.concatenate(gid)


def kind_perms() -> list[np.ndarray]:
    """四种对称变换：不变、交换两门非缺门、1–9 镜像、两者都做"""
    ident = np.arange(K)
    swap = np.concatenate([np.arange(9, 18), np.arange(0, 9), np.arange(18, 27)])
    mirror = np.array([s * 9 + (8 - r) for s in range(3) for r in range(9)])
    return [ident, swap, mirror, swap[mirror]]


def feature_perm(kperm: np.ndarray, blocks: int, nf: int) -> np.ndarray:
    idx = np.arange(nf)
    for b in range(blocks):
        idx[b * K : (b + 1) * K] = b * K + kperm
    return idx


class OppNet(nn.Module):
    def __init__(self, nf: int, hidden: int):
        super().__init__()
        self.l1 = nn.Linear(nf, hidden)
        self.l2 = nn.Linear(hidden, hidden)
        self.win = nn.Linear(hidden, K)
        self.tenpai = nn.Linear(hidden, 1)
        self.fan = nn.Linear(hidden, K * FAN_CLASSES)

    def forward(self, x):
        h = F.relu(self.l2(F.relu(self.l1(x))))
        return self.win(h), self.tenpai(h).squeeze(-1), self.fan(h).view(-1, K, FAN_CLASSES)


def quantize_(model: OppNet) -> None:
    """按输出行做对称 int8 量化（模拟导出后的精度）"""
    with torch.no_grad():
        for m in [model.l1, model.l2, model.win, model.tenpai, model.fan]:
            w = m.weight
            scale = w.abs().amax(dim=1, keepdim=True).clamp_min(1e-8) / 127
            m.weight.copy_(torch.round(w / scale).clamp(-127, 127) * scale)


def logloss(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean())


@torch.no_grad()
def predict(model: OppNet, x: torch.Tensor, bs: int = 65536):
    win, ten, fan = [], [], []
    for i in range(0, len(x), bs):
        w, t, f = model(x[i : i + bs].float())
        win.append(torch.sigmoid(w).cpu())
        ten.append(torch.sigmoid(t).cpu())
        fan.append(torch.softmax(f, -1).cpu())
    return torch.cat(win).numpy(), torch.cat(ten).numpy(), torch.cat(fan).numpy()


def evaluate(model, xv, lab_v, heur_v, lam: float) -> dict:
    pw, pt, pf = predict(model, xv)
    win = lab_v[:, :K].astype(np.float32)
    fan = lab_v[:, K : 2 * K].astype(np.float32)
    ten = lab_v[:, 2 * K].astype(np.float32)
    hw = np.clip(heur_v[:, 1 : 1 + K], 0, 1)
    hf = heur_v[:, 1 + K :]
    ht = heur_v[:, 0]
    out = {}
    yw, pm, ph = win[:, :LIVE].ravel(), pw[:, :LIVE].ravel(), hw[:, :LIVE].ravel()
    out["win_logloss"] = (logloss(yw, pm), logloss(yw, ph))
    out["win_auc"] = (roc_auc_score(yw, pm), roc_auc_score(yw, ph))
    out["tenpai_logloss"] = (logloss(ten, pt), logloss(ten, np.clip(ht, 0, 1)))
    out["tenpai_auc"] = (roc_auc_score(ten, pt), roc_auc_score(ten, ht))
    # 番数：只看真能胡的牌
    mask = win > 0
    fan_c = np.clip(fan, 1, FAN_CLASSES)
    exp_fan = (pf * np.arange(1, FAN_CLASSES + 1)).sum(-1)
    out["fan_mae"] = (
        float(np.abs(exp_fan[mask] - fan_c[mask]).mean()),
        float(np.abs(np.clip(hf, 1, 5)[mask] - fan_c[mask]).mean()),
    )
    # 放炮损失（以底分 1 计）：真实 = 能胡 × 2^(番−1)；预测 = P(能胡) × E[分]
    true_loss = win * np.power(2.0, fan_c - 1)
    exp_pts = (pf * np.power(2.0, np.arange(FAN_CLASSES))).sum(-1)
    pred_loss = pw * exp_pts
    heur_loss = hw * np.power(2.0, np.clip(hf, 1, 5) - 1) * lam
    t, m, h = true_loss[:, :LIVE].ravel(), pred_loss[:, :LIVE].ravel(), heur_loss[:, :LIVE].ravel()
    out["loss_mse"] = (float(((m - t) ** 2).mean()), float(((h - t) ** 2).mean()))
    out["loss_corr"] = (float(np.corrcoef(m, t)[0, 1]), float(np.corrcoef(h, t)[0, 1]))
    out["base_rates"] = {"win": float(yw.mean()), "tenpai": float(ten.mean())}
    # 校准：按预测概率分箱，看真实频率
    bins = np.linspace(0, 1, 11)
    which = np.digitize(pm, bins) - 1
    out["calibration"] = [
        (round(float(pm[which == b].mean()), 3), round(float(yw[which == b].mean()), 3), int((which == b).sum()))
        for b in range(10)
        if (which == b).sum() > 100
    ]
    return out


def export(model: OppNet, nf: int, hidden: int, out_path: Path, version: int, metrics: dict) -> None:
    """int8 权重 + 每行一个 float32 缩放 + float32 偏置，按层顺序拼成一段 base64"""
    chunks: list[bytes] = []
    layers = []
    with torch.no_grad():
        for name, m in [("l1", model.l1), ("l2", model.l2), ("win", model.win), ("tenpai", model.tenpai), ("fan", model.fan)]:
            w = m.weight.detach().cpu().float()
            scale = w.abs().amax(dim=1).clamp_min(1e-8) / 127
            q = torch.round(w / scale[:, None]).clamp(-127, 127).to(torch.int8)
            chunks += [q.numpy().tobytes(), scale.numpy().astype("<f4").tobytes(), m.bias.detach().cpu().numpy().astype("<f4").tobytes()]
            layers.append({"name": name, "out": w.shape[0], "in": w.shape[1]})
    blob = base64.b64encode(b"".join(chunks)).decode()
    lines = [blob[i : i + 100] for i in range(0, len(blob), 100)]
    body = "\n".join(f"  '{line}' +" for line in lines)[:-2]
    out_path.write_text(
        "// 由 ml/sc-opponent/train.py 生成，请勿手改。\n"
        f"// 验证集：能否胡某张牌 AUC {metrics['win_auc'][0]:.3f}（经验公式 {metrics['win_auc'][1]:.3f}），"
        f"听牌 AUC {metrics['tenpai_auc'][0]:.3f}（经验公式 {metrics['tenpai_auc'][1]:.3f}）。\n"
        "// 每层依次是：int8 权重（out × in，按行）、每行一个 float32 缩放、float32 偏置。\n"
        "export const OPP_NET = {\n"
        f"  version: {version},\n"
        f"  features: {nf},\n"
        f"  hidden: {hidden},\n"
        f"  fanClasses: {FAN_CLASSES},\n"
        f"  layers: {json.dumps(layers)},\n"
        "  data:\n"
        f"{body},\n"
        "};\n"
    )
    print(f"导出 {out_path}（{len(blob) // 1024} KB base64）")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "ml/sc-opponent/data"))
    ap.add_argument("--hidden", type=int, default=128)
    ap.add_argument("--epochs", type=int, default=10)
    ap.add_argument("--batch", type=int, default=4096)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--lam", type=float, default=1.25, help="经验公式里的 λ（对比用）")
    ap.add_argument("--export", action="store_true")
    ap.add_argument("--out", default=str(ROOT / "packages/engine/src/games/sichuan/coach/oppnet-weights.ts"))
    args = ap.parse_args()

    torch.manual_seed(0)
    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    t0 = time.time()
    meta, feat, lab, heur, gid = load(Path(args.data))
    nf = meta["features"]
    blocks = (nf - 9) // K
    print(f"读入 {len(feat)} 条样本（{meta['games']} 局），特征 {nf} 维，设备 {dev}，{time.time() - t0:.0f} 秒")

    val = gid % 10 == 0
    xt = torch.from_numpy(feat[~val]).to(dev, torch.float16)
    yt = torch.from_numpy(lab[~val]).to(dev)
    xv = torch.from_numpy(feat[val]).to(dev, torch.float16)
    kp = [torch.from_numpy(p).to(dev) for p in kind_perms()]
    fp = torch.stack([torch.from_numpy(feature_perm(p, blocks, nf)) for p in kind_perms()]).to(dev)
    lp = torch.stack(kp)

    model = OppNet(nf, args.hidden).to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    steps = args.epochs * (len(xt) // args.batch)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=steps, pct_start=0.1)
    print(f"训练 {len(xt)} 条，验证 {len(xv)} 条；参数 {sum(p.numel() for p in model.parameters())} 个")

    step = 0
    for ep in range(args.epochs):
        model.train()
        perm = torch.randperm(len(xt), device=dev)
        tot = 0.0
        for i in range(0, len(xt) - args.batch + 1, args.batch):
            idx = perm[i : i + args.batch]
            x, y = xt[idx].float(), yt[idx]
            # 对称增强：每条样本随机选一种变换
            pid = torch.randint(0, 4, (len(idx),), device=dev)
            x = x.gather(1, fp[pid])
            kperm = lp[pid]
            win = y[:, :K].float().gather(1, kperm)
            fan = y[:, K : 2 * K].long().gather(1, kperm)
            ten = y[:, 2 * K].float()
            pw, pt, pf = model(x)
            mask = win > 0
            loss = F.binary_cross_entropy_with_logits(pw, win) * K / 4 + F.binary_cross_entropy_with_logits(pt, ten)
            if mask.any():
                target = (fan.clamp(1, FAN_CLASSES) - 1)[mask]
                loss = loss + 0.5 * F.cross_entropy(pf[mask], target)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            sched.step()
            tot += loss.item()
            step += 1
        print(f"第 {ep + 1} 轮  训练损失 {tot / (len(xt) // args.batch):.4f}  {time.time() - t0:.0f} 秒")

    model.eval()
    m = evaluate(model, xv, lab[val], heur[val], args.lam)
    quantize_(model)
    mq = evaluate(model, xv, lab[val], heur[val], args.lam)
    print("\n验证集（模型 vs 经验公式）：")
    for key in ["win_logloss", "win_auc", "tenpai_logloss", "tenpai_auc", "fan_mae", "loss_mse", "loss_corr"]:
        print(f"  {key:15s} 模型 {m[key][0]:.4f}  int8 {mq[key][0]:.4f}  经验公式 {m[key][1]:.4f}")
    print(f"  基准频率 {m['base_rates']}")
    print(f"  校准（预测, 实际, 样本）{m['calibration']}")
    if args.export:
        export(model, nf, args.hidden, Path(args.out), meta["version"], mq)
        # 一致性样例：TypeScript 推理要算出同样的结果（packages/engine/test/sccoach.test.ts 会检查）
        pick = np.arange(0, len(xv), len(xv) // 24)[:24]
        pw, pt, pf = predict(model, xv[pick])
        check = {
            "x": [[round(float(v), 6) for v in row] for row in xv[pick].float().cpu().numpy()],
            "win": pw.round(6).tolist(),
            "tenpai": pt.round(6).tolist(),
            "fan": pf.reshape(len(pick), -1).round(6).tolist(),
        }
        path = ROOT / "packages/engine/test/fixtures/oppnet-check.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(check))
        print(f"一致性样例 {path}")


if __name__ == "__main__":
    main()
