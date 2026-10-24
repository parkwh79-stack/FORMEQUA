# 주소 → PNU → 필지 경계

`parcel_service.py`는 주소 후보 검색·연속지적도 경계·용도지역 및 지구단위계획 공간자료 조회를 담당합니다. HTTP 처리는 Python 표준 라이브러리, 정확한 다각형 교차면적은 기존 웹 계산 엔진과 같은 번들 `polygon-clipping`을 Node.js로 실행하여 계산합니다. 주소가 여러 지번에 대응할 때 첫 결과를 자동으로 확정하지 않고, 최대 10개의 PNU 후보를 반환하여 사용자가 대상 지번을 선택하게 합니다. 이 검색 후보 수와 별개로, 한 대지 검토에 입력·적용할 필지는 **최대 5개**입니다.

## 서버 설정

| 환경변수 | 역할 |
| --- | --- |
| `JUSO_API_KEY` | 행정안전부 주소 검색 API 승인키. 설정되어 있으면 주소 후보 검색에 우선 사용. |
| `VWORLD_API_KEY` | 브이월드 검색 API 및 2D 데이터 API 승인키. 필지 경계 조회에 필요. |
| `VWORLD_DOMAIN` | 브이월드에 승인받은 서비스 주소. 생략 시 로컬 주소 `http://127.0.0.1:8090`. |

인증키는 서버 환경에만 설정하고 브라우저 HTML·스크립트·프로젝트 파일에 넣지 않습니다. 서버가 시작된 뒤 프로세스 외부의 환경변수를 바꾼 경우에는 새 설정을 읽도록 서버를 다시 시작해야 합니다. 이 문서와 테스트에는 실제 키를 포함하지 않습니다.

`status()`의 `configured`와 `*Ready`는 **설정 존재 여부**이며 실제 API 승인·도메인 등록·남은 사용량을 검증한 결과는 아닙니다. 운영 서버에서 승인된 키로 별도 연결 확인이 필요합니다. 키가 없으면 예시 PNU·가짜 경계를 반환하지 않고 HTTP 503에 대응하는 `PROVIDER_NOT_CONFIGURED` 오류를 반환합니다.

## 주소에서 PNU를 찾는 방법

Juso의 `addrLinkApi.do` 응답에서 다음과 같이 구성합니다.

```text
법정동코드 admCd 10자리
+ 산 여부: mtYn=0(대지) → 1, mtYn=1(산) → 2
+ 지번 본번 lnbrMnnm 4자리 (앞에 0 채움)
+ 지번 부번 lnbrSlno 4자리 (앞에 0 채움)
= PNU 19자리
```

건물관리번호, 행정동명, 주소 문자열을 자의적으로 잘라 PNU를 만들지 않습니다. 필요한 공식 코드와 지번이 없으면 해당 후보의 PNU를 확정하지 않습니다. 도로명주소는 대표 지번에 대응할 수 있으므로 `relJibun` 관련 지번을 함께 표시하고, 여러 필지에 걸친 건물은 실제 사업 대상 경계를 확인해야 합니다.

Juso 키가 없고 브이월드 키가 있으면 `req/search`의 `type=address`, `crs=EPSG:4326`에서 **지번 `category=parcel`을 우선 검색**합니다. 지번 검색으로 PNU 후보를 찾지 못하면 도로명 `category=road`로 검색합니다. 후보의 대표 주소는 지번주소를 우선 사용하고, 지번주소가 없을 때 도로명주소를 표시합니다. 응답 `items[].id`가 19자리 숫자일 때만 PNU로 취급합니다. 다른 ID인 경우 주소 좌표를 `LP_PA_CBND_BUBUN` 레이어에 `geomFilter=POINT(lon lat)`로 조회하여 `properties.pnu`를 확인합니다. 주소 좌표가 복수 필지 경계에 놓이면 후보들을 별도로 반환합니다.

## 필지 경계 조회

고정된 HTTPS 엔드포인트 `https://api.vworld.kr/req/data`에 다음을 요청합니다.

```text
service=data
request=GetFeature
data=LP_PA_CBND_BUBUN
attrFilter=pnu:=:{확인한 PNU}
crs=EPSG:4326
geometry=true
attribute=true
```

