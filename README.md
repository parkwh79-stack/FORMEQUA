# FORMEQUA

공간의 가능성과 사업의 구조를 함께 살펴보는 박완희의 리서치 아뜰리에.
**POWERED BY WAN2** · [Wanhee Park](https://wan2-website.web.app/)

아뜰리에의 개념 연구와 WebGL 모형, 실제 필지 조회, 법규·면적·주차·실내 배치·사업성 검토를 연결하는 연구용 웹 애플리케이션입니다. 오피스·오피스텔·호텔·공동주택·리빙을 다루며 물류 프로그램은 포함하지 않습니다.

## 로컬 실행

Python 3.12 이상과 Node.js가 필요합니다.

```powershell
python -m pip install -r requirements.txt
python server.py
```

`http://127.0.0.1:8090/`에서 아뜰리에, `dashboard.html`에서 상세 작업실을 확인합니다. 보조 계산 스크립트는 `runtime/Skills-Architects/`에 포함되어 상위 폴더의 다른 Git 저장소가 없어도 실행할 수 있습니다.

실제 주소·지적도·주변 도로 조회는 제공기관의 승인키가 필요합니다. 서버 환경변수 `JUSO_API_KEY`, `VWORLD_API_KEY`, `VWORLD_PRICE_API_KEY`, `VWORLD_TWIN_API_KEY`, `VWORLD_DOMAIN`으로 설정합니다. 로컬에서는 웹 폴더 밖 `.secrets/formequa-providers.json`도 지원합니다. 키가 없거나 승인·쿼터가 부족하면 미연결/조회 실패를 표시합니다.

## 연구 범위

- 최대 5개 필지의 실제 경계·좌표·공개 공간자료를 사용하고 자료 미확인을 구분합니다.
- 모형·사용자 대안의 면적, 법규 조건, 주차 및 금융 원장을 함께 검토합니다.
- 실내 평면과 가구·객실·좌석 배치는 규칙 기반 개념 초안입니다.
- 구조 격자·코어·IFC 매스·협업 JSON은 실시 설계나 구조 해석 완료를 의미하지 않습니다.
- 법령 표시는 검토한 시행 버전과 조회 근거에 따릅니다. 브라우저에서 법령 MCP가 상시 실행되거나 모든 개정·개별 고시가 자동 반영되는 구조는 아닙니다.
- 지역별 선정 조감도는 AI 건축 개념 이미지이며 실제 준공·현황 사진이 아닙니다.

인허가 가능 여부, 법정 주차·피난·접도·구조 적합 및 투자 수익을 확정하지 않습니다. 실제 사업에는 건축사와 해당 분야 전문가의 개별 검토가 필요합니다.

## 비공개 검토 기록과 수동 포트폴리오

현재 공개 배포는 검토 자료를 서버에 누적하지 않는 무저장 모드를 사용합니다. 제공기관 조회와 모형·실내·사업성 계산은 유지하며, 사용자가 프로젝트 파일을 직접 내려받을 수 있습니다. [무저장 배포 설정](docs/stateless-deployment.md)

로컬에서 기록 기능을 켠 경우 검토 조건 변경 시 주소·PNU·입력·평면·법규·사업성 등 전체 검토 자료를 비공개 보관합니다. 인증키·접속 토큰은 수집하지 않습니다. 동일 검토는 중복을 제한합니다. 외부 LLM 이미지 API를 사용한 자동 이미지 생성은 없습니다.

로컬 기본 저장소는 상위 `.pilot-data/study-review`의 SQLite/JSON입니다. 클라우드는 `ARCHIVE_BACKEND=gcs`, `ARCHIVE_BUCKET`으로 보호된 Cloud Storage를 사용하고 임시 SQLite로 자동 전환하지 않습니다. 운영자는 주간 JSON을 내려받아 검토하고 선정 이미지만 수동 발행합니다. 공개 피드는 전체 원본을 제공하지 않습니다.

```powershell
python study_review_tools.py weekly --days 7
```

[비공개 보관·운영자 절차](docs/manual-study-review.md)

## GitHub와 Google 배포

```powershell
python tools/build_release.py
```

- `dist/github/`: 공개 저장소 `parkwh79-stack/FORMEQUA`를 위한 독립 소스 패키지.
- `dist/web/`: Firebase Hosting에 제공할 웹 파일만 포함한 패키지.
- `deploy/release-files.json`: 두 패키지의 명시적 파일 목록.

공개 패키지는 실행 코드와 일반 회귀 테스트를 포함합니다. 실제 대지 조회에서 받은 경계·주변 도로 원본 fixture와 내부 조회·검증 기록, 이에 의존하는 테스트는 공개 목록에서 제외합니다. 원본 자료와 해당 검증은 로컬에서 별도로 보관합니다. GitHub Actions는 공개 패키지에 포함된 테스트를 실행합니다.

인증키·운영 비밀번호, 방문자의 검토 JSON·DB, 백업, 로그와 내부 작업 메모는 포함하지 않습니다. 필요한 제공기관 인증정보와 운영 설정은 배포 환경에서 별도로 주입해야 합니다. 대시보드 HTML은 Hosting에서 직접 제공하지 않고 Cloud Run으로 전달하여 기존 비밀번호 검사를 유지합니다. 앱에서 제공하는 공개 파일과 공개 GitHub 소스는 범위가 다릅니다.

Firebase 프로젝트는 `formequa-research`이며 WAN2 개인 사이트와 별도로 관리합니다. Hosting + Cloud Run + 비공개 Storage의 준비·권한·배포·비용 제한은 [Google 배포 안내](docs/cloud-deployment.md)를 따릅니다. 설정 파일이 있다는 사실은 클라우드 배포나 실제 연결 검증이 완료됐다는 의미가 아닙니다.

## 모듈과 검증 문서

| 주제 | 문서 |
|---|---|
| 분석 API·입력 계약 | [analysis-api](docs/analysis-api.md) |
| 층별 수입과 금융 | [income-model](docs/income-model.md) |
| 파일 저장·불러오기 | [project-files](docs/project-files.md) |
| 필지별 법규·근거 | [parcel-regulations-legal](docs/parcel-regulations-legal.md) |
| 오피스·호텔·동선·BIM 연구 | [space-planning-integration](docs/space-planning-integration.md) |
| 공개 파일 생성·Google 배포 | [cloud-deployment](docs/cloud-deployment.md) |

Python 검증은 `python -m unittest discover -s tests -p 'test_*.py'`, JavaScript 검증은 `python tools/run_node_tests.py`로 실행합니다. 실제 대지 자료에 의존하는 추가 검증은 전체 로컬 작업본에서만 실행합니다. 테스트 결과는 연구 계약과 회귀를 확인하며 실제 건물의 법정 적합을 인증하지 않습니다.

## 출처와 라이선스

자체 작성 코드의 이용 허락 라이선스는 아직 지정하지 않았습니다. 저장소 공개가 자체 코드나 이미지에 MIT 등 별도 라이선스를 부여하는 것은 아닙니다.

[NOTICE.md](NOTICE.md), `runtime/Skills-Architects/LICENSE`, `vendor/polygon-clipping-LICENSE.md`를 유지합니다. 포함된 외부 코드에는 각각의 라이선스가 적용됩니다. Hypar·Dynamo/Revit·TopologicPy의 원리를 연구한 별도 구현이며 해당 네이티브 엔진이 실행된 것으로 표시하지 않습니다. 외부 코드·이미지의 재사용 조건은 각 권리와 라이선스를 따릅니다.
