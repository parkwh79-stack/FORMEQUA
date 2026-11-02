/** Shared, local-only explanations, loading states and concise feedback. */
(() => {
  'use strict';
  const HELP=Object.freeze({
    far:['용적률','대지면적 대비 용적률 산정에 포함되는 연면적의 비율입니다. 개별 필지의 고시·산정 제외 면적은 별도 확인이 필요합니다.'],
    bcr:['건폐율','대지면적 대비 건축면적의 비율입니다. 현재 모형은 층별 외곽의 수평 투영을 반영하며, 실제 적용 상한과 산정 범위는 별도 확인이 필요합니다.'],
    efficiency:['전용률','사업성 계산에 사용하는 전용면적 비율 가정입니다. 실제 생성된 실 배치 면적과 구분해서 살펴보세요.'],
    dscr:['DSCR · 이자 대비 NOI','이 모형에서는 안정화 NOI를 전체 PF 트랜치의 연간 이자로 나눕니다. 매각월 원금상환까지 포함하는 기간별 원리금 상환배율은 아닙니다.'],
    ltc:['LTC · 사업비 대비 대출','총사업비에서 대출이 차지하는 비율 가정입니다. 실제 금융기관의 대출 승인이나 담보인정비율을 의미하지 않습니다.'],
    capex:['총사업비','토지·공사·간접비·금융비 등을 합산한 검토 추정치입니다. 특수 곡면 외피·회전 및 전이구조의 추가 공사비는 별도 검토 대상입니다.'],
    xirr:['자기자본 수익률','모형의 월별 자기자본 현금흐름에 따른 연환산 수익률 추정치입니다. 임대·운영·공사비·매각 가정에 따라 달라집니다.'],
    height:['적용 높이와 층수','요청 층수와 실제 생성 층수는 다를 수 있습니다. 대지·높이·용적률·코어 조건에 따라 층이 제한되며 지붕 높이 여유도 반영합니다.'],
    shape:['형태 변화','선택한 형태의 절삭·축소·곡면 강도 또는 요청 회전각을 조정합니다. 실제 외곽을 기준으로 면적과 층별 평면을 다시 계산합니다.'],
    crown:['경사 크라운','거주 공간으로 계산하지 않는 지붕 스크린 개념입니다. 높이 여유에 반영하며 구조·풍하중·법정 높이 해석과 추가 공사비는 별도 검토가 필요합니다.'],
    plan:['생성 실내 평면','층별 실제 외곽을 따라 실·복도·창가 지원 영역을 배치합니다. 가구와 욕실은 각 구획 안에 들어갈 때만 생성합니다. 구조·피난·설비는 별도 설계가 필요합니다.']
  });
  let tooltip,activeHelp,pinned=false,hoverTimer,toast,toastTimer,toastToken=0,sceneReady=false,busyTimer,busyNode;
  const byId=id=>document.getElementById(id);
  function hideHelp(){
    clearTimeout(hoverTimer);pinned=false;
    if(activeHelp){
      const ids=(activeHelp.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!=='formequaTooltip');
      if(ids.length)activeHelp.setAttribute('aria-describedby',ids.join(' '));else activeHelp.removeAttribute('aria-describedby');
      activeHelp.setAttribute('aria-expanded','false');activeHelp=null;
    }
    if(tooltip)tooltip.hidden=true;
  }
  function positionHelp(){
    if(!activeHelp||tooltip.hidden)return;
    const r=activeHelp.getBoundingClientRect(),w=tooltip.offsetWidth,h=tooltip.offsetHeight;
    if(!r.width||!r.height||r.bottom<0||r.top>innerHeight){hideHelp();return;}
    tooltip.style.left=Math.max(12,Math.min(innerWidth-w-12,r.left+r.width/2-w/2))+'px';
    tooltip.style.top=Math.max(12,Math.min(innerHeight-h-12,r.bottom+h+14<innerHeight?r.bottom+9:r.top-h-9))+'px';
  }
  function showHelp(button){
    const entry=HELP[button?.dataset.uiHelp];if(!entry)return;
    if(activeHelp!==button)hideHelp();
    activeHelp=button;tooltip.textContent=entry[1];tooltip.hidden=false;
    const ids=new Set((button.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));ids.add('formequaTooltip');
    button.setAttribute('aria-describedby',[...ids].join(' '));button.setAttribute('aria-expanded','true');positionHelp();
  }
  function helpButton(key){
    const button=document.createElement('button');button.type='button';button.className='ui-help';button.dataset.uiHelp=key;
    button.setAttribute('aria-label',HELP[key][0]+' 설명');button.setAttribute('aria-expanded','false');button.title='';
    const mark=document.createElement('span');mark.setAttribute('aria-hidden','true');mark.textContent='?';button.append(mark);return button;
  }
  function mountHelp(){
    const fields={sliderTargetBcr:'bcr',inputLegalBcrCap:'bcr',inputLegalFarCap:'far',sliderFloorsAbove:'height',inputLoanLtv:'ltc',modelMassShapePct:'shape',modelCrownStyle:'crown'};
    for(const [id,key] of Object.entries(fields)){
      const field=byId(id);if(!field)continue;
      const label=field.closest('.control-row')?.querySelector('.control-label')||document.querySelector(`label[for="${id}"]`);
      if(!label)continue;
      if(label.tagName==='LABEL'){
        const wrapper=document.createElement('div');wrapper.className='ui-help-field';label.before(wrapper);wrapper.append(label,helpButton(key));
      }else label.append(helpButton(key));
    }
    const metrics={kpiFarArea:'far',kpiNetArea:'efficiency',kpiTotalCost:'capex',kpiPeakEquity:'dscr',kpiEquityIrr:'xirr'};
    for(const [id,key] of Object.entries(metrics))byId(id)?.closest('.kpi-cell')?.querySelector('.kpi-label > span')?.append(helpButton(key));
    document.querySelector('.model-focus-scale > span')?.append(helpButton('height'));
    document.querySelector('.model-focus-plan-heading h2')?.append(helpButton('plan'));
  }
  function notify(message,{duration=4200}={}){
    if(!toast||!message)return;
    clearTimeout(toastTimer);const token=++toastToken;
    toast.querySelector('.ui-toast-copy').textContent=String(message).slice(0,220);toast.hidden=false;toast.classList.add('is-visible');
    if(duration)toastTimer=setTimeout(()=>{if(token===toastToken){toast.hidden=true;toast.classList.remove('is-visible');}},duration);
  }
  function finishViewer(){sceneReady=true;document.querySelectorAll('[data-viewer-loading]').forEach(el=>el.hidden=true);}
  function solidStatus(status){
    clearTimeout(busyTimer);const stage=byId('threeStage');
    if(status==='pending'){
      stage?.setAttribute('aria-busy','true');
      busyTimer=setTimeout(()=>{if(busyNode){busyNode.textContent='모형의 외곽을 갱신하고 있습니다.';busyNode.hidden=false;}},320);
    }else{
      stage?.setAttribute('aria-busy','false');
      if(busyNode){busyNode.hidden=status!=='fallback';busyNode.textContent=status==='fallback'?'기본 외곽 모형을 표시하고 있습니다.':'';}
    }
  }
  window.AtelierUI=Object.freeze({notify,hideHelp});
  window.addEventListener('atelier:scene-rebuilt',finishViewer);
  window.addEventListener('atelier:viewer-unavailable',finishViewer);
  window.addEventListener('atelier:solid-status',event=>solidStatus(event.detail?.status));
  window.addEventListener('DOMContentLoaded',()=>{
    tooltip=document.createElement('div');tooltip.id='formequaTooltip';tooltip.className='ui-tooltip';tooltip.setAttribute('role','tooltip');tooltip.hidden=true;document.body.append(tooltip);
    toast=document.createElement('div');toast.className='ui-toast';toast.id='formequaToast';toast.hidden=true;
    const copy=document.createElement('span');copy.className='ui-toast-copy';copy.setAttribute('role','status');copy.setAttribute('aria-live','polite');copy.setAttribute('aria-atomic','true');
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','알림 닫기');close.onclick=()=>{clearTimeout(toastTimer);toast.hidden=true;};
    toast.append(copy,close);document.body.append(toast);
    toast.addEventListener('mouseenter',()=>clearTimeout(toastTimer));toast.addEventListener('focusin',()=>clearTimeout(toastTimer));
    busyNode=document.createElement('p');busyNode.className='ui-model-status';busyNode.id='modelCalculationStatus';busyNode.setAttribute('role','status');busyNode.hidden=true;byId('threeStage')?.append(busyNode);
    mountHelp();if(sceneReady)finishViewer();
    document.addEventListener('click',event=>{
      const button=event.target.closest('[data-ui-help]');if(!button)return;
      event.preventDefault();event.stopPropagation();
      if(pinned&&activeHelp===button)hideHelp();else{showHelp(button);pinned=true;button.focus({preventScroll:true});}
    },true);
    document.addEventListener('click',event=>{if(activeHelp&&!event.target.closest('[data-ui-help],.ui-tooltip'))hideHelp();});
    document.addEventListener('focusin',event=>{const button=event.target.closest('[data-ui-help]');if(button)showHelp(button);else if(activeHelp)hideHelp();});
    document.addEventListener('pointerover',event=>{const button=event.target.closest('[data-ui-help]');if(button&&!pinned){clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>showHelp(button),130);}});
    document.addEventListener('pointerout',event=>{if(event.target.closest('[data-ui-help]')&&!pinned&&document.activeElement!==activeHelp){clearTimeout(hoverTimer);hoverTimer=setTimeout(hideHelp,180);}});
    tooltip.addEventListener('pointerenter',()=>clearTimeout(hoverTimer));tooltip.addEventListener('pointerleave',()=>{if(!pinned&&document.activeElement!==activeHelp)hideHelp();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&activeHelp){hideHelp();event.preventDefault();event.stopPropagation();}},true);
    document.addEventListener('click',event=>{
      const button=event.target.closest('button[data-qmat],button[data-qglass],button[data-qaccent],button[data-qfacade]');
      if(!button)return;const wasActive=button.classList.contains('active');
      requestAnimationFrame(()=>{if(!wasActive&&button.classList.contains('active'))notify((button.textContent.trim()||button.getAttribute('aria-label')||button.title||'선택한 재료')+' · 적용했습니다.');});
    },true);
    window.addEventListener('resize',positionHelp);window.addEventListener('scroll',positionHelp,{capture:true,passive:true});window.addEventListener('pagehide',()=>{hideHelp();clearTimeout(toastTimer);clearTimeout(busyTimer);});
  });
})();
