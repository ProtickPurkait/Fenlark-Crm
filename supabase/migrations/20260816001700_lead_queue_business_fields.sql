-- ============================================================================
-- Trace · 1700 — lead_queue was missing business_type/address
-- ============================================================================
-- lead_queue is `select l.*, ... from public.leads l`. Postgres expands `l.*`
-- into a fixed column list at CREATE/CREATE OR REPLACE time — it does not
-- track the underlying table afterwards. This view was last (re)created by
-- migration 1000, before migration 1400 added leads.business_type and
-- leads.address. Every row leads itself has always carried the data (an
-- import writes it straight to the table, unaffected), but the view a
-- telecaller actually queries has been silently omitting both columns since
-- 1400 shipped — category and address existed in the database the whole
-- time, they just never reached the caller queue or the disposition drawer.
--
-- No column list changed here versus migration 1000's version — this is the
-- same view, re-run now that business_type/address are part of `leads`, so
-- `l.*` picks them up. If leads ever gains another column in the future, this
-- view will need re-running again for the same reason; that is the actual
-- lesson, not anything specific to these two columns.
--
-- Plain `create or replace view` cannot do this rebuild: business_type and
-- address land in the middle of the output column list (wherever `l.*`
-- expands them, ahead of follow_up_bucket/queue_rank/sla_hours_remaining),
-- and Postgres only allows CREATE OR REPLACE to append new columns at the
-- very end, not insert them earlier — it rejects this with "cannot change
-- name of view column ... to business_type". Drop and recreate instead; nothing
-- else in the schema depends on this view (grep confirms only this file and
-- migrations 0700/1000 ever reference lead_queue), so there is nothing for
-- the drop to cascade into.
drop view if exists public.lead_queue;

create view public.lead_queue
with (security_invoker = true) as
select
  l.*,
  case
    when l.status in ('converted', 'dead')            then 'closed'
    when l.scheduled_at is null                       then 'unscheduled'
    when l.scheduled_at <  now()                      then 'overdue'
    when l.scheduled_at <  now() + interval '2 hours' then 'due_soon'
    when l.scheduled_at <  now() + interval '24 hours' then 'due_today'
    else 'scheduled'
  end as follow_up_bucket,
  case
    when l.status in ('converted', 'dead')            then 90
    when l.scheduled_at <  now()                      then 10
    when l.scheduled_at <  now() + interval '2 hours' then 20
    when l.scheduled_at <  now() + interval '24 hours' then 30
    when l.status = 'new'                             then 40
    when l.scheduled_at is not null                   then 50
    else 60
  end as queue_rank,
  case
    when l.status = 'new' and l.assigned_at is not null then
      greatest(
        0,
        public.sla_hours()
        - (extract(epoch from (now() - l.assigned_at)) / 3600)
      )
    else null
  end as sla_hours_remaining
from public.leads l
where l.deleted_at is null;

revoke all on public.lead_queue from anon, authenticated;
grant select on public.lead_queue to authenticated;

comment on view public.lead_queue is
  'Order by queue_rank, scheduled_at nulls last. Overdue and Due Soon rise to '
  'the top of the telecaller queue automatically. Re-run this view (not just '
  'alter leads) any time a column is added to leads — see migration 1700.';
