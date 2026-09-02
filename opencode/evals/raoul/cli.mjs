#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { applyPhase, gitDiff, loadFixture, prepareFixture, runTests } from './fixtures.mjs';
import { buildInvalidDiagnostic, extractAssistant, extractJsonEvents, parseReview } from './parser.mjs';
import { aggregateConvergence, aggregateQuality, aggregateRuns } from './metrics.mjs';

const CASES = ['clean-diff', 'seeded-contract-bug', 'suspicious-valid', 'convergence'];

export function parseArgs(argv) {
  const options = { mode: 'deterministic', case: 'all', agent: 'codex', repeat: 1 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') { options.help = true; continue; }
    if (!['--mode', '--case', '--agent', '--model', '--variant', '--repeat'].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[++index];
    if (value === undefined) throw new Error(`Missing value for ${argument}`);
    options[argument.slice(2)] = argument === '--repeat' ? Number(value) : value;
  }
  if (!['deterministic', 'live'].includes(options.mode)) throw new Error('mode must be deterministic or live');
  if (!Number.isInteger(options.repeat) || options.repeat < 1) throw new Error('repeat must be a positive integer');
  if (!['codex', 'claude'].includes(options.agent)) throw new Error('agent must be a visible primary (codex or claude)');
  if (options.case !== 'all' && !CASES.includes(options.case)) throw new Error(`unknown case: ${options.case}`);
  options.command = 'review';
  return options;
}

function usage() {
  return 'Usage: node evals/raoul/cli.mjs [--mode deterministic|live] [--case ID|all] '
    + '[--agent codex|claude] [--model PROVIDER/MODEL] [--variant NAME] [--repeat N]';
}

function reviewPrompt(manifest, phase) {
  return `PROFILE: raoul\nReview the current Git diff for ${manifest.id}, phase ${phase}. `
    + 'Return exactly one JSON object and no markdown with schemaVersion 1, caseId, '
    + 'phase, reviewStatus, findings. Each finding needs unique id, status '
    + '(confirmed|hypothesis|risk|resolved|unchanged|invalid|abstained), severity '
    + '(critical|high|medium|low|info), file, optional positive line or symbol, '
    + 'summary, contract, evidence, impact, correctionDirection. Use normal Raoul semantics.';
}

function terminate(child) {
  if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
}

export function classifyProcessFailure(exitCode, stdout, stderr) {
  if (!exitCode) return null;
  if (/ENOENT|spawn .* not found/i.test(stderr)) return 'process_failure';
  if (/(quota|rate limit|authentication|unauthorized|provider|model .* unavailable|billing)/i.test(`${stdout}\n${stderr}`)) return 'provider_failure';
  const events = extractJsonEvents(stdout);
  if (events.some((event) => event.type === 'error' || /provider|quota|auth|model/i.test(JSON.stringify(event.error ?? '')))) return 'provider_failure';
  return 'process_failure';
}

export function classifySpawnError(error) {
  return error?.code === 'ENOENT' ? 'process_failure' : 'process_failure';
}

export async function pairRepeatSessions(repeat, runner) {
  const broken = [];
  const fixed = [];
  for (let index = 0; index < repeat; index += 1) {
    broken.push(await runner('broken', index, null));
  }
  for (let index = 0; index < repeat; index += 1) {
    const sessionId = broken[index].sessionId;
    fixed.push(sessionId
      ? await runner('fixed', index, sessionId)
      : { infrastructure: 'convergence_unavailable' });
  }
  return { broken, fixed };
}

export function runLive(fixture, manifest, phase, options, sessionId = null) {
  const command = ['run', '--pure', '--dir', fixture.temp, '--agent', options.agent,
    '--command', 'review', '--format', 'json'];
  if (sessionId) command.push('--session', sessionId);
  if (options.model) command.push('--model', options.model);
  if (options.variant) command.push('--variant', options.variant);
  command.push(reviewPrompt(manifest, phase));
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn('opencode', command, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let stderr = ''; let settled = false;
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolve({
      ...result, stderr: stderr.slice(0, 8192), requested: { agent: options.agent, model: options.model ?? null, variant: options.variant ?? null },
      durationMs: Date.now() - started,
    }); };
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8192); });
    const timer = setTimeout(() => { terminate(child); finish({ infrastructure: 'timeout' }); }, 120000);
    child.on('error', (error) => finish({ infrastructure: classifySpawnError(error) }));
    child.on('close', (code) => {
      if (code !== 0) { finish({ infrastructure: classifyProcessFailure(code, output, stderr) }); return; }
      const parsed = extractAssistant(extractJsonEvents(output));
      const review = parseReview(parsed.text, { caseId: manifest.id, phase });
      finish(review.ok ? { review: review.value, sessionId: parsed.sessionId, metadata: parsed.metadata }
        : { infrastructure: 'invalid_output', metadata: parsed.metadata,
          diagnostic: buildInvalidDiagnostic({ events: extractJsonEvents(output),
            assistantText: parsed.text, reason: review.reason, sessionId: parsed.sessionId }) });
    });
  });
}

