# Teacher AI settings

Open **Teacher workspace → AI settings**. The existing shared server key remains
the default; students never enter a provider key. Blank password fields preserve
saved keys. A teacher can enter a replacement OpenAI, Kimi/Moonshot, or Z.AI key,
test text inference with synthetic content, and save it without a code deployment.
The test does not establish image, file, transcription, or Realtime permissions.

Teachers can add, edit, and remove models in the OpenAI, Kimi/Moonshot, and Z.AI
provider lists. Each model has an exact provider ID, display name, and capability.
Assessment roles use dropdowns containing compatible models from these lists.
OpenAI serves text assessment roles, transcription, images, and live voice;
Kimi and Z.AI serve simulation code through their existing adapters. Assign a
replacement before removing a model used by an assessment role or the default.
Removed or disabled assignment choices resolve to the current enabled default
for new attempts. Existing attempts retain their captured list and configuration.

Teachers can edit reasoning settings and output token limits, enable or
disable simulation options, select a default, and apply the default to every new
simulation attempt. Otherwise the assignment's enabled model is used. A disabled
assignment choice resolves to the teacher's enabled default. Model IDs must be
available to the selected provider account and support the requested capability.
The current Sol provider ID is `gpt-6.1-sol`, with `low`, `medium`, `high`, `xhigh`,
and `max` reasoning efforts. Max remains the app default. Terra and Luna remain
available, preserving the existing tiered roles. OpenAI's numeric limit is
`max_output_tokens`: it caps reasoning and answer tokens together, not reasoning
alone. Teachers may enter whole-number limits from 16 to 128,000; a lower limit
can stop a response before any visible answer. Blank limits restore app defaults.
Kimi/Z.AI continue to use provider default reasoning. Transcription, image, and
Realtime roles do not use text reasoning or output token controls.

Saving settings freezes the prior configuration of existing attempts in the same
database transaction. New AI operations also capture their configuration before
contacting a provider. This preserves account ownership of uploaded provider files,
background responses, and live voice calls during a teacher key/model change.
Settings apply to new attempts; revoking an old key externally can still interrupt
an existing attempt that uses it. Credentials are not validated automatically by
saving: use **Test key and text model** before a classroom switch.

Provider keys are encrypted with AES-256-GCM, a random IV, and authenticated
teacher/provider context. HKDF derives an encryption key from the backend-only
PIN pepper using a distinct context from PIN and artifact-token signatures.
Rotating the pepper requires migrating encrypted provider credentials and attempt
snapshots; do not rotate it as a provider-key operation. No provider credential or
encrypted envelope is returned by the teacher API. Only configured/source status
is returned. Keys are held transiently in the password input and cleared after a
successful save; they are not saved in browser storage.

Both configuration tables are in the non-exposed `private` schema, with RLS and
no browser grants. Their RPCs use SECURITY INVOKER and are executable only by
`service_role`. Worker routes additionally verify a signed-in teacher's database
profile. Immutable attempt snapshots have no UPDATE grant for `service_role`.
Concurrent teacher edits require the current saved timestamp, rejecting stale
writes. Realtime sideband and retention cleanup use the same attempt credentials.

For operators, the shared fallback remains the Cloudflare Worker secret
`OPENAI_API_KEY`, populated from the matching GitHub repository secret on deploy.
If an operator replaces the Cloudflare secret directly, update its GitHub secret
too before the next deployment so the release workflow does not restore an old
value. Do not place provider keys in `VITE_*`, source, chat, or student accounts.

# Pasted student CSV

Open **Courses & roster → Import & manage roster** for the selected course. Paste:

```csv
display_name,email
Alex Rivera,alex@example.org
Sam Lee,sam@example.org
```

One row or multiple rows use the same parser, validation, ownership checks, and
transactional roster import as a file. Optional columns are `student_identifier`
and `section`. Quote names containing commas. **Preview import** validates entries;
**Add students** saves them and returns one-time PINs. Existing student records and
claimed accounts are not modified; duplicates are rejected with row errors.
