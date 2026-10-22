-- CallGuide schema. Safe to run again in the same Supabase project.
create extension if not exists pgcrypto;

create table if not exists public.call_stages (
    id uuid primary key default gen_random_uuid(),
    stage_number smallint not null unique check (stage_number between 1 and 8),
    name text not null,
    purpose text not null,
    talk_track text not null,
    response_patterns jsonb not null default '[]'::jsonb,
    outcome_options jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.calls (
    id uuid primary key default gen_random_uuid(),
    prospect_name text,
    company_name text,
    status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
    current_stage smallint not null default 1 check (current_stage between 1 and 8),
    furthest_stage_reached smallint not null default 1 check (furthest_stage_reached between 1 and 8),
    final_outcome text check (final_outcome is null or final_outcome in (
        'meeting_booked', 'callback_agreed', 'information_sent', 'not_interested', 'no_next_step', 'other'
    )),
    next_step text,
    next_step_at timestamptz,
    started_at timestamptz not null default now(),
    ended_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint completed_call_has_outcome check (status <> 'completed' or (final_outcome is not null and ended_at is not null))
);

create table if not exists public.call_stage_results (
    id uuid primary key default gen_random_uuid(),
    call_id uuid not null references public.calls(id) on delete cascade,
    stage_number smallint not null check (stage_number between 1 and 8),
    selected_outcome text,
    prospect_words text not null default '',
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint call_stage_results_one_per_stage unique (call_id, stage_number)
);

create index if not exists calls_started_at_idx on public.calls (started_at desc);
create index if not exists calls_status_idx on public.calls (status);
create index if not exists calls_final_outcome_idx on public.calls (final_outcome);
create index if not exists call_stage_results_call_idx on public.call_stage_results (call_id, stage_number);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists call_stages_set_updated_at on public.call_stages;
create trigger call_stages_set_updated_at before update on public.call_stages
for each row execute function public.set_updated_at();
drop trigger if exists calls_set_updated_at on public.calls;
create trigger calls_set_updated_at before update on public.calls
for each row execute function public.set_updated_at();
drop trigger if exists call_stage_results_set_updated_at on public.call_stage_results;
create trigger call_stage_results_set_updated_at before update on public.call_stage_results
for each row execute function public.set_updated_at();

-- Multi-table state changes are performed atomically through these RPC functions.
create or replace function public.save_call_stage(
    p_call_id uuid,
    p_stage_number smallint,
    p_selected_outcome text,
    p_prospect_words text,
    p_advance_to smallint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_call public.calls%rowtype;
    v_result public.call_stage_results%rowtype;
    v_current_stage smallint;
begin
    if p_stage_number < 1 or p_stage_number > 8 then
        raise exception using errcode = 'P0001', message = 'INVALID_STAGE';
    end if;
    if p_advance_to is not null and (p_advance_to < p_stage_number or p_advance_to > p_stage_number + 1) then
        raise exception using errcode = 'P0001', message = 'INVALID_ADVANCE';
    end if;
    if not exists (select 1 from public.call_stages where stage_number = p_stage_number) then
        raise exception using errcode = 'P0001', message = 'INVALID_STAGE';
    end if;
    if p_selected_outcome is not null and not exists (
        select 1 from public.call_stages
        where stage_number = p_stage_number and outcome_options ? p_selected_outcome
    ) then
        raise exception using errcode = 'P0001', message = 'INVALID_STAGE_OUTCOME';
    end if;

    select * into v_call from public.calls where id = p_call_id for update;
    if not found then
        raise exception using errcode = 'P0001', message = 'CALL_NOT_FOUND';
    end if;
    if v_call.status <> 'in_progress' then
        raise exception using errcode = 'P0001', message = 'CALL_ALREADY_COMPLETED';
    end if;

    v_current_stage := coalesce(p_advance_to, p_stage_number);
    insert into public.call_stage_results (call_id, stage_number, selected_outcome, prospect_words, completed_at)
    values (p_call_id, p_stage_number, p_selected_outcome, p_prospect_words, now())
    on conflict (call_id, stage_number) do update set
        selected_outcome = excluded.selected_outcome,
        prospect_words = excluded.prospect_words,
        completed_at = excluded.completed_at
    returning * into v_result;

    update public.calls set
        current_stage = v_current_stage,
        furthest_stage_reached = greatest(furthest_stage_reached, p_stage_number, v_current_stage)
    where id = p_call_id;

    return to_jsonb(v_result);
end;
$$;

create or replace function public.close_call(
    p_call_id uuid,
    p_final_outcome text,
    p_next_step text default null,
    p_next_step_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_call public.calls%rowtype;
begin
    select * into v_call from public.calls where id = p_call_id for update;
    if not found then
        raise exception using errcode = 'P0001', message = 'CALL_NOT_FOUND';
    end if;
    if v_call.status = 'completed' then
        if v_call.final_outcome = p_final_outcome
            and v_call.next_step is not distinct from p_next_step
            and v_call.next_step_at is not distinct from p_next_step_at then
            return to_jsonb(v_call);
        end if;
        raise exception using errcode = 'P0001', message = 'CALL_ALREADY_COMPLETED';
    end if;
    if p_final_outcome not in ('meeting_booked', 'callback_agreed', 'information_sent', 'not_interested', 'no_next_step', 'other') then
        raise exception using errcode = 'P0001', message = 'INVALID_OUTCOME';
    end if;

    update public.calls set
        status = 'completed',
        final_outcome = p_final_outcome,
        next_step = nullif(btrim(p_next_step), ''),
        next_step_at = p_next_step_at,
        ended_at = now()
    where id = p_call_id
    returning * into v_call;
    return to_jsonb(v_call);
end;
$$;

alter table public.call_stages enable row level security;
alter table public.calls enable row level security;
alter table public.call_stage_results enable row level security;

revoke all on public.call_stages, public.calls, public.call_stage_results from anon, authenticated;
grant select on public.call_stages to service_role;
grant select, insert on public.calls to service_role;
grant select on public.call_stage_results to service_role;
revoke all on function public.save_call_stage(uuid, smallint, text, text, smallint) from public, anon, authenticated;
revoke all on function public.close_call(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.save_call_stage(uuid, smallint, text, text, smallint) to service_role;
grant execute on function public.close_call(uuid, text, text, timestamptz) to service_role;