function deterministicReview(manifest, phase) {
  const expected = manifest.expected?.[phase];
  const convergenceResolved = manifest.id === 'convergence' && phase === 'fixed';
  const prior = manifest.expected?.broken;
  const findings = (expected || convergenceResolved) ? [{ id: `${manifest.id}-expected`,
    status: convergenceResolved ? 'resolved' : 'confirmed', severity: 'medium',
    file: (expected ?? prior).file, line: (expected ?? prior).line, symbol: (expected ?? prior).symbol, summary: 'Deterministic oracle defect',
    contract: manifest.contract, evidence: phase === 'fixed'
      ? 'The standard-library test passes after the fix.'
      : 'The standard-library test fails on the changed state.',
    impact: 'The documented contract is violated.', correctionDirection: 'Restore the contract.' }] : [];
  return { review: { schemaVersion: 1, caseId: manifest.id, phase,
    reviewStatus: findings.length ? 'findings' : 'clean', findings }, durationMs: null };
}

async function runCase(caseId, options) {
  const manifest = await loadFixture(caseId);
  const fixture = await prepareFixture(caseId);
  const phaseResults = [];
  const sessionIds = Array(options.repeat).fill(null);
  try {
    for (const phase of manifest.phases ?? ['changed']) {
      await applyPhase(fixture, phase);
      const test = await runTests(fixture);
      const diff = await gitDiff(fixture);
      const expected = manifest.expected?.[phase];
      const changedFiles = manifest.changedFiles?.[phase] ?? manifest.changedFiles ?? [];
      const diffValid = diff.trim() && changedFiles.every((file) => diff.includes(file));
      const oracleValid = expected ? !test.passed : test.passed;
      const runs = [];
      for (let repeat = 0; repeat < options.repeat; repeat += 1) {
        let result;
        if (!diffValid) result = { infrastructure: 'fixture_failure' };
        else if (!oracleValid) result = { infrastructure: 'test_oracle_failure' };
        else if (options.mode === 'live' && caseId === 'convergence' && phase === 'fixed' && !sessionIds[repeat]) {
          result = { infrastructure: 'convergence_unavailable' };
        } else if (options.mode === 'live') result = await runLive(fixture, manifest, phase, options, sessionIds[repeat]);
        else result = deterministicReview(manifest, phase);
        if (result.sessionId) sessionIds[repeat] = result.sessionId;
        result.requested ??= { agent: options.agent, model: options.model ?? null, variant: options.variant ?? null };
        result.metadata ??= { tokens: null, cost: null };
        runs.push(result);
      }
      const aggregate = aggregateRuns(runs);
      const representative = runs.find((run) => run.review) ?? runs.at(-1);
      const metrics = aggregateQuality(runs, expected, caseId);
      phaseResults.push({ caseId, phase, ...representative, runs, metrics,
        perRunMetrics: metrics.runs,
        infrastructureCounts: aggregate.infrastructureCounts,
        pairwiseStability: aggregate.pairwiseStability,
        fixture: { testPassed: test.passed, diffNonEmpty: Boolean(diff.trim()), changedFiles }, });
    }
    if (caseId === 'convergence' && phaseResults.length > 1) {
      const pairs = phaseResults[0].runs.map((run, index) => ({
        broken: run.review?.findings ?? [],
        fixed: phaseResults[1].runs[index]?.review?.findings ?? [],
      }));
      phaseResults[1].convergence = aggregateConvergence(pairs);
    }
    return phaseResults;
  } finally { await fixture.cleanup(); }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { console.log(usage()); return; }
  const cases = options.case === 'all' ? CASES : [options.case];
  for (const caseId of cases) for (const result of await runCase(caseId, options)) console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 2; });
