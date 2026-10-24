/* Local project files contain editable study inputs, never API keys or computed results. */
(function () {
  "use strict";
  const ready = () => {
    const bridge = window.AtelierWorkspace;
    const toolbar = document.querySelector(".topbar-controls") || document.querySelector(".studio-toolbar");
    if (!bridge || !toolbar || document.getElementById("projectFiles")) return;
    const panel = document.createElement("details");
    panel.id = "projectFiles";
    panel.className = "project-files";
    panel.innerHTML = `<summary>프로젝트 파일 <span aria-hidden="true">↗</span></summary>
      <div class="project-files-body">
        <div class="project-files-heading"><strong>PROJECT FILE</strong><span>로컬 파일 · v1</span></div>
        <label for="projectFileTitle">프로젝트 이름</label>
        <input id="projectFileTitle" type="text" maxlength="120" value="FORMEQUA 설계 연구" autocomplete="off">
        <div class="project-files-actions"><button type="button" class="btn" data-project-save>프로젝트 저장</button>
          <button type="button" class="btn" data-project-load>불러오기</button></div>
        <input type="file" accept=".json,application/json" data-project-input hidden>
        <p class="project-files-caption">필지별 입력·층별 용도·금융 가정을 .formequa.json 파일로 보관합니다. 불러오면 현재 설계 입력을 복원하고 다시 계산합니다.</p>
        <p class="project-files-caption">이 탭의 임시 보관은 12시간입니다. 파일에는 만료 기간이 없으며, 불러오는 파일은 서버로 전송하지 않습니다.</p>
        <p class="project-files-status" data-project-status role="status" aria-live="polite">아직 저장한 프로젝트 파일이 없습니다.</p>
      </div>`;
    toolbar.append(panel);
    const title = panel.querySelector("#projectFileTitle");
    const input = panel.querySelector("[data-project-input]");
    const status = panel.querySelector("[data-project-status]");
    const saveButton = panel.querySelector("[data-project-save]");
    const loadButton = panel.querySelector("[data-project-load]");
    const meta = bridge.getProjectMeta();
    if (meta) title.value = meta.title;
    function message(text, failed = false) {
      status.textContent = text;
      status.classList.toggle("is-error", failed);
      status.setAttribute("role", failed ? "alert" : "status");
    }
    function formatDate(iso) {
      return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(iso));
    }
    saveButton.addEventListener("click", () => {
      let url;
      try {
        const project = bridge.exportProject({ title: title.value });
        title.value = project.title;
        const raw = JSON.stringify(project, null, 2);
        const blob = new Blob([raw], { type: "application/json;charset=utf-8" });
        if (blob.size > bridge.maxProjectBytes) throw new Error("프로젝트 파일: 파일 크기가 5 MiB 제한을 초과합니다.");
        url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        const safeTitle = project.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").slice(0, 80) || "FORMEQUA";
        link.download = `${safeTitle}.formequa.json`;
        document.body.append(link);
        link.click();
        link.remove();
        message(`${project.title} · ${Object.keys(project.perParcel).length}개 필지 · 저장 ${formatDate(project.savedAt)}`);
      } catch (error) { message(error.message || "프로젝트 파일을 저장하지 못했습니다.", true); }
      finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); }
    });
    loadButton.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      saveButton.disabled = true;
      loadButton.disabled = true;
      try {
        if (file.size > bridge.maxProjectBytes) throw new Error("프로젝트 파일: 파일은 5 MiB 이하여야 합니다.");
        const project = bridge.parseProject(await file.text());
        if (typeof loadParcelPreset !== "function") throw new Error("설계 작업실이 아직 준비되지 않았습니다.");
        bridge.importProject(project, inputs => {
          // Keep the engine's state object and its existing preset/UI pipeline.
          // All file validation completed before this first mutation.
          if (typeof state !== "undefined") state.lawSyncedMeta = null;
          loadParcelPreset(inputs.parcelKey, inputs);
        });
        title.value = project.title;
        message(`${project.title} · ${Object.keys(project.perParcel).length}개 필지 복원 · 파일 저장 ${formatDate(project.savedAt)} · 현재 계산 기준으로 다시 계산했습니다.`);
        window.dispatchEvent(new CustomEvent("atelier:project-loaded", { detail: { title: project.title, activeParcelKey: project.activeParcelKey } }));
      } catch (error) { message(error.message || "프로젝트 파일을 불러오지 못했습니다.", true); }
      finally {
        input.value = "";
        saveButton.disabled = false;
        loadButton.disabled = false;
      }
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
