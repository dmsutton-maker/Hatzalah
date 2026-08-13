-- ============================================================
-- Grants the admin screens need beyond 04_rls.sql.
--
-- 04 grants authenticated `update` on active_ranges only. The settings screen
-- also adds registers and disables leaked ones (BUILD_BRIEF §7, §8), which needs
-- insert/update on stores. Anon is untouched — it still has zero table access.
--
-- Run after 05_override.sql.
-- ============================================================

grant insert, update on stores to authenticated;

-- The settings screen edits the live range in place; inserting a new range row
-- is how a future batch would be added.
grant insert on active_ranges to authenticated;
grant usage, select on sequence active_ranges_id_seq to authenticated;

-- ------------------------------------------------------------
-- Verify (as an authenticated session, not anon):
--   insert into stores (token, name) values ('TEST-TOKEN', 'scratch');  -- ok
--   delete from stores where token = 'TEST-TOKEN';                      -- denied
--
-- Deletes are deliberately NOT granted. A register is disabled, never removed —
-- scan_log rows reference its token.
-- ------------------------------------------------------------
