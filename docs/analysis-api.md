# FORMEQUA Study API v1

상세 검토의 용도별 매스, 법규, 주차, 금융 결과와 선택층 실내 평면을 JSON으로 조회합니다. 물류 용도는 지원하지 않습니다.

## 실행과 구성

```powershell
python server.py
```

기본 주소는 `http://127.0.0.1:8090`입니다. `PORT` 환경변수로 포트를 지정할 수 있습니다. Node.js가 PATH에 있어야 하며, 필요하면 `NODE_BINARY`에 실행 파일의 절대 경로를 지정합니다. 서버는 Node를 인자 배열과 JSON stdin으로 호출하며 셸을 실행하지 않습니다.

`analysis-engine.js`는 브라우저가 사용하는 `app.js`의 `loadParcelPreset`·`evaluateDesignAndProforma`, `use-study.js`의 실제 용도 변경 처리, `legal-rules.js`·`use-permissions.js`, `interior-plan.js`의 `generate`, `finance-model.js`, `parking-layout.js`, `parcel-geometry.js`를 재사용합니다. 브라우저와 API에 서로 다른 법적 상한이나 재무 수식을 두지 않습니다. DOM 표현과 WebGL 초기화는 API에서 실행하지 않습니다.

## 엔드포인트

| 메서드 | 경로 | 결과 |
| --- | --- | --- |
| GET | `/api/v1/capabilities` | 지원 용도·필지·입력 enum·범위·법령 검토일 |
| GET | `/api/v1/openapi.json` | 실제 입력 제약을 포함한 OpenAPI 3.1 문서 |
| POST | `/api/v1/analysis` | 실제 계산 결과와 선택층 개념 평면 |

기존 `/api/health`, `/api/law-lookup`, `/api/zoning-law-sync`, `/api/calculate-skills`, `/api/facade-presets`는 유지합니다.

`/api/calculate-skills`는 독립 보조 계산입니다. 실제 경계·현재 층별 매스·금융 원장은 `/api/v1/analysis`를 사용합니다. 보조 응답의 `scope`는 `independent-reference-calculators`, `isCurrentDashboardResult`와 `isPermitConfirmation`은 false입니다. 과거 한국 주차 산술은 참고 가정으로 격리되어 있으며 보조 계단·법정 폭·보행거리 등은 미확인/null을 반환합니다. 따라서 이 보조 결과를 법정 주차나 확정 비용·인허가 판단에 사용하지 않습니다. 잘못된 본문·65,536바이트 초과·비유한수는 거부하고, 보조 계산 단계가 실패하거나 필수 면적이 누락되면 후속 계산을 중단합니다.

## 요청 예시

```javascript
const response = await fetch('/api/v1/analysis', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    program: 'hotel',
    parcelKey: 'gangnam_yeoksam',
    inputs: {
      hotelType: 'tourist',
      financeMode: 'hotel',
      hotelAdrKrw: 180000,
      hotelOccupancyPct: 70,
      hotelResidentialDistanceM: null,
      hotelResidentialBarrier: null,
      floorsAbove: 6,
      floorsBelow: 3,
      parkingMode: 'report'
    },
    floorLevel: 3
  })
});
const result = await response.json();
if (!response.ok) throw new Error(result.error.message);
```

`program`은 필수이며 `office`, `officetel`, `hotel`, `housing`, `living`, `knowledge`, `retail`, `sales`를 받습니다. `living`은 코리빙 공간 콘셉트로, 기본 법적 용도는 오피스텔입니다. 공동주택으로 검토하려면 `inputs.buildingUse: '공동주택(주상복합)'`, `inputs.residentialType: 'apartment'`를 함께 보냅니다.

`parcelKey` 생략 시 역삼 예시 필지를 사용합니다. `inputs`는 부분 입력을 허용하며 나머지는 해당 필지와 프로그램 기본값을 적용합니다. `floorLevel`을 생략하면 실제 생성된 호텔·주거·오피스 층 중 첫 층을 선택하고, 없으면 생성된 첫 층을 반환합니다. 요청한 층이 상한 적용 후 매스에 존재하지 않으면 400을 반환합니다. 매스에 층이 없고 층을 지정하지 않았다면 `plan`은 `null`입니다.

`inputs.regulationMode`의 기본은 `statutory`입니다. 이 모드에서는 `legalFarCapPct`, `legalBcrCapPct`, `maxHeightM`의 저장된 사용자 비교값을 계산에 적용하지 않고, 법령 MCP로 검토한 용도지역별 일반 기준과 확인된 개별 고시 상한을 적용합니다. 해당 필드의 원래 값은 `inputs`에 보존하며 파생 적용값은 `model.effectiveRegulationInputs`에 반환합니다. 사용자 추가 제한을 비교하려면 `regulationMode: 'scenario'`를 명시해야 합니다. 확인된 고시 제한은 두 모드 모두 적용하며 미확인 지구단위계획 상한은 확정값으로 취급하지 않습니다. 모드가 없는 기존 저장 파일도 법정 기준으로 복원합니다.

