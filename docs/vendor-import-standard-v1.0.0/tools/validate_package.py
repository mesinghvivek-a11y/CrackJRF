#!/usr/bin/env python3
"""Validate a CrackJRF import package. Uses only the Python standard library."""
from __future__ import annotations
import argparse, hashlib, json, re, sys
from pathlib import Path

EXPECTED = ["manifest.json", "questions_common.json", "questions_en.json", "qa_report.json", "assets/asset_manifest.json"]
FORBIDDEN_CLASSIFICATION_KEYS = {"unit", "unit_code", "topic", "topic_code", "subtopic", "subtopic_code", "classifications", "keywords", "tags", "syllabus_node_id", "node_id"}

def fail(errors, message): errors.append(message)
def read_json(path, errors):
    try:
        with path.open("r", encoding="utf-8") as f: return json.load(f)
    except Exception as exc:
        fail(errors, f"Cannot read valid UTF-8 JSON {path}: {exc}"); return None

def walk_keys(value, path="$", found=None):
    found = found or []
    if isinstance(value, dict):
        for key, child in value.items():
            if key.lower() in FORBIDDEN_CLASSIFICATION_KEYS: found.append(f"{path}.{key}")
            walk_keys(child, f"{path}.{key}", found)
    elif isinstance(value, list):
        for i, child in enumerate(value): walk_keys(child, f"{path}[{i}]", found)
    return found

