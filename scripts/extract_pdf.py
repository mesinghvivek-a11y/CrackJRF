#!/usr/bin/env python3
"""Extract page text and OCR candidates from NTA/private UGC NET PDFs.

This is a staging importer, not a publish-ready question parser. It deliberately preserves
page provenance and marks every candidate for human segmentation/review. The NTA 2025
sample contains native metadata while much of the visible question body is embedded as
page images, so OCR is run when native text appears incomplete.
"""
from __future__ import annotations
import argparse, hashlib, json, re, sys
from pathlib import Path
from typing import Any

try:
    import fitz  # PyMuPDF
    import pytesseract
    from PIL import Image
except ImportError as exc:
    print(f"Missing dependency: {exc}. Install with: pip install -r scripts/requirements.txt", file=sys.stderr)
    raise SystemExit(2)

QUESTION_RE = re.compile(r"Question\s*(?:Number|No\.?)[\s:]*([0-9]{1,4})(?:\s+Question\s+Id\s*:\s*([0-9]+))?", re.I)

def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""): h.update(chunk)
    return h.hexdigest()

def ocr_page(page: fitz.Page, lang: str, dpi: int) -> tuple[str,str]:
    pix=page.get_pixmap(dpi=dpi, alpha=False)
    from io import BytesIO
    image=Image.open(BytesIO(pix.tobytes("png")))
    try:
        return pytesseract.image_to_string(image, lang=lang, config="--psm 6"), lang
    except pytesseract.TesseractError:
        fallback="eng" if "eng" in pytesseract.get_languages(config="") else pytesseract.get_languages(config="")[0]
        return pytesseract.image_to_string(image, lang=fallback, config="--psm 6"), fallback

def detect_language(text: str) -> str:
    devanagari=len(re.findall(r"[\u0900-\u097F]",text))
    latin=len(re.findall(r"[A-Za-z]",text))
    if devanagari > max(12, latin * 0.15): return "hi"
    if latin > 12: return "en"
    return "unknown"

def strip_nta_option_ids(text: str) -> str:
    # NTA's long numeric option IDs are source-system identifiers, not student-facing options.
    lines=[]
    for line in text.splitlines():
        if re.match(r"^\s*\d{9,}\s*[.)]\s*\S+",line):
            continue
        lines.append(line)
    return "\n".join(lines).strip()

def detect_paper_number(text: str, default_paper: int | None) -> int | None:
    """Infer paper from exact section headings; admin must confirm combined-source assignments."""
    lines=[re.sub(r"[^a-z]", "", line.lower()) for line in text.splitlines()]
    if any(line == "generalpaper" for line in lines): return 1
    if any(line == "geography" for line in lines): return 2
    return default_paper