`inputs.modelDetail`은 `auto`(기본), `massing`, `concept`를 받습니다. 자동 간략 분류는 지상 4층 이하·지상 연면적 1,000㎡ 이하·지하 1층 이하의 기획 표시 가정입니다. 표현 수준은 구조 검토 면제나 설계 완료를 뜻하지 않으며 계산용 코어·면적·주차·금융은 유지합니다. 간략 표시의 `plan`은 `status: 'not-generated'`, `metrics: null`을 반환하므로 수량 0으로 해석하지 않습니다. `model.buildingReview`는 피난·구조안전 확인서류의 규모 조건과 미확인 자료를 반환하며 `structuralDesignVerified`는 false입니다. `floorsAbove`는 1~35층, `floorsBelow`는 0~7층입니다.

프로그램과 충돌하는 `buildingUse`, `spaceProgram`는 거부합니다. 명시한 `floorUseOverrides`는 각 층의 다른 용도를 허용하며 기존 모형처럼 실제 주차와 용도 허용 검토에 포함됩니다. `residentialType`은 화면의 ‘혼합용도의 주거 분류’ 입력처럼 주거 층의 법적 분류를 전달합니다. `mixedUseProfile`도 기존 엔진과 동일하게 적용됩니다.

알 수 없는 키, 숫자로 된 문자열, 비유한 수, 범위 밖 숫자, 잘못된 enum, 잘못된 층 번호를 거부합니다. 구체적인 입력 범위는 capabilities 또는 OpenAPI 문서를 확인합니다. 본문 상한은 65,536 byte이고 계산 subprocess의 제한 시간은 12초입니다.

## 수입 모델과 호텔 조건

`financeMode: 'rental'`은 기존 임대 시나리오를 유지합니다. `financeMode: 'hotel'`은 실제 생성된 호텔 객실 수를 기본으로 ADR·가동률·부대매출·운영비·고정비·위탁 수수료·FF&E를 계산하고, 비호텔 층의 임대수입만 따로 합산합니다. 호텔 객실층이 없으면 경고와 함께 임대 모드로 계산합니다. `hotelRoomsOverride: 0`은 자동 배치 객실 수, 양의 정수는 사용자 수량 가정입니다. 자동 배치 수와 운영 수량은 모두 반환하며 법정 정원을 의미하지 않습니다.

| 입력 | 단위·범위 |
| --- | --- |
| `hotelAdrKrw` | VAT·봉사료 제외 원/실·박, 0~5,000,000 |
| `hotelOccupancyPct` | 0~100% |
| `hotelRoomsOverride` | 0~5,000실 정수, 0은 자동 배치 |
| `hotelAncillaryRevenuePct` | 객실 매출 대비 부대매출 0~200% |
| `hotelOpexPct` | 총 호텔 매출 대비 변동 운영비 0~100% |
| `hotelFixedOpexEok` | 별도 고정비 0~1,000억원/년 |
| `hotelManagementFeePct` | 총 호텔 매출 대비 별도 위탁 수수료 0~30% |
| `hotelFfeReservePct` | 총 호텔 매출 대비 별도 FF&E 적립 0~30% |
| `hotelResidentialDistanceM` | 주거지역 경계 이격 0~10,000m 또는 `null`(미확인) |
| `hotelResidentialBarrier` | `true`(적용 근거 확인 가정), `false`(예외 미적용), `null`(미확인) |

변동 운영비율에 별도 입력한 고정비·위탁 수수료·FF&E를 중복 포함하지 않습니다. FF&E 공제 후 NOI를 매각·DSCR·월별 현금흐름·IRR·잔여지가에 사용합니다. 상세 공식과 남은 계산 범위는 [income-model.md](income-model.md)를 참조합니다. 이격거리 `null`은 0m로 변환하지 않으며 차단 입력만으로 허가를 확정하지 않습니다.

## 실제 경계 입력

`inputs.parcelData`는 `null` 또는 다음 canonical 형식을 받습니다. `geometry`는 EPSG:4326 `[경도, 위도]` 배열의 `Polygon` 또는 `MultiPolygon`입니다. 전체 좌표 2,000개, 최대 5개 필지, 경도 124~132·위도 33~39 범위이며 열린 링·자기 교차·연결되지 않은 합필 등은 400으로 거부합니다. 같은 필지 경계를 중복 보내더라도 합집합 면적을 사용하며 +35% 면적 가정을 적용하지 않습니다.

