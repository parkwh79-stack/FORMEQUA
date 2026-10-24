# 호텔 모듈과 BIM 협업 적용 조사

검토일: 2026-10-21. 공개 공식 저장소의 파일·커밋·전체 트리와 라이선스를 읽고, 적용 가능한 설계 원리를 독립적인 JavaScript로 구현했다. C# 코드를 복제하거나 런타임을 설치하지 않았다. 외부 저장소의 파일은 참고 자료로만 취급했다.

## 공식 자료와 유지 상태

| 프로젝트 | 확인한 기본 브랜치 최신 커밋 | 라이선스 | 확인 범위와 적용 판단 |
|---|---|---|---|
| DynamoDS/DynamoRevit | [`49cd43c5c3b21271640ae043b8b77374e4796843`](https://github.com/DynamoDS/DynamoRevit/commit/49cd43c5c3b21271640ae043b8b77374e4796843), 2026-10-12 12:37:04 UTC | [Apache-2.0](https://github.com/DynamoDS/DynamoRevit/blob/49cd43c5c3b21271640ae043b8b77374e4796843/LICENSE.txt) | archived=false. Dynamo Core 4.2.2.6377로 갱신한 커밋이다. Family/Level 배치와 trace 방식은 협업 어댑터 설계의 근거로 활용한다. |
| hypar-io/Elements | [`d4e7a95266e6b0941f7f0649febbf04cea69a6f4`](https://github.com/hypar-io/Elements/commit/d4e7a95266e6b0941f7f0649febbf04cea69a6f4), 2026-05-26 16:05:55 UTC | [MIT](https://github.com/hypar-io/Elements/blob/d4e7a95266e6b0941f7f0649febbf04cea69a6f4/LICENSE.md) | archived=false. 테셀레이션·정점 정리 수정 병합 커밋이다. 반복 부재 정의·인스턴스 구분을 객실 catalog/type_id/instance ID에 적용한다. |

두 저장소의 재귀 트리는 각각 12,345개와 1,295개 항목이며 GitHub의 `truncated`가 false였다. **어느 트리에도 `SKILL.md`는 없었다.** 이름이 비슷한 로컬 스킬이나 제3자 스킬을 이 저장소의 공식 기능으로 취급하지 않는다. 커밋이 있다는 사실은 현재 앱과의 호환성 검증이나 제품 지원 보장이 아니다.

## DynamoRevit에서 확인한 실제 동작

- [`FamilyInstance.cs`](https://github.com/DynamoDS/DynamoRevit/blob/49cd43c5c3b21271640ae043b8b77374e4796843/src/Libraries/RevitNodes/Elements/FamilyInstance.cs): `ByPoint`, `ByCoordinates`, `ByPointAndLevel`, `ByCoordinateSystem`, `ByHostAndPoint`가 있다. 초기화 함수는 trace의 기존 요소를 찾아 위치·레벨·타입을 바꾸거나, 문서 transaction 안에서 family symbol을 활성화하고 새 요소를 만든다. 배치 점만 전달한다고 호텔의 벽·문·객실 관계까지 생기는 엔진은 아니다.
- [`ElementBinder.cs`](https://github.com/DynamoDS/DynamoRevit/blob/49cd43c5c3b21271640ae043b8b77374e4796843/src/Libraries/RevitServices/Persistence/ElementBinder.cs): `GetElementFromTrace`, `SetElementForTrace`, `CleanupAndSetElementForTrace`가 문서 요소 식별·재사용·교체 정리를 담당한다. 향후 어댑터는 앱 ID와 Revit UniqueId 매핑, 문서별 범위, 충돌 및 삭제 승인 정책이 필요하다. 이번 JSON은 추적할 ID를 제공하지만 Revit 요소를 갱신·삭제하지 않는다.
- [`RevitNodes.csproj`](https://github.com/DynamoDS/DynamoRevit/blob/49cd43c5c3b21271640ae043b8b77374e4796843/src/Libraries/RevitNodes/RevitNodes.csproj)는 RevitAPI/RevitAPIUI와 WPF를 참조한다. [`CS_SDK.props`](https://github.com/DynamoDS/DynamoRevit/blob/49cd43c5c3b21271640ae043b8b77374e4796843/src/Config/CS_SDK.props)는 Windows x64와 net8.0-windows/net10.0-windows 대상을 정의한다. 따라서 이 C# 호스트를 현재 WebGL 앱에 직접 로드하지 않는다.

Apache 라이선스는 저장소 소스에 적용된다. Autodesk Revit 제품의 이용 권한이나 별도 ASM/LibG 기하 라이선스를 함께 부여하지 않는다. 공식 [Dynamo 설정 설명](https://primer2.dynamobim.org/2_setup_for_dynamo)은 Sandbox 기하 기능에 해당 Autodesk 제품의 구독/라이선스가 필요함을 설명한다. Revit 실행은 해당 환경·버전·패밀리·좌표를 마련한 뒤 별도 검증해야 한다.

## Elements에서 확인한 실제 동작

- [`ArrayPlacementRule.cs`](https://github.com/hypar-io/Elements/blob/d4e7a95266e6b0941f7f0649febbf04cea69a6f4/Elements.Components/src/Rules/ArrayPlacementRule.cs): `FromClosestPoints`로 앵커와 변위를 연결하고 `Instantiate`에서 경로를 변환한다. 길이/근사 길이/개수 방식으로 Grid1d를 나누어 부재 인스턴스를 만든다. 원문의 새 GUID 방식을 그대로 쓰면 재생성 때 ID가 달라지므로 이번 앱은 원본 실 ID와 층을 기반으로 결정적인 식별자를 쓴다.
- [`IFCModelExtensions.cs`](https://github.com/hypar-io/Elements/blob/d4e7a95266e6b0941f7f0649febbf04cea69a6f4/Elements.Serialization.IFC/src/IFCModelExtensions.cs): `FromIFC`와 파일/스트림 `ToIFC`를 제공한다. `CreateIfcDocument`는 기본 Site/Building/Storey를 만들고 제품을 기본 Storey에 담는다. 변환 실패 요소는 예외를 기록하고 계속 처리할 수 있다. 이 파일만 도입해서 현재 앱의 여러 층·실·문 관계가 정확해진다고 보장할 수 없다.
- [`Elements.csproj`](https://github.com/hypar-io/Elements/blob/d4e7a95266e6b0941f7f0649febbf04cea69a6f4/Elements/src/Elements.csproj)는 netstandard2.0 및 여러 .NET 패키지·기하 DLL을 사용한다. 앱에 이 런타임을 추가하는 대신 검증 가능한 catalog/instance/JSON 원리를 적용했다.

## 이번 적용

### hotel-modules.js

`normalizeHotelSettings`로 공통 설정을 확인하고, `planRooms` → 기존 가구·욕실 배치 → `assignRooms` 순서로 사용한다. 원본 geometry와 `room.id`를 보존하고 `type_id`, `moduleId`, `hotelModule`을 연결한다.

| 모듈 | 기획 배치 가정 | 완성 객실 확인 | 단가 |
|---|---|---|---|
| standard | 20㎡, 최소 변 3.5m | 출입문, 침대 1개, 구획 욕실·문·변기·세면대 | 기준 ADR |
| twin | 20㎡, 최소 변 3.5m | 동일 조건과 침대 2개 | 기준 ADR × 트윈 배수 |
| suite | 38㎡, 최소 변 4m | 동일 조건과 침대·소파 | 기준 ADR × 스위트 배수 |
| housekeeping | 4㎡, 최소 변 1.5m의 지원 공간 가정 | 기하 예약 상태와 부족 상태를 구분 | 객실 매출 제외 |

**치수는 법정 최소 또는 호텔 등급 인증 기준이 아니다.** 객실 유형 비율과 N객실당 지원실 수는 사용자 기획값이다. 면적·가구 조건이 부족한 스위트를 이름만 바꾸어 만들지 않는다. 목표 수량, 실제 유형, 미달 수량을 별도로 보관한다. 세탁·직원·창고·설비 등 호텔 운영 전반을 이 지원실 하나로 충족했다고 판단하지 않는다.

`preview`와 `finance-model.js`는 유형별 **유효 객실 수 × 유형별 ADR × 365 × 가동률**의 같은 공식을 쓴다. 실제 객실이 없는 경우 수동 운영 객실 수를 넣지 않으면 매출은 0이다. 수동 총객실 수를 넣으면 실제 생성 비율을 정수 배분하고, 생성 객실이 없을 때만 목표 비율을 사용한다. 이는 사용자 운영 가정으로 표시하고 평면 수량은 바꾸지 않는다. FF&E·위탁수수료·고정비 등 기존 운영비 공제와 층별 합계를 유지한다.

ID는 동일 프로젝트 범위·층·원본 실 ID에 대해 재생성·단가 변경 시 유지된다. 평면 분할로 원본 실 ID가 바뀌면 자동으로 동일 실이라고 보장하지 않는다. 이 변경의 외부 문서 반영은 어댑터가 검토해야 한다.

### bim-handoff.js

`buildHandoff(model, {plans, inputs, projectId, parcelKey, option, createdAt})`와 `serialize`가 `formequa.bim-handoff`, schemaVersion 1의 JSON을 만든다. 이는 FORMEQUA 자체 협업 스키마이며 공인 BIM 표준이나 RVT/IFC가 아니다.

- 좌표: source x/z 평면과 y 높이를 BIM `[x, -z, height]` 미터로 옮긴다. 층 elevation, 이미 적용된 northShift, WGS84 원점, frameRotationRad, trueNorth와 미측량 수직 기준을 함께 기록한다. Revit 내부 피트 변환은 `/0.3048`이며 실제 좌표 지정은 어댑터 검증 대상이다.
- 객체: 층·실·분절 내벽·문을 고유 ID로 내보낸다. storey-contains, room-boundary-segment, room-door, opening-adjacent-segment 관계를 담는다. 실 ID·type_id·moduleId와 생성 호텔 객실 수를 연결한다.
- 문: 현재 내벽은 문 폭만큼 끊어진 개념 선분이다. 연결된 선분을 문 호스트로 확정하지 않고 `hostWallId:null`, `nativeHostVerified:false`로 기록한다. 실제 Revit용 벽 연속선 복원과 hosted family 매핑이 남는다.
- 검증: 중복 ID, 존재하지 않는 층·실·벽 참조, 유한하지 않은 좌표, 실 경계/면적 불일치, 호텔 집계 수량 불일치를 오류로 막는다. 생성되지 않은 실내는 수량 0을 확정하는 대신 해당 층의 planStatus와 경고로 남긴다.
- 범위: `nativeExecution.performed:false`, `adapterImplemented:false`다. 구조설계·허가·전문가 피난 검토를 완료했다고 표시하지 않는다. 기존 `mass-ifc.js`의 검증된 매스 출력은 유지한다.

## 건축사 Revit 환경이 마련된 뒤 남는 개발

1. 버전이 고정된 Revit/Dynamo 호스트, 문서 transaction과 실제 Family/type catalog.
2. shared coordinates, 내부 피트, 층 기준과 true north를 작은 샘플에서 왕복 검증.
3. 연속 호스트 벽·개구부·문/창 Family 관계를 복원하고 객실 Space/Room 생성 규칙 검토.
4. 앱 moduleId ↔ Revit UniqueId 매핑, 변경 미리보기, 문서 소유 범위, 재실행 중복 방지. 기존 객체 삭제는 별도 승인과 복구 전략을 갖춘 뒤 구현.
5. 실제 Revit/IFC 수신 도구에서 여러 층·객실·문·공간 경계 및 수량을 대조. 현재는 외부 엔진 실행 결과가 없으므로 native 지원 완료를 보장하지 않는다.

## 검증

`node tests/hotel-modules.test.js`, `node tests/bim-handoff.test.js`, `node tests/finance-income-integration.test.js`, `node tests/core-cache-invalidation.test.js`, `node tests/core-representation.test.js`에서 배치 가능 유형·지원실 매출 제외·완성 가구 조건·타입별 ADR·수동 수량 구분·안정 ID·좌표/층/객체 관계·Node/브라우저 동등성·표시모드와 계산의 분리를 확인한다. Revit 실행 테스트는 수행하지 않았다.
