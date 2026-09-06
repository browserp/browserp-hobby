-- Submission drafts must be read through the guarded owner/staff functions.
-- A JWT can outlive a revoked session; the old owner SELECT policy checked only
-- auth.uid(). Keep service access for the API after its current-session guard.
revoke select on table public.server_submissions from public, anon, authenticated;

notify pgrst, 'reload schema';
