import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getCompetition } from '../db/competitionsRepo.js';
import {
  joinCompetition,
  leaveCompetition,
  getMembership,
} from '../db/membersRepo.js';

export function createMembershipRouter({ db }) {
  const router = Router({ mergeParams: true });

  router.post('/join', requireAuth, (req, res) => {
    const c = getCompetition(db, req.params.competitionSlug);
    if (!c || c.deletedAt) return res.status(404).json({ error: 'competition not found' });
    const result = joinCompetition(db, c.slug, req.user.id);
    res.json({ joined: true, alreadyMember: result.alreadyMember });
  });

  router.delete('/members/me', requireAuth, (req, res) => {
    const c = getCompetition(db, req.params.competitionSlug);
    if (!c || c.deletedAt) return res.status(404).json({ error: 'competition not found' });
    leaveCompetition(db, c.slug, req.user.id);
    res.json({ left: true });
  });

  router.get('/membership', (req, res) => {
    const c = getCompetition(db, req.params.competitionSlug);
    if (!c || c.deletedAt) return res.status(404).json({ error: 'competition not found' });
    if (!req.user) return res.json({ isMember: false, joinedAt: null });
    const m = getMembership(db, c.slug, req.user.id);
    res.json({ isMember: !!m, joinedAt: m?.joinedAt || null });
  });

  return router;
}
