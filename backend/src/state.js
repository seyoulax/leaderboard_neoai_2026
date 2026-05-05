import fs from 'node:fs/promises';
import path from 'node:path';

export async function readCompetitionState(competitionDir) {
  const file = path.join(competitionDir, 'state.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      currentParticipantId: typeof parsed?.currentParticipantId === 'string'
        ? parsed.currentParticipantId
        : null,
      cycleBoardSlug: typeof parsed?.cycleBoardSlug === 'string'
        ? parsed.cycleBoardSlug
        : null,
      cardBoardSlug: typeof parsed?.cardBoardSlug === 'string'
        ? parsed.cardBoardSlug
        : null,
    };
  } catch (e) {
    if (e.code === 'ENOENT') return { currentParticipantId: null, cycleBoardSlug: null, cardBoardSlug: null };
    throw e;
  }
}

export async function writeCompetitionState(competitionDir, state) {
  await fs.mkdir(competitionDir, { recursive: true });
  const file = path.join(competitionDir, 'state.json');
  const body = JSON.stringify({
    currentParticipantId: state.currentParticipantId ?? null,
    cycleBoardSlug: state.cycleBoardSlug ?? null,
    cardBoardSlug: state.cardBoardSlug ?? null,
  }, null, 2) + '\n';
  await fs.writeFile(file, body, 'utf8');
}
