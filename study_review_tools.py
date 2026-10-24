"""Owner-only filesystem workflow: weekly JSON review and manual image curation."""
import argparse
import json
import os
import secrets
from datetime import datetime, timedelta
from pathlib import Path

import study_archive as archive
from study_catalog import CatalogError


def write_json(path, value):
    path = Path(path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + secrets.token_hex(6) + ".pending")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()
    return path


def weekly_report(days=7, output=None, advance=True):
    """Use a saved cursor so a sleeping/offline computer doesn't lose a week's records."""
    if type(days) is not int or not 1 <= days <= 366:
        raise CatalogError("검토 기간은 1~366일로 입력해 주세요.")
    folder = archive.database_path().resolve().parent
    cursor_path = folder / "weekly-report-state.json"
    end = datetime.now(archive.KST).replace(microsecond=0)
    start = end - timedelta(days=days)
    if advance and cursor_path.exists():
        try:
            previous = json.loads(cursor_path.read_text(encoding="utf-8"))
            cursor = datetime.fromisoformat(previous["through"])
            if cursor.tzinfo is not None and cursor <= end:
                start = cursor.astimezone(archive.KST)
        except (KeyError, TypeError, ValueError, OSError):
            raise CatalogError("주간 보고서의 이전 기준일을 확인해 주세요. 원본 기록은 보관되어 있습니다.") from None
    studies = archive.records_between(start.isoformat(timespec="seconds"), end.isoformat(timespec="seconds"))
    report = {"schemaVersion": 1, "generatedAt": end.isoformat(timespec="seconds"),
              "period": {"start": start.isoformat(timespec="seconds"), "end": end.isoformat(timespec="seconds"),
                         "timeZone": "Asia/Seoul", "endExclusive": True},
              "count": len(studies), "pendingCount": sum(item["review"]["status"] == "pending" for item in studies),
              "studies": studies}
    target = Path(output) if output else folder / "weekly" / f"reviews-{end:%Y%m%d-%H%M%S}.json"
    path = write_json(target, report)
    if advance:
        write_json(cursor_path, {"through": end.isoformat(timespec="seconds"), "lastReport": str(path), "count": len(studies)})
    # Console/notifications contain counts and a local path, never parcel/financial contents.
    return {"path": str(path), "count": report["count"], "pendingCount": report["pendingCount"], "period": report["period"]}


def main():
    parser = argparse.ArgumentParser(description="비공개 검토 JSON과 수동 포트폴리오 관리")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("weeks", help="보관된 주차와 검토 대기 건수")
    weekly = commands.add_parser("weekly", help="지난 보고서 이후 새 검토를 주간 JSON으로 저장")
    weekly.add_argument("--days", type=int, default=7, help="첫 보고서에 포함할 최근 일수")
    weekly.add_argument("--output")
    weekly.add_argument("--preview", action="store_true", help="최근 기간만 내보내고 알림 기준일은 변경하지 않음")
    export = commands.add_parser("export-week", help="특정 주차 전체 JSON 내보내기")
    export.add_argument("--week", required=True)
    export.add_argument("--output")
    single = commands.add_parser("export-one", help="개별 검토 또는 다시 불러올 프로젝트 JSON")
    single.add_argument("--id", required=True)
    single.add_argument("--output", required=True)
    single.add_argument("--project", action="store_true")
    publish = commands.add_parser("publish", help="직접 만든 이미지 한 장을 승인 후 홈페이지에 등록")
    publish.add_argument("--id", required=True)
    publish.add_argument("--image", required=True)
    args = parser.parse_args()
    try:
        if args.command == "weeks":
            result = archive.list_weeks()
        elif args.command == "weekly":
            result = weekly_report(args.days, args.output, not args.preview)
        elif args.command == "export-week":
            data = archive.export_week(args.week)
            target = args.output or archive.database_path().parent / "weekly" / f"{args.week}.json"
            result = {"path": str(write_json(target, data)), "count": len(data["studies"])}
        elif args.command == "export-one":
            data = archive.get_review(args.id)
            if data is None:
                raise CatalogError("검토 기록을 찾을 수 없습니다.", 404, "REVIEW_NOT_FOUND")
            if args.project:
                data = data["reviewData"].get("project")
                if not data:
                    raise CatalogError("이 기록에는 복원할 프로젝트가 없습니다.")
            result = {"path": str(write_json(args.output, data))}
        else:
            result = archive.publish_manual(args.id, args.image)
        print(json.dumps(result, ensure_ascii=False))
    except (CatalogError, OSError, ValueError):
        # Avoid leaking filenames, image contents or private data in error diagnostics.
        print(json.dumps({"error": "검토 기록 또는 입력 파일을 확인해 주세요."}, ensure_ascii=False))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
