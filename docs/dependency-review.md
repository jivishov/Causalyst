# Dependency review, 22 September 2026

The reviewed lockfile had advisories, but an audit severity is not evidence of a reachable exploit in this deployment. The original review identified two applicability limits: the critical Vitest finding required exposed UI/API or particular Windows UI/Browser Mode conditions, while CI uses `vitest run` on Linux; GHSA-2w69-qvjg-hvjx excluded this application's declarative `BrowserRouter` mode. Neither observation cleared the other reported advisories.

This release updates Vitest to 4.1.11, Vite to 6.4.3, React Router DOM to 7.18.4 and Wrangler to 4.136.1, including the separate deployment-workflow Wrangler pin. React and React DOM use matching 19.2.6 versions, avoiding a mismatched peer resolution. The lockfile includes the transitive fixes. `npm audit --audit-level=moderate` reports zero known vulnerabilities for the resulting dependency tree at validation time.

Validation covers Node 22 installation, TypeScript, the existing unit suite, a production frontend build, a Wrangler dry run and Chromium journeys. The frontend stays on declarative routing. Browser tests do not expose a Vitest UI/API server. Development tools should remain bound to a trusted development environment.

`Validate / checks` runs dependency auditing and repository/distribution secret checks on every PR. These checks complement review; they are not proof that no vulnerability or secret exists. Recheck new advisories against the installed version, reachable path and deployment mode, then update the package and any independent workflow pin together.
