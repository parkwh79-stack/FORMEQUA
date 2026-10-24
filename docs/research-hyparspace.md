# HyparSpace 오피스 배치 조사와 적용

조사일: 2026-10-21. 적용 파일: `office-layout.js`, 검증: `tests/office-layout.test.js`.

## 결론과 적용 범위

HyparSpace의 오픈 오피스 설계 원리 중 **책상 모듈·방향·실별 설정·통로·기둥 회피·협업 공간의 분리**를 현재 브라우저/Node 공통 모델에 맞춰 자체 JavaScript 휴리스틱으로 구현했다. upstream C# 코드, JSON 가구 카탈로그, 형상 자산, NuGet 패키지를 복사하거나 실행하지 않았다. 결과의 `provenance.upstreamEngineExecuted`와 `upstreamCodeOrAssetsBundled`는 모두 `false`다.

Hypar 실행 결과와 같은 배치·밀도·품질이라는 의미가 아니다. 최대 좌석 최적화, 임의 다각형의 실 분할, 법정 수용인원, 장애인 접근성, 피난 설계, 구조 설계는 이 모듈의 검증 범위가 아니다. 외곽 매스·용적률·건폐율·주차 법정 대수를 오피스 책상 수로 바꾸지 않는다.

## 공식 저장소 직접 확인

