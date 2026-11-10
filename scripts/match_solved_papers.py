#!/usr/bin/env python3
"""Suggest content matches between official and solved-paper extraction JSON files.

Input files should contain items with question_text/raw_text and optional options list.
Scores are suggestions only. This script never copies or verifies answer keys.
"""
import argparse, json, re
from pathlib import Path
from difflib import SequenceMatcher

try:
    from rapidfuzz import fuzz
except ImportError:
    fuzz=None

def normalize(s):
    s=(s or "").lower()
    s=re.sub(r"question\s*(number|no\.?)[\s:]*\d+"," ",s)
    s=re.sub(r"[^\w\s]"," ",s)
    return " ".join(s.split())

def similarity(a,b):
    aa=normalize(a);bb=normalize(b)
    if not aa or not bb:return 0.0
    if fuzz:return max(fuzz.token_set_ratio(aa,bb),fuzz.ratio(aa,bb)) / 100
    return SequenceMatcher(None,aa,bb).ratio()

def clean_raw_text(text):
    kept=[]
    for line in (text or "").splitlines():
        low=line.lower().strip()
        if re.match(r"question\s*(number|no\.?)[\s:]*\d+",low): continue
        if "question id" in low or "question mandatory" in low or "correct marks" in low or "wrong marks" in low: continue
        if low.startswith("options") or re.match(r"^\s*\d{9,}\s*[.)]",line): continue
        kept.append(line)
    return " ".join(kept)

def body(item):
    text=item.get("question_text") or item.get("extracted_text") or clean_raw_text(item.get("raw_text") or "")
    opts=item.get("options") or []
    if isinstance(opts,list): text += " " + " ".join(str(x.get("text",x)) if isinstance(x,dict) else str(x) for x in opts)
    return text

def main():
    p=argparse.ArgumentParser();p.add_argument("official",type=Path);p.add_argument("solved",type=Path);p.add_argument("--out",type=Path,default=Path("matches.suggestions.json"));p.add_argument("--top",type=int,default=3);args=p.parse_args()
    official=json.loads(args.official.read_text(encoding="utf-8"));solved=json.loads(args.solved.read_text(encoding="utf-8"));
    a=official.get("items",[]);b=solved.get("items",[]);results=[]
    for oi,op in enumerate(a):
        scores=sorted(((similarity(body(op),body(sp)),si,sp) for si,sp in enumerate(b)),key=lambda x:x[0],reverse=True)[:args.top]
        for score,si,sp in scores:
            results.append({"official_item_index":oi,"official_page":op.get("source_page_start"),"official_question_number":op.get("source_question_number"),"supporting_item_index":si,"supporting_page":sp.get("source_page_start"),"supporting_question_number":sp.get("source_question_number"),"similarity_score":round(score,4),"match_status":"candidate","requires_human_confirmation":True,"answer_copy_allowed":False})
    args.out.write_text(json.dumps({"schema_version":"1.0","match_policy":"suggestions_only","results":results},ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"Wrote {len(results)} candidate pairs to {args.out}. No match or answer was auto-confirmed.")
if __name__=="__main__":main()
