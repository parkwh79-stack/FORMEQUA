"use strict";
// Real app.js finance / mass generation, real hotel plans and permission checks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const finance = require("../finance-model.js");
const planner = require("../interior-plan.js");
const legal = require("../legal-rules.js");
const permissions = require("../use-permissions.js");
const root = path.join(__dirname, "..");
function makeContext(useFinance = true) {
  const element = () => ({ value: "", textContent: "", classList: { add() {}, remove() {}, toggle() {} } });
  const context = vm.createContext({ window: { AtelierLegal: legal, AtelierUsePermissions: permissions,
    AtelierInteriorPlan: planner, AtelierFinance: useFinance ? finance : null, addEventListener() {} },
  document: { getElementById: element, querySelectorAll: () => [] } });
  vm.runInContext(fs.readFileSync(path.join(root, "app.js"), "utf8"), context);
  vm.runInContext("syncWorkspaceInputsToUI=()=>{}; updateAllCalculationsAndUI=()=>{}; syncFacadeUI=()=>{}; loadParcelPreset('custom_seoul');", context);
  return context;
}
function calculate(context, inputs = {}) {
  context.inputs = inputs;
  vm.runInContext("Object.assign(state,inputs)", context);
  return JSON.parse(vm.runInContext("JSON.stringify(evaluateDesignAndProforma(state,state.option))", context));
}
function near(a, b, label) { assert.ok(Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(b)), label + `: ${a} = ${b}`); }
const ctx = makeContext(), legacy = makeContext(false);
for (const option of ["A", "B", "C"]) {
  const current = calculate(ctx, { option, financeMode: "rental" });
  const prior = calculate(legacy, { option });
  for (const key of ["stabilizedNoiEok", "grossExitValueEok", "dscr", "equityXirrPct", "npv8Eok"]) near(current.finance[key], prior.finance[key], `rental ${option} legacy ${key}`);
  current.finance.monthlyEquityCf.forEach((cf, index) => near(cf, prior.finance.monthlyEquityCf[index], "rental cashflow"));
  const rows = current.finance.income.floorIncome;
  near(rows.reduce((s, r) => s + r.annualGrossIncomeEok, 0), current.finance.annualGrossIncomeEok, "floor gross reconciles");
  near(rows.reduce((s, r) => s + r.annualNoiEok, 0), current.finance.stabilizedNoiEok, "floor NOI reconciles");
  near(rows.reduce((s, r) => s + r.rentalContractAreaSqm, 0), current.areas.contractAreaSqm, "floor contract area reconciles");
  for (const fp of current.floorPlates) near(fp.estMonthlyRentMan, fp.income.scheduledMonthlyRentMan, "inspector uses same rent ledger");
}
const hotelParams = { financeMode: "hotel", buildingUse: "숙박시설(호텔)", hotelType: "general", hotelResidentialDistanceM: 210,
  parkingMode: "report", zoning: "일반상업지역", floorsAbove: 10, floorUseOverrides: { "2": "retail", "3": "main" },
  landPricePyeongM: 30, constCostPyeongMan: 650, loanLtvPct: 20, floorsBelow: 1, capRatePct: 4,
  hotelAdrKrw: 220000, hotelOccupancyPct: 75, hotelAncillaryRevenuePct: 20,
  hotelOpexPct: 55, hotelManagementFeePct: 3, hotelFfeReservePct: 4, hotelFixedOpexEok: 1, hotelRoomsOverride: 0 };
const hotel = calculate(ctx, hotelParams), income = hotel.finance.income, h = income.hotel;
assert.equal(income.mode, "hotel"); assert.ok(h.generatedGuestRooms > 0);
const actualInputs = JSON.parse(vm.runInContext("JSON.stringify(state)", ctx));
const actualPlans = hotel.floorPlates.filter(fp => fp.use === "hotel").map(fp => planner.generate(fp, actualInputs));
assert.equal(h.generatedGuestRooms, actualPlans.reduce((sum, plan) => sum + plan.metrics.guestRoomCount, 0), "hotel rooms from real plans");
assert.equal(h.effectiveGuestRooms, h.generatedGuestRooms);
near(h.roomRevenueEok, h.roomTypes.reduce((sum,type)=>sum+type.generatedCount*type.adrKrw,0) * 365 * 0.75 / 1e8, "fitted type / ADR occupancy revenue");
near(h.weightedAdrKrw,h.roomTypes.reduce((sum,type)=>sum+type.generatedCount*type.adrKrw,0)/h.generatedGuestRooms,"actual weighted ADR");
near(h.noiAfterReserveEok, h.roomRevenueEok * 1.2 * (1 - 0.55 - 0.03 - 0.04) - 1, "explicit operating deductions");
assert.ok(income.rentalAnnualGrossEok > 0, "mixed office / retail retain rental income");
for (const row of income.floorIncome.filter(row => row.hotelOperatingFloor)) assert.equal(row.rentalAnnualGrossEok, 0, "no hotel rent double count");
near(income.floorIncome.reduce((s, row) => s + row.annualGrossIncomeEok, 0), income.annualGrossIncomeEok, "mixed income reconciles");
near(income.floorIncome.reduce((s, row) => s + row.annualNoiEok, 0), hotel.finance.stabilizedNoiEok, "mixed NOI reconciles");
near(finance.monthlyNoiAtRamp(income, 1), income.stabilizedNoiEok / 12, "stable monthly NOI");
near(finance.monthlyNoiAtRamp(income, 0), -1 / 12, "fixed opex fully payable while ramping");
const operatingStart = hotel.finance.predevMonths + hotel.finance.constMonths;
near(hotel.finance.monthlyEquityCf[operatingStart], finance.monthlyNoiAtRamp(income, 1 / hotel.finance.leaseUpMonths)
  - hotel.finance.annualDebtServiceEok / 12, "monthly equity cashflow pays operating-period PF interest from hotel operations");
