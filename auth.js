/* =========================================================
   منطق صفحات المصادقة
   الصفحة الحالية تُعرف من <body data-page="...">
   login | signup | forgot | reset
   ========================================================= */
(function () {
  "use strict";
  const { client, error: configError, pageUrl } = window.SB;
  const page = document.body.dataset.page;
  const $ = (s, r = document) => r.querySelector(s);
  const msgBox = $("#authMsg");
  const MIN_PASSWORD = 8;

  /* ---------- أدوات مساعدة ---------- */
  function showMsg(text, type = "err") {
    msgBox.className = `auth-msg auth-msg--${type}`;
    msgBox.textContent = text;
    msgBox.hidden = false;
  }
  function hideMsg() { msgBox.hidden = true; }

  function setBusy(form, busy, label = "جارٍ التنفيذ…") {
    const btn = $('button[type="submit"]', form);
    if (busy) { btn.dataset.label = btn.textContent; btn.textContent = label; }
    else if (btn.dataset.label) btn.textContent = btn.dataset.label;
    btn.disabled = busy;
  }

  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  // ترجمة رسائل Supabase إلى العربية
  const ERRORS = [
    [/invalid login credentials/i, "البريد الإلكتروني أو كلمة المرور غير صحيحة."],
    [/email not confirmed/i, "لم تؤكد بريدك الإلكتروني بعد. افتح رسالة التأكيد في بريدك."],
    [/user already registered|already been registered/i, "هذا البريد مسجّل مسبقًا. سجّل الدخول بدلًا من ذلك."],
    [/password should be at least/i, `كلمة المرور قصيرة. استخدم ${MIN_PASSWORD} أحرف على الأقل.`],
    [/weak|pwned|leaked/i, "كلمة المرور ضعيفة أو معروفة. اختر كلمة أقوى."],
    [/new password should be different/i, "كلمة المرور الجديدة يجب أن تختلف عن القديمة."],
    [/for security purposes.*?(\d+) seconds/i, (m) => `لأسباب أمنية، انتظر ${m[1]} ثانية ثم حاول مجددًا.`],
    [/rate limit|too many/i, "طلبات كثيرة خلال وقت قصير. انتظر قليلًا ثم حاول مجددًا."],
    [/unable to validate email|invalid format|email address .* is invalid/i, "صيغة البريد الإلكتروني غير صحيحة."],
    [/signups not allowed|signup is disabled/i, "إنشاء الحسابات الجديدة متوقف حاليًا."],
    [/failed to fetch|networkerror|network request failed/i, "تعذّر الاتصال بالخادم. تحقّق من الإنترنت."]
  ];
  function translate(err) {
    const text = (err && err.message) || String(err);
    for (const [re, out] of ERRORS) {
      const m = text.match(re);
      if (m) return typeof out === "function" ? out(m) : out;
    }
    return text;
  }

  // زر إظهار/إخفاء كلمة المرور
  document.querySelectorAll(".pw-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.previousElementSibling;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "إخفاء" : "إظهار";
      btn.setAttribute("aria-pressed", String(show));
    });
  });

  // مؤشر قوة كلمة المرور
  const meter = $("#pwMeter");
  const pwInput = $('input[name="password"]');
  if (meter && pwInput) {
    pwInput.addEventListener("input", () => {
      const v = pwInput.value;
      let score = 0;
      if (v.length >= MIN_PASSWORD) score++;
      if (v.length >= 12) score++;
      if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
      if (/\d/.test(v)) score++;
      if (/[^A-Za-z0-9]/.test(v)) score++;
      const levels = ["", "ضعيفة", "ضعيفة", "متوسطة", "جيدة", "قوية"];
      meter.dataset.level = v ? Math.max(1, score) : 0;
      meter.querySelector("span").textContent = v ? `القوة: ${levels[Math.max(1, score)]}` : "";
    });
  }

  function checkNewPassword(password, confirm) {
    if (password.length < MIN_PASSWORD) return `كلمة المرور يجب أن تكون ${MIN_PASSWORD} أحرف على الأقل.`;
    if (password !== confirm) return "كلمتا المرور غير متطابقتين.";
    return null;
  }

  const goHome = () => window.location.replace(pageUrl("index.html"));

  /* ---------- لا يوجد اتصال ---------- */
  if (!client) {
    showMsg(configError);
    document.querySelectorAll('form button[type="submit"]').forEach((b) => (b.disabled = true));
    return;
  }

  // المستخدم المسجّل لا يحتاج صفحتي الدخول والتسجيل
  if (page === "login" || page === "signup") {
    client.auth.getSession().then(({ data }) => { if (data.session) goHome(); });
  }

  /* ---------- تسجيل الدخول ---------- */
  if (page === "login") {
    const form = $("#loginForm");
    const resendBtn = $("#resendBtn");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideMsg(); resendBtn.hidden = true;
      const email = form.email.value.trim().toLowerCase();
      const password = form.password.value;
      if (!isEmail(email)) return showMsg("اكتب بريدًا إلكترونيًا صحيحًا.");
      if (!password) return showMsg("اكتب كلمة المرور.");

      setBusy(form, true, "جارٍ الدخول…");
      const { error } = await client.auth.signInWithPassword({ email, password });
      setBusy(form, false);
      if (error) {
        showMsg(translate(error));
        if (/not confirmed/i.test(error.message)) resendBtn.hidden = false;
        return;
      }
      goHome();
    });

    // إعادة إرسال رسالة التأكيد
    resendBtn.addEventListener("click", async () => {
      const email = form.email.value.trim().toLowerCase();
      resendBtn.disabled = true;
      const { error } = await client.auth.resend({
        type: "signup", email, options: { emailRedirectTo: pageUrl("index.html") }
      });
      resendBtn.disabled = false;
      if (error) return showMsg(translate(error));
      resendBtn.hidden = true;
      showMsg(`أعدنا إرسال رسالة التأكيد إلى ${email}.`, "ok");
    });
  }

  /* ---------- إنشاء حساب ---------- */
  if (page === "signup") {
    const form = $("#signupForm");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideMsg();
      const email = form.email.value.trim().toLowerCase();
      const password = form.password.value;
      if (!isEmail(email)) return showMsg("اكتب بريدًا إلكترونيًا صحيحًا.");
      const problem = checkNewPassword(password, form.confirm.value);
      if (problem) return showMsg(problem);

      setBusy(form, true, "جارٍ إنشاء الحساب…");
      const { data, error } = await client.auth.signUp({
        email, password,
        options: { emailRedirectTo: pageUrl("index.html") }
      });
      setBusy(form, false);
      if (error) return showMsg(translate(error));

      // إذا كان تأكيد البريد معطّلًا في Supabase تُنشأ الجلسة مباشرة
      if (data.session) return goHome();

      // Supabase يُرجع مستخدمًا بلا هويات إذا كان البريد مسجّلًا مسبقًا
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return showMsg("هذا البريد مسجّل مسبقًا. سجّل الدخول، أو استخدم «نسيت كلمة المرور».");
      }

      form.reset();
      if (meter) { meter.dataset.level = 0; meter.querySelector("span").textContent = ""; }
      showMsg(`تم إنشاء الحساب. أرسلنا رابط تأكيد إلى ${email}، افتحه ثم سجّل الدخول.`, "ok");
    });
  }

  /* ---------- نسيت كلمة المرور ---------- */
  if (page === "forgot") {
    const form = $("#forgotForm");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideMsg();
      const email = form.email.value.trim().toLowerCase();
      if (!isEmail(email)) return showMsg("اكتب بريدًا إلكترونيًا صحيحًا.");

      setBusy(form, true, "جارٍ الإرسال…");
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: pageUrl("reset-password.html")
      });
      setBusy(form, false);
      if (error) return showMsg(translate(error));
      // رسالة موحّدة حتى لا نكشف هل البريد مسجّل أم لا
      showMsg(`إذا كان ${email} مسجّلًا لدينا، فستصلك رسالة فيها رابط لتعيين كلمة مرور جديدة. تحقّق من مجلد الرسائل غير المرغوبة أيضًا.`, "ok");
    });
  }

  /* ---------- تعيين كلمة مرور جديدة ---------- */
  if (page === "reset") {
    const form = $("#resetForm");
    const invalid = $("#resetInvalid");

    function showInvalid(text) {
      form.hidden = true;
      invalid.hidden = false;
      if (text) showMsg(text);
    }

    (async () => {
      // رابط منتهي أو مستخدم سابقًا: Supabase يضع الخطأ في الرابط
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const query = new URLSearchParams(window.location.search);
      const errCode = hash.get("error_code") || query.get("error_code");
      if (hash.get("error") || query.get("error")) {
        return showInvalid(errCode === "otp_expired"
          ? "انتهت صلاحية الرابط أو استُخدم من قبل. اطلب رابطًا جديدًا."
          : "الرابط غير صالح. اطلب رابطًا جديدًا.");
      }

      const { data } = await client.auth.getSession();
      if (!data.session) {
        return showInvalid("افتح هذه الصفحة من الرابط الذي وصلك في البريد الإلكتروني.");
      }
      history.replaceState(null, "", window.location.pathname);
      $("#resetEmail").textContent = data.session.user.email;
      form.hidden = false;
    })();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideMsg();
      const password = form.password.value;
      const problem = checkNewPassword(password, form.confirm.value);
      if (problem) return showMsg(problem);

      setBusy(form, true, "جارٍ الحفظ…");
      const { error } = await client.auth.updateUser({ password });
      setBusy(form, false);
      if (error) return showMsg(translate(error));
      form.hidden = true;
      showMsg("تم تغيير كلمة المرور. سننقلك إلى الموقع الآن…", "ok");
      setTimeout(goHome, 1800);
    });
  }
})();
