-- Directory searches calculate a 30-day uptime average for every published server.
-- The existing status_latest_idx finds the snapshots but must visit heap pages to
-- read online for each row. Preserve that index for latest-status lookups while
-- allowing the uptime range aggregate to use an index-only scan where visible.
create index if not exists status_uptime_covering_idx
  on public.server_status_snapshots (server_id, checked_at desc)
  include (online);
