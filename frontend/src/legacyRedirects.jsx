import { Navigate, useParams } from 'react-router-dom';

const NEOAI = 'neoai-2026';

export const LEGACY_REDIRECTS = [
  { from: '/cycle', to: `/competitions/${NEOAI}/cycle` },
  { from: '/leaderboard', to: `/competitions/${NEOAI}/leaderboard` },
  { from: '/control', to: `/admin/competitions/${NEOAI}/card` },
  { from: '/admin/tasks', to: `/admin/competitions/${NEOAI}/tasks` },
  { from: '/admin/boards', to: `/admin/competitions/${NEOAI}/boards` },
  { from: '/admin/card', to: `/admin/competitions/${NEOAI}/card` },
  { from: '/obs/overall', to: `/obs/competitions/${NEOAI}/overall` },
  { from: '/obs/cycle', to: `/obs/competitions/${NEOAI}/cycle` },
  { from: '/obs/card', to: `/obs/competitions/${NEOAI}/card` },
];

export function LegacyBoardRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/competitions/${NEOAI}/board/${slug}`} replace />;
}

export function LegacyTaskRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/competitions/${NEOAI}/task/${slug}`} replace />;
}

export function LegacyObsBoardRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/obs/competitions/${NEOAI}/board/${slug}`} replace />;
}

export function LegacyObsBoardBarRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/obs/competitions/${NEOAI}/bar/board/${slug}`} replace />;
}

export function LegacyObsTaskRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/obs/competitions/${NEOAI}/task/${slug}`} replace />;
}
