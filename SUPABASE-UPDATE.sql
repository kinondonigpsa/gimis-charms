-- =====================================================================================
-- SUPABASE-UPDATE.sql  (Gimis Charms - auto-update)   - endesha MARA MOJA tu.
-- Supabase Dashboard > SQL Editor > New query > bandika yote > Run.  Ni salama kuiendesha tena.
--
-- Inaruhusu app (APK/EXE) kusoma TAARIFA ya toleo jipya (safu zenye id "app-android" / "app-windows" kwenye gpsa_release),
-- hata kabla mtu hajaingia kwenye Cloud storage. Safu hizi zina URL za kupakua tu, hakuna siri.
-- Safu nyingine za gpsa_release (meta + faili za extension) zinabaki kwa walioingia tu; kuandika ni kwa owner pekee.
-- =====================================================================================
grant select on public.gpsa_release to anon;
drop policy if exists gpsa_release_app_public on public.gpsa_release;
create policy gpsa_release_app_public on public.gpsa_release for select to anon using (id like 'app-%');
