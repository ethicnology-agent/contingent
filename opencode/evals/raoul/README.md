# Raoul evaluation harness

This Node ESM, built-ins-only harness uses deterministic mode to validate the
fixtures, Git-diff setup, parser, oracle, and descriptive metrics; it does not
measure model quality. Live mode invokes OpenCode 1.18.26 through visible
`codex` or `claude` and the normal `review` command; that primary delegates to
the provider-affine Raoul analyst. `--model` and `--variant` override the
primary, while hidden analyst/worker names are rejected. Restart OpenCode after
prompt changes so agent definitions reload.

```sh
npm run eval:raoul
npm run eval:raoul -- --case seeded-contract-bug
npm run eval:raoul:live -- --agent codex --repeat 2
npm run eval:raoul:live -- --agent claude --model provider/model
npm run test:evals
```

Live runs may incur cost and network use; no quality threshold is imposed. Temp
repositories are `/tmp/opencode/raoul-evals-*`; transcripts/results remain
outside this repository. Metrics cover TP/FN, precision/recall (null when the
denominator is zero), clean and suspicious-valid findings, abstention versus
empty reviews, hypotheses/risks, repeated finding-set agreement, convergence,
and separate invalid-output, timeout, process/provider, fixture, oracle, and
convergence-unavailable infrastructure counters. Do not claim live quality
success unless a live run was actually performed.