const richer = calculate(ctx, { hotelAdrKrw: 300000 });
for (const key of ["stabilizedNoiEok", "grossExitValueEok", "dscr", "equityXirrPct", "npv8Eok"]) assert.ok(richer.finance[key] > hotel.finance[key], "higher ADR affects " + key);
function residualAt(adr) {
  ctx.inputs = { ...hotelParams, hotelAdrKrw: adr };
  vm.runInContext("Object.assign(state,inputs)", ctx);
  return JSON.parse(vm.runInContext("JSON.stringify(solveMaxResidualLandPrice(state))", ctx));
}
const baseResidual = residualAt(220000), highResidual = residualAt(300000);
assert.equal(baseResidual.status, "solved"); assert.equal(highResidual.status, "solved");
assert.ok(highResidual.maxLandPyeongM > baseResidual.maxLandPyeongM, "ADR affects target-return residual land budget");
const lowerOccupancy = calculate(ctx, { hotelAdrKrw: 220000, hotelOccupancyPct: 30 });
assert.ok(lowerOccupancy.finance.stabilizedNoiEok < hotel.finance.stabilizedNoiEok);
const override = calculate(ctx, { hotelOccupancyPct: 75, hotelRoomsOverride: 200 });
assert.equal(override.finance.income.hotel.effectiveGuestRooms, 200);
assert.equal(override.finance.income.hotel.roomsSource, "user-assumption");
assert.equal(override.finance.income.hotel.generatedGuestRooms, h.generatedGuestRooms);
const noHotel = calculate(ctx, { buildingUse: "업무시설(오피스)", floorUseOverrides: {}, mixedUseProfile: "office_retail" });
assert.equal(noHotel.finance.financeMode, "rental");
assert.ok(noHotel.finance.income.warnings.some(text => text.includes("호텔 객실층이 없어")));
const loss = calculate(ctx, { ...hotelParams, hotelAdrKrw: 0, hotelOccupancyPct: 0, hotelFixedOpexEok: 1000 });
assert.ok(loss.finance.stabilizedNoiEok < 0);
assert.equal(loss.finance.grossExitValueEok, 0, "negative NOI cannot create a negative asset / selling fee");
const basicHotel = { ...hotelParams, floorUseOverrides: {} };
assert.equal(calculate(ctx, { ...basicHotel, hotelResidentialDistanceM: 45, hotelResidentialBarrier: null }).usePermission.status, "prohibited");
assert.equal(calculate(ctx, { hotelResidentialBarrier: true }).usePermission.status, "conditional", "barrier assumption never confirms permission");
assert.equal(calculate(ctx, { hotelResidentialDistanceM: null, hotelResidentialBarrier: null }).usePermission.status, "conditional", "unknown distance is never zero");
const badValues = finance.calculate({ ...hotelParams, hotelAdrKrw: NaN, hotelOccupancyPct: Infinity, hotelRoomsOverride: -9 }, hotel.floorPlates,
  { planner, undergroundGfaSqm: hotel.areas.undergroundGfaSqm });
assert.equal(badValues.hotel.adrKrw, finance.defaults.hotelAdrKrw);
assert.equal(badValues.hotel.occupancyPct, finance.defaults.hotelOccupancyPct);
assert.equal(badValues.hotel.roomsSource, "generated");
assert.ok(Number.isFinite(badValues.stabilizedNoiEok));
const missingPlanner = finance.calculate(hotelParams, hotel.floorPlates, {});
assert.equal(missingPlanner.hotel.effectiveGuestRooms, 0);
assert.equal(missingPlanner.hotel.roomRevenueEok, 0);
assert.ok(missingPlanner.warnings.length > 0);
// Equal room geometry on two different sites must not reuse a cached plan's
// study-scoped stable module IDs. Repeated finance on the same site can cache.
const cachePlans = [], scopedPlanner = { generate(fp, params) {
  const plan = planner.generate(fp, params); cachePlans.push(plan); return plan;
} };
const singleHotelFloor = hotel.floorPlates.filter(fp => fp.use === "hotel").slice(0, 1);
const scopedParams = {...hotelParams, parcelKey:"custom_seoul", option:"A"};
finance.calculate(scopedParams,singleHotelFloor,{planner:scopedPlanner});
finance.calculate(scopedParams,singleHotelFloor,{planner:scopedPlanner});
assert.equal(cachePlans.length,1,"same study geometry is cached");
finance.calculate({...scopedParams,parcelKey:"gangnam_yeoksam"},singleHotelFloor,{planner:scopedPlanner});
assert.equal(cachePlans.length,2,"different study scope invalidates hotel plan cache");
const firstId = cachePlans[0].rooms.find(room => room.moduleId)?.moduleId;
const secondId = cachePlans[1].rooms.find(room => room.moduleId)?.moduleId;
assert.ok(firstId && secondId && firstId!==secondId,"module identity follows the selected site");
console.log("Finance income integration passed: rental legacy parity, reconciled floor ledger, generated hotel rooms, mixed revenue, ADR / occupancy / cost sensitivities, monthly cashflows, no negative exit value, and nullable hotel legal inputs.");