def sha256(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024), b""): h.update(chunk)
    return h.hexdigest()

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("package_dir", type=Path); args=ap.parse_args()
    root=args.package_dir.resolve(); errors=[]; warnings=[]
    if not root.is_dir(): print(f"Not a directory: {root}"); return 2
    for rel in EXPECTED:
        if not (root/rel).is_file(): fail(errors, f"Required file missing: {rel}")
    if errors: print("\n".join("ERROR: "+x for x in errors)); return 1
    manifest=read_json(root/"manifest.json", errors); common=read_json(root/"questions_common.json", errors); en=read_json(root/"questions_en.json", errors); hi=read_json(root/"questions_hi.json", errors) if (root/"questions_hi.json").exists() else None
    qa=read_json(root/"qa_report.json", errors); assets=read_json(root/"assets/asset_manifest.json", errors)
    for obj,name in [(manifest,"manifest"),(common,"common"),(en,"English"),(qa,"QA report"),(assets,"asset manifest")]:
        if isinstance(obj,dict) and obj.get("schema_version")!="1.0.0": fail(errors, f"{name}: schema_version must be 1.0.0")
    if errors: print("\n".join("ERROR: "+x for x in errors)); return 1
    pkg=manifest.get("package_id")
    for obj,name in [(common,"common"),(en,"English"),(qa,"QA report"),(assets,"asset manifest")]+([(hi,"Hindi")] if hi else []):
        if obj.get("package_id")!=pkg: fail(errors, f"{name}: package_id does not match manifest")
    if manifest.get("schema_name")!="crackjrf-question-package": fail(errors,"manifest: unexpected schema_name")
    if manifest.get("question_sequence",{}).get("order_preserved") is not True: fail(errors,"manifest: official NTA order must be declared preserved")
    if manifest.get("languages",{}).get("primary")!="en": fail(errors,"manifest: primary language must be en for this release")
    if "en" not in manifest.get("languages",{}).get("available",[]): fail(errors,"manifest: English must be available")
    cqs=common.get("questions",[]); eqs=en.get("questions",[]); hqs=hi.get("questions",[]) if hi else []
    if len(cqs)!=manifest.get("question_sequence",{}).get("total_questions"): fail(errors,"common question count differs from manifest total_questions")
    if len(eqs)!=len(cqs): fail(errors,"English question count must equal common question count")
    if qa.get("delivered_question_count")!=len(cqs): warnings.append("QA delivered_question_count differs from common question count")
    if qa.get("question_order_preserved") is not True: fail(errors,"QA report must confirm question_order_preserved=true")
    common_by={}; en_by={}; hi_by={}
    for q in cqs:
        bid=q.get("base_question_id")
        if not bid: fail(errors,"common question missing base_question_id"); continue
        if bid in common_by: fail(errors,f"duplicate base_question_id in common file: {bid}")
        common_by[bid]=q
    for label, rows, target in [("English",eqs,en_by),("Hindi",hqs,hi_by)]:
        for q in rows:
            bid=q.get("base_question_id")
            if bid in target: fail(errors,f"duplicate {label} base_question_id: {bid}")
            target[bid]=q
    if hi and "hi" not in manifest.get("languages",{}).get("available",[]): fail(errors,"Hindi file supplied but manifest does not list hi")
    if hi and set(hi_by)-set(common_by): fail(errors,"Hindi file contains base IDs absent from common file")
    if set(en_by)!=set(common_by): fail(errors,"English base_question_id set must exactly match common file")
    for lang, rows, suffix in [("en",en_by,"E"),("hi",hi_by,"H")]:
        for bid,q in rows.items():
            if bid not in common_by: continue
            expected=(common_by[bid].get("language_question_codes") or {}).get(lang)
            code=q.get("language_question_code")
            if not expected and lang=="hi": continue
            if code!=expected: fail(errors,f"{bid}: {lang} language code mismatch between common and language file")
            if not isinstance(code,str) or not code.endswith(suffix): fail(errors,f"{bid}: {lang} code must end with {suffix}")
            if q.get("question_crop_asset_id"):
                pass
            opts=q.get("options",[])
            if len(opts)!=4: fail(errors,f"{bid}: {lang} file must contain exactly four options")
            copt=common_by[bid].get("options",[])
            sig=[(o.get("option_id"),o.get("key")) for o in copt]
            lsig=[(o.get("option_id"),o.get("key")) for o in opts]
            if sig!=lsig: fail(errors,f"{bid}: {lang} option IDs/keys/order do not match common file")
    seen_orders=[]
    for bid,q in common_by.items():
        order=q.get("order_index")
        if not isinstance(order,int) or order<1: fail(errors,f"{bid}: invalid order_index")
        else: seen_orders.append(order)
        if any(k.lower() in FORBIDDEN_CLASSIFICATION_KEYS for k in q.keys()): fail(errors,f"{bid}: provider must not assign syllabus classification or keywords")
        option_keys=[o.get("key") for o in q.get("options",[])]
        if option_keys!=["A","B","C","D"]: fail(errors,f"{bid}: common options must be A, B, C, D in official order")
        opt_ids=[o.get("option_id") for o in q.get("options",[])]
        if len(set(opt_ids))!=len(opt_ids): fail(errors,f"{bid}: duplicate option_id")
        ans=q.get("answer",{})
        allowed=set(option_keys)
        if not set(ans.get("proposed_correct_option_keys",[])).issubset(allowed): fail(errors,f"{bid}: answer references an unknown option key")
        if ans.get("resolution")=="unknown" and ans.get("proposed_correct_option_keys"): fail(errors,f"{bid}: unknown answer must not contain proposed correct options")
        source_ids={d.get("source_document_id") for d in manifest.get("source_documents",[])}
        for ref in q.get("source_references",[]):
            if ref.get("source_document_id") not in source_ids: fail(errors,f"{bid}: source reference points to unknown source_document_id")
        for ev in ans.get("evidence",[]):
            if ev.get("source_document_id") not in source_ids: fail(errors,f"{bid}: answer evidence points to unknown source_document_id")
    if seen_orders and sorted(seen_orders)!=list(range(1,len(common_by)+1)): fail(errors,"order_index values must be unique and contiguous from 1 to total question count")
    asset_rows=assets.get("assets",[]); asset_by={}
    for a in asset_rows:
        aid=a.get("asset_id")
        if aid in asset_by: fail(errors,f"duplicate asset_id: {aid}")
        asset_by[aid]=a
        rel=a.get("filename","")
        fp=(root/rel).resolve()
        if not str(fp).startswith(str(root)+"/"): fail(errors,f"asset path escapes package: {rel}"); continue
        if not fp.is_file(): fail(errors,f"asset file missing: {rel}"); continue
        if sha256(fp).lower()!=str(a.get("sha256","")).lower(): fail(errors,f"asset SHA-256 mismatch: {rel}")
    for label, rows in [("common",cqs),("English",eqs),("Hindi",hqs)]:
        for q in rows:
            bid=q.get("base_question_id")
            refs=[]
            if label=="common": refs=q.get("media_asset_ids",[])
            else: refs=(q.get("media_asset_ids",[]) + ([q.get("question_crop_asset_id")] if q.get("question_crop_asset_id") else []))
            for aid in refs:
                if aid not in asset_by: fail(errors,f"{label} {bid}: asset reference not found: {aid}")
    if hi is None and "hi" in manifest.get("languages",{}).get("available",[]): fail(errors,"manifest lists Hindi but questions_hi.json is missing")
    if errors:
        print(f"INVALID PACKAGE: {len(errors)} error(s), {len(warnings)} warning(s)")
        for e in errors: print("ERROR:",e)
        for w in warnings: print("WARNING:",w)
        return 1
    print(f"VALID PACKAGE: {len(cqs)} common questions, {len(eqs)} English, {len(hqs)} Hindi, {len(asset_rows)} assets")
    for w in warnings: print("WARNING:",w)
    print("Note: schema validation does not verify academic correctness or syllabus classification.")
    return 0

if __name__=="__main__": sys.exit(main())
