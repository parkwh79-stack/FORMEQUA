/** Record the current WebGL view locally, without changing design inputs. */
(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const MAX_DURATION_MS = 60000;
  let active = null;
  let supported = false;

  function ui(mode, message) {
    document.querySelectorAll("[data-record-model]").forEach(button => {
      button.disabled = !supported || mode === "saving";
      button.classList.toggle("recording", mode === "recording");
      button.setAttribute("aria-pressed", String(mode === "recording"));
      button.textContent = mode === "recording" ? "녹화 종료·저장" : "동영상 저장";
      if (mode === "saving") button.textContent = "영상 저장 중…";
    });
    const status = byId("modelVideoStatus");
    if (status) { status.hidden = !message; status.textContent = message || ""; }
  }

  function release(session) {
    cancelAnimationFrame(session.frame);
    clearInterval(session.clock);
    clearTimeout(session.timeout);
    session.stream?.getTracks().forEach(track => track.stop());
  }

  function fail(session, message) {
    if (active !== session) return;
    active = null;
    session.discard = true;
    try { if (session.recorder?.state !== "inactive") session.recorder?.stop(); } catch (_) { /* Release tracks below. */ }
    release(session);
    ui("idle", message);
  }

  function finish(session) {
    if (active !== session) return;
    active = null;
    release(session);
    if (session.discard) { ui("idle"); return; }
    const type = session.recorder.mimeType || session.mimeType || "video/webm";
    const blob = new Blob(session.chunks, { type });
    if (!blob.size) { ui("idle", "저장할 영상이 없습니다. 모형이 보이는 상태에서 다시 녹화해 주세요."); return; }
    const extension = type.includes("mp4") ? "mp4" : "webm";
    const filename = `formequa-model-${session.parcelKey}-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = filename; link.hidden = true;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    ui("idle", `동영상 저장을 시작했습니다. (${extension.toUpperCase()})`);
  }

  function stop() {
    const session = active;
    if (!session || session.stopping) return;
    session.stopping = true;
    ui("saving", "현재 모형의 영상을 파일로 저장하고 있습니다.");
    try {
      if (session.recorder.state !== "inactive") session.recorder.stop();
      else finish(session);
    } catch (_) { fail(session, "동영상을 저장하지 못했습니다. 다시 녹화해 주세요."); }
  }

  function start() {
    if (active || !supported) return;
    const source = byId("threeCanvas");
    if (!source?.width || !source.height || document.body.dataset.viewerUnavailable === "true") {
      ui("idle", "모형을 불러온 뒤 동영상을 저장할 수 있습니다."); return;
    }
    const session = { chunks: [], stream: null, recorder: null, frame: 0, clock: null, timeout: null,
      discard: false, stopping: false,
      parcelKey: (byId("parcelSelect")?.value || "study").replace(/[^a-z0-9_-]/gi, "").slice(0, 60) };
    active = session;
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1600 / source.width, 1000 / source.height);
      canvas.width = Math.max(2, Math.floor(source.width * scale / 2) * 2);
      canvas.height = Math.max(2, Math.floor(source.height * scale / 2) * 2);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Recording canvas unavailable");
      const paint = () => {
        if (active !== session || session.stopping) return;
        try {
          // Keep a fixed encoding size when the user resizes the work surface.
          context.fillStyle = "#f5f3ee"; context.fillRect(0, 0, canvas.width, canvas.height);
          if (source.width && source.height) {
            const fit = Math.min(canvas.width / source.width, canvas.height / source.height);
            const width = source.width * fit, height = source.height * fit;
            context.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
          }
          session.frame = requestAnimationFrame(paint);
        } catch (_) { fail(session, "모형 화면을 녹화하지 못했습니다. 다시 시도해 주세요."); }
      };
      paint();
      if (active !== session) return;
      session.stream = canvas.captureStream(30);
      session.mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]
        .find(type => MediaRecorder.isTypeSupported(type)) || "";
      session.recorder = new MediaRecorder(session.stream, session.mimeType ? { mimeType: session.mimeType } : {});
      session.recorder.ondataavailable = event => { if (event.data?.size) session.chunks.push(event.data); };
      session.recorder.onstop = () => finish(session);
      session.recorder.onerror = () => fail(session, "브라우저에서 영상 녹화를 완료하지 못했습니다. 다시 시도해 주세요.");
      session.recorder.start(200);
      ui("recording", "녹화 중 · 시점을 움직인 뒤 종료하면 저장됩니다. 최대 1분.");
      const elapsed = document.createElement("span"); elapsed.setAttribute("aria-hidden", "true");
      byId("modelVideoStatus")?.append(elapsed);
      const startedAt = Date.now();
      const tick = () => {
        const seconds = Math.min(60, Math.floor((Date.now() - startedAt) / 1000));
        elapsed.textContent = ` ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      };
      tick(); session.clock = setInterval(tick, 500); session.timeout = setTimeout(stop, MAX_DURATION_MS);
    } catch (_) { fail(session, "이 브라우저에서 동영상 녹화를 시작하지 못했습니다. 최신 Chrome 또는 Edge에서 다시 시도해 주세요."); }
  }

  window.AtelierModelVideo = Object.freeze({ start, stop, isRecording: () => !!active && !active.stopping });
  window.addEventListener("DOMContentLoaded", () => {
    supported = typeof MediaRecorder === "function" && typeof MediaRecorder.isTypeSupported === "function" &&
      typeof HTMLCanvasElement.prototype.captureStream === "function";
    ui("idle", supported ? "" : "이 브라우저에서는 동영상 저장을 지원하지 않습니다.");
    document.querySelectorAll("[data-record-model]").forEach(button => button.addEventListener("click", () => active ? stop() : start()));
  });
  window.addEventListener("pagehide", () => { if (active) { active.discard = true; stop(); } });
})();
