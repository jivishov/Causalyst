alter table attempt_artifacts
  add column if not exists simulation_html_viewport_width integer;

alter table attempt_artifacts
  add column if not exists simulation_html_viewport_height integer;

alter table attempt_artifacts
  drop constraint if exists attempt_artifacts_simulation_html_viewport_check;

alter table attempt_artifacts
  add constraint attempt_artifacts_simulation_html_viewport_check
  check (
    (
      simulation_html_viewport_width is null
      and simulation_html_viewport_height is null
    )
    or (
      simulation_html_viewport_width is not null
      and simulation_html_viewport_height is not null
      and simulation_html_viewport_width between 320 and 4096
      and simulation_html_viewport_height between 240 and 4096
    )
  );

update attempt_artifacts
set
  simulation_html_viewport_width = 1200,
  simulation_html_viewport_height = 800
where kind = 'simulation-derived'
  and upload_state = 'uploaded'
  and mime_type ilike 'text/html%'
  and simulation_html_viewport_width is null
  and simulation_html_viewport_height is null;
