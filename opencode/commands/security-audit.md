---
description: Audit security vulnerabilities, then apply and verify targeted fixes with Kimi K3.
agent: kimi
model: prem-router/kimi-k3
variant: high
---

Audit the security of $ARGUMENTS. If no target is provided, audit the active
project.

Work in two explicit phases. Complete the audit before editing anything.

For each finding, report `file:line`, category, severity, exploitability in
this project's actual context, and concrete evidence. Separate confirmed
vulnerabilities from hypotheses that still need verification. Prioritize by
real impact rather than generic CVE severity.

Then fix confirmed vulnerabilities from highest to lowest severity. Keep each
change minimal and avoid unrelated refactors. Add or run the narrowest test
that demonstrates the vulnerability is fixed. Do not claim success without
executed evidence, and do not commit or push unless the user explicitly asks.

Finish with confirmed findings, fixes applied, verification results, and open
risks with the reason each remains open.