```javascript
{
  version: 1,
  source: 'import', // 또는 'vworld'
  fetchedAt: '2026-10-21T00:00:00Z', // 선택
  features: [{
    type: 'Feature',
    properties: { pnu: '1111010100100010000', source: '사용자 제공 자료' },
    geometry: { type: 'Polygon', coordinates: [/* 폐합된 [경도,위도] 링 */] }
  }]
}
```

경계의 근사 투영 면적과 연결된 합집합을 사용하고 매스는 경계 안의 보수적인 남북축 사각 영역에 배치합니다. `evidence.boundaryApplied`는 경계를 계산에 사용했다는 표시입니다. `liveParcelVerified`와 `isPermitConfirmation`은 계속 `false`이며 사용자가 입력한 PNU나 `source: 'vworld'`만으로 공적 자료를 인증하지 않습니다. 용도지역·지구단위계획 구역은 `GET /api/v1/parcels/{pnu}/regulations`로 조회하고 각 Feature의 `properties.regulations`에 정규화된 자료를 전달할 수 있습니다. 필지 전체의 명확한 단일 서울 지원 용도지역은 법령 MCP 검토 일반 기준에 대응합니다. 개별 고시의 세부 상한·접도 방향·실측 면적과 법적 합필은 별도 확인합니다.

## 응답

| 필드 | 내용 |
| --- | --- |
| `apiVersion` | `1.0` |
| `program` | 요청한 용도 |
| `inputs` | 기본값을 적용한 재현 가능한 입력 스냅샷 |
| `model.floorPlates` | 상한·후퇴·주차 제약을 적용한 실제 층별 면적과 치수 |
| `model.zoningRule`, `model.usePermission`, `model.constraints` | 밀도 상한, 허용 상태·근거·조건, 실제 제약과 경고 |
| `model.areas`, `model.parking`, `model.egress`, `model.facade` | 면적·주차·피난·외피 산정 결과 |
| `model.finance` | 개발비·대출·NOI·매각·현금흐름·IRR·NPV·LP/GP 배분 |
| `model.finance.income`, `model.floorPlates[].income` | 임대·호텔 수입 분리, 운영 객실 수·지출·공통 층별 대사·가정 |
| `model.parcelGeometry` | 사용한 경계 합집합·근사 면적·보수적 사각 영역·출처·경고 |
| `plan` | 선택층 경계·코어·복도·방·내벽·문·가구·지표·경고 |
| `evidence` | 법령 검토일과 원문 링크, 필지 검증·인허가 확인 여부 |
| `units` | 면적·길이·억원·평당 백만원·평당 만원 등 단위 |
| `limitations` | 해당 결과의 적용 한계 |
| `generatedAt` | ISO 8601 계산 시각 |

수학적으로 산정할 수 없는 IRR 등은 JSON에서 `null`입니다. 0% 수익률로 해석하면 안 됩니다. 금지 용도는 모델 비교를 위해 계산할 수 있지만 `model.usePermission.status: 'prohibited'`, `canUseForStudy: false`로 명시됩니다. HTTP 200은 사업 가능성이나 인허가 승인을 뜻하지 않습니다.

오류 형식은 `{ "error": { "code": "INVALID_REQUEST", "message": "..." } }`입니다. 잘못된 요청은 400, 본문 초과는 413, Content-Type 오류는 415, 런타임 부재는 503, 계산 제한 시간 초과는 504입니다.

## 현재 자료 범위와 고도화 지점

법령은 기존 검토 스냅샷을 사용합니다. 실시간 외부 법령을 호출해 임의로 수식을 바꾸지 않습니다. 예시 필지와 사용자 경계의 용도지역·지구단위계획은 공적 필지 자료로 확인한 결과가 아닙니다. 평면은 구조·설비·피난·접근성의 실시설계 검증 전 개념 배치입니다. 주차 수량은 생성한 구획·램프·통로의 기하 배치와 비교하지만 진입·차량 회전·접근성·방재의 적합성을 확정하지 않습니다. 호텔 운영은 사용자가 입력한 안정화 가정이며 실제 시장 조사·세무·다년 보유 운영 모델은 아닙니다.

프로젝트 JSON 저장·불러오기는 브라우저의 로컬 파일 기능입니다. API는 입력 스냅샷을 반환해 재현 계산을 지원하며 계정·서버 영구 저장·공개 API 인증·사용량 제한을 제공하지 않습니다. 공적 계획 자료의 출처·효력 확인과 운영 계층은 후속 통합 항목입니다.

## 검증

```powershell
node tests/api-analysis.test.js
node tests/api-income-parcel.test.js
python tests/api-http.test.py
```

실제 오피스·오피스텔의 엄격한 면적 상한, 호텔·주거·코리빙의 다른 실내 계획, 금지 용도의 명시, 입력 스냅샷 재현, HTTP 오류·본문 제한·런타임 시간 제한을 검증합니다. HTTP 테스트는 임시 loopback 포트에서 실행하므로 현재 8090 서버를 중단하지 않습니다.
