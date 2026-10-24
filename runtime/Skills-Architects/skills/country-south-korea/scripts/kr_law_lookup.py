#!/usr/bin/env python3
"""
Korean Law & Municipal Ordinance Live Lookup CLI (kr_law_lookup.py)
Queries the Ministry of Government Legislation (법제처 국가법령정보센터) Open API
using LAW_OC (default: "wanhee") with browser User-Agent header to retrieve:
- National Statutes & Enforcement Decrees (target="law")
- Municipal Ordinances / 자치법규·조례 (target="ordin")
- Administrative Rules / 행정규칙·고시 (target="admrul")

Outputs structured JSON including an EvidenceRecord block ready for
korea-evidence-report.
"""

import argparse
import datetime
import json
import os
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


DEFAULT_OC = os.environ.get("LAW_OC", "wanhee")
BASE_SEARCH_URL = "http://www.law.go.kr/DRF/lawSearch.do"
BASE_SERVICE_URL = "http://www.law.go.kr/DRF/lawService.do"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)


def fetch_xml(url: str, timeout: int = 15) -> ET.Element:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/xml, text/xml, */*",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return ET.fromstring(raw)


def format_article_code(article: str) -> str:
    """Convert article string like '119' or '34-2' to 6-digit JO code (e.g. '011900', '003402')."""
    if not article:
        return ""
    cleaned = article.strip().replace("제", "").replace("조", "")
    if "의" in cleaned:
        parts = cleaned.split("의", 1)
    elif "-" in cleaned:
        parts = cleaned.split("-", 1)
    else:
        parts = [cleaned, "0"]
    main_no = int(parts[0])
    sub_no = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
    return f"{main_no:04d}{sub_no:02d}"


def search_items(target: str, query: str, oc: str, display: int = 20):
    params = {
        "OC": oc,
        "target": target,
        "type": "XML",
        "query": query,
        "display": str(max(display, 30)),
    }
    url = f"{BASE_SEARCH_URL}?{urllib.parse.urlencode(params)}"
    root = fetch_xml(url)

    items = []
    if target == "law":
        for node in root.findall(".//law"):
            items.append({
                "mst": node.findtext("법령일련번호", ""),
                "law_id": node.findtext("법령ID", ""),
                "name": node.findtext("법령명한글", ""),
                "type_name": node.findtext("법령구분명", ""),
                "ministry": node.findtext("소관부처명", ""),
                "proclamation_date": node.findtext("공포일자", ""),
                "effective_date": node.findtext("시행일자", ""),
                "detail_link": node.findtext("법령상세링크", ""),
            })
    elif target == "ordin":
        for node in root.findall(".//law"):
            items.append({
                "mst": node.findtext("자치법규일련번호", ""),
                "ordin_id": node.findtext("자치법규ID", ""),
                "name": node.findtext("자치법규명", ""),
                "municipality": node.findtext("지자체기관명", ""),
                "type_name": node.findtext("자치법규종류", ""),
                "proclamation_date": node.findtext("공포일자", ""),
                "effective_date": node.findtext("시행일자", ""),
                "detail_link": node.findtext("자치법규상세링크", ""),
            })
    elif target == "admrul":
        for node in root.findall(".//admrul"):
            items.append({
                "mst": node.findtext("행정규칙일련번호", ""),
                "admrul_id": node.findtext("행정규칙ID", ""),
                "name": node.findtext("행정규칙명", ""),
                "type_name": node.findtext("행정규칙종류", ""),
                "ministry": node.findtext("소관부처명", ""),
                "issue_date": node.findtext("발령일자", ""),
                "effective_date": node.findtext("시행일자", ""),
                "detail_link": node.findtext("행정규칙상세링크", ""),
            })
    q_norm = query.replace(" ", "")
    items.sort(key=lambda x: (0 if x.get("name", "").replace(" ", "") == q_norm else 1))
    return items[:display], url


def fetch_article_detail(target: str, mst: str, article: str, keyword: str, oc: str):
    params = {
        "OC": oc,
        "target": target,
        "type": "XML",
        "MST": mst,
    }
    jo_code = format_article_code(article) if (article and not keyword) else ""
    if jo_code and target == "law":
        params["JO"] = jo_code

    url = f"{BASE_SERVICE_URL}?{urllib.parse.urlencode(params)}"
    root = fetch_xml(url)
    articles = []

    if target == "law":
        for unit in root.findall(".//조문단위"):
            jo_no = unit.findtext("조문번호", "")
            jo_sub = unit.findtext("조문가지번호", "")
            jo_title = unit.findtext("조문제목", "")
            jo_text = (unit.findtext("조문내용", "") or "").strip()
            hang_texts = []
            for hang in unit.findall(".//항"):
                h_content = (hang.findtext("항내용", "") or "").strip()
                if h_content:
                    hang_texts.append(h_content)
                for ho in hang.findall(".//호"):
                    ho_content = (ho.findtext("호내용", "") or "").strip()
                    if ho_content:
                        hang_texts.append("  " + ho_content)
            full_blob = jo_title + " " + jo_text + " " + " ".join(hang_texts)
            if keyword and keyword not in full_blob:
                continue
            articles.append({
                "article_no": f"{jo_no}" + (f"의{jo_sub}" if jo_sub else ""),
                "title": jo_title,
                "content": jo_text,
                "paragraphs": hang_texts,
            })
    elif target == "ordin":
        art_clean = article.strip().replace("제", "").replace("조", "").replace("-", "의") if article else ""
        target_prefix = f"제{art_clean}조(" if art_clean else ""
        target_prefix_space = f"제{art_clean}조 " if art_clean else ""
        for unit in root.findall(".//조"):
            jo_title = (unit.findtext("조제목", "") or "").strip()
            jo_content = (unit.findtext("조내용", "") or "").strip()
            if not jo_content:
                continue
            if art_clean:
                if not (jo_content.startswith(target_prefix) or jo_content.startswith(target_prefix_space)):
                    continue
            if keyword and (keyword not in jo_title and keyword not in jo_content):
                continue
            articles.append({
                "title": jo_title,
                "content": jo_content,
            })

    return articles[:10], url


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(
        description="Query Korean National Law Information Center (law.go.kr) Open API."
    )
    parser.add_argument(
        "--target",
        choices=["law", "ordin", "admrul"],
        default="law",
        help="Target type: law (법령), ordin (자치법규/조례), admrul (행정규칙/고시)",
    )
    parser.add_argument(
        "--query",
        required=True,
        help="Search keyword (e.g., '건축법 시행령', '서울특별시 도시계획 조례')",
    )
    parser.add_argument(
        "--article",
        default=None,
        help="Optional article number to fetch (e.g., '119', '55')",
    )
    parser.add_argument(
        "--keyword",
        default=None,
        help="Optional keyword to filter articles inside the matched statute/ordinance (e.g., '용적률', '건폐율')",
    )
    parser.add_argument(
        "--oc",
        default=DEFAULT_OC,
        help=f"Law Open API OC key (default: {DEFAULT_OC})",
    )
    parser.add_argument(
        "--display",
        type=int,
        default=5,
        help="Max search results (default: 5)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output JSON",
    )

    args = parser.parse_args()
    today = datetime.date.today().isoformat()

    try:
        items, search_url = search_items(args.target, args.query, args.oc, args.display)
        articles = []
        service_url = None
        selected = items[0] if items else None

        if selected and (args.article or args.keyword) and selected.get("mst"):
            articles, service_url = fetch_article_detail(
                args.target, selected["mst"], args.article, args.keyword, args.oc
            )

        evidence_record = {
            "source_name": selected["name"] if selected else args.query,
            "issuing_authority": (
                selected.get("ministry") or selected.get("municipality") or "법제처 국가법령정보센터"
            ) if selected else "법제처 국가법령정보센터",
            "reference_date": selected.get("effective_date", today) if selected else today,
            "retrieved_at": today,
            "spatial_unit": selected.get("municipality", "대한민국 전국") if selected else "미확인",
            "verification_status": "VERIFIED" if selected else "NEEDS_VERIFICATION",
            "api_endpoint": service_url or search_url,
        }

        payload = {
            "query": args.query,
            "target": args.target,
            "oc_used": args.oc,
            "result_count": len(items),
            "results": items,
            "articles": articles,
            "evidence_record": evidence_record,
        }

        if args.json:
            print(json.dumps(payload, indent=2, ensure_ascii=False))
        else:
            print(f"=== Korean Law Open API Lookup ({args.target}) ===")
            print(f"Query:   {args.query} (OC={args.oc})")
            print(f"Matches: {len(items)}")
            for idx, it in enumerate(items, 1):
                print(
                    f"  [{idx}] {it.get('name')} | MST={it.get('mst')} | "
                    f"시행일={it.get('effective_date')} | "
                    f"{it.get('ministry') or it.get('municipality') or ''}"
                )
            if articles:
                print("---------------------------------------")
                for art in articles:
                    print(f"[{art.get('title') or art.get('article_no', '')}]")
                    print(art.get("content", ""))
                    for p in art.get("paragraphs", []):
                        print(" ", p)
            print("---------------------------------------")
            print(f"Verification Status: {evidence_record['verification_status']}")
    except Exception as exc:
        err_payload = {
            "query": args.query,
            "target": args.target,
            "error": str(exc),
            "evidence_record": {
                "source_name": args.query,
                "issuing_authority": "법제처 국가법령정보센터",
                "reference_date": None,
                "retrieved_at": today,
                "verification_status": "NEEDS_VERIFICATION",
            },
        }
        if args.json:
            print(json.dumps(err_payload, indent=2, ensure_ascii=False))
        else:
            print(f"Error querying law.go.kr: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
