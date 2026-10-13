-- =========================================================
-- MultiMedia Converter — إعداد قاعدة بيانات Supabase
-- انسخ هذا الملف كاملًا والصقه في: SQL Editor ← New query ← Run
-- يمكن تشغيله أكثر من مرة بأمان.
-- =========================================================

-- 1) جدول بيانات الملفات
create table if not exists public.media_files (
  id                 uuid primary key default gen_random_uuid(),
  category           text not null check (category in ('image', 'audio', 'video')),
  original_name      text not null,
  original_type      text,
  original_size      bigint,
  original_path      text,                -- مسار الملف الأصلي (اختياري)
  converted_name     text not null,
  converted_type     text,
  converted_size     bigint,
  converted_path     text not null,       -- مسار الملف المحوَّل في التخزين
  conversion_options jsonb default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists media_files_created_at_idx on public.media_files (created_at desc);

-- 2) تفعيل الحماية على مستوى الصفوف (RLS) مع سياسات تسمح للمشروع بالقراءة والإضافة والحذف
alter table public.media_files enable row level security;

drop policy if exists "mmc_select" on public.media_files;
drop policy if exists "mmc_insert" on public.media_files;
drop policy if exists "mmc_delete" on public.media_files;

create policy "mmc_select" on public.media_files
  for select to anon, authenticated using (true);

create policy "mmc_insert" on public.media_files
  for insert to anon, authenticated with check (true);

create policy "mmc_delete" on public.media_files
  for delete to anon, authenticated using (true);

-- 3) حاوية التخزين للملفات (عامة للقراءة حتى تظهر المعاينات)
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)   -- 50MB
on conflict (id) do update set public = true, file_size_limit = 52428800;

-- 4) سياسات التخزين: رفع وقراءة وحذف داخل حاوية media فقط
drop policy if exists "mmc_storage_select" on storage.objects;
drop policy if exists "mmc_storage_insert" on storage.objects;
drop policy if exists "mmc_storage_delete" on storage.objects;

create policy "mmc_storage_select" on storage.objects
  for select to anon, authenticated using (bucket_id = 'media');

create policy "mmc_storage_insert" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'media');

create policy "mmc_storage_delete" on storage.objects
  for delete to anon, authenticated using (bucket_id = 'media');

-- ملاحظة أمان: هذه السياسات مفتوحة لأي شخص يملك رابط الموقع،
-- وهي مناسبة لمشروع جامعي أو تجربة محلية. في مشروع حقيقي أضف تسجيل دخول
-- واجعل السياسات تعتمد على auth.uid().
