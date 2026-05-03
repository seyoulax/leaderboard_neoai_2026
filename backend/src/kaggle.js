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

export async function fetchCompetitionLeaderboard({ competition, kaggleCmd }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `neoai-lb-public-${competition}-`));

  try {
    try {
      await execFileAsync(
        kaggleCmd,
        ['competitions', 'leaderboard', '-c', competition, '-d', '-p', tempDir, '-q'],
        { env: process.env, maxBuffer: 1024 * 1024 * 10 }
      );
    } catch (err) {
      const out = `${err?.stdout || ''}\n${err?.stderr || ''}`;
      const is429 = /\b429\b|Too Many Requests/i.test(out);
      const meaningful = out
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l && !/^Warning:/i.test(l));
      const tag = is429 ? '429 rate-limited' : (meaningful || 'kaggle CLI failed');
      const e = new Error(`${competition}: ${tag}`);
      e.cause = err;
      throw e;
    }

    const csvRaw = await readLeaderboardTextFromCliArchive(tempDir);
    return parseLeaderboardRows(csvRaw);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
