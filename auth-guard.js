/* =========================================================
   حارس المصادقة — يُحمَّل في الصفحة الرئيسية فقط
   - إذا لم يكن الزائر مسجّلًا يُحوَّل فورًا إلى login.html
   - الصفحة تبقى مخفية (class="auth-pending") حتى يتم التحقق
   - يوفّر window.authReady: وعد (Promise) يحمل بيانات المستخدم
   ========================================================= */
(function () {
  "use strict";
  const { client, pageUrl } = window.SB;
  let leaving = false; // يمنع التحويل مرتين في نفس اللحظة
  const toLogin = () => {
    if (leaving) return;
    leaving = true;
    window.location.replace(pageUrl("login.html"));
  };
  window.goToLogin = toLogin;
  const never = () => new Promise(() => {}); // يوقف بقية الكود أثناء التحويل

  window.authReady = (async () => {
    if (!client) { toLogin(); return never(); }

    let session = null;
    try {
      const { data } = await client.auth.getSession();
      session = data.session;
    } catch (e) {
      console.error(e);
    }
    if (!session) { toLogin(); return never(); }

    // إزالة رموز الجلسة من شريط العنوان بعد القدوم من رابط تأكيد البريد
    if (window.location.hash.includes("access_token")) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }

    document.documentElement.classList.remove("auth-pending");

    // إذا خرج المستخدم من تبويب آخر، أو انتهت الجلسة، نعيده لصفحة الدخول
    client.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_OUT" || !s) toLogin();
    });

    return session.user;
  })();
})();