반환 경계의 `properties.pnu`가 요청한 PNU와 일치해야 합니다. 같은 PNU가 여러 Feature로 나누어 반환되면 각 Polygon/MultiPolygon의 좌표를 **하나의 MultiPolygon Feature**로 모읍니다. 이때 첫 Feature의 PNU·주소·출처를 사용하고 전체 좌표 2,000개 한도를 유지합니다. 한 PNU는 실제 필지 선택 한 칸을 차지하며, 위상 합집합은 브라우저의 공유 기하 엔진이 계산합니다. 다른 PNU, Polygon/MultiPolygon이 아닌 기하, 닫히지 않은 고리, 유한하지 않은 좌표, 한국 범위 밖의 좌표, 필지 수·좌표 수 제한 초과는 오류입니다. 브라우저의 `AtelierParcelGeometry.sanitizeParcelData`가 이어서 위상·경계 연결 등을 검증합니다.

경계 조회는 현재 최대 10개 Feature의 첫 페이지를 지원합니다. `record.total`·`record.current`와 실제 Feature 수가 다르거나 후속 페이지가 존재하면 `PARCEL_BOUNDARY_INCOMPLETE` 오류로 중단합니다. 전체 건수와 페이지 정보가 모두 없는 10개 한도 응답도 완결 경계로 사용하지 않습니다. 페이지 메타데이터가 잘못된 형식이면 오류이며, 잘린 일부 경계로 면적·규제를 계산하지 않습니다.

반환 형식은 프로젝트 파일과 동일한 `parcelData`입니다.

```json
{
  "version": 1,
  "features": [{
    "type": "Feature",
    "geometry": {"type": "Polygon", "coordinates": []},
    "properties": {"pnu": "1168010100100010000", "address": "공식 응답의 주소", "source": "vworld"}
  }],
  "source": "vworld",
  "fetchedAt": "2026-10-21T00:00:00.000Z"
}
```

위 예시의 빈 좌표는 구조 설명용입니다. 웹에서 입력·적용·저장하는 실제 경계는 **최대 5개 필지(Feature)**, 전체 2,000개 좌표 이내입니다. 좌표 범위는 경도 124~132, 위도 33~39입니다. 주소 검색 후보는 최대 10개까지 표시되지만, 후보를 10개 필지로 일괄 적용하지 않습니다.

**주소·경계 조회의 성공만으로 용도지역·지구단위계획·법정 건폐율·용적률·주차 구역을 확정하지 않습니다.** 별도의 `fetch_parcel_regulations`가 아래 공식 공간자료를 확인합니다. 출처와 레이어 계약이 검증되지 않은 규제 값을 추정해서 적용하지 않습니다. `status()`의 규제 상태와 주소 검색 안내는 개별 필지의 규제가 아직 조회되지 않았다는 뜻입니다. 경계 조회 성공이 곧 건축 허용이나 합필의 행정적 승인을 뜻하지 않습니다.

## 필지별 용도지역·지구단위계획

`fetch_parcel_regulations(pnu)`는 먼저 해당 PNU의 실제 경계를 가져오고, 그 경계의 BOX 범위로 다음 고정 레이어를 조회합니다. BOX는 `BOX(minLon,minLat,maxLon,maxLat)`의 네 숫자 쉼표 형식입니다. 후보 경계를 실제 필지와 다각형 교차한 뒤 **면적이 0인 이웃·접경 영역을 제외**합니다. 필지 중심점 하나를 조회하여 전체 용도지역으로 가정하지 않습니다.

| 공식 레이어 | 데이터 | 사용하는 공식 속성 |
| --- | --- | --- |
| `LT_C_UQ111` | 도시지역 | `uname`, 응답에 존재할 때만 `ucode` |
| `LT_C_UQ112` | 관리지역 | `uname`, 응답에 존재할 때만 `ucode` |
| `LT_C_UQ113` | 농림지역 | `uname`, 응답에 존재할 때만 `ucode` |
| `LT_C_UQ114` | 자연환경보전지역 | `uname`, 응답에 존재할 때만 `ucode` |
| `LT_C_UPISUQ161` | 지구단위계획 | `dgm_nm` 이름, `present_sn` 관리 식별자, `ntfc_sn` 고시 식별자 |

공식 WFS GetCapabilities·DescribeFeatureType과 Data API의 실제 응답을 2026-10-21에 대조했습니다. 인증정보를 제외한 근거는 [공식 레이어 메타데이터 확인 기록](../law-evidence/vworld-layer-metadata-20261021.json)에 있습니다. 실제 도시지역 응답에는 `uname`만 있고 `ucode`가 없는 경우도 있어 이름에서 코드를 만들어 넣지 않습니다. 지구단위계획의 고시 식별자는 원문 URL이나 원문 내용으로 간주하지 않습니다.