| 항목 | 확인 결과 | 공식 근거 |
|---|---|---|
| 저장소와 최신 기준 | 기본 브랜치 `master`; 조사 시 최신 SHA가 첨부 문서의 pinned SHA와 동일 | [저장소 API](https://api.github.com/repos/hypar-io/HyparSpace), [커밋 API](https://api.github.com/repos/hypar-io/HyparSpace/commits/master) |
| 고정 커밋 | `f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f`, committer 시각 `2026-03-31T18:08:21Z` | [고정 커밋](https://github.com/hypar-io/HyparSpace/commit/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f) |
| 보관 상태·릴리스 | archived `false`; releases API 응답 `[]` | [저장소 API](https://api.github.com/repos/hypar-io/HyparSpace), [릴리스 API](https://api.github.com/repos/hypar-io/HyparSpace/releases) |
| 본체 라이선스 | 실제 파일명 `LICENSE.md`; MIT, copyright 2021 Hypar Inc. | [LICENSE.md](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LICENSE.md) |
| SKILL.md | recursive tree가 잘리지 않았고, 본체 트리에서 `SKILL.md` 경로 0개 | [고정 트리 API](https://api.github.com/repos/hypar-io/HyparSpace/git/trees/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f?recursive=1) |
| 테스트 | xUnit 프로젝트와 생성된 모델 fixture·결과 파일 존재. 원본 테스트는 실행하지 않음 | [테스트 프로젝트](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/OpenOfficeLayout/test/OpenOfficeLayout.Tests.csproj), [생성 테스트](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/OpenOfficeLayout/test/Generated/OpenOfficeLayoutTest.cs) |

본체 MIT 조건에는 코드의 사본 또는 상당 부분을 배포할 때 저작권·허가 고지를 포함하는 조건이 있다. 이 작업은 원리를 참고한 별도 구현이며 원본 코드·카탈로그를 포함하지 않는다. 이후 원본 일부를 가져오면 해당 범위의 고지와 별도 의존 자산의 조건을 다시 확인해야 한다.

### 서브모듈과 패키지의 범위

[`.gitmodules`](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/.gitmodules)는 ZonePlanningFunctions 아래 별도 두 저장소를 가리킨다.

| 별도 저장소 | 본체가 고정한 SHA | 이번 확인과 채택 여부 |
|---|---|---|
| [Function-SpacePlanning](https://github.com/hypar-io/Function-SpacePlanning/tree/f802a505cd7fa087245eac6485ccdea97da786fd) | `f802a505cd7fa087245eac6485ccdea97da786fd` | API license `null`; 고정 트리에서 LICENSE/COPYING/SKILL.md 경로 없음. 코드·자산 미채택 |
| [Function-Circulation](https://github.com/hypar-io/Function-Circulation/tree/4f35c301e1f39058eb1be49652fc3857ca57dd98) | `4f35c301e1f39058eb1be49652fc3857ca57dd98` | API license `null`; 고정 트리에서 LICENSE/COPYING/SKILL.md 경로 없음. 코드·자산 미채택 |

license 필드나 파일이 없다는 사실로 사용 허가를 추정하지 않았다. 본체 MIT를 별도 저장소·서브모듈·패키지·카탈로그 자산에 일괄 적용하지 않는다. 전체 상위 트리를 검색해도 서브모듈 내부는 포함되지 않으므로 각 고정 서브모듈 트리도 별도로 조회했다.

## 실제 소스의 기능과 현재 채택 범위

| 기능 | upstream 실제 코드 | 이번 자체 구현 | 남은 차이 |
|---|---|---|---|
| 단계 분리 | [본체 README](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/README.md): Zone Planning과 Layout Functions가 구분됨 | 기존 실·문·코어 생성 후 `office` 실의 가구 배치만 교체 | upstream 공간 계획·복도 엔진 전체를 이식하지 않음 |
| 책상과 입력 | [OpenOfficeLayout README](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/OpenOfficeLayout/README.md): 회전·협업 밀도·통로·열 간격·유형·기둥 회피·사용자 치수 입력 | `single`, `back-to-back`, `bench`, `standing`의 독립 모듈과 실제 책상·의자 치수 | upstream의 가구 유형 명칭·120도 워크스테이션·카탈로그와 동일하지 않음 |
| 실별 설정 | [`OpenOfficeLayout.Execute`](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/OpenOfficeLayout/src/OpenOfficeLayout.cs#L126), [`GetSpaceSettings`](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/LayoutFunctionCommon/LayoutStrategies.cs#L538) | 명시적인 room id로 치수·유형·방향·협업·목표 좌석 override | centroid로 유사 실을 자동 매칭하지 않음. id 변경 후 이전 요구 조건의 자동 재연결 없음 |
| 방향 | [`GetOrientationTransform`](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/LayoutFunctionCommon/LayoutStrategies.cs#L575): 복도에 가까운 면을 기준으로 회전 | 0·90도와 양 끝 정렬 후보 4개씩을 비교 | 임의 각도 회전·복도 기준 자동 각도 분석은 하지 않음 |
| 통로와 모듈 | [`LayoutDesksInGrid`](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/LayoutFunctionCommon/LayoutStrategies.cs#L641): U/V 패턴, 책상·열 사이 통로와 군집 균형 | 주 통로·문 연결 직교 통로·열/옆 통로를 예약하고 연결된 군집만 배치 | upstream 패턴/균형 로직을 복사하지 않음. 전역 최적해, 상세 보행 경로는 미검증 |
| 기둥 | [`GetColumnLocations`](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/LayoutFunctionCommon/LayoutStrategies.cs#L467), [`GetValidGrids`](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/LayoutFunctionCommon/LayoutStrategies.cs#L588): 실제 Column 모델의 profile·위치와 adaptive grid 분할 | 입력된 직사각형 장애물에 0.1m 검토 여유를 적용해 충돌·통로 차단 확인 | 표시용 참고 구조 그리드로 실제 기둥을 추정하지 않음. 구조 검증·측량 확인은 별개 |
| 협업 공간 | [`LayoutDesksInGrid`](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/LayoutFunctionCommon/LayoutStrategies.cs#L717), [협업 profile 병합](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/LayoutFunctionCommon/LayoutStrategies.cs#L858) | 실제 2.8×2.8m 공유 영역·테이블·의자 4개를 예약. 요청 면적·확보 면적·부족 면적 구분 | density를 원본과 동일한 확률/패턴으로 해석하지 않음. 이 구현의 값은 실 inset 면적 대비 요청 비율 |
| 비정형 실 | [`GetValidGrids`](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/LayoutFunctionCommon/LayoutStrategies.cs#L595)는 profile 외곽·void를 받고, [trimmed cell 관련 처리](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/LayoutFunctionCommon/LayoutStrategies.cs#L80)가 있음. 책상 배치는 [잘린 cell을 제외](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/LayoutFunctionCommon/LayoutStrategies.cs#L788) | 기존 생성기의 직사각형 office 실을 입력으로 사용 | 임의 다각형/곡선 실의 최대 내접 직사각형 계산, void 전체 polygon clipping은 미이식 |
| 수량 | [`TotalDeskCount`](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/OpenOfficeLayout/src/OpenOfficeLayout.cs#L212) | 실제 남긴 책상 객체를 집계, 협업 좌석은 별도 집계 | 인허가 수용인원·임대 계약 인원·법정 주차 산정 인원과 동일시하지 않음 |

## 실행 요구와 유지보수 판단

원본은 [OpenOfficeLayout.csproj](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/OpenOfficeLayout/src/OpenOfficeLayout.csproj)의 `net6.0` C# 프로젝트이며, 책상 configuration JSON과 catalog JSON을 빌드 출력에 복사한다. [의존 프로젝트](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/OpenOfficeLayout/dependencies/OpenOfficeLayout.Dependencies.csproj)는 `Hypar.Elements 2.2.0-alpha.25`, `Hypar.Functions 1.11.0-alpha.13`와 공통 프로젝트를 참조한다. [공통 프로젝트](https://github.com/hypar-io/HyparSpace/blob/f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f/LayoutFunctions/LayoutFunctionCommon/LayoutFunctionCommon.csproj)는 Elements.Components, Newtonsoft.Json, Elements.LargestInteriorRectangle도 참조한다.

공개된 `Execute(Dictionary<string, Model>, inputs)`와 공통 기하 함수가 있으므로 별도 .NET worker 연결을 검토할 수는 있다. 하지만 소스 공개만으로 Hypar 서비스의 모든 기능·카탈로그·실행 환경을 독립 재현했다고 결론 내릴 수 없다. 이번 작업에서는 원본 패키지 설치·컴파일·worker 실행·Hypar 계정 연결을 하지 않았다. 라이브 서비스 종속성과 자산 가용성은 향후 실제 worker 검증 항목이다.

현재 웹앱에는 Node/브라우저 동일 순수 모듈이 적합해 원리를 자체 구현했다. 이 선택은 alpha 패키지와 upstream 런타임을 새 배포 의존성으로 추가하지 않는다. 반대로 원본 엔진의 일반 profile 처리·adaptive grid·가구 catalog와 같은 기능은 자동으로 얻지 못한다. 유지보수는 이 JS 알고리즘과 독립 기하 회귀 검사에 있다.

## 현재 모듈의 계약과 알고리즘

Node `require('./office-layout.js')`, 브라우저 `window.AtelierOfficeLayout`의 `generate`, `layoutRoom`, `normalizeSettings`를 제공한다. DOM·THREE·외부 런타임이 필요 없다. 모든 길이는 미터, 평면 좌표는 기존 모델의 X/Z이며, 실·문·장애물이 동일 원점을 사용해야 한다.

```js
const result = AtelierOfficeLayout.generate({
  rooms: [{ id: 'office-1', minX: 0, maxX: 18, minZ: 0, maxZ: 14 }],
  doors: [{ roomId: 'office-1', x: 8, z: 0, width: 1.1, axis: 'x' }],
  obstacles: [{ id: 'explicit-column', minX: 5, maxX: 6, minZ: 4, maxZ: 5 }],
  options: {
    deskType: 'single', orientation: 'auto', deskWidthM: 1.4,
    deskDepthM: .7, aisleWidthM: 1.2, rowGapM: .9,
    backClearanceM: .9, collaborationPct: 10, targetSeats: 20
  },
  roomRequirements: { 'office-1': { orientation: 90 } }
});
```

| 입력 | 허용값·기본값 | 의미 |
|---|---|---|
| deskType | single / back-to-back / bench / standing; single | 군집당 1 / 2 / 4 / 1석. standing은 높이 1.05m 책상과 좌석 표시 |
| orientation | auto / 0 / 90; auto. 문자열 0·90도 허용 | auto는 2방향×4정렬 후보 비교 |
| deskWidthM / deskDepthM | 1.2~2 / 0.6~1; 1.4 / 0.7 | 실제 책상 치수 |
| aisleWidthM | 0.9~2.4; 1.2 | 입력한 배치 가정의 통로 폭. 법정 폭 자동 판정이 아님 |
| rowGapM | 0.7~2; 0.9 | 군집 열 간 여유. 통로에 사용되는 값은 aisleWidthM보다 좁게 만들지 않음 |
| backClearanceM | 0.6~1.8; 0.9 | 각 책상의 의자와 뒤 공간을 담는 예약 깊이. upstream Back-to-Back Width와 같은 치수 정의가 아님 |
| collaborationPct | 0~40; 0 | 실 외곽에서 0.25m inset한 면적 대비 요청 비율. 실제 면적은 타일 단위로 반올림되어 초과/부족할 수 있음 |
| targetSeats | 정수 0~1000; 0 | 0은 가능한 좌석, 양수는 실제 배치 좌석의 상한 겸 목표. 전체 generate에 한 번 적용 |
| roomRequirements[id] | 위 설정의 일부 | room id가 일치하는 실에만 적용. 실별 targetSeats는 별도 목표/상한 |

방은 최대 100개, 각 외곽 폭·깊이는 최대 200m, 장애물과 문은 각각 최대 200개다. 장애물은 실제 좌표 또는 명시적 설계 장애물만 전달한다. `referenceOnly:true`, `isReference:true`, `confirmed:false`, `source:'reference'`는 회피 목록에서 제외하고 경고한다. 이 모듈은 입력 좌표의 구조적 진실성을 인증하지 않는다.

1. 방의 0.25m inset에서 책상·의자 전체 모듈을 구성한다.
2. 방향/정렬 후보별 주 통로, 문 연결 후보, 보조 격자 통로를 만든다. 문 앞은 폭+0.5m, 실 안쪽 1.35m의 검토 여유로 예약한다. 이는 앱의 배치 가정이다.
3. 명시적 장애물을 0.1m 확장해 통로에서 빼고, 요청 폭보다 좁은 통로 조각은 버린다. 연결부도 요청 통로 폭 이상인 직사각형 연결망을 검사한다. 문이 차단되면 그 문을 연결 시작점으로 사용하지 않는다.
4. 주 통로에 접한 공유 영역을 먼저 예약하고, 이후 보조 통로를 잘라 공유 영역 침범을 막는다. 테이블·협업 의자는 별도 실제 객체다.
5. 방 내부에 완전히 들어오며 장애물·문 여유·통로·공유 영역에 겹치지 않고, 출입 연결 통로에 접한 **군집 전체**만 배치한다. 개별 좌석까지의 상세 동선 검증은 별개다.
6. 협업 부족 면적을 먼저 줄이고, 다음으로 좌석 수를 늘리는 순서로 후보를 선택한다. 방향 동률이면 0도를 우선한다. 유한 후보 휴리스틱이며 최적해를 보장하지 않는다.
7. 실별 목표를 우선 배분하고 나머지 전체 목표를 실에 순환 배분한다. 목표 제한으로 일부 bench 위치만 남길 수 있으나 군집 예약 영역은 유지한다. 목표 부족 수량과 실별/전체 목표 충돌을 경고한다.

반환 가구는 `{type,x,z,width,depth,height,rotationY:0,roomId,...}`다. 90도 후보는 이미 물리적 width/depth와 좌표를 바꾼 결과이므로 렌더러가 추가로 90도 회전하면 안 된다. `workstations[].envelope`, `groupEnvelope`, `aisles`, `doorClearances`, `collaboration`, `obstacles`로 배치 근거를 추적할 수 있다.

`metrics`는 실제 업무 책상 수, 협업 좌석 수, 요청/확보/부족 협업 면적, 통로의 중복을 제거한 면적, 목표 부족 좌석을 구분한다. 업무 책상 수에 회의/협업 의자를 더하지 않는다. 문이 없으면 내부 배치는 검토하되 `entryConnected:null`과 미확인 경고를 남긴다. 좌석을 담지 못하면 `unfeasible`, 일부 요구를 채우지 못하면 `partial`이다.

## 기존 모델과의 접점

- `interior-plan.js`: 이미 확정한 방·문·코어를 받아 `office` 유형의 가구를 교체한다. 거주·호텔 객실과 복도·코어 경계를 책상 목표에 맞춰 임의로 옮기지 않는다. 다른 업무 유형은 호출자가 명시적으로 선택해 전달할 수 있다.
- WebGL/평면: 동일 가구 객체를 사용해 3D와 층별 평면의 책상 수·위치를 맞춘다. 실제 구조 자료가 없을 때의 참고 기둥을 장애물로 전달하지 않는다.
- 수량·사업성: deskCount는 생성된 업무 좌석의 기획 수량이다. 임대 면적·호텔 객실 원장·법정 주차 산정에 자동 대입하지 않는다. 공유 공간의 좌석은 `collaborationSeatCount`로 별도 표시한다.
- 간략 매스 표시: 상세 가구 생략 정책은 상위 모델의 책임이며, 상세 표현을 선택할 때 이 모듈을 사용한다. 표시 변경으로 법정 규모나 사업성을 바꾸지 않는다.

## 검증과 한계

`node tests/office-layout.test.js`에서 4개 유형×0/90/auto, 실제 가구의 방 내부 포함/상호 충돌, 장애물·문 여유·통로 비침범, 군집과 문 연결망, 협업 영역/면적/좌석 수, 넓은 통로와 뒤 여유의 수용량 변화, 전역/실별 목표, 원점 이동 불변성, 입력 불변성, 잘못된 숫자/열거값, 브라우저 UMD의 Node 동등성을 확인한다.

연결 검사는 직교 사각형 네트워크에 대한 검토다. 임의 장애물 주변의 곡선·최단 경로, 문 스윙 상세, 개별 좌석 접근의 swept path, 소방 피난·법정 재실 인원·휠체어 회전 반경·구조 기둥의 적합성은 검증하지 않는다. 과도하게 보수적인 통로 예약으로 실제 설계자가 확보할 수 있는 좌석을 놓칠 수 있으며, 요구 비중을 채우지 못해도 숨기지 않고 실제 부족량을 남긴다.

upstream에서 재사용할 `SKILL.md`는 발견하지 못했다. 프로젝트용 skill을 만들 때는 이 문서의 입력 계약·검증 범위·출처 구분을 담고, upstream 엔진 실행이나 인허가 확인을 수행했다고 표현하지 않아야 한다.