def split_candidates(text: str, page_no: int, paper_number: int | None) -> list[dict[str,Any]]:
    matches=list(QUESTION_RE.finditer(text))
    if not matches:
        # Keep non-question material (cover pages, section metadata, shared stimuli) in import_job_pages.
        # Only create a source-item candidate when the page resembles an MCQ fragment.
        stripped=text.strip()
        looks_like_question=bool(re.search(r"(?im)^\s*(?:options\s*:|\(?\s*[1-4]\s*\)?[.)])", stripped))
        if not stripped or not looks_like_question: return []
        return [{"source_page_start":page_no,"source_page_end":page_no,"source_question_number":None,"source_native_question_id":None,"paper_number":paper_number,"language":detect_language(stripped),"raw_text":strip_nta_option_ids(stripped),"segmentation_status":"needs_review","warnings":["Question boundary could not be identified; manually segment the page."]}]
    out=[]
    for i,m in enumerate(matches):
        start=m.start();end=matches[i+1].start() if i+1<len(matches) else len(text)
        chunk=strip_nta_option_ids(text[start:end].strip())
        language=detect_language(chunk)
        out.append({"source_page_start":page_no,"source_page_end":page_no,"source_question_number":m.group(1),"source_native_question_id":m.group(2),"paper_number":paper_number,"language":language,"raw_text":chunk,"segmentation_status":"needs_review","warnings":["OCR/native text boundary is a candidate; confirm the visible question and options.","Language was estimated from the script and must be verified.","Opaque NTA option IDs were discarded; local A/B/C/D keys are assigned during review."]})
    return out

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("pdf",type=Path)
    ap.add_argument("--out",type=Path,default=Path("imports/ocr"))
    ap.add_argument("--source-type",choices=["nta_official","private_solution","official_answer_key","other"],default="nta_official")
    ap.add_argument("--subject-code",default="80")
    ap.add_argument("--paper",type=int,choices=[0,1,2],default=2,help="1=Paper I, 2=Paper II, 0=combined Paper I + Paper II (page headings are detected heuristically)")
    ap.add_argument("--year",type=int,default=None)
    ap.add_argument("--session",choices=["June","December","Other"],default="Other")
    ap.add_argument("--lang",default="eng+hin")
    ap.add_argument("--dpi",type=int,default=220)
    ap.add_argument("--start-page",type=int,default=1)
    ap.add_argument("--max-pages",type=int,default=None)
    ap.add_argument("--force-ocr",action="store_true")
    args=ap.parse_args()
    if not args.pdf.exists(): ap.error(f"PDF not found: {args.pdf}")
    args.out.mkdir(parents=True,exist_ok=True)
    doc=fitz.open(args.pdf)
    pages=[];items=[]
    current_paper: int | None = (None if args.paper == 0 else args.paper)
    print(f"Processing {args.pdf.name}: {len(doc)} pages",flush=True)
    last_page=min(len(doc), args.start_page-1+(args.max_pages or len(doc)))
    for index in range(args.start_page-1,last_page):
        page=doc[index]
        page_no=index+1
        native=page.get_text("text") or ""
        # NTA response-sheet PDFs may expose metadata but leave the question body as images.
        incomplete=len(re.sub(r"\s+","",native))<120 or ("Question Number" in native and len(native.strip())<900)
        if args.force_ocr or incomplete:
            ocr,used_lang=ocr_page(page,args.lang,args.dpi)
            text=ocr
            method="ocr"
        else:
            text=native
            used_lang="embedded"
            method="embedded_text"
        detected_paper=detect_paper_number(text, current_paper)
        if detected_paper is not None: current_paper=detected_paper
        page_paper = detected_paper if args.paper == 0 else args.paper
        combined={"page_number":page_no,"paper_number":page_paper,"extraction_method":method,"ocr_language":used_lang,"native_text":native,"extracted_text":text,"warnings":[]}
        if method=="ocr" and len(text.strip())<20: combined["warnings"].append("OCR returned very little text; manual visual inspection required.")
        pages.append(combined)
        page_items=split_candidates(text,page_no,page_paper)
        for item in page_items:
            item["extraction_method"]=method
            item["ocr_language"]=used_lang
            item["source_type"]=args.source_type
            item["match_status"]="not_matched"
            items.append(item)
        if page_no%10==0 or page_no==len(doc): print(f"  {page_no}/{len(doc)} pages",flush=True)
    payload={
      "schema_version":"1.0",
      "source_document":{"file_name":args.pdf.name,"sha256":sha256(args.pdf),"source_type":args.source_type,"subject_code":args.subject_code,"paper_number":(None if args.paper == 0 else args.paper),"paper_scope":("combined" if args.paper == 0 else f"paper{args.paper}"),"year":args.year,"session":args.session,"page_count":len(doc)},
      "extraction":{"engine":"PyMuPDF + Tesseract","dpi":args.dpi,"requested_languages":args.lang,"created_for":"staging_only"},
      "pages":pages,
      "processed_page_count":len(pages),
      "items":items,
      "warnings":["All extracted items require human review.","Do not infer correct answers from the official question paper. Load answer evidence as a separate source.","English and Hindi renderings of one examination item must be linked as translations, not counted as separate questions.","For combined PDFs, paper_number is inferred from page section headings where possible; confirm or correct each staging item in the Admin Panel before creating a canonical question."]
    }
    out_file=args.out/(args.pdf.stem+".extraction.json")
    out_file.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"Saved {out_file} with {len(items)} page-level question candidates. Review and segment before database import.")

if __name__=="__main__": main()
