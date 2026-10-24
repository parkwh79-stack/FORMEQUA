# FORMEQUA · 검토 자료를 누적하지 않는 배포

공개 서버에 `ARCHIVE_BACKEND=disabled`를 명시하면 주소·필지·법령 조회와
모형·실내·사업성 계산은 계속 제공하지만 검토 자료를 서버에 보관하지 않는다.
비공개 기록 접수는 본문을 파싱하기 전에 404로 종료하고, 공개 연구 피드는 빈
목록, 기록 이미지와 원본 기록 조회는 404를 반환한다. 비공개 계산·조회 API의
비밀번호 보호는 유지한다. 운영자가 기존 로컬 기록을 삭제하거나 이전할 필요는 없다.

공개 HTTPS 아뜰리에와 `/model.html`은 보호된 API를 자동 조회하지 않는다.
공개 모형에서는 브라우저 계산으로 높이·형태·외관·층별 평면·실내를 살펴본다.
법령·필지 실시간 조회와 사업성 API를 공개하는 변경은 포함하지 않는다.
`WORKSPACE_ENTRY=contact`로 배포하면 상세 작업실 진입은
`https://wan2-website.web.app/#contact`로 안내한다. 예전
`dashboard.html?view=model` 링크는 공개 모형으로 연결하고, 그 밖의 대시보드
주소는 문의 페이지로 연결한다. 방문자에게 로그인창을 표시하지 않는다.
로컬 개발에서는 해당 환경변수를 지정하지 않으면 기존 작업실을 계속 사용한다.

## 서버와 브라우저 설정

- Cloud Run 환경변수: `ARCHIVE_BACKEND=disabled`. 이 모드에는 보관용 버킷이 필요 없다.
- `PUBLIC_ORIGIN`, `PILOT_PASSWORD`와 공공 API 설정은 기존 배포 설정을 사용한다.
- 공개 파일 `deployment-config.js`를 index와 dashboard가 앱보다 먼저 로드한다.
  로컬 원본은 기존 동작을 보존하기 위해 두 값 모두 `true`다.
- 실제 릴리스에서는 빌드 시 `FORMEQUA_REVIEW_STORAGE=disabled`를 사용해
  `dist/github/deployment-config.js`와 `dist/web/deployment-config.js`를 아래처럼
  생성한다. 이 환경변수는 릴리스 빌더 입력이며, 서버의 `ARCHIVE_BACKEND`와 별개다.
  Firebase predeploy로 재빌드할 때도 같은 빌드 환경변수가 필요하다.

```javascript
window.FORMEQUA_DEPLOYMENT = Object.freeze({
  reviewStorageEnabled: false,
  remoteStudiesEnabled: false
});
```

`reviewStorageEnabled=false`면 저장 안내·수집 이벤트·스냅샷 복사·전송을 mount하지
않는다. `remoteStudiesEnabled=false`면 AI Visual Study의 참고 이미지와 확대 모달을
유지하면서 원격 목록 조회와 주기적 갱신을 중단한다. 사용자가 직접 내보내는 로컬
프로젝트 파일과 현재 탭의 작업 상태는 기존대로 사용할 수 있다.

브라우저 플래그는 표시·전송 제어용이며 접근 보안 수단이 아니다. 서버도 반드시
`ARCHIVE_BACKEND=disabled`로 배포해야 직접 요청으로 기록을 추가할 수 없다.
`ARCHIVE_BACKEND=gcs`는 기존 비공개 버킷 검증을 계속 사용한다. Cloud Run에서
`sqlite`나 미지정 설정으로 자동 전환하는 경로는 계속 차단한다.

요청을 처리하는 동안의 메모리와 플랫폼 요청 로그는 영구 검토 보관과 별개다.
주소·PNU를 포함한 요청 URL이 플랫폼 로그에 남지 않도록 운영 배포에서
Cloud Run 요청 로그 제외를 적용한다. 기존 로컬 아카이브는 그대로 보존한다.
