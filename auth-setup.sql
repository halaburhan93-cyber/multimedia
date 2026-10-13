-- =========================================================
-- MultiMedia Converter — المرحلة الثانية: المصادقة وخصوصية الملفات
-- شغّل هذا الملف بعد setup.sql (في SQL Editor ← New query ← Run)
-- يمكن تشغيله أكثر من مرة بأمان.
-- النتيجة: كل مستخدم يرى ويرفع ويحذف ملفاته فقط.
-- =========================================================

-- 1) ربط كل صف بصاحبه
alter table public.media_files
  add column if not exists user_id uuid references auth.users (id) on delete cascade
  default auth.uid();

create index if not exists media_files_user_id_idx on public.media_files (user_id);

-- الملفات التي حُفظت قبل إضافة الحسابات ليس لها صاحب ولن تظهر لأحد.
-- لحذف بياناتها أزل علامتي -- من السطر التالي:
-- delete from public.media_files where user_id is null;

-- 2) إزالة السياسات القديمة المفتوحة للجميع
drop policy if exists "mmc_select" on public.media_files;
drop policy if exists "mmc_insert" on public.media_files;
drop policy if exists "mmc_delete" on public.media_files;
drop policy if exists "own_rows_select" on public.media_files;
drop policy if exists "own_rows_insert" on public.media_files;
drop policy if exists "own_rows_delete" on public.media_files;

alter table public.media_files enable row level security;

-- 3) سياسات جديدة: المستخدم المسجّل يتعامل مع صفوفه فقط
create policy "own_rows_select" on public.media_files
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "own_rows_insert" on public.media_files
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "own_rows_delete" on public.media_files
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- 4) جعل حاوية التخزين خاصة (المعاينة تتم بروابط موقّعة مؤقتة)
update storage.buckets set public = false where id = 'media';

-- 5) سياسات التخزين: كل مستخدم داخل مجلد يحمل رقمه فقط
--    مثال على المسار: 6f1c…-uuid/image/1700000000-photo.png
drop policy if exists "mmc_storage_select" on storage.objects;
drop policy if exists "mmc_storage_insert" on storage.objects;
drop policy if exists "mmc_storage_delete" on storage.objects;
drop policy if exists "own_files_select" on storage.objects;
drop policy if exists "own_files_insert" on storage.objects;
drop policy if exists "own_files_delete" on storage.objects;

create policy "own_files_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "own_files_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "own_files_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
