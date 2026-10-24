# FORMEQUA · Firebase Hosting + Cloud Run

2026-10-24 기준, FORMEQUA 전용 Google 프로젝트는 `formequa-research`다.
Blaze 결제 연결과 런타임·빌드 서비스 계정, Artifact Registry를 준비했다.
개인 WAN2 프로젝트의 배포 설정은 변경하지 않는다.

- 공개 주소: [formequa-research.web.app](https://formequa-research.web.app/)
- 공개 소스: [parkwh79-stack/FORMEQUA](https://github.com/parkwh79-stack/FORMEQUA)
- 리전·서비스: `asia-northeast3` / `formequa-api`

배포 완료 여부와 실제 기능은 아래의 배포 후 확인 항목으로 검증한다. 운영자 PC의
비공개 REST 배포 도구는 공개 저장소에 포함하지 않는다.

## 기본 운영: 조회·계산만 제공, 서버에 검토 자료를 누적하지 않음

Firebase Hosting은 아뜰리에 HTML·사진·CSS·JavaScript를 제공하고,
`/api/**`, `/model.html`, `/dashboard.html`은 Cloud Run으로 전달한다. Cloud Run은
Gunicorn WSGI, Python 3.12, Node 22로 조회와 계산을 처리한다. WebGL은 브라우저에서
실행하므로 서버 GPU는 사용하지 않는다.

기본값은 `ARCHIVE_BACKEND=disabled`다. 주소·필지·법령 조회와 모형·평면·금융 계산은
유지하지만 검토 JSON과 조회 결과를 영구 보관하지 않는다. 검토 접수는 본문을
파싱하기 전에 404, 원본 기록·이미지 조회도 404, 공개 연구 피드는 빈 목록을 반환한다.
방문자 기록용 버킷은 만들지 않는다. Cloud Run에서 SQLite로 자동 전환하지 않는다.
이전 로컬 아카이브는 삭제하거나 업로드하지 않고 그대로 보존한다.

실제 배포의 공개 `deployment-config.js`는 `reviewStorageEnabled=false`,
`remoteStudiesEnabled=false`다. 저장 안내·자동 수집·전송과 원격 포트폴리오 갱신을
중단하며 AI Visual Study의 참고 이미지와 확대 모달은 유지한다. 사용자의 로컬
프로젝트 파일 내보내기와 현재 브라우저의 작업 상태는 계속 사용할 수 있다.
자세한 동작은 [stateless-deployment.md](stateless-deployment.md)를 참고한다.

`/model.html`은 로그인 없이 모형·형태·재료·평면을 보여주는 전용 화면이다.
`WORKSPACE_ENTRY=contact`에서는 상세 작업실 진입을 개인 홈페이지 최상단으로
보낸다. 예전 `dashboard.html?view=model` 링크는 공개 모형으로 옮긴다.
계산·법령·필지 등 비공개 API의 Basic 인증은 유지하고 공개 모형에서 자동 호출하지
않는다. 대시보드 HTML 원본은 Hosting 정적 디렉터리에 복사하지 않는다.
API 운영용 비밀번호는 Secret Manager의 `formequa-pilot-password`에서 읽는다.

## 공개 파일과 인증정보

`python tools/build_release.py`는 `deploy/release-files.json`에 명시된 파일만 복사한다.

- `dist/github/`: 독립 소스, 테스트, 보조 계산기, 라이선스와 배포 설정
- `dist/web/`: Hosting에 제공할 정적 파일과 법령 출처 인덱스
- `dist/release-report.json`: 파일별 SHA-256·개수·크기와 빌드 모드

`.secrets`, `.pilot-data`, 백업, DB, 인증 파일, 로그와 내부 진행 메모는 포함하지 않는다.
새 파일은 허용 목록에 넣기 전까지 자동 공개되지 않는다. 지정된 비밀정보 패턴이
발견되면 파일·행·분류만 표시하고 빌드를 중단한다. 검출기는 모든 종류의 비밀정보를
보장하지 않으므로 공개 전 문서 내용과 이미지 사용 권한도 확인한다.

인증키·비밀번호 값은 소스, YAML, README, 명령줄 인수나 GitHub에 입력하지 않는다.
Secret Manager에서 관리하고 Cloud Run 서비스 ID에 필요한 secret의
`roles/secretmanager.secretAccessor`만 부여한다. 서비스 계정 JSON 키는 생성하지 않는다.
공공 API 환경변수 이름은 `JUSO_API_KEY`, `VWORLD_API_KEY`, `VWORLD_PRICE_API_KEY`,
`VWORLD_TWIN_API_KEY`다. 실제 사용하는 제공기관에 공개 origin
`https://formequa-research.web.app`을 등록한다. 키가 없는 기능은 미연결 상태를 표시한다.

## 1. 인프라와 실행 환경

Google Cloud CLI와 Firebase CLI를 로그인한 운영자 환경에서 실행한다.

```powershell
./deploy/bootstrap.ps1 -ArchiveBackend disabled
```

기본 bootstrap은 API, 런타임·빌드 서비스 계정, Artifact Registry와 비밀번호 secret을
준비한다. 향후 `gcloud builds submit`용 비공개 소스 스테이징 버킷은 유지한다.
이 버킷은 허용 목록으로 정리한 빌드 소스용이며 방문자 조회·검토 자료를 저장하지 않는다.
방문자 아카이브 버킷과 그 전용 IAM 역할은 `-ArchiveBackend gcs`를 명시한 경우에만
생성한다. 기본 disabled 실행으로 기존 버킷이나 기록을 삭제하지 않는다.

`deploy/runtime.env.example.yaml`을 무시 대상인 `deploy/runtime.env.yaml`로 복사한다.
`PUBLIC_ORIGIN`, `ARCHIVE_BACKEND=disabled`, `BIND_HOST=0.0.0.0`과 제공기관 origin을
확인한다. disabled 모드에는 `ARCHIVE_BUCKET`이 필요 없다. 비밀번호 secret은
16자 이상이어야 하며 실제 값은 설정 파일에 넣지 않는다.

서버는 요청 본문이나 전체 조회 URL을 앱 로그에 출력하지 않는다. 배포 프로젝트에는
주소 검색어·PNU가 포함될 수 있는 Cloud Run HTTP 요청 로그의 저장 제외를 설정했다.
서비스나 로그 저장 대상을 바꿀 때도 이 제외 설정을 확인하고, 디버깅 중에도 요청
본문과 제공기관 URL을 로그로 추가하지 않는다. 처리 중의 메모리는 영구 검토 보관과
별개이며, 서버가 Google 제공기관으로 조회 요청을 보내는 동작은 계속 필요하다.

## 2. 릴리스 생성과 배포

서버 disabled 모드와 브라우저 플래그를 맞추기 위해 빌드 환경을 명시한다.

```powershell
$env:FORMEQUA_REVIEW_STORAGE = 'disabled'
python tools/build_release.py
gcloud builds submit dist/github --project=formequa-research --config=deploy/cloudbuild.yaml --service-account=projects/formequa-research/serviceAccounts/formequa-build@formequa-research.iam.gserviceaccount.com --gcs-source-staging-dir=gs://formequa-research-build-source/source
```

빌드가 반환한 `BUILD_ID`의 이미지를 확인한 다음 배포한다. 소스를 바꾸면 같은 소스로
이미지도 다시 빌드해야 한다. 배포 스크립트는 전달받은 이미지를 조용히 다시 만들지 않는다.

```powershell
./deploy/deploy.ps1 -Image 'asia-northeast3-docker.pkg.dev/formequa-research/formequa/api:BUILD_ID'
```

배포 스크립트는 runtime YAML의 archive 모드를 확인하고 disabled일 때
`FORMEQUA_REVIEW_STORAGE=disabled`를 릴리스 빌드와 Firebase predeploy 자식 프로세스에
전달한다. GCS 모드에서는 `FORMEQUA_REVIEW_STORAGE=enabled`로 수집 설정을 맞춘다.
종료 시 운영자 프로세스의 이전 환경변수 값으로 복원한다.

Cloud Run은 최소 0·최대 1 인스턴스, 1 CPU/1GiB, 동시 요청 4, 요청 시간 60초다.
`--update-secrets`로 pilot 비밀번호 연결을 갱신하므로 이미 연결한 공공 API secret
바인딩을 지우지 않는다. 새 제공기관 secret은 Cloud Run에 별도로 연결한다.
CLI 의미는 [Google 공식 deploy 문서](https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy#--update-secrets)를 참고한다.

Cloud Run health가 성공해야 Hosting을 배포한다. Firebase rewrite의 `pinTag`는
리비전을 고정하므로 Cloud Run 변경 후 Hosting도 다시 배포해야 한다. 공개 origin은
`.web.app` 주소를 사용한다. 다른 origin에서 API를 호출하면 기존 origin 검사가 거절한다.

## 3. 배포 후 확인

- `/api/health` 200 및 `calculators_ready=true`
- 비밀번호 없는 `/model.html` 200, 모형·평면 정상 및 초기 보호 API 호출 없음
- `/dashboard.html`은 개인 홈페이지 최상단으로 303, 이전 모형 링크는 `/model.html`로 303
- 인증된 주소·PNU·법령 조회와 실제 Node 사업성 계산 실행
- disabled 상태의 검토 POST 404, 원본·이미지 조회 404, 공개 연구 빈 피드
- 브라우저에서 검토 자료 저장 요청과 원격 갤러리 polling 없음
- 로컬 프로젝트 내보내기와 다시 불러오기, 4개 예시·모션·이미지 정상 동작
- 공개 파일에 인증정보·운영자 도구·기존 아카이브가 포함되지 않음

Blaze의 무료 사용량과 별개로 Cloud Run, 빌드, 이미지 저장과 전송에 과금이 발생할 수
있다. 예산 알림을 별도 설정하고 사용량을 확인한다. 최대 인스턴스 제한은 전체 Google
청구액의 절대 상한이 아니다.

## 선택 경로: 향후 검토 저장을 다시 도입할 경우

현재 배포에는 사용하지 않는다. 별도 운영 결정 후 `bootstrap.ps1 -ArchiveBackend gcs`,
`ARCHIVE_BACKEND=gcs`, `ARCHIVE_BUCKET`과 수집 가능한 공개 config를 함께 적용한다.
GCS 모드에서는 uniform bucket-level access와 public access prevention enforced를
검증하며 보호되지 않거나 접근할 수 없는 버킷이면 서버를 시작하지 않는다.
객체와 버킷 보호 설정 조회 권한만 런타임 계정에 부여하고 서명 URL이나 공개 ACL은
사용하지 않는다. 이 경로를 선택해도 원본 기록의 HTTP 읽기·내보내기는 열지 않는다.

GCS 연결을 검증하는 운영자 도구에는 ADC 로그인이 필요하다. 저장 모드를 다시 켜는
일과 기존 로컬 기록을 이전하는 일은 각각 명시적으로 결정해야 하며 자동 이전하지 않는다.
