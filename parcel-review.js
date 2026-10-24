/* Address search → chosen parcel → boundary and regulation evidence. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.AtelierParcelReview = api; api.mount(root); }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const validPnu = value => typeof value === 'string' && /^\d{19}$/.test(value);
  const textList = value => Array.isArray(value) ? [...new Set(value.filter(item => item && typeof item.name === 'string' && item.name.trim()).map(item => item.name.trim()))] : [];
  const safeUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch (_) { return ''; } };
  const limit = (value, max, suffix) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? `${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${suffix}` : '미확인';
  const manualCaps = params => {
    const cap = (key, max) => Number.isFinite(params[key]) && params[key] > 0 && params[key] <= max ? params[key] : null;
    return { farPct: cap('legalFarCapPct', 1500), bcrPct: cap('legalBcrCapPct', 100), heightM: cap('maxHeightM', 300) };
  };
  const regulationMode = params => params.regulationMode === 'scenario' ? 'scenario' : 'statutory';
  function siteConditionsForBoundary(previous, next) {
    const identity = data => (data?.features || []).map(feature => feature.properties?.pnu || JSON.stringify(feature.geometry)).sort().join('|');
    if (!next?.features?.length || identity(previous) === identity(next)) return {};
    const zones = next.features.map(feature => feature.properties?.regulations?.zones);
    const names = zones.every(items => items?.length === 1 && items[0].coveragePct >= 99.9)
      ? [...new Set(zones.map(items => items[0].name))] : [];
    return { publicContribPct: 0, seoulDowntown: false,
      northSolar: names.length === 1 && /전용주거|일반주거/.test(names[0]) };
  }
  const density = (caps, empty = '미확인') => `${caps?.farPct === null || caps?.farPct === undefined ? empty : limit(caps.farPct, 1500, '%')} / ${caps?.bcrPct === null || caps?.bcrPct === undefined ? empty : limit(caps.bcrPct, 100, '%')}`;
  const manualText = caps => `용적 ${caps.farPct === null ? '미입력' : limit(caps.farPct, 1500, '%')} · 건폐 ${caps.bcrPct === null ? '미입력' : limit(caps.bcrPct, 100, '%')} · 높이 ${caps.heightM === null ? '미입력' : limit(caps.heightM, 300, 'm')}`;
  function regulationsView(feature) {
    const p = feature?.properties || {}, imported = /GeoJSON/i.test(p.source || ''), raw = imported ? null : p.regulations;
    const status = ['verified', 'partial', 'unverified'].includes(raw?.status) ? raw.status : 'unverified';
    const zones = textList(raw?.zones), plans = textList(raw?.districtPlans);
    const sources = Array.isArray(raw?.sources) ? raw.sources.filter(source => source && typeof source.title === 'string' && safeUrl(source.url)).map(source => ({ title: source.title, url: safeUrl(source.url) })) : [];
    const warnings = Array.isArray(raw?.warnings) ? raw.warnings.filter(note => typeof note === 'string') : [];
    if (zones.length > 1) warnings.unshift('복수 용도지역입니다. 가장 높은 상한을 임의 적용하지 않으며 구역별 경계·면적과 적용 기준을 확인해야 합니다.');
    if (!raw) warnings.unshift(imported ? '가져온 경계에는 고시 원문과 규제 확인 자료가 없습니다. 용도지역·상한은 수동 확인 대상입니다.' : '필지 경계와 규제 자료는 별도입니다. 용도지역·지구단위계획·상한을 아직 확인하지 못했습니다.');
    return { status, label: imported ? '수동 확인' : ({ verified: '자료 조회', partial: '일부 조회', unverified: '법규 미확인' }[status]), zones, plans, sources, warnings,
      far: limit(status !== 'unverified' && zones.length === 1 ? raw?.limits?.farPct : null, 1500, '%'), bcr: limit(status !== 'unverified' && zones.length === 1 ? raw?.limits?.bcrPct : null, 100, '%'), height: limit(status !== 'unverified' && zones.length === 1 ? raw?.limits?.heightM : null, 2000, 'm'),
      checkedAt: typeof raw?.checkedAt === 'string' && Number.isFinite(Date.parse(raw.checkedAt)) ? raw.checkedAt : null,
      hasData: Boolean(raw), multipleZones: zones.length > 1, imported };
  }
  function regulationMarkup(feature, index, context = null) {
    const view = regulationsView(feature), p = feature.properties || {};
    const params = context?.params || (typeof state !== 'undefined' ? state : {});
    const engine = context?.regulationEngine || (typeof window !== 'undefined' ? window.AtelierParcelRegulations : null);
    const legal = context?.legalEngine || (typeof window !== 'undefined' ? window.AtelierLegal : null);
    let general = null;
    if (!view.imported && p.source === 'vworld' && engine) {
      try { general = engine.resolve(p.regulations, params, legal); } catch (_) { /* Invalid evidence is displayed as unconfirmed. */ }
    }
    const manual = general?.manualLimits || manualCaps(params);
    const plans = general?.planLimits || { farPct: null, bcrPct: null, heightM: null };
    const effective = general?.effectiveLimits || { farPct: null, bcrPct: null, heightM: null };
    const scenario = regulationMode(params) === 'scenario';
    const kv = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
    const identification = validPnu(p.pnu) ? `<details class="parcel-identification"><summary>필지 식별 정보</summary><span>PNU ${esc(p.pnu)}</span></details>` : '';
    const ordinance = engine?.sources?.find(source => source.title?.includes('서울특별시 도시계획 조례'));
    const ordinanceLink = ordinance && safeUrl(ordinance.url) ? `<a href="${esc(safeUrl(ordinance.url))}" target="_blank" rel="noopener noreferrer">서울 도시계획 조례 · 일반 기준 ↗</a>` : '';
    const planLinks = (general?.districtPlans || []).filter(plan => plan.noticeId && safeUrl(plan.url)).map(plan => `<a href="${esc(safeUrl(plan.url))}" target="_blank" rel="noopener noreferrer">${esc(plan.name)} · ${esc(plan.noticeId)} ↗</a>`).join('');
    const warnings = [...new Set([...view.warnings, ...(general?.warnings || [])])];
    const rawClaim = [['far','farPct'],['bcr','bcrPct'],['height','heightM']].some(([display,key]) => view[display] !== '미확인' && plans[key] === null)
      ? `<p class="parcel-note">조회 응답 수치(적용 검증 전): 용적 ${esc(view.far)} · 건폐 ${esc(view.bcr)} · 높이 ${esc(view.height)}. 고시 원문과 필지별 적용 조건 확인 전에는 계획 상한으로 적용하지 않습니다.</p>` : '';
    return `<div class="parcel-regulation"><div class="parcel-regulation-status"><span data-status="${esc(view.status)}">${esc(view.label)}</span>${view.multipleZones ? '<strong>복수 용도지역 · 적용 확인</strong>' : ''}</div><dl class="parcel-regulation-grid">${kv('계산 모드', scenario ? '비교 시나리오 · 사용자 제한 적용' : '법정 기준 · 저장된 비교값 미적용')}${kv('용도지역', view.zones.join(' · ') || '미확인')}${kv('지구단위계획', view.plans.join(' · ') || '명칭 미확인')}${kv('서울 일반 용적률 / 건폐율', density({ farPct: general?.generalRules?.far, bcrPct: general?.generalRules?.bcr }))}${kv('고시 확인 용적률 / 건폐율', density(plans))}${kv('고시 확인 높이 상한', limit(plans.heightM, 300, 'm'))}${kv(scenario ? '사용자 추가 제한' : '저장된 비교값 (현재 미적용)', manualText(manual))}${kv('이 필지 검토 용적률 / 건폐율', density(effective))}${kv('이 필지 검토 높이 상한', limit(effective.heightM, 300, 'm'))}</dl><p class="parcel-note">일반 조례 · 고시 확인값 · 사용자 입력을 구분합니다. 합필 전체의 최종 적용값은 법규 검토 결과에서 확인하세요. 미확인 높이는 높이 제한이 없다는 뜻이 아닙니다.</p><details class="parcel-evidence"><summary>근거 · 조회 상태</summary>${view.checkedAt ? `<p class="parcel-note">조회 ${esc(view.checkedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC'))}</p>` : ''}${ordinanceLink}${planLinks}${view.sources.map(source => `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ↗</a>`).join('')}${rawClaim}${warnings.length ? `<ul>${warnings.map(note => `<li>${esc(note)}</li>`).join('')}</ul>` : '<p class="parcel-note">필지별 상세 인허가 확인은 별도 검토 대상입니다.</p>'}${validPnu(p.pnu) && !view.imported ? `<button type="button" class="btn" data-refresh-regulations="${index}">법규 자료 다시 조회</button>` : ''}</details>${identification}</div>`;
  }
  function additionalLimitsMarkup(params = {}, model = null, busy = false) {
    const caps = manualCaps(params), active = Object.values(caps).some(value => value !== null);
    const scenario = regulationMode(params) === 'scenario';
    const heading = scenario ? (active ? '사용자 추가 제한 적용 중' : '사용자 추가 제한 없음')
      : (active ? '저장된 비교값 · 법정 기준 모드에서는 미적용' : '법정 기준 모드 · 저장된 비교값 없음');
    const area = model?.effectiveCadastralAreaSqm, footprint = model?.areas?.buildingFootprintSqm;
    const result = Number.isFinite(area) && Number.isFinite(footprint)
      ? `<p class="parcel-note">현재 매스: 건축면적 ${esc(limit(footprint, 20000, '㎡'))} / 대지 ${esc(limit(area, 20000, '㎡'))} · ${esc(model.actualFloorsAbove)}층 / 요청 ${esc(model.requestedFloorsAbove)}층</p>` : '';
    return `<div class="parcel-regulation" data-regulation-mode="${scenario ? 'scenario' : 'statutory'}" data-manual-limits-active="${active && scenario}" data-manual-limits-stored="${active}"><strong>${heading}</strong><p class="parcel-note">${esc(manualText(caps))}</p>${result}${active ? `<p class="parcel-note">${scenario ? '입력하거나 저장한 추가 제한입니다. 필지의 고시에서 조회된 법정 수치와 구분합니다.' : '비교값을 지우지 않아도 법정 기준으로 계산합니다. 비교 시나리오 모드에서만 이 값을 적용합니다.'}</p>` : ''}<button type="button" class="btn parcel-reset-limits" data-reset-manual-limits ${busy || !active ? 'disabled' : ''}>추가 제한 해제 · 조회 기준으로 재배치</button><p class="parcel-note">원할 때 용적률·건폐율·높이의 저장된 비교값만 해제할 수 있습니다. 조회 용도지역과 확인된 고시 제한은 계속 적용하며, 미확인 조건은 별도 검토합니다.</p></div>`;
  }
  function candidateMarkup(candidate) {
    if (!candidate || !validPnu(candidate.pnu) || typeof candidate.address !== 'string' || !candidate.address.trim()) return '';
    return `<button type="button" class="parcel-candidate" data-parcel-pnu="${esc(candidate.pnu)}"><strong>${esc(candidate.address)}</strong>${candidate.roadAddress ? `<span>도로명 ${esc(candidate.roadAddress)}</span>` : ''}<small>${candidate.relatedJibun ? '관련 지번이 있는 주소 · 추가 필지는 별도 검색' : '이 지번의 경계와 법규 자료 조회'}<b>선택 +</b></small></button>`;
  }
  function mount(window) {
    const document = window.document;
    const ready = () => {
      const host = document.querySelector('#chap-site .chapter-content') || document.querySelector('#chap-site .chapter-body');
      if (!host || !window.AtelierParcelGeometry || document.getElementById('parcelReview')) return;
      const panel = document.createElement('details'); panel.id = 'parcelReview'; panel.className = 'parcel-review'; panel.open = true;
      panel.innerHTML = `<summary>지번 검색 · 실제 필지 <span id="parcelDraftCount">선택 0/5</span></summary><div class="parcel-review-body"><form id="parcelAddressForm"><label for="parcelAddress">추가할 필지의 지번 검색</label><div class="parcel-search"><input id="parcelAddress" placeholder="예: 서울 성동구 성수동2가 277" maxlength="200" autocomplete="street-address"><button type="submit" class="btn">지번 검색</button></div></form><p class="parcel-note">지번주소 또는 도로명주소를 입력하고, 검색 결과에서 해당 지번을 선택하세요.</p><p id="parcelProviderStatus" class="parcel-note">주소 검색 연결 상태 확인 중</p><div id="parcelCandidates" aria-label="지번 검색 결과"></div><div class="parcel-file-actions"><button type="button" class="btn" id="parcelImport">GeoJSON 불러오기</button><input id="parcelBoundaryFile" type="file" accept=".geojson,.json,application/geo+json,application/json" hidden><button type="button" class="btn" id="parcelClear">경계 해제</button></div><div id="parcelDraftList"></div><div id="parcelBoundaryPreview"></div><button type="button" class="btn parcel-apply" id="parcelApply" disabled>선택한 필지를 설계에 적용</button><p id="parcelMessage" role="status" aria-live="polite"></p><p class="parcel-note">최대 5개 필지를 차례로 추가할 수 있습니다. 연결된 경계만 합치며 중복 면적은 제외합니다. 복수 용도지역은 높은 상한을 임의 적용하지 않습니다.</p><details class="parcel-help"><summary>자료 연결과 법규 확인</summary><p>지번을 선택하면 식별번호를 자동으로 처리해 경계와 규제 자료를 각각 조회합니다. 목록에서 용도지역·지구단위계획 명칭과 상한의 확인 여부를 검토하세요.</p><p>규제 조회가 되지 않은 필지와 고시 원문이 없는 파일 경계는 수동 확인 대상입니다. 실제 법규 계산은 현재 서울 기준이며 조회 자료만으로 인허가 적합성을 확정하지 않습니다.</p><a href="https://www.eum.go.kr/" target="_blank" rel="noopener noreferrer">토지이음에서 확인 ↗</a></details></div>`;
      host.prepend(panel);
      const by = id => document.getElementById(id), current = () => typeof state === 'undefined' ? {} : state;
      const additionalControls = document.createElement('div'); additionalControls.id = 'parcelAdditionalLimits';
      by('parcelApply').insertAdjacentElement('afterend', additionalControls);
      let draft = null, lastKey = current().parcelKey, appliedSignature = JSON.stringify(current().parcelData || null), busy = false, revision = 0;
      let lastLimitSignature = null, lastLimitDisplaySignature = null;
      const message = (text, error = false) => { by('parcelMessage').textContent = text; by('parcelMessage').classList.toggle('is-error', error); };
      async function request(url) { const res = await window.fetch(url, { headers: { Accept: 'application/json' } }); const body = await res.json(); if (!res.ok) throw new Error(body.error?.message || '자료를 불러오지 못했습니다.'); return body; }
      function failedRegulations(pnu, error) { return { pnu, status: 'unverified', zones: [], districtPlans: [], limits: { farPct: null, bcrPct: null, heightM: null }, sources: [], checkedAt: new Date().toISOString(), warnings: ['법규 자료 조회 실패: ' + (error?.message || '연결 상태 확인 필요')] }; }
      async function fetchRegulations(pnu) { try { return await request('/api/v1/parcels/' + encodeURIComponent(pnu) + '/regulations'); } catch (error) { return failedRegulations(pnu, error); } }
      function drawing(geom) {
        const points = geom.outlines.flat(2), xs = points.map(p => p[0]), zs = points.map(p => p[1]), minX = Math.min(...xs), minZ = Math.min(...zs), w = Math.max(...xs) - minX, d = Math.max(...zs) - minZ, pad = Math.max(w, d) * .08;
        const path = geom.outlines.map(poly => poly.map(r => r.map(([x, z], i) => `${i ? 'L' : 'M'}${x},${z}`).join(' ') + 'Z').join(' ')).join(' '), r = geom.rectangle;
        return `<svg viewBox="${minX - pad} ${minZ - pad} ${w + pad * 2} ${d + pad * 2}" role="img" aria-label="선택 필지 경계와 보수적 사각 검토 영역"><path d="${path}" fill="#eaf0f8" fill-rule="evenodd" stroke="#b38a4a" stroke-width="${Math.max(w, d) / 180}"/><rect x="${-r.widthM / 2}" y="${-r.depthM / 2}" width="${r.widthM}" height="${r.depthM}" fill="#1d4ed81a" stroke="#2852a4" stroke-dasharray="${w / 45}" stroke-width="${Math.max(w, d) / 220}"/></svg><p class="parcel-note">금색: 경계 합집합 · 파랑: 경계 안 사각 검토 영역<br>북쪽 ↑ · 도로 방향은 별도 확인</p>`;
      }
      function renderDraft() {
        const count = draft?.features.length || 0;
        by('parcelDraftCount').textContent = `선택 ${count}/5`;
        by('parcelDraftList').innerHTML = (draft?.features || []).map((f, i) => `<article class="parcel-draft-item"><div class="parcel-draft-heading"><strong><span class="parcel-slot-number">${i + 1}</span> ${esc(f.properties.address || '가져온 필지 경계')}</strong><button type="button" class="btn" data-remove-parcel="${i}" aria-label="필지 ${i + 1} 삭제" ${busy ? 'disabled' : ''}>×</button></div>${regulationMarkup(f, i)}</article>`).join('') + (count < 5 ? `<button class="parcel-next-slot" type="button" data-add-parcel ${busy ? 'disabled' : ''}>+ 필지 ${count + 1} 추가 · ${5 - count}개 더 선택 가능</button>` : '<p class="parcel-note">5개 필지를 모두 선택했습니다. 변경하려면 목록에서 삭제하세요.</p>');
        by('parcelAddress').disabled = count >= 5 || busy; by('parcelAddressForm').querySelector('button').disabled = count >= 5 || busy;
        by('parcelImport').disabled = busy; by('parcelClear').disabled = busy;
        by('parcelCandidates').querySelectorAll('button').forEach(button => { button.disabled = busy || count >= 5; });
        by('parcelDraftList').querySelectorAll('[data-refresh-regulations]').forEach(button => { button.disabled = busy; });
        by('parcelApply').disabled = busy || !count; by('parcelBoundaryPreview').innerHTML = '';
        if (count) { try { const g = window.AtelierParcelGeometry.derive(draft); by('parcelBoundaryPreview').innerHTML = drawing(g) + `<strong>${g.featureCount}개 경계 · 근사 ${g.areaSqm.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}㎡</strong>`; } catch (error) { message(error.message, true); by('parcelApply').disabled = true; } }
        renderAdditionalLimits();
      }
      function renderAdditionalLimits() {
        const s = current(), model = s.lastComputed?.model;
        const signature = JSON.stringify([s.regulationMode, s.legalFarCapPct, s.legalBcrCapPct, s.maxHeightM, busy,
          model?.effectiveCadastralAreaSqm, model?.areas?.buildingFootprintSqm, model?.actualFloorsAbove, model?.requestedFloorsAbove]);
        if (signature !== lastLimitSignature) { lastLimitSignature = signature; additionalControls.innerHTML = additionalLimitsMarkup(s, model, busy); }
      }
      function sync() {
        const s = current(), signature = JSON.stringify(s.parcelData || null);
        if (s.parcelKey !== lastKey || signature !== appliedSignature) { revision++; lastKey = s.parcelKey; appliedSignature = signature; draft = s.parcelData ? structuredClone(s.parcelData) : null; by('parcelCandidates').replaceChildren(); message(''); renderDraft(); }
        const limitDisplay = JSON.stringify([s.regulationMode, s.legalFarCapPct, s.legalBcrCapPct, s.maxHeightM, s.zoning,
          s.buildingUse, s.seoulDowntown, s.mixedUseProfile, s.residentialType, s.floorUseOverrides]);
        if (limitDisplay !== lastLimitDisplaySignature) { lastLimitDisplaySignature = limitDisplay; renderDraft(); }
        renderAdditionalLimits();
        if (by('inputSiteArea')) { by('inputSiteArea').disabled = Boolean(s.parcelData); by('inputSiteArea').title = s.parcelData ? '경계 근사 면적을 적용 중입니다. 직접 면적을 입력하려면 경계를 해제하세요.' : ''; }
        const g = s.lastComputed?.model?.parcelGeometry;
        const select = by('parcelSelect');
        if (select) {
          for (const option of select.options) { option.dataset.presetCaption ||= option.textContent; option.textContent = option.dataset.presetCaption; }
          if (g && select.selectedOptions[0]) select.selectedOptions[0].textContent = `${g.addresses[0] || '적용 필지'}${g.featureCount > 1 ? ` 외 ${g.featureCount - 1}필지` : ''}`;
        }
        if (g) { if (by('hudParcelName')) by('hudParcelName').textContent = g.addresses.join(' + ') || '실제 필지 경계'; if (by('chapSummarySite')) by('chapSummarySite').textContent = `${g.featureCount}개 경계 · ${Math.round(g.areaSqm).toLocaleString()}㎡`; }
      }
      async function add(pnu) {
        if (busy) return;
        if (!validPnu(pnu)) { message('선택한 지번을 다시 검색해 주세요.', true); return; }
        if ((draft?.features.length || 0) >= 5) { message('필지는 최대 5개까지 선택할 수 있습니다. 목록에서 삭제한 뒤 추가하세요.', true); return; }
        if (draft?.features.some(f => f.properties.pnu === pnu)) { message('이미 선택한 지번입니다.', true); return; }
        const token = revision; busy = true; renderDraft(); message('선택한 지번의 경계와 법규 자료를 조회하고 있습니다.');
        try {
          const [boundary, regulations] = await Promise.all([request('/api/v1/parcels/' + encodeURIComponent(pnu)), fetchRegulations(pnu)]); if (token !== revision) return;
          const data = window.AtelierParcelGeometry.sanitizeParcelData(boundary), features = data.features.map(f => ({ ...f, properties: { ...f.properties, regulations } }));
          const next = { version: 1, source: draft?.source === 'import' ? 'import' : 'vworld', fetchedAt: data.fetchedAt, features: [...(draft?.features || []), ...features] };
          draft = window.AtelierParcelGeometry.sanitizeParcelData(next); revision++;
          message(regulations.status === 'unverified' ? '필지 경계를 추가했습니다. 법규 자료는 미확인 상태이므로 용도지역과 상한을 별도로 확인하세요.' : '필지와 조회 자료를 추가했습니다. 각 필지의 규제를 확인한 뒤 설계에 적용하세요.');
        } catch (error) { if (token === revision) message(error.message, true); }
        finally { busy = false; renderDraft(); }
      }
      by('parcelAddressForm').addEventListener('submit', async event => {
        event.preventDefault(); if (busy) return; const q = by('parcelAddress').value.trim();
        if (!q || /^\d{19}$/.test(q)) { message('지번주소나 도로명주소를 입력해 검색해 주세요. 필지 식별번호는 선택 후 자동으로 처리합니다.', true); return; }
        const token = revision; busy = true; by('parcelCandidates').replaceChildren(); renderDraft(); message('주소에 해당하는 지번을 찾고 있습니다.');
        try {
          const data = await request('/api/v1/parcels/search?q=' + encodeURIComponent(q)); if (token !== revision) return;
          const html = (data.candidates || []).map(candidateMarkup).join(''); by('parcelCandidates').innerHTML = html;
          message(html ? '지번을 확인하고 선택하면 경계와 법규 자료를 추가합니다.' : '일치하는 지번이 없습니다. 시·구와 번지를 포함해 다시 검색해 주세요.');
        } catch (error) { if (token === revision) message(error.message, true); }
        finally { busy = false; renderDraft(); }
      });
      by('parcelCandidates').addEventListener('click', event => { const button = event.target.closest('[data-parcel-pnu]'); if (button) add(button.dataset.parcelPnu); });
      additionalControls.addEventListener('click', event => {
        if (busy || !event.target.closest('[data-reset-manual-limits]')) return;
        const s = current(), caps = manualCaps(s);
        if (!Object.values(caps).some(value => value !== null)) return;
        const before = { legalFarCapPct: s.legalFarCapPct, legalBcrCapPct: s.legalBcrCapPct, maxHeightM: s.maxHeightM };
        try {
          Object.assign(s, { legalFarCapPct: 0, legalBcrCapPct: 0, maxHeightM: 0 });
          syncWorkspaceInputsToUI(); updateAllCalculationsAndUI(); sync();
          message(regulationMode(s) === 'scenario'
            ? `추가 제한(${manualText(caps)})을 해제했습니다. 조회 용도지역과 확인된 고시 제한을 유지해 재배치했습니다. 미확인 계획 조건은 별도 검토하세요.`
            : `저장된 비교값(${manualText(caps)})을 해제했습니다. 법정 기준 모드의 계산과 확인된 고시 제한을 유지했습니다.`);
        } catch (error) {
          Object.assign(s, before);
          try { syncWorkspaceInputsToUI(); updateAllCalculationsAndUI(); sync(); } catch (_) { /* Keep the original editable limits if recalculation fails. */ }
          message('추가 제한을 해제하지 못해 기존 값을 유지했습니다. ' + (error.message || '계산 상태를 확인해 주세요.'), true);
        }
      });
      by('parcelDraftList').addEventListener('click', async event => {
        if (busy) return;
        if (event.target.closest('[data-add-parcel]')) { by('parcelAddress').value = ''; by('parcelAddress').focus(); message('추가할 필지의 지번주소나 도로명주소를 검색하세요.'); return; }
        const remove = event.target.closest('[data-remove-parcel]');
        if (remove) { draft.features.splice(Number(remove.dataset.removeParcel), 1); if (!draft.features.length) draft = null; revision++; message('선택 목록을 변경했습니다. 적용 버튼으로 확정하세요.'); renderDraft(); return; }
        const retry = event.target.closest('[data-refresh-regulations]');
        if (retry) {
          const feature = draft?.features[Number(retry.dataset.refreshRegulations)]; if (!validPnu(feature?.properties.pnu)) return;
          const token = revision; busy = true; renderDraft(); message('선택 필지의 법규 자료를 다시 조회하고 있습니다.');
          try { const regulations = await fetchRegulations(feature.properties.pnu); if (token !== revision) return; const next = structuredClone(draft); next.features[Number(retry.dataset.refreshRegulations)].properties.regulations = regulations; draft = window.AtelierParcelGeometry.sanitizeParcelData(next); revision++; message('조회 상태를 갱신했습니다. 적용 버튼으로 설계에 반영하세요.'); }
          catch (error) { if (token === revision) message(error.message, true); }
          finally { busy = false; renderDraft(); }
        }
      });
      by('parcelApply').addEventListener('click', () => {
        if (busy) return;
        try { const data = window.AtelierParcelGeometry.sanitizeParcelData(draft), g = window.AtelierParcelGeometry.derive(data);
          if (g.areaSqm < 200 || g.areaSqm > 20000) throw new Error('현재 설계 엔진은 경계 면적 200~20,000㎡를 지원합니다. 입력은 변경하지 않았습니다.');
          const resetConditions = siteConditionsForBoundary(state.parcelData, data);
          Object.assign(state, resetConditions, { parcelData: data, parcelMerged: g.featureCount > 1, siteAreaSqm: g.areaSqm }); syncWorkspaceInputsToUI(); updateAllCalculationsAndUI();
          message('필지 경계와 조회 자료를 적용했습니다. ' + (Object.keys(resetConditions).length ? '새 필지에는 이전 예시의 공공기여·서울도심·일조 비교 전제를 승계하지 않았습니다. ' : '') + '도로 폭 입력과 서울도심 여부는 미확인 비교 가정입니다. 개별 고시·접도 조건은 별도로 확인하세요.');
        } catch (error) { message(error.message, true); }
      });
      by('parcelClear').addEventListener('click', () => { if (busy) return; revision++; draft = null; state.parcelData = null; state.parcelMerged = false; updateAllCalculationsAndUI(); renderDraft(); message('경계를 해제했습니다. 면적 입력을 사용하는 사각 대지 검토로 돌아갑니다.'); });
      by('parcelImport').addEventListener('click', () => { if (!busy) by('parcelBoundaryFile').click(); });
      by('parcelBoundaryFile').addEventListener('change', async event => {
        const file = event.target.files?.[0]; if (!file || busy) return; const token = revision; busy = true; renderDraft();
        try {
          if (file.size > 256 * 1024) throw new Error('경계 파일은 256 KiB 이하여야 합니다.'); const raw = JSON.parse(await file.text()); if (token !== revision) return;
          if (raw.crs && !/4326|CRS84/.test(JSON.stringify(raw.crs))) throw new Error('WGS84 EPSG:4326 GeoJSON으로 변환해 주세요.');
          const features = raw.type === 'FeatureCollection' ? raw.features : raw.type === 'Feature' ? [raw] : raw.version === 1 ? raw.features : [{ type: 'Feature', geometry: raw, properties: {} }];
          if (!Array.isArray(features) || features.length > 5) throw new Error('경계 파일에는 최대 5개 필지를 넣어 주세요.');
          // Boundary files do not authenticate a zoning designation or notice.
          const data = { version: 1, source: 'import', features: features.map(f => { const p = f.properties || {}, properties = { source: '사용자 GeoJSON' }; if (p.pnu !== undefined) properties.pnu = p.pnu; if (p.address) properties.address = p.address; return { type: 'Feature', geometry: f.geometry, properties }; }) };
          draft = window.AtelierParcelGeometry.sanitizeParcelData(data); revision++; message('파일 경계를 읽었습니다. 고시 원문이 없는 법규 자료는 수동 확인 대상으로 두었습니다.');
        } catch (error) { if (token === revision) message(error.message || '경계 파일을 읽지 못했습니다.', true); }
        finally { busy = false; event.target.value = ''; renderDraft(); }
      });
      window.addEventListener('atelier:updated', sync);
      window.addEventListener('atelier:project-loaded', () => { revision++; draft = current().parcelData ? structuredClone(current().parcelData) : null; renderDraft(); sync(); });
      draft = current().parcelData ? structuredClone(current().parcelData) : null; renderDraft(); sync();
      request('/api/v1/parcels/status').then(status => { by('parcelProviderStatus').textContent = `지번 검색 ${status.addressSearchReady ? '연결됨' : '연결 필요'} · 필지 경계 ${status.boundaryReady ? '연결됨' : '연결 필요'}`; }).catch(() => { by('parcelProviderStatus').textContent = '필지 API 연결 상태를 확인하지 못했습니다. 서버를 확인해 주세요.'; });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
  }
  return Object.freeze({ regulationsView, regulationMarkup, additionalLimitsMarkup, candidateMarkup, siteConditionsForBoundary, mount });
});