결과 계약:

```text
{
  pnu,
  status: "verified" | "partial" | "unverified",
  zones: [{name, code?, source, intersectionAreaSqm, coveragePct}],
  districtPlans: [{name, code?, noticeId?, source, intersectionAreaSqm}],
  limits: {farPct: null, bcrPct: null, heightM: null},
  sources: [{title, url, checkedAt}],
  checkedAt,
  warnings: [string]
}
```

`verified`는 이 다섯 공간 레이어가 모두 조회되고, 필지 전체의 용도지역 분포가 교차면적으로 확인되었다는 뜻입니다. **인허가나 개별 계획의 상한 확정을 뜻하지 않습니다.** 여러 용도지역이면 각각의 교차면적을 유지하고, 동일 지역의 겹치는 조각은 합집합으로 계산하여 중복 면적을 제거합니다. 필지 내부 구멍도 면적에서 제외합니다. 미조회 레이어, 잘린 응답, 일부 미확인 용도지역, 서로 다른 용도지역 중복은 `partial`로 표시합니다. Node 계산 모듈이 없거나 교차 계산이 실패하면 단순 BOX 후보를 해당 필지 지정사항으로 반환하지 않고 `unverified`로 남깁니다.

`limits`의 건폐율·용적률·높이는 개별 지구단위계획 고시·시행지침의 적용 내용을 확인하지 않았으므로 **항상 null**입니다. 공간자료의 다른 숫자 속성을 상한으로 오인하지 않습니다. 여러 용도지역의 한도를 단순 평균하거나 한 지역만 골라 확정하지 않습니다. 주차구역·다른 법률 지정사항은 이 다섯 레이어의 조사 범위에 포함하지 않습니다.

교차면적은 기존 경계 계산과 같은 지역 평면 근사 투영값입니다. 공부 면적이나 측량 성과를 대체하지 않습니다. 개별 규제 레이어 응답의 경계는 최대 1,000개·좌표 50,000개, 각 HTTP 응답은 4 MiB 이내로 제한합니다. 고정된 번들 모듈과 고정 JavaScript만 실행하며 좌표는 stdin의 JSON으로 전달합니다. 셸 명령이나 모듈 경로에 주소·PNU·응답 문자열을 삽입하지 않습니다. Node 교차 계산 제한 시간은 8초입니다.

## Python 인터페이스

| 메서드 | 반환 |
| --- | --- |
| `status()` | 제공자 설정 존재 여부, 주소 검색/경계 조회 준비 상태, 미확인 규제 안내. 네트워크 요청 없음. |
| `search_addresses(q)` | `{provider, query, candidates, totalCount, truncated, notes}`. 후보는 `{pnu, address, roadAddress, jibunAddress, source, pnuMethod}`이며 관련 지번·좌표·복수 경계 안내가 추가될 수 있음. |
| `fetch_parcel(pnu)` | 정규화된 `parcelData` 객체. |
| `fetch_parcel_regulations(pnu)` | 실제 필지와 교차하는 용도지역·지구단위계획 이름·공식 식별자·교차면적·조회 출처. 개별 계획 상한은 미확정 null. |
| `fetch_parcel_context(pnus, radius_m=120)` | 실제 선택 필지 1~5개 주변의 연속지적도·도로 중심선·도시계획도로를 구분한 EPSG:4326 GeoJSON. 아래 공간자료 계약 참고. |
| `ParcelServiceError(code, message, status)` | 원본 응답·인증키·요청 URL을 포함하지 않는 공개 오류. |

주소 입력은 2~200자, PNU 입력은 19자리 숫자 문자열입니다. 한 요청의 응답은 최대 4 MiB, 개별 상위 요청 제한 시간은 5초, 주소 검색 과정 전체 예산은 18초입니다. HTTPS 호스트와 API 경로는 코드의 고정 목록만 허용하고 리다이렉트는 따르지 않습니다. 입력 주소가 URL처럼 보여도 요청 대상 호스트로 사용하지 않습니다.

## 근거 및 검증 범위

