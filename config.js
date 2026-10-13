/* =========================================================
   إعدادات المشروع — عدّل هذا الملف فقط
   ---------------------------------------------------------
   1) افتح مشروعك في Supabase
   2) اذهب إلى: Project Settings ← API (أو Data API / API Keys)
   3) انسخ Project URL وضعه في SUPABASE_URL
   4) انسخ مفتاح anon public (أو Publishable key) وضعه في SUPABASE_ANON_KEY
   ⚠️ لا تضع أبدًا مفتاح service_role هنا، فهو سري.
   ========================================================= */

window.APP_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-ID.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-KEY",

  // لا تغيّر هذه القيم إلا إذا غيّرتها في ملف setup.sql
  BUCKET: "media",        // اسم حاوية التخزين (Storage bucket)
  TABLE: "media_files",   // اسم جدول قاعدة البيانات
  MAX_FILE_MB: 50         // الحد الأقصى لحجم الملف في الخطة المجانية
};
