-- Development seed. Use worker PIN_PEPPER=dev-pepper and PIN 2468.
-- Replace demo.student@example.com with the Google account used for local student testing if needed.
insert into classes (id, code, name)
values ('11111111-1111-1111-1111-111111111111', 'CHEM101', 'Chemistry Nomenclature')
on conflict (id) do update set code = excluded.code, name = excluded.name;

insert into roster_students (id, class_id, display_name, student_identifier, email, section)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  'Demo Student',
  'DEMO-001',
  'demo.student@example.com',
  'Demo'
)
on conflict (id) do update
set display_name = excluded.display_name,
    student_identifier = excluded.student_identifier,
    email = excluded.email,
    section = excluded.section,
    updated_at = now();

insert into student_access_codes (id, class_id, roster_student_id, student_label, pin_hash)
values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Demo Student',
  encode(hmac(convert_to('2468', 'utf8'), convert_to('dev-pepper', 'utf8'), 'sha256'), 'hex')
)
on conflict (class_id, pin_hash) do update
set student_label = excluded.student_label,
    roster_student_id = excluded.roster_student_id;

insert into assessments (id, type, title, prompt, expected_answer, rubric, config)
values
(
  '33333333-3333-3333-3333-333333333331',
  'voice',
  'Name the Compound',
  'Read the formula aloud: NaCl',
  'sodium chloride',
  '[{"name":"Nomenclature accuracy","maxPoints":6,"description":"Names the compound correctly."},{"name":"Pronunciation clarity","maxPoints":4,"description":"Speaks clearly enough to verify the term."}]'::jsonb,
  '{"maxRecordingSec":30}'::jsonb
),
(
  '33333333-3333-3333-3333-333333333332',
  'writing',
  'Show the Algebra',
  'Solve 2x + 3 = 11. Upload a photo or PDF of your written work.',
  null,
  '[{"name":"Setup","maxPoints":3,"description":"Writes a correct equation setup."},{"name":"Procedure","maxPoints":4,"description":"Shows valid algebraic steps."},{"name":"Answer","maxPoints":3,"description":"Finds x = 4 and labels the result."}]'::jsonb,
  '{"acceptedMime":["image/png","image/jpeg","application/pdf"],"maxBytes":10485760}'::jsonb
),
(
  '33333333-3333-3333-3333-333333333333',
  'simulation',
  'Immune Response Simulation',
  'Describe what happens when a virus invades the body and the immune system responds.',
  null,
  '[{"name":"Process detail","maxPoints":5,"description":"Includes clear entities and steps."},{"name":"Causal relationships","maxPoints":3,"description":"Describes interactions between parts."},{"name":"Simulation clarity","maxPoints":2,"description":"Gives enough information to render the stated process."}]'::jsonb,
  '{"minDescriptionChars":40}'::jsonb
)
on conflict (id) do update
set title = excluded.title,
    prompt = excluded.prompt,
    expected_answer = excluded.expected_answer,
    rubric = excluded.rubric,
    config = excluded.config;

insert into assessment_assignments (assessment_id, class_id)
values
  ('33333333-3333-3333-3333-333333333331', '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333332', '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111')
on conflict (assessment_id, class_id) where archived_at is null do nothing;
