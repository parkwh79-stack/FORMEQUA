"use strict";
// Regressions from the PDF / finance audit: the fixtures include a negative
// exit and operating deficits, not just successful financial examples.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, {innerHTML:"", value:"", textContent:"", dataset:{}, style:{},
    classList:{add(){},remove(){},toggle(){}}});
  return elements.get(id);
};
const context = vm.createContext({window:{addEventListener(){}},document:{getElementById:element,querySelectorAll:()=>[]},console});
for (const [name,file] of Object.entries({AtelierLegal:"legal-rules",AtelierUsePermissions:"use-permissions",
  AtelierInteriorPlan:"interior-plan",AtelierFinance:"finance-model",AtelierCoreLayout:"core-layout",
  AtelierParkingLayout:"parking-layout",AtelierParcelGeometry:"parcel-geometry",
  AtelierParcelRegulations:"parcel-regulation-rules",AtelierBuildingReview:"building-review",
  AtelierConceptStructure:"concept-structure"})) context.window[name]=require(path.join(root,file+".js"));
vm.runInContext(fs.readFileSync(path.join(root,"app.js"),"utf8"),context);
vm.runInContext("updateAllCalculationsAndUI=()=>{}; syncFacadeUI=()=>{}; syncWorkspaceInputsToUI=()=>{}; loadParcelPreset('custom_seoul');",context);
const run=code=>vm.runInContext(code,context),sum=a=>a.reduce((s,x)=>s+x,0);
const base=JSON.parse(run("JSON.stringify(state)"));
function model(inputs){context.caseInputs={...base,...inputs};return run("evaluateDesignAndProforma(caseInputs, caseInputs.option)");}
const standard=model({buildingUse:"업무시설(오피스)",zoning:"일반상업지역",northSolar:false,parkingMode:"report",floorsAbove:10,floorsBelow:2});
const f=standard.finance;
const noFinanceCostsProject=f.monthlyUses.map((use,i)=>{
  const operating=i>=f.predevMonths+f.constMonths;
  const noi=operating?context.window.AtelierFinance.monthlyNoiAtRamp(f.income,(i-f.predevMonths-f.constMonths+1)/f.leaseUpMonths):0;
  const financeAllocation=i>=f.predevMonths&&i<f.predevMonths+f.constMonths?
    (f.interestReserveEok+f.loanFeeEok)*run(`scurveWeights(${f.constMonths},6)`)[i-f.predevMonths]:0;
  return -use+financeAllocation+noi+(i===f.totalMonths-1?f.netExitValueEok:0);
});
context.cfForAudit=noFinanceCostsProject;
const periodIndex=f.predevMonths+f.constMonths;
const lossInputs={buildingUse:"숙박시설(호텔)",zoning:"일반상업지역",northSolar:false,parkingMode:"report",
  financeMode:"hotel",hotelAdrKrw:0,hotelOccupancyPct:0,hotelFixedOpexEok:1000,hotelRoomsOverride:0,floorsAbove:6,floorsBelow:0};
const loss=model(lossInputs);
const l=loss.finance;
context.presetModel=standard;run("state.option='A';renderOptionAndRemodelComparison(SEOUL_PARCELS.custom_seoul,presetModel,presetModel,presetModel,presetModel)");
const remodelMarkup=elements.get("tableRemodelCompareBody").innerHTML;
const brick=model({facadeType:"brick_rainscreen"}),diagrid=model({facadeType:"diagrid_biophilic"});
assert.equal(brick.facade.rentPremiumPct,0,'material choice supplies no observed market premium');
assert.equal(diagrid.facade.rentPremiumPct,0,'elaborate facade supplies no observed market premium');
assert.equal(brick.finance.income.annualGrossIncomeEok,diagrid.finance.income.annualGrossIncomeEok,'identical areas and lease inputs retain the same revenue across facade styles');
const exportPayloads=[];
context.Blob=class {constructor(parts,opts){this.text=parts.join("");this.type=opts.type;exportPayloads.push(this);}};
context.URL={createObjectURL:()=>"blob:audit-only"};context.setTimeout=fn=>fn();
context.document.createElement=()=>({click(){}});
context.reportModel=loss;context.reportInputsForTest={...base,...lossInputs};
const SECRET_FIXTURE="SECRET_MUST_NOT_EXPORT_20261021";
context.secretFixture=SECRET_FIXTURE;
run("Object.assign(state,reportInputsForTest);state.apiKey=secretFixture;state.providerKeys={secret:secretFixture};state.lastComputed={model:reportModel,residual:{maxLandTotalEok:NaN,maxLandPyeongM:NaN},secretRuntimeCache:secretFixture};exportProformaAndReport()");
const reportText=exportPayloads.find(x=>x.type.includes("markdown")).text;
function near(actual,expected,label){assert.ok(Number.isFinite(actual)&&Number.isFinite(expected)&&Math.abs(actual-expected)<1e-7*Math.max(1,Math.abs(expected)),`${label}: ${actual} != ${expected}`);}
const profit=model({buildingUse:"숙박시설(호텔)",zoning:"일반상업지역",northSolar:false,parkingMode:"report",financeMode:"hotel",
  hotelAdrKrw:900000,hotelOccupancyPct:95,hotelFixedOpexEok:0,hotelRoomsOverride:200,landPricePyeongM:10,constCostPyeongMan:400,floorsAbove:8,floorsBelow:0});
