import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'csv-parse/sync';
import AdmZip from 'adm-zip';

const execFileAsync = promisify(execFile);

function pickValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      return row[key];
    }
  }
  return null;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseLeaderboardRows(csvRaw) {
  const rows = parse(csvRaw, { columns: true, skip_empty_lines: true, bom: true });

  return rows
    .map((row) => {
      const teamId = pickValue(row, ['teamId', 'TeamId']);
      const teamName = pickValue(row, ['teamName', 'TeamName', 'team_name', 'Team']);
      const teamMemberUserNames = pickValue(row, ['teamMemberUserNames', 'TeamMemberUserNames']);
      const scoreRaw = pickValue(row, ['score', 'Score']);
      const rankRaw = pickValue(row, ['rank', 'Rank']);

      const score = toNumber(scoreRaw);
      const rank = toNumber(rankRaw);
      const nickname = teamMemberUserNames
        ? String(teamMemberUserNames)
            .split(',')[0]
            .trim()
        : null;
      const participantKey = nickname || (teamId ? `team-${teamId}` : String(teamName || 'unknown-team'));

      if (score === null) {
        return null;
      }

      return {
        participantKey,
        nickname,
        teamId: teamId ? String(teamId) : null,
        teamName: teamName ? String(teamName) : null,
        score,
        rank,
      };
    })
    .filter(Boolean);
}

function pickPublicCsvEntry(entries) {
  const csvEntries = entries.filter((entry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.csv'));
  const publicCsv = csvEntries.find((entry) => entry.entryName.toLowerCase().includes('publicleaderboard'));

  if (!publicCsv) {
    throw new Error('Public leaderboard CSV was not found in Kaggle archive');
  }

  return publicCsv;
}

async function readLeaderboardTextFromCliArchive(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);

  const zipName = files.find((f) => f.toLowerCase().endsWith('.zip'));
  if (!zipName) {
    throw new Error(`No ZIP leaderboard file found in ${dir}`);
  }

  const zipPath = path.join(dir, zipName);
  const zip = new AdmZip(zipPath);
  const csvEntry = pickPublicCsvEntry(zip.getEntries());
  return zip.readAsText(csvEntry, 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runKaggleDownload({ competition, kaggleCmd, tempDir }) {
  const maxAttempts = 4;
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await execFileAsync(
        kaggleCmd,
        ['competitions', 'leaderboard', '-c', competition, '-d', '-p', tempDir, '-q'],
        { env: process.env, maxBuffer: 1024 * 1024 * 10 }
      );
      return;
    } catch (err) {
      lastErr = err;
      const out = `${err?.stdout || ''}\n${err?.stderr || ''}`;
      const is429 = /\b429\b|Too Many Requests/i.test(out);
      if (!is429 || attempt === maxAttempts) {
        const tag = is429 ? '429 rate-limited' : (out.split('\n').find((l) => l.trim()) || 'kaggle CLI failed');
        const e = new Error(`${competition}: ${tag.trim()}`);
        e.cause = err;
        throw e;
      }
      const wait = 2000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500);
      console.warn(`[kaggle] ${competition} hit 429, retry ${attempt}/${maxAttempts - 1} in ${wait}ms`);
      await sleep(wait);
    }
  }

  throw lastErr;
}

export async function fetchCompetitionLeaderboard({ competition, kaggleCmd }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `neoai-lb-public-${competition}-`));

  try {
    await runKaggleDownload({ competition, kaggleCmd, tempDir });
    const csvRaw = await readLeaderboardTextFromCliArchive(tempDir);
    return parseLeaderboardRows(csvRaw);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