- [행정안전부 주소기반산업지원서비스](https://business.juso.go.kr/) — 검색 API 이용 신청과 `admCd`, `mtYn`, `lnbrMnnm`, `lnbrSlno`, 관련 지번 항목.
- [브이월드 공식 주소 검색 후 필지 표출 예제](https://github.com/V-world/V-world_API_sample/blob/master/%5B%EA%B2%80%EC%83%89%2C%20DATA%5D%20%EC%A3%BC%EC%86%8C%20%EA%B2%80%EC%83%89%20%ED%9B%84%20%ED%95%84%EC%A7%80%20%ED%91%9C%EC%B6%9C.html) — 주소 검색 ID와 PNU 필터를 연결하는 공식 예제. 예제의 키를 복사하거나 사용하지 않음.
- [브이월드 검색 API 2.0](https://www.vworld.kr/dev/v4dv_search2_s001.do), [2D 데이터 API](https://www.vworld.kr/dev/v4dv_2ddataguide2_s001.do) — 운영 연동 시 승인된 키의 API 사용 범위와 도메인 조건 확인.

`python -m unittest discover -s tests -p test_parcel_service.py -v`는 상위 API를 모의하여 PNU 구성, 산 지번, 주소 모호성, 좌표 대체 조회, 경계·PNU 일치, 응답 크기·제한 시간, 키 유출 방지 등을 검사합니다. 실제 키를 사용한 외부 API 호출은 테스트에 포함하지 않습니다.

`python -m unittest discover -s tests -p test_parcel_regulations.py -v`는 공식 레이어 HTTP를 모의하고 실제 번들 다각형 엔진으로 교차면적·복수 용도지역·이웃 제외·내부 공백·중복 제거·잘린 자료·모듈 부재·상한 미확정을 검사합니다. Node가 설치되지 않은 환경에서는 다각형 계산 테스트를 건너뛰므로, 운영 배포 시 Node 실행 환경도 확인해야 합니다.

## 로컬 인증 설정

`provider_settings.py`는 웹 공개 폴더 바깥의 `../.secrets/formequa-providers.json`에서 승인키 설정을 읽습니다. 환경변수가 있으면 파일보다 우선합니다. 설정 파일은 Git 제외 대상이며 HTTP로 제공하지 않고, 인증키는 상태 API·브라우저 소스·프로젝트 파일에 포함하지 않습니다. 필지 API는 다른 웹사이트에서 들어오는 브라우저 요청을 거부합니다.

2026-10-21 실제 지번 검색·경계·용도지역·지구단위계획 조회를 확인했습니다. 성수동2가 277-17은 공간자료상 준공업지역이 필지 전체를 덮고 성수IT 지구단위계획 구역과 교차합니다. 일반 상한은 법령 MCP 검토 기준에 대응하며, 개별 계획 고시의 완화·높이·용도 제한은 별도 원문 확인 전 미확인입니다. `law-evidence/parcel-live-check-20261021.json`은 공개 필지 조회 검증 자료이며 인증키를 포함하지 않습니다.

## 실제 주변 지적도·도로와 공통 좌표

`fetch_parcel_context(pnus, radius_m=120)`는 입력 PNU의 실제 필지 경계를 다시 조회해 공통 BOX를 만든 뒤 다음 네 가지 공식 자료를 가져옵니다. 최대 5필지, 기본 여유 범위 120m이며 허용 범위는 20~300m입니다. 선택 경계의 가로 또는 세로 범위가 1,500m를 넘으면 거부합니다. PNU·여유 범위에서 조회 호스트, 레이어명 또는 파일 경로를 만들지 않습니다.

서버 라우팅 계약: `GET /api/v1/parcels/context?pnus={쉼표로 구분한 PNU}&radiusM=120`.

| 고정 레이어 | 실제 자료 형식 | 반환·해석 |
| --- | --- | --- |
| `LP_PA_CBND_BUBUN` | Polygon / MultiPolygon | `parcels`: `pnu`, `address`, `jibun`, `selected`, 고시 연월 원문. 지적도 레이블 끝의 `도`를 별도 검증된 지목 코드로 승격하지 않음. |
| `LT_L_SPRD` | LineString / MultiLineString | `roads`: 도로명주소 도로 중심선, 응답의 `rn`을 `name`으로 보관. |
| `LT_L_N3A0020000` | LineString / MultiLineString | `roads`: 도로 중심선, `rdnm`·`ufid`와 일부 공식 원문 속성. |
| `LT_C_UPISUQ151` | Polygon / MultiPolygon | `plannedRoads`: 도시계획도로, `planned:true`, `dgm_nm`·`present_sn`·`ntfc_sn`·`grad_se`·`exc_nam`을 보관. 실제 개설 도로로 간주하지 않음. |

공식 WFS의 GetCapabilities·DescribeFeatureType와 Data API의 실제 응답을 2026-10-21 대조했습니다. `LT_L_SPRD`의 WFS 스키마에는 `road_bt`가 있지만 실제 Data API 응답에는 `rn`만 있는 사례가 있었습니다. `LT_L_N3A0020000` 실제 응답에는 `rvwd`, `rdln` 등이 있으나 이 작업에서 해당 속성의 공식 의미·단위와 법적 도로 폭 적용 조건까지 확인하지 않았습니다. 따라서 **모든 도로 중심선의 `widthM`은 null, `widthVerified`와 `physicalBoundaryVerified`는 false**입니다. 원문 숫자 문자열은 `attributes`에 보존하며 차로 수에서 폭을 계산하거나 임의 폭의 도로 면적을 생성하지 않습니다. 도시계획도로 면적과 지적도 역시 실제 차도·보도 경계나 건축법상 접도 판정을 대체하지 않습니다.

인증정보를 제외한 [공식 레이어·필드 확인 기록](../law-evidence/vworld-context-layer-metadata-20261021.json)과 [실제 서초동 1596-3·5·6 주변 조회 기록](../law-evidence/parcel-context-live-check-20261021.json)을 보관합니다. 실제 조회에서는 지적도 184개, 도로명주소도로 24개, 도로중심선 121개, 도시계획도로 4개가 반환되었고 네 레이어 모두 페이지 누락 없이 확인되었습니다. 이는 조회 당시 제공자 자료의 완결성 검사이며 현장 변경·측량 정확성의 보증은 아닙니다. 원본 기하를 보존한 `tests/fixtures/seocho-1596-site-context.json`은 오프라인 좌표·렌더링 검증용 공개 공간자료이며 운영 조회의 대체 자료로 자동 사용하지 않습니다.

응답:

```text
{
  version: 1, source: "vworld", crs: "EPSG:4326",
  pnus: [...], radiusM, bbox: [minLon, minLat, maxLon, maxLat], checkedAt,
  selectedParcels: FeatureCollection,
  parcels: FeatureCollection, roads: FeatureCollection, plannedRoads: FeatureCollection,
  layers: [{
    id, title, kind: "cadastral" | "road-centerline" | "planned-road",
    status: "available" | "empty" | "partial" | "unavailable",
    featureCount, totalCount: number | null, complete,
    source: {title, url: "https://api.vworld.kr/req/data", checkedAt}, errorCode?
  }],
  warnings: [...]
}
```

`selectedParcels`는 기준점 계산에 사용할 실제 선택 경계입니다. 모든 Feature는 원본 경위도를 유지합니다. 좌표 원점·회전은 선택 필지에서 한 번 정하고, 주변 지적도·도로·건물·BIM에 동일하게 적용해야 합니다. 도로가 조회 BOX 바깥으로 이어져도 별도의 중심점이나 방향으로 옮기지 않습니다. 실제 원형을 유지하므로 렌더러는 반환 `bbox`로 표시를 클리핑해야 합니다. 원본 기하의 내부 구멍과 MultiPolygon/MultiLineString 조각을 보존합니다. 이 좌표는 측량 기준점·표고가 아니며, IFC의 지리 참조 및 측량 좌표계 변환은 별도 확정이 필요합니다.

레이어별 300개씩 최대 2페이지, 최대 600개 경계·좌표 80,000개로 제한합니다. 제공자의 페이지·총수 메타데이터가 없거나 불일치하거나 자료가 600개를 초과하면 `partial`입니다. 응답에서 검증할 수 없는 좌표·PNU·조회 범위 밖 도형은 제외하고 `partial`로 알립니다. 정상 조회 결과 0개는 `empty`, 조회 실패는 `unavailable`로 구분합니다. **실패하거나 일부 누락되어도 예시 필지·임의 도로·절차적 배경 건물로 대체하지 않습니다.** 출처는 인증 쿼리가 없는 고정 URL이며, 위성·지도 타일 또는 브라우저 키를 반환하지 않습니다.

`python -m unittest discover -s tests -p test_parcel_context.py -v`는 실제 네트워크 없이 복수 필지 범위, 원본 기하·내부 구멍 보존, 페이지 순회와 상한, 잘못된 좌표·범위·PNU 제외, 실패와 결과 없음의 구분, 임의 폭 적용 방지, 키·원본 오류 URL 비노출을 검사합니다.
