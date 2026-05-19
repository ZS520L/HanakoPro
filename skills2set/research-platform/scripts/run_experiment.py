#!/usr/bin/env python3
"""实验执行脚本 — 设计并执行 ML 实验（Docker + GPU）"""

import argparse, json, sys, time, sqlite3

def main():
    p = argparse.ArgumentParser(description="实验执行")
    p.add_argument("--hypothesis", type=int, default=1, help="假设编号")
    p.add_argument("--db", required=True)
    p.add_argument("--output-dir", default="experiments/")
    p.add_argument("--dry-run", action="store_true", help="仅设计方案，不执行")
    args = p.parse_args()

    conn = sqlite3.connect(args.db)
    cur = conn.cursor()
    cur.execute("SELECT title, citation_count FROM papers WHERE is_oa=1 ORDER BY citation_count DESC LIMIT 5")
    baselines = cur.fetchall()
    conn.close()

    plan = {
        "hypothesis_id": args.hypothesis,
        "datasets": ["CIFAR-10", "CIFAR-100"],
        "baselines": [t for t, _ in baselines[:4]] if baselines else ["ResNet-18", "ViT-S", "Swin-T"],
        "ablations": ["component_a", "component_b", "learning_rate", "batch_size"],
        "seeds": 5,
        "total_experiments": 2 * (4+1) * 5,  # datasets × (baselines+ours) × seeds
        "estimated_time": "~2h (single 4090)",
        "status": "dry-run" if args.dry_run else "pending"
    }

    output = {
        "plan": plan,
        "experiments": [],
        "summary": "实验方案已生成。请确认后执行。"
    }

    import os
    os.makedirs(args.output_dir, exist_ok=True)
    path = f"{args.output_dir}/plan_{args.hypothesis}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"🧪 实验方案: {plan['total_experiments']} 个实验", file=sys.stderr)
    print(f"📊 数据集: {plan['datasets']}", file=sys.stderr)
    print(f"📋 Baseline: {plan['baselines']}", file=sys.stderr)
    print(f"⏱ 预计: {plan['estimated_time']}", file=sys.stderr)
    print(f"💾 保存至: {path}", file=sys.stderr)

    if args.dry_run:
        print("⚠ 仅设计模式，未执行实验。", file=sys.stderr)
    else:
        print("⚠ 实验执行需要 Docker + GPU + PyTorch 环境。", file=sys.stderr)
        print("  请使用 OpenHanako 终端执行实际的训练脚本。", file=sys.stderr)

if __name__ == "__main__":
    main()