for(const scenario of [standard,loss,profit]){
  const v=scenario.finance, operatingStart=v.predevMonths+v.constMonths;
  near(sum(v.monthlyUses),v.totalDevCostEok,"development uses reconcile");
  near(sum(v.monthlyDebtDraw),v.loanAmountEok,"PF draws reconcile");
  near(sum(v.monthlyCapitalizedFinancing),v.interestReserveEok+v.loanFeeEok,"construction financing allocation");
  near(sum(v.monthlyUnleveredUses),v.totalLandCostEok+v.totalHardCostEok+v.softCostEok,"unlevered expenditure excludes financing");
  const annualInterest=v.seniorLoanEok*v.seniorRatePct/100+v.mezzLoanEok*v.mezzRatePct/100+v.juniorLoanEok*v.juniorRatePct/100;
  near(v.annualDebtServiceEok,annualInterest,"all tranche annual interest");
  near(v.dscr,v.stabilizedNoiEok/annualInterest,"all tranche interest coverage");
  for(let month=0;month<v.totalMonths;month++){
    near(v.monthlyLpCf[month]+v.monthlyGpCf[month],v.monthlyEquityCf[month],"every month's LP/GP conserves equity cash");
    near(v.monthlyOperatingDebtInterest[month],month>=operatingStart?annualInterest/12:0,"interest accrued in every operating month only");
    const noi=month>=operatingStart?context.window.AtelierFinance.monthlyNoiAtRamp(v.income,(month-operatingStart+1)/v.leaseUpMonths):0;
    const exit=month===v.totalMonths-1?v.netExitValueEok-v.loanAmountEok:0;
    const developmentEquity=v.monthlyUses[month]-v.monthlyDebtDraw[month];
    near(v.monthlyEquityCf[month],-developmentEquity+noi-v.monthlyOperatingDebtInterest[month]+exit,"equity includes NOI, all interest, development funding, exit debt");
  }
  near(v.lpPaidInEok,-sum(v.monthlyLpCf.filter(x=>x<0)),"actual LP paid in includes losses");
  near(v.gpPaidInEok,-sum(v.monthlyGpCf.filter(x=>x<0)),"actual GP paid in includes losses");
  near(v.actualEquityPaidInEok,v.lpPaidInEok+v.gpPaidInEok,"actual funding totals");
  near(v.lpTotalDistEok+v.gpTotalDistEok,sum(v.monthlyEquityCf.filter(x=>x>0)),"actual distributions total");
}
noFinanceCostsProject.forEach((value,index)=>near(f.monthlyProjectCf[index],value,"independent unlevered monthly cashflow"));
assert.ok(l.monthlyEquityCf.at(-1)<0&&l.monthlyLpCf.at(-1)<0&&l.monthlyGpCf.at(-1)<0,"terminal shortfall is included in both investors' calls");
assert.ok(l.actualEquityPaidInEok>l.equityRequiredEok,"operating losses require additional cash");
assert.ok(remodelMarkup.includes("미산정")&&remodelMarkup.includes("판단 보류"),"no fabricated remodeling IRR or investment ranking");
assert.ok(reportText.includes("ADR")&&reportText.includes("가동률")&&reportText.includes("NOI")&&reportText.includes("추가 출자"),"report records hotel and financial assumption scope");
assert.ok(reportText.includes("2026-10-21-audit1")&&reportText.includes("코드 버전")&&reportText.includes("검토 기준일"),"report records an explicit engine review version and timestamp");
assert.match(reportText,/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,"generation timestamp is concrete");
assert.ok(reportText.includes(loss.finance.income.assumptions[0])&&reportText.includes("비용 포함·제외")&&reportText.includes("미확인 자료"),"income assumptions, cost scope, and missing evidence survive export");
assert.ok(!reportText.includes(SECRET_FIXTURE)&&!reportText.includes('"apiKey"')&&!reportText.includes('"secretRuntimeCache"'),"fallback export cannot serialize secrets or state caches");
const fallbackSnapshot=JSON.parse(reportText.match(/```json\n([\s\S]*?)\n```/)[1]);
assert.equal(fallbackSnapshot.hotelAdrKrw,0);assert.equal(fallbackSnapshot.financeMode,"hotel");
const createBridge=require("../workspace-state.js");
context.window.AtelierWorkspace=createBridge({AtelierParcelGeometry:context.window.AtelierParcelGeometry,AtelierSpatialSettings:require("../spatial-settings.js")});
run("exportProformaAndReport()");
const bridgeReport=exportPayloads.filter(x=>x.type.includes("markdown")).at(-1).text;
const bridgeSnapshot=JSON.parse(bridgeReport.match(/```json\n([\s\S]*?)\n```/)[1]);
assert.equal(bridgeSnapshot.financeMode,"hotel");
assert.ok(bridgeReport.includes("프로젝트 허용목록으로 선별한 입력"),"workspace sanitizer is used when available");
assert.ok(!bridgeReport.includes(SECRET_FIXTURE)&&!Object.hasOwn(bridgeSnapshot,"apiKey")&&!Object.hasOwn(bridgeSnapshot,"lastComputed"),"workspace path also excludes keys and caches");
const csvHeader=exportPayloads[0].text.split("\n")[0];
assert.ok(csvHeader.includes("LP현금흐름")&&csvHeader.includes("운영기PF이자")&&csvHeader.includes("금융비제외사업지출"),"CSV exposes reconciliation fields");
const result={
  caseInputs:{standard:{parcelKey:"custom_seoul",buildingUse:"업무시설(오피스)",zoning:"일반상업지역",northSolar:false,parkingMode:"report",floorsAbove:10,floorsBelow:2},
    loss:{buildingUse:"숙박시설(호텔)",financeMode:"hotel",hotelAdrKrw:0,hotelOccupancyPct:0,hotelFixedOpexEok:1000,floorsAbove:6,floorsBelow:0}},
  projectUnlevered:{currentProjectIrrPct:f.projectXirrPct,independentlyReconstructedProjectIrrPct:run("solveXirr(cfForAudit)*100"),
    financialCostsExcludedEok:f.interestReserveEok+f.loanFeeEok,capitalizedInterestEok:f.interestReserveEok},
  leaseUpInterest:{loanEok:f.loanAmountEok,weightedAnnualRatePct:f.weightedLoanRatePct,months:f.leaseUpMonths,
    outstandingLoanInterestEok:f.loanAmountEok*f.weightedLoanRatePct/100*f.leaseUpMonths/12,
    firstLeaseUpEquityCfEok:f.monthlyEquityCf[periodIndex],firstLeaseUpNoiEok:context.window.AtelierFinance.monthlyNoiAtRamp(f.income,1/f.leaseUpMonths),
    dscrReported:f.dscr,dscrAllTrancheInterest:f.stabilizedNoiEok/(f.loanAmountEok*f.weightedLoanRatePct/100)},
  waterfallLoss:{finalEquityCf:l.monthlyEquityCf.at(-1),finalLpPlusGpCf:l.monthlyLpCf.at(-1)+l.monthlyGpCf.at(-1),
    totalEquityCf:sum(l.monthlyEquityCf),totalLpPlusGpCf:sum(l.monthlyLpCf)+sum(l.monthlyGpCf),
    reportedLpPaidInEok:l.lpPaidInEok,actualLpNegativeCfEok:-sum(l.monthlyLpCf.filter(v=>v<0)),
    reportedLpIrrPct:l.lpIrrPct,reportedGpIrrPct:l.gpIrrPct},
  costLandAndTiming:{acquisitionTaxRate:f.acquisitionTaxEok/f.landPurchaseEok,
    fixedPredevMonths:f.predevMonths,fixedLeaseUpMonths:f.leaseUpMonths,softCostRatio:f.softCostEok/f.totalHardCostEok},
  remodel:{containsComputedIrrLabel:remodelMarkup.includes("예상 Equity XIRR"),markup:remodelMarkup.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim()},
  facadeAutomaticMarketPremium:{brick:{rentPremiumPct:brick.facade.rentPremiumPct,noiEok:brick.finance.stabilizedNoiEok},
    diagrid:{rentPremiumPct:diagrid.facade.rentPremiumPct,noiEok:diagrid.finance.stabilizedNoiEok}},
  exportAudit:{mode:"hotel",includesAdr:reportText.includes("ADR"),includesOccupancy:reportText.includes("가동률"),
    includesNoi:reportText.includes("NOI"),includesIncomeAssumptions:reportText.includes(loss.finance.income.assumptions[0]),
    includesCodeVersion:reportText.includes("코드 버전"),includesReviewDate:reportText.includes("검토 기준일"),
    includesSupplyDefinition:reportText.includes("공급면적"),unleveredLabel:exportPayloads[0].text.split("\n")[0]}
};
console.log(JSON.stringify(result,null,2));
