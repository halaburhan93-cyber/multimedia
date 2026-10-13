/* =========================================================
   عميل Supabase المشترك بين كل الصفحات
   يُنشأ مرة واحدة ويُستخدم في: الحارس، صفحات الدخول، والتطبيق
   ========================================================= */
(function () {
  "use strict";
  const CFG = window.APP_CONFIG || {};
  const configured = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY &&
    !CFG.SUPABASE_URL.includes("YOUR-") && !CFG.SUPABASE_ANON_KEY.includes("YOUR-"));

  let client = null;
  let error = null;

  if (!configured) {
    error = "لم تُضَف مفاتيح Supabase بعد. افتح الملف js/config.js وضع الرابط والمفتاح.";
  } else if (!window.supabase || !window.supabase.createClient) {
    error = "تعذّر تحميل مكتبة Supabase. تحقّق من اتصالك بالإنترنت ثم أعد تحميل الصفحة.";
  } else {
    client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,      // يبقى المستخدم مسجّلًا بعد إغلاق المتصفح
        autoRefreshToken: true,    // تجديد الجلسة تلقائيًا
        detectSessionInUrl: true,  // قراءة الجلسة من روابط البريد (تأكيد / استعادة)
        flowType: "implicit"       // يجعل روابط البريد تعمل حتى لو فُتحت من جهاز آخر
      }
    });
  }

  window.SB = {
    client,
    configured,
    error,
    // يبني رابطًا كاملًا لصفحة داخل نفس المجلد (يعمل محليًا وعلى GitHub Pages)
    pageUrl: (page) => new URL(page, window.location.href).href.split("#")[0]
  };
})();
