# TopologicPy 검토와 내부 보행 경로 적용

검토일: 2026-10-21. 공개 공식 소스·패키지 메타데이터를 읽었으며 TopologicPy, PythonOCC, Topologic 커널을 설치·실행·클론하지 않았다. 이번 웹 기능은 원래 실내 평면 자료를 소비하는 독립 JavaScript 구현이며 **TopologicPy 실행 결과가 아니다**.

## 확인한 저장소 상태

- 저장소: [wassimj/topologicpy](https://github.com/wassimj/topologicpy).
- 확인 당시 기본 브랜치 HEAD: [`99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a`](https://github.com/wassimj/topologicpy/commit/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a), 2026-10-20 20:40:51 UTC, `Fixed methods in TGraph`. GitHub 저장소 API의 `archived:false`를 확인했다.
- [해당 커밋의 재귀 트리](https://api.github.com/repos/wassimj/topologicpy/git/trees/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a?recursive=1)는 `truncated:false`였으며 이름이 `SKILL.md`인 파일은 없었다. `AGENTS.md`가 존재한다는 사실을 AI 건축 작성 스킬의 존재로 해석하지 않았다.
- [pyproject.toml](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/pyproject.toml#L12)은 Python `>=3.10,<3.15`를 명시한다. README의 더 넓은 Python 설명보다 선택 버전 패키지 계약을 우선해야 한다. 기본 의존성은 NumPy·SciPy·Pandas·Shapely·Plotly 등이며 graph/IFC/Honeybee 기능은 선택 의존성도 갖는다.

## 실제 구현을 읽어 확인한 기능

| 기능 | 확인한 공식 소스 | 이번 서비스와의 연결·한계 |
| --- | --- | --- |
| 기존 Graph | [Graph.ByTopology](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/src/topologicpy/Graph.py#L10462), [Graph.ShortestPath](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/src/topologicpy/Graph.py#L24889) | 위상과 aperture 연결을 그래프로 바꾸는 함수가 실제 존재한다. 이웃 공간이 붙어 있다는 사실만으로 사람이 벽을 통과할 수 있다는 뜻은 아니다. 문·개구부·출입 권한과 보행 형상을 별도로 제공해야 한다. |
| TGraph | [TGraph](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/src/topologicpy/TGraph.py#L35), [ByTopology](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/src/topologicpy/TGraph.py#L15190), [ShortestPath](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/src/topologicpy/TGraph.py#L31633) | 안정적인 정점 인덱스·간선 레코드와 사전을 사용하는 최신 그래프 계층이다. 길이 가중, 방향, 필터, 회전 비용, A* 선택이 있다. 단순 중심점 간 연결을 안전한 보행 경로로 바꾸어 주는 자동 법규 엔진은 아니다. |
| 분석과 표시 | [NetworkXGraph](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/src/topologicpy/TGraph.py#L29800), [중개 중심성](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/src/topologicpy/TGraph.py#L10238), [VisibilityGraph](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/src/topologicpy/TGraph.py#L37421) | 시선망·중심성·NetworkX 연동이 실제 지원된다. 시선이 통한다는 사실과 통행·피난 적합성은 구분한다. 이번 경량 모듈은 중심성·혼잡·군중 시뮬레이션을 구현하지 않는다. |
| 보행 모델 | [Navigation.ByFaces](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/src/topologicpy/Navigation.py#L150), [Navigation.Graph](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/src/topologicpy/Navigation.py#L397) | 실제 보행 면·장애물·계단·램프·리프트 connector 입력을 지원한다. clearance로 장애물을 제외하고 통로를 줄이는 구현과 좁은 통로 단절 처리가 있다. 수평 틈을 임의로 건너뛰지 않고 명시적 연결을 요구한다. 우리 실내의 평면 벽·가구·코어 데이터를 해당 구조로 변환할 수 있지만 이번에는 이 Python 엔진을 실행하지 않았다. |
| IFC 접근망 | [IFC.AccessGraph](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/src/topologicpy/IFC.py#L7053) | IfcSpace와 문이 채운 실제 IfcOpeningElement, 미충전 opening, 계단·램프·리프트 등을 이용한다. 문 자체의 형상을 가져오는 대신 opening을 사용하고, 공간 경계 관계와 선택적인 공간 교차를 구분한다. |
| IFC 인접망 | [IFC.AdjacencyGraph](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/src/topologicpy/IFC.py#L7901) | 일반 객체·공간의 의미적/공간적 인접망이다. AccessGraph와 목적이 다르며 인접 간선을 그대로 보행·피난 간선으로 쓰면 안 된다. |
| IFC 파서 범위 | [IFC.py 머리말](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/src/topologicpy/IFC.py#L4) | 일부 IFC2X3/IFC4 압출·BRep·placement 등을 지원하는 실험적 파서라고 소스에 명시되어 있다. 현재 우리 IFC의 PlanningMass/CoreReservation 프록시만으로 실제 문·계단 접근이 자동 증명되지 않는다. |

[최신 README의 TGraph 안내](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/README.md)는 TGraph 중심의 API와 과거 selector 호환을 설명한다. `Graph.py`에도 기존 구현이 남아 있으므로 특정 버전에서 모든 Graph 함수가 완전히 동일한 반환형으로 동작한다고 가정하지 않았다. 실제 Python 연동 때에는 위 커밋 또는 별도로 고정한 릴리스와 geometry backend 조합으로 인터페이스·정확도를 실행 검증해야 한다.

## 라이선스와 실행 커널의 경계

| 대상 | 확인된 공식 근거 | 적용 판단 |
| --- | --- | --- |
| TopologicPy 본체 | [LICENSE](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/LICENSE), [패키지 분류](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/pyproject.toml#L15), 각 Graph/Navigation 소스 머리말 | LGPL v3 또는 이후 버전 표시를 확인했다. 저장소의 COPYING 문서가 함께 있다고 전체 본체를 단순 GPL 전용으로 분류하지 않는다. |
| PythonOCC 선호 backend | [Core backend 선택](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/src/topologicpy/Core.py#L89), [pythonocc-core LICENSE](https://github.com/tpaviot/pythonocc-core/blob/master/LICENSE) | 현재 Core는 PythonOCC를 먼저 시도한다. pythonocc-core에는 LGPL v3 문서가 있다. 선택한 배포본·링킹·재배포 조건을 별도로 확인해야 한다. |
| Open CASCADE | [LGPL 2.1](https://github.com/Open-Cascade-SAS/OCCT/blob/master/LICENSE_LGPL_21.txt), [Open CASCADE 예외 1.0](https://github.com/Open-Cascade-SAS/OCCT/blob/master/OCCT_LGPL_EXCEPTION.txt) | Python 래퍼와 실제 기하 커널의 라이선스 문서는 별개다. 예외의 범위도 별도로 확인해야 한다. |
| topologic_core fallback | [실제 fallback import](https://github.com/wassimj/topologicpy/blob/99624bbb7c25a0f0c73dd28cd83ef6d75ca1f84a/src/topologicpy/Core.py#L184), [Topologic 커널 LICENSE](https://github.com/wassimj/Topologic/blob/main/LICENSE), [공식 라이선스 안내](https://topologic.app/Software/) | fallback 커널 저장소는 AGPL v3이다. 본체가 LGPL이라고 전체 실행 조합을 LGPL로 단정할 수 없다. 자동 fallback의 실제 설치·배포 버전을 확인해야 한다. |

이 문서는 배포 형태별 법률 결론을 내리지 않는다. API 프로세스로 분리한다는 사실만으로 라이선스 의무가 사라진다고 판단하지 않는다. 이번 구현은 외부 엔진과 코드를 포함하지 않은 독립 JS 구현이므로 TopologicPy 설치나 라이선스 변경을 실행하지 않았다.

## 이번에 구현한 경량 모듈

`spatial-navigation.js`의 `AtelierSpatialNavigation.analyze(plan, options)`는 현재 `interior-plan.js`/`interior-walk.js`와 같은 미터 X/Z 형상을 읽는다.

```js
const review = AtelierSpatialNavigation.analyze(plan, {
  clearanceM: 0.22, cellSizeM: 0.25, maxCells: 15000, maxPaths: 64
});
// review.paths[].points: [{x, z}], distanceM, minClearWidthM, doorIds
// review.ledger[]: pathId, fromId, toId, status, distanceM, widthStatus
```

- 벽은 두께를 가진 선분, 코어·void와 명시적 `plan.obstacles`는 불투과 사각형, 가구는 `rotationY`를 적용한 외곽이다. 보행 격자의 각 간선 전체를 충돌 검사한다. 얇은 벽을 끝점 검사만으로 건너뛰지 않는다.
- 문 통과점은 실제 벽 조각 사이로 통과할 때만 연결한다. 문 태그로 막힌 벽을 지우지 않는다. 알려진 방 외곽의 문폭을 좁히거나 `closed:true`로 바꾸면 통행도 제한한다. 문이 열린 상태라는 가정은 결과에 남는다.
- 방 원점은 실제로 설 수 있는 점이다. 중심점이 가구에 가려지면 방 내부 보행점을 선택한다. 경로는 방 중심 간 직선거리가 아닌 실제 연결 그래프의 길이 최소 경로다.
- 기본 경로는 방→내부 진입 후보, 방→코어 외곽 접근 후보, 고객·직원 대표 경로다. 코어 내부로 선을 넣지 않으며 계단 문이나 승강기를 만들어 연결하지 않는다.
- `minClearWidthM`는 경로 중심선 주변에서 확보한 폭의 보수적 추정이다. 넓은 곳에서는 8m에서 계산을 제한한다. 실제 복도 전체 폭·문 순유효폭·법정 최소 유효폭을 뜻하지 않는다. `minDoorWidthM`와 `doorCrossings[].widthM`은 별도로 제공한 문폭 원문과 구분한다.
- `status:'disconnected'`는 해당 보행 그래프에서 연결을 찾지 못했다는 뜻이다. 격자가 조정된 경우 더 세밀한 검토가 필요할 수 있다. 장애물 제거·중심점 직선거리로 실패를 대체하지 않는다.
- 실제 외부 출구·계단 입구가 없으면 내부 접근 후보로만 표시한다. `options.endpoints`에서 검증 자료를 제공해도 경로의 법정 피난 적합성은 별개이며 `isEgressVerified:false`를 유지한다. 이번 모듈은 층간 연결을 지원하지 않고 항상 `multiLevel.status:'unverified'`로 남긴다.
- `not-generated` 실내에는 거리 0을 반환하지 않는다. 유효하지 않은 형상은 `unavailable`, 입력/연산 한도 초과는 `limited`, 일부 경로 생략은 `partial`로 구분한다.

선택 경로 요청은 `options.endpoints:[{id,x,z,kind?,verified?,evidence?}]`와 `options.routes:[{fromId,toId,kind?,id?}]`로 전달한다. 외부 입력의 endpoint ID는 기본 `room:`/`core:` 접두어와 충돌하지 않게 지정한다. `verified:true`만 있는 점은 검증 자료로 취급하지 않으며 출처 또는 evidence를 함께 요구한다.

## 한도·캐시·검증

최대 1,000실, 기본 15,000셀, 20,000 graph node, 문 3,000개, 최종 장애물 18,000개, 경로 2,048개, 출력 점 50,000개, 목적지별 탐색 트리 8개, 충돌·검색 연산 250만 회로 제한한다. 문 통과점으로 격자를 보강하지만 큰 모델의 근사 단절을 정확 판정으로 과장하지 않는다. 동일 형상·문 상태·가구·clearance·옵션의 결과를 동기 캐시 4개에 보관한다. 큰 키는 캐시하지 않고 결과를 동결해 외부 수정으로 캐시가 오염되지 않게 했다.

`node tests/spatial-navigation.test.js`는 다음을 검사한다.

- 독립 `interior-walk.canStand`로 반환 경로 전 구간을 촘촘히 검사하고 길이를 다시 합산한다.
- 벽·코어·void 단절, 코어 우회, 회전 가구 우회, 가구로 막힌 방 중심점을 검증한다.
- 실제 문 틈·좁은 문폭·닫힌 문·벽을 뚫지 못하는 가짜 문 태그·거친 격자 사이의 통과점을 검사한다.
- 실제 자동 생성 업무·호텔·주거 평면, stable 원장/경로 ID, 고객/직원 대표 경로를 검사한다.
- 미생성 실내, 유효하지 않은 입력, 15,000셀·1,000실 한도, 캐시 무효화·동결·브라우저 UMD 동일성을 검사한다.

TopologicPy 자체 엔진의 실행 검증이나 외부 출구·계단·법정 거리·접근성·소방·군중 흐름 검증을 했다는 뜻은 아니다.
