/* =========================================================
   MultiMedia Converter — منطق التطبيق
   الأقسام:
   1) أدوات مساعدة          2) الاتصال بـ Supabase
   3) تعريف الصيغ والإعدادات  4) اختيار الملف والمعاينة
   5) دوال التحويل الفعلية    6) عرض النتيجة والتنزيل والحفظ
   7) مكتبة الملفات المحفوظة (عرض/تنزيل/حذف)
   ========================================================= */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  if (!window.SB || !window.SB.client) return; // الحارس سيحوّل إلى صفحة الدخول
  const BUCKET = CFG.BUCKET || "media";
  const TABLE = CFG.TABLE || "media_files";
  const MAX_BYTES = (CFG.MAX_FILE_MB || 50) * 1024 * 1024;
  const { encodeWAV, encodeBMP } = window.Encoders;

  /* ---------------- 1) أدوات مساعدة ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0, n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function formatTime(sec) {
    if (!isFinite(sec)) return "—";
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function baseName(name) { return name.replace(/\.[^.]+$/, "") || "file"; }

  // اسم آمن لمسار التخزين (Supabase لا يقبل بعض الأحرف مثل العربية في المسار)
  function safeKey(name) {
    const ext = (name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const base = baseName(name).normalize("NFKD").replace(/[^\w-]+/g, "_")
      .replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "file";
    return `${base}.${ext}`;
  }

  function uid() { return Math.random().toString(36).slice(2, 8); }

  function toast(message, type = "info", ms = 4200) {
    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    el.textContent = message;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function pickMime(list) {
    if (!window.MediaRecorder) return null;
    return list.find((m) => MediaRecorder.isTypeSupported(m)) || null;
  }

  function extFromMime(mime, category) {
    if (mime.includes("webm")) return "webm";
    if (mime.includes("ogg")) return "ogg";
    if (mime.includes("mp4")) return category === "audio" ? "m4a" : "mp4";
    return "bin";
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("تعذّر إنشاء الصورة"))), mime, quality);
    });
  }

  /* ---------------- 2) الاتصال بـ Supabase ---------------- */
  let db = null;

  function setStatus(kind, text) {
    const el = $("#dbStatus");
    el.className = `status status--${kind}`;
    $(".status-text", el).textContent = text;
  }

  let user = null; // المستخدم الحالي (يأتي من auth-guard.js)

  async function initSupabase() {
    // ننتظر حارس المصادقة: لا يصل التنفيذ هنا إلا إذا كان المستخدم مسجّلًا
    user = await window.authReady;
    $("#userEmail").textContent = user.email;
    db = window.SB.client;
    const { error } = await db.from(TABLE).select("id", { count: "exact", head: true });
    if (error) {
      setStatus("error", "خطأ في الجدول: شغّل ملفات SQL");
      console.error(error);
      toast("تعذّر الوصول إلى الجدول: " + error.message, "err", 7000);
      db = null;
      return;
    }
    setStatus("online", "متصل بـ Supabase");
    loadLibrary();
  }

  /* ---------------- 3) الصيغ والإعدادات ---------------- */
  const webpSupported = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 1;
    return c.toDataURL("image/webp").startsWith("data:image/webp");
  })();

  const CATEGORIES = {
    image: {
      accept: "image/*",
      hint: "PNG، JPG، WEBP، GIF، BMP، SVG…",
      formats: [
        { id: "png", label: "PNG (بدون فقد)" },
        { id: "jpeg", label: "JPG (مضغوط)" },
        ...(webpSupported ? [{ id: "webp", label: "WEBP (حديث وخفيف)" }] : []),
        { id: "bmp", label: "BMP (غير مضغوط)" }
      ]
    },
    audio: {
      accept: "audio/*",
      hint: "MP3، WAV، OGG، M4A، WEBM، FLAC…",
      formats: [
        { id: "wav", label: "WAV (PCM 16-bit)" },
        { id: "compressed", label: "WebM/Opus (مضغوط)" }
      ]
    },
    video: {
      accept: "video/*",
      hint: "MP4، WEBM، MOV، OGG…",
      formats: [
        { id: "reencode", label: "WebM (إعادة ترميز وتصغير)" },
        { id: "audio", label: "استخراج الصوت إلى WAV" },
        { id: "frame-png", label: "لقطة صورة PNG" },
        { id: "frame-jpeg", label: "لقطة صورة JPG" }
      ]
    }
  };

  const state = { category: "image", file: null, fileUrl: null, meta: {}, result: null, busy: false };

  function selectHtml(name, label, options, small = "") {
    return `<label class="field"><span>${label}</span>
      <select name="${name}">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select>
      ${small ? `<small>${small}</small>` : ""}</label>`;
  }

  function renderOptions() {
    const cat = CATEGORIES[state.category];
    const fmt = selectHtml("format", "الصيغة الناتجة", cat.formats.map((f) => [f.id, f.label]));
    let html = fmt;

    if (state.category === "image") {
      html += `
        <label class="field"><span>الجودة</span>
          <div class="range-row"><input type="range" name="quality" min="10" max="100" value="85">
          <output>85</output></div>
          <small>تؤثر في JPG وWEBP فقط</small></label>
        <label class="field"><span>العرض الأقصى بالبكسل</span>
          <input type="number" name="width" min="0" step="1" value="0" inputmode="numeric">
          <small>0 = الحجم الأصلي. يحافظ على نسبة الأبعاد</small></label>
        <label class="check"><input type="checkbox" name="grayscale"> تحويل إلى أبيض وأسود</label>`;
    }

    if (state.category === "audio") {
      html += selectHtml("rate", "معدل العيّنات", [["0", "كما في الأصل"], ["48000", "48000 Hz"], ["44100", "44100 Hz (جودة CD)"], ["22050", "22050 Hz"], ["16000", "16000 Hz (صوت كلام)"]]);
      html += selectHtml("channels", "القنوات", [["0", "كما في الأصل"], ["2", "ستيريو"], ["1", "مونو"]]);
      html += selectHtml("bitrate", "معدل البت (للمضغوط)", [["64000", "64 kbps"], ["128000", "128 kbps"], ["192000", "192 kbps"]]);
    }

    if (state.category === "video") {
      html += selectHtml("height", "الدقة", [["0", "كما في الأصل"], ["1080", "1080p"], ["720", "720p"], ["480", "480p"], ["360", "360p"]]);
      html += selectHtml("vbitrate", "جودة الفيديو", [["800000", "منخفضة (حجم صغير)"], ["2500000", "متوسطة"], ["5000000", "عالية"]]);
      html += `<label class="field"><span>وقت اللقطة بالثواني</span>
        <input type="number" name="time" min="0" step="0.1" value="1"><small>للّقطات PNG/JPG فقط</small></label>`;
    }

    const form = $("#optionsForm");
    form.innerHTML = html;
    const range = $('input[name="quality"]', form);
    if (range) range.addEventListener("input", () => (range.nextElementSibling.value = range.value));
    updateNote();
  }

  function readOptions() {
    const fd = new FormData($("#optionsForm"));
    const o = Object.fromEntries(fd.entries());
    o.grayscale = fd.has("grayscale");
    return o;
  }

  function updateNote() {
    const o = readOptions();
    const notes = {
      compressed: "يتم الترميز بسرعة التشغيل الطبيعية، أي أن ملفًا مدته دقيقة يحتاج دقيقة تقريبًا.",
      reencode: "يتم الترميز بسرعة التشغيل الطبيعية. أبقِ هذه الصفحة ظاهرة حتى ينتهي التحويل.",
      audio: "يعمل إذا كان الفيديو يحتوي على مسار صوت وصيغته مدعومة في المتصفح."
    };
    $("#optionsNote").textContent = notes[o.format] || "";
  }

  /* ---------------- 4) اختيار الملف والمعاينة ---------------- */
  function switchCategory(cat, keepFile = false) {
    state.category = cat;
    $$(".tab").forEach((t) => {
      const active = t.dataset.cat === cat;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active);
    });
    $("#fileInput").accept = CATEGORIES[cat].accept;
    $("#acceptHint").textContent = CATEGORIES[cat].hint;
    renderOptions();
    if (!keepFile) clearFile();
  }

  function categoryOf(file) {
    const t = file.type || "";
    if (t.startsWith("image/")) return "image";
    if (t.startsWith("audio/")) return "audio";
    if (t.startsWith("video/")) return "video";
    // بعض الملفات تأتي بدون نوع، نستنتجه من الامتداد
    const ext = file.name.split(".").pop().toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico"].includes(ext)) return "image";
    if (["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus", "oga"].includes(ext)) return "audio";
    if (["mp4", "webm", "mov", "mkv", "ogv", "m4v"].includes(ext)) return "video";
    return null;
  }

  function mediaElement(cat, url) {
    if (cat === "image") return `<img src="${url}" alt="معاينة">`;
    if (cat === "audio") return `<audio src="${url}" controls preload="metadata"></audio>`;
    return `<video src="${url}" controls playsinline preload="metadata"></video>`;
  }

  function renderMeta(el, rows) {
    el.innerHTML = rows.filter(Boolean)
      .map(([k, v, cls]) => `<dt>${k}</dt><dd${cls ? ` class="${cls}"` : ""}>${v}</dd>`).join("");
    el.hidden = false;
  }

  async function handleFile(file) {
    if (!file || state.busy) return;
    const cat = categoryOf(file);
    if (!cat) { toast("نوع الملف غير مدعوم. اختر صورة أو صوتًا أو فيديو.", "err"); return; }
    if (cat !== state.category) {
      switchCategory(cat, true);
      toast(`تم التبديل إلى تبويب «${{ image: "صور", audio: "صوت", video: "فيديو" }[cat]}» تلقائيًا`);
    }
    clearFile();
    state.file = file;
    state.fileUrl = URL.createObjectURL(file);

    const preview = $("#sourcePreview");
    preview.innerHTML = mediaElement(cat, state.fileUrl);
    preview.hidden = false;
    $("#dropzone").hidden = true;
    $("#clearBtn").hidden = false;

    const rows = [["الاسم", escapeHtml(file.name)], ["النوع", file.type || "غير معروف"], ["الحجم", formatBytes(file.size)]];
    renderMeta($("#sourceInfo"), rows);

    // قراءة الأبعاد أو المدة
    const media = $("img, audio, video", preview);
    const onMeta = () => {
      if (cat === "image") {
        state.meta = { width: media.naturalWidth, height: media.naturalHeight };
        rows.push(["الأبعاد", `${media.naturalWidth} × ${media.naturalHeight}`]);
      } else {
        state.meta = { duration: media.duration, width: media.videoWidth, height: media.videoHeight };
        rows.push(["المدة", formatTime(media.duration)]);
        if (cat === "video" && media.videoWidth) rows.push(["الأبعاد", `${media.videoWidth} × ${media.videoHeight}`]);
      }
      renderMeta($("#sourceInfo"), rows);
    };
    media.addEventListener(cat === "image" ? "load" : "loadedmetadata", onMeta, { once: true });
    media.addEventListener("error", () => toast("المتصفح لا يستطيع عرض هذا الملف، وقد يفشل تحويله.", "warn"), { once: true });

    $("#convertBtn").disabled = false;
  }

  function clearFile() {
    if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
    state.file = null; state.fileUrl = null; state.meta = {};
    $("#sourcePreview").hidden = true; $("#sourcePreview").innerHTML = "";
    $("#sourceInfo").hidden = true;
    $("#dropzone").hidden = false;
    $("#clearBtn").hidden = true;
    $("#fileInput").value = "";
    $("#convertBtn").disabled = true;
    clearResult();
  }

  function clearResult() {
    if (state.result && state.result.url) URL.revokeObjectURL(state.result.url);
    state.result = null;
    $("#resultBox").hidden = true;
    $("#resultEmpty").hidden = false;
    $("#resultPreview").innerHTML = "";
  }

  /* ---------------- 5) دوال التحويل الفعلية ---------------- */
  function setProgress(p) {
    const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
    $("#progressBar").style.width = pct + "%";
    $("#progressText").textContent = pct + "%";
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("تعذّرت قراءة الصورة"));
      img.src = url;
    });
  }

  // --- الصور: باستخدام Canvas ---
  async function convertImage(file, o) {
    const img = await loadImage(state.fileUrl);
    let w = img.naturalWidth || 800, h = img.naturalHeight || 600;
    const maxW = parseInt(o.width, 10) || 0;
    if (maxW > 0 && maxW < w) { h = Math.round((h * maxW) / w); w = maxW; }
    setProgress(0.3);

    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    // JPG و BMP لا يدعمان الشفافية، لذلك نملأ الخلفية بالأبيض
    if (o.format === "jpeg" || o.format === "bmp") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
    if (o.grayscale) ctx.filter = "grayscale(1)";
    ctx.drawImage(img, 0, 0, w, h);
    setProgress(0.7);

    if (o.format === "bmp") {
      return { blob: encodeBMP(ctx.getImageData(0, 0, w, h)), ext: "bmp", info: { width: w, height: h } };
    }
    const mime = `image/${o.format}`;
    const blob = await canvasToBlob(canvas, mime, (parseInt(o.quality, 10) || 85) / 100);
    if (blob.type !== mime) throw new Error("المتصفح لا يدعم إنشاء هذه الصيغة");
    return { blob, ext: o.format === "jpeg" ? "jpg" : o.format, info: { width: w, height: h } };
  }

  // --- الصوت: فك الترميز ثم إعادة المعالجة ---
  async function decodeAudio(file) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    try {
      const data = await file.arrayBuffer();
      return await ctx.decodeAudioData(data);
    } catch (e) {
      throw new Error("تعذّر فك ترميز الصوت. قد تكون الصيغة غير مدعومة أو لا يوجد مسار صوت.");
    } finally {
      ctx.close();
    }
  }

  // تغيير معدل العيّنات وعدد القنوات باستخدام OfflineAudioContext
  async function remixAudio(buffer, rate, channels) {
    const sr = rate || buffer.sampleRate;
    const ch = channels || buffer.numberOfChannels;
    if (sr === buffer.sampleRate && ch === buffer.numberOfChannels) return buffer;
    const length = Math.max(1, Math.ceil(buffer.duration * sr));
    const off = new OfflineAudioContext(ch, length, sr);
    const src = off.createBufferSource();
    src.buffer = buffer;
    src.connect(off.destination);
    src.start();
    return off.startRendering();
  }

  function bufferToWav(buffer) {
    const chans = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
    return encodeWAV(chans, buffer.sampleRate);
  }

  // ترميز صوت مضغوط باستخدام MediaRecorder
  async function encodeCompressedAudio(buffer, bitrate) {
    const mime = pickMime(["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"]);
    if (!mime) throw new Error("المتصفح لا يدعم الترميز المضغوط. استخدم Chrome أو Edge.");
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ sampleRate: buffer.sampleRate });
    await ctx.resume();
    const dest = ctx.createMediaStreamDestination();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(dest); // لا نوصله بالسماعات، لذلك يعمل بصمت

    const rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: bitrate });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));

    rec.start(250);
    const t0 = ctx.currentTime;
    src.start();
    const timer = setInterval(() => setProgress(Math.min(0.99, (ctx.currentTime - t0) / buffer.duration)), 200);
    await new Promise((r) => (src.onended = r));
    clearInterval(timer);
    rec.stop();
    await stopped;
    ctx.close();
    const type = mime.split(";")[0];
    return { blob: new Blob(chunks, { type }), ext: extFromMime(type, "audio") };
  }

  async function convertAudio(file, o) {
    setProgress(0.05);
    const decoded = await decodeAudio(file);
    setProgress(0.35);
    const buffer = await remixAudio(decoded, parseInt(o.rate, 10) || 0, parseInt(o.channels, 10) || 0);
    setProgress(0.6);
    const info = { duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels };
    if (o.format === "wav") {
      const blob = bufferToWav(buffer);
      return { blob, ext: "wav", info };
    }
    const r = await encodeCompressedAudio(buffer, parseInt(o.bitrate, 10) || 128000);
    return { ...r, info };
  }

  // --- الفيديو ---
  function loadVideo(url) {
    return new Promise((resolve, reject) => {
      const v = document.createElement("video");
      v.preload = "auto"; v.playsInline = true; v.crossOrigin = "anonymous";
      v.onloadedmetadata = () => resolve(v);
      v.onerror = () => reject(new Error("تعذّرت قراءة الفيديو، قد تكون الصيغة غير مدعومة في هذا المتصفح"));
      v.src = url;
    });
  }

  function seekTo(video, t) {
    return new Promise((resolve) => {
      video.addEventListener("seeked", () => resolve(), { once: true });
      video.currentTime = t;
    });
  }

  function scaledSize(w, h, targetH) {
    if (targetH && targetH < h) { w = Math.round((w * targetH) / h); h = targetH; }
    // ترميز الفيديو يفضّل الأبعاد الزوجية
    return { w: w - (w % 2), h: h - (h % 2) };
  }

  async function videoFrame(file, o, mimeId) {
    const v = await loadVideo(state.fileUrl);
    const dur = isFinite(v.duration) ? v.duration : 0;
    const t = Math.min(Math.max(0.01, parseFloat(o.time) || 0), Math.max(0.01, dur - 0.05));
    await seekTo(v, t);
    setProgress(0.6);
    const { w, h } = scaledSize(v.videoWidth, v.videoHeight, parseInt(o.height, 10) || 0);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(v, 0, 0, w, h);
    const mime = `image/${mimeId}`;
    const blob = await canvasToBlob(canvas, mime, 0.92);
    return { blob, ext: mimeId === "jpeg" ? "jpg" : "png", info: { width: w, height: h, time: t } };
  }

  async function reencodeVideo(file, o) {
    const mime = pickMime(["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]);
    if (!mime) throw new Error("المتصفح لا يدعم ترميز الفيديو. استخدم Chrome أو Edge.");
    const v = await loadVideo(state.fileUrl);
    const { w, h } = scaledSize(v.videoWidth, v.videoHeight, parseInt(o.height, 10) || 0);
    if (!w || !h) throw new Error("لم يتم العثور على صورة داخل ملف الفيديو");

    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext("2d");
    const stream = canvas.captureStream(30);

    // نمرّر الصوت عبر Web Audio حتى يُسجَّل دون أن يُسمع
    let actx = null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
      await actx.resume();
      const src = actx.createMediaElementSource(v);
      const dest = actx.createMediaStreamDestination();
      src.connect(dest);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch (e) {
      v.muted = true; // بدون صوت إذا تعذّر ذلك
    }

    const rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: parseInt(o.vbitrate, 10) || 2500000,
      audioBitsPerSecond: 128000
    });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    const ended = new Promise((r) => (v.onended = r));

    let raf = 0;
    const draw = () => {
      g.drawImage(v, 0, 0, w, h);
      if (isFinite(v.duration) && v.duration > 0) setProgress(Math.min(0.99, v.currentTime / v.duration));
      if (!v.ended) raf = requestAnimationFrame(draw);
    };

    await seekTo(v, 0);
    g.drawImage(v, 0, 0, w, h);
    rec.start(500);
    await v.play();
    draw();
    await ended;
    cancelAnimationFrame(raf);
    rec.stop();
    await stopped;
    if (actx) actx.close();
    const type = mime.split(";")[0];
    return { blob: new Blob(chunks, { type }), ext: extFromMime(type, "video"), info: { width: w, height: h, duration: v.duration } };
  }

  async function convertVideo(file, o) {
    if (o.format === "frame-png") return videoFrame(file, o, "png");
    if (o.format === "frame-jpeg") return videoFrame(file, o, "jpeg");
    if (o.format === "audio") {
      setProgress(0.1);
      const buffer = await decodeAudio(file);
      setProgress(0.7);
      return { blob: bufferToWav(buffer), ext: "wav", info: { duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels } };
    }
    return reencodeVideo(file, o);
  }

  async function convert() {
    if (!state.file || state.busy) return;
    const o = readOptions();
    state.busy = true;
    clearResult();
    $("#convertBtn").disabled = true;
    $("#convertBtn").textContent = "جارٍ التحويل…";
    $("#progress").hidden = false;
    setProgress(0);
    const started = performance.now();

    try {
      const fn = { image: convertImage, audio: convertAudio, video: convertVideo }[state.category];
      const r = await fn(state.file, o);
      if (!r.blob || r.blob.size === 0) throw new Error("الملف الناتج فارغ");
      setProgress(1);
      const name = `${baseName(state.file.name)}.${r.ext}`;
      // نوع الملف الناتج: صورة/صوت/فيديو (قد يختلف عن الأصل، مثل استخراج صوت من فيديو)
      const outCat = r.blob.type.startsWith("image/") ? "image" : r.blob.type.startsWith("audio/") || r.ext === "wav" ? "audio" : "video";
      state.result = {
        blob: r.blob, name, ext: r.ext, info: r.info || {},
        category: outCat, options: o, url: URL.createObjectURL(r.blob),
        seconds: (performance.now() - started) / 1000
      };
      showResult();
      toast("تم التحويل بنجاح", "ok");
    } catch (err) {
      console.error(err);
      toast(err.message || "فشل التحويل", "err", 7000);
    } finally {
      state.busy = false;
      $("#convertBtn").disabled = !state.file;
      $("#convertBtn").textContent = "حوّل الملف";
      setTimeout(() => ($("#progress").hidden = true), 600);
    }
  }

  /* ---------------- 6) النتيجة والتنزيل والحفظ ---------------- */
  function showResult() {
    const r = state.result;
    $("#resultPreview").innerHTML = mediaElement(r.category, r.url);
    const diff = state.file.size ? ((r.blob.size - state.file.size) / state.file.size) * 100 : 0;
    const diffText = `${diff > 0 ? "+" : ""}${diff.toFixed(1)}%`;
    const rows = [
      ["الاسم", escapeHtml(r.name)],
      ["النوع", r.blob.type],
      ["الحجم", formatBytes(r.blob.size)],
      ["التغيّر", diffText, diff <= 0 ? "gain" : "loss"],
      r.info.width ? ["الأبعاد", `${r.info.width} × ${r.info.height}`] : null,
      r.info.sampleRate ? ["الصوت", `${r.info.sampleRate} Hz، ${r.info.channels === 1 ? "مونو" : r.info.channels === 2 ? "ستيريو" : r.info.channels + " قنوات"}`] : null,
      ["زمن التحويل", `${r.seconds.toFixed(1)} ث`]
    ];
    renderMeta($("#resultInfo"), rows);
    $("#resultEmpty").hidden = true;
    $("#resultBox").hidden = false;
    $("#saveBtn").disabled = false;
    if (r.blob.size > MAX_BYTES) toast(`حجم الملف أكبر من ${CFG.MAX_FILE_MB || 50}MB، لن يقبله Supabase المجاني. جرّب جودة أقل.`, "warn", 7000);
  }

  async function saveToSupabase() {
    const r = state.result;
    if (!r) return;
    if (!db) { toast("لا يوجد اتصال بـ Supabase. أضف المفاتيح في js/config.js ثم أعد تحميل الصفحة.", "err", 7000); return; }
    if (r.blob.size > MAX_BYTES) { toast("الملف أكبر من الحد المسموح للحفظ.", "err"); return; }

    const btn = $("#saveBtn");
    btn.disabled = true; btn.textContent = "جارٍ الحفظ…";
    const uploaded = [];
    try {
      const stamp = `${Date.now()}-${uid()}`;
      const convertedPath = `${user.id}/${r.category}/${stamp}-${safeKey(r.name)}`;
      const up1 = await db.storage.from(BUCKET).upload(convertedPath, r.blob, { contentType: r.blob.type, upsert: false });
      if (up1.error) throw up1.error;
      uploaded.push(convertedPath);

      let originalPath = null;
      if ($("#saveOriginal").checked) {
        if (state.file.size > MAX_BYTES) {
          toast("الملف الأصلي أكبر من الحد المسموح، سيتم حفظ الملف المحوَّل فقط.", "warn");
        } else {
          originalPath = `${user.id}/originals/${stamp}-${safeKey(state.file.name)}`;
          const up2 = await db.storage.from(BUCKET).upload(originalPath, state.file, { contentType: state.file.type || "application/octet-stream" });
          if (up2.error) throw up2.error;
          uploaded.push(originalPath);
        }
      }

      const row = {
        user_id: user.id,
        category: r.category,
        original_name: state.file.name,
        original_type: state.file.type || null,
        original_size: state.file.size,
        original_path: originalPath,
        converted_name: r.name,
        converted_type: r.blob.type,
        converted_size: r.blob.size,
        converted_path: convertedPath,
        conversion_options: { ...r.options, ...r.info }
      };
      const { error } = await db.from(TABLE).insert(row);
      if (error) throw error;

      toast("تم الحفظ في Supabase", "ok");
      btn.textContent = "تم الحفظ ✓";
      loadLibrary();
    } catch (err) {
      console.error(err);
      // تنظيف أي ملفات رُفعت إذا فشلت العملية في المنتصف
      if (uploaded.length) await db.storage.from(BUCKET).remove(uploaded);
      toast("فشل الحفظ: " + (err.message || err), "err", 8000);
      btn.disabled = false; btn.textContent = "حفظ في Supabase";
    }
  }

  /* ---------------- 7) مكتبة الملفات المحفوظة ---------------- */
  let library = [];
  let filter = "all";

  async function loadLibrary() {
    if (!db) return;
    const { data, error } = await db.from(TABLE).select("*")
      .eq("user_id", user.id).order("created_at", { ascending: false });
    if (error) { toast("تعذّر تحميل الملفات: " + error.message, "err"); return; }
    library = data || [];
    await signUrls(library.map((x) => x.converted_path));
    renderLibrary();
  }

  // الحاوية خاصة، لذلك نطلب روابط موقّعة مؤقتة (ساعة) لعرض المعاينات
  const signed = new Map();
  async function signUrls(paths) {
    const need = paths.filter((p) => !signed.has(p));
    if (!need.length) return;
    const { data, error } = await db.storage.from(BUCKET).createSignedUrls(need, 3600);
    if (error) { console.error(error); return; }
    data.forEach((d) => d.signedUrl && signed.set(d.path, d.signedUrl));
  }

  function renderLibrary(list) {
    const q = $("#searchInput").value.trim().toLowerCase();
    const items = (list || library).filter((it) =>
      (filter === "all" || it.category === filter) &&
      (!q || it.converted_name.toLowerCase().includes(q) || it.original_name.toLowerCase().includes(q)));

    $("#libCount").textContent = library.length;
    const grid = $("#libraryGrid");
    const empty = $("#libraryEmpty");

    if (!db) {
      grid.innerHTML = "";
      empty.hidden = false;
      empty.innerHTML = "<p>اربط المشروع بـ Supabase لعرض الملفات المحفوظة. التحويل والتنزيل يعملان الآن بدون اتصال.</p>";
      return;
    }
    if (!items.length) {
      grid.innerHTML = "";
      empty.hidden = false;
      empty.innerHTML = library.length
        ? "<p>لا توجد نتائج مطابقة للبحث أو التصفية.</p>"
        : "<p>لا توجد ملفات محفوظة بعد. حوّل ملفًا ثم اضغط «حفظ في Supabase».</p>";
      return;
    }
    empty.hidden = true;

    const labels = { image: "صورة", audio: "صوت", video: "فيديو" };
    grid.innerHTML = items.map((it) => {
      const url = signed.get(it.converted_path) || "";
      const date = new Date(it.created_at).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" });
      return `
        <article class="card" data-id="${it.id}">
          <div class="card-media">${mediaElement(it.category, escapeHtml(url))}</div>
          <div class="card-body">
            <div><span class="badge badge--${it.category}">${labels[it.category] || it.category}</span></div>
            <div class="card-title">${escapeHtml(it.converted_name)}</div>
            <div class="card-sub">من: ${escapeHtml(it.original_name)}</div>
            <div class="card-sub">${formatBytes(it.original_size)} ← ${formatBytes(it.converted_size)} • ${date}</div>
            <div class="card-actions">
              <button class="btn btn--outline" data-action="download">تنزيل</button>
              ${it.original_path ? `<button class="btn btn--ghost" data-action="download-original">الأصلي</button>` : ""}
              <button class="btn btn--danger" data-action="delete">حذف</button>
            </div>
          </div>
        </article>`;
    }).join("");
  }

  async function downloadFromStorage(path, name, btn) {
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = "…";
    try {
      const { data, error } = await db.storage.from(BUCKET).download(path);
      if (error) throw error;
      downloadBlob(data, name);
    } catch (err) {
      toast("فشل التنزيل: " + (err.message || err), "err");
    } finally {
      btn.disabled = false; btn.textContent = old;
    }
  }

  async function deleteItem(item, btn) {
    if (!confirm(`حذف «${item.converted_name}» نهائيًا؟`)) return;
    btn.disabled = true;
    try {
      const paths = [item.converted_path, item.original_path].filter(Boolean);
      const st = await db.storage.from(BUCKET).remove(paths);
      if (st.error) throw st.error;
      const { error } = await db.from(TABLE).delete().eq("id", item.id);
      if (error) throw error;
      library = library.filter((x) => x.id !== item.id);
      renderLibrary();
      toast("تم الحذف", "ok");
    } catch (err) {
      btn.disabled = false;
      toast("فشل الحذف: " + (err.message || err), "err");
    }
  }

  /* ---------------- ربط الأحداث ---------------- */
  function bindEvents() {
    $$(".tab").forEach((t) => t.addEventListener("click", () => !state.busy && switchCategory(t.dataset.cat)));

    const dz = $("#dropzone");
    const input = $("#fileInput");
    input.addEventListener("change", () => handleFile(input.files[0]));
    dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("is-over"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("is-over"); }));
    dz.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));
    // منع المتصفح من فتح الملف إذا أُسقط خارج المنطقة
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => e.preventDefault());

    $("#optionsForm").addEventListener("change", updateNote);
    $("#logoutBtn").addEventListener("click", async () => {
      $("#logoutBtn").disabled = true;
      await window.SB.client.auth.signOut();
      window.goToLogin();
    });
    $("#clearBtn").addEventListener("click", () => !state.busy && clearFile());
    $("#convertBtn").addEventListener("click", convert);
    $("#downloadBtn").addEventListener("click", () => state.result && downloadBlob(state.result.blob, state.result.name));
    $("#saveBtn").addEventListener("click", saveToSupabase);

    $$(".chip").forEach((c) => c.addEventListener("click", () => {
      filter = c.dataset.filter;
      $$(".chip").forEach((x) => x.classList.toggle("is-active", x === c));
      renderLibrary();
    }));
    $("#searchInput").addEventListener("input", () => renderLibrary());
    $("#refreshBtn").addEventListener("click", () => (db ? loadLibrary().then(() => toast("تم التحديث")) : initSupabase()));

    $("#libraryGrid").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const id = btn.closest(".card").dataset.id;
      const item = library.find((x) => String(x.id) === id);
      if (!item) return;
      if (btn.dataset.action === "download") downloadFromStorage(item.converted_path, item.converted_name, btn);
      if (btn.dataset.action === "download-original") downloadFromStorage(item.original_path, item.original_name, btn);
      if (btn.dataset.action === "delete") deleteItem(item, btn);
    });
  }

  /* ---------------- التشغيل ---------------- */
  bindEvents();
  switchCategory("image");
  initSupabase();
})();
