import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const MAX_LOG_BYTES = 8192;

export function runGrader({ graderPath, gtPath, subPath, timeoutMs, pythonBin = process.env.PYTHON_BIN || 'python3' }) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(pythonBin, [graderPath, subPath, gtPath], {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      const durationMs = Math.round(performance.now() - start);
      reject({ error: err.message, log: stderr.slice(-MAX_LOG_BYTES), durationMs });
    });
    child.on('close', (code, signal) => {
      const durationMs = Math.round(performance.now() - start);
      const log = (`${stderr}\n--- STDOUT ---\n${stdout}`).slice(-MAX_LOG_BYTES);
      if (signal === 'SIGTERM') {
        return reject({ error: `timeout after ${timeoutMs}ms`, log, durationMs });
      }
      if (code !== 0) {
        return reject({ error: `grader exit code ${code}`, log, durationMs });
      }
      const lastNonEmpty = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || '';
      const score = Number(lastNonEmpty);
      if (!Number.isFinite(score)) {
        return reject({
          error: `invalid score from grader: ${JSON.stringify(lastNonEmpty.slice(0, 200))}`,
          log, durationMs,
        });
      }
      resolve({ rawScore: score, log, durationMs });
    });
  });
}
