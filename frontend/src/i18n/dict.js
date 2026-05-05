// Flat dictionary keyed by short identifiers. ru is canonical; en added below.
// Add `{key}` placeholders for interpolation via t(key, { key: value }).

export const dict = {
  // Site header
  'nav.competitions':    { ru: 'Соревнования',     en: 'Competitions' },
  'nav.cabinet':         { ru: 'Кабинет',          en: 'My account' },
  'nav.my_competitions': { ru: 'Мои соревнования', en: 'My competitions' },
  'nav.my_submissions':  { ru: 'Мои сабмиты',      en: 'My submissions' },

  // User menu
  'user.login':    { ru: 'Войти',           en: 'Sign in' },
  'user.register': { ru: 'Регистрация',     en: 'Sign up' },
  'user.logout':   { ru: 'Выйти',           en: 'Sign out' },
  'user.cabinet':  { ru: 'Личный кабинет',  en: 'My account' },
  'user.admin':    { ru: 'Админка',         en: 'Admin' },

  // Footer
  'footer.made_by': { ru: 'Сделано', en: 'Built by' },

  // Common
  'common.save':       { ru: 'Сохранить',     en: 'Save' },
  'common.saving':     { ru: 'Сохранение…',   en: 'Saving…' },
  'common.cancel':     { ru: 'Отмена',        en: 'Cancel' },
  'common.loading':    { ru: 'Загрузка…',     en: 'Loading…' },
  'common.error':      { ru: 'Ошибка',        en: 'Error' },
  'common.empty':      { ru: 'Пусто',         en: 'Empty' },
  'common.confirm':    { ru: 'Подтвердить',   en: 'Confirm' },

  // Cabinet — page titles
  'me.title':                 { ru: 'Личный кабинет',     en: 'My account' },
  'me.title.competitions':    { ru: 'Мои соревнования',   en: 'My competitions' },
  'me.title.submissions':     { ru: 'Мои сабмиты',        en: 'My submissions' },
  'me.empty.competitions':    { ru: 'Вы ни в одном соревновании', en: 'You have not joined any competition yet' },
  'me.empty.submissions':     { ru: 'Сабмитов пока нет',  en: 'No submissions yet' },

  // Cabinet — Profile section
  'profile.title':         { ru: 'Профиль',     en: 'Profile' },
  'profile.email':         { ru: 'Email',       en: 'Email' },
  'profile.display_name':  { ru: 'Имя',         en: 'Name' },
  'profile.kaggle_id':     { ru: 'Kaggle ID',   en: 'Kaggle ID' },
  'profile.saved':         { ru: 'Сохранено',   en: 'Saved' },

  // Cabinet — Password section
  'password.title':              { ru: 'Сменить пароль',           en: 'Change password' },
  'password.current':            { ru: 'Текущий',                  en: 'Current' },
  'password.new':                { ru: 'Новый (≥ 8)',              en: 'New (≥ 8)' },
  'password.confirm':            { ru: 'Подтверждение',            en: 'Confirm' },
  'password.change':             { ru: 'Сменить',                  en: 'Change' },
  'password.changed':            { ru: 'Пароль изменён',           en: 'Password changed' },
  'password.mismatch':           { ru: 'Пароли не совпадают',      en: 'Passwords do not match' },
  'password.too_short':          { ru: 'Новый пароль ≥ 8 символов', en: 'New password must be ≥ 8 characters' },

  // MyCompetitions table
  'mycomp.col.competition': { ru: 'Соревнование', en: 'Competition' },
  'mycomp.col.type':        { ru: 'Тип',          en: 'Type' },
  'mycomp.col.points':      { ru: 'Очки',         en: 'Points' },
  'mycomp.col.place':       { ru: 'Место',        en: 'Place' },
  'mycomp.col.joined':      { ru: 'С',            en: 'Joined' },
  'mycomp.action.leave':    { ru: 'Выйти',        en: 'Leave' },
  'mycomp.confirm.leave':   { ru: 'Выйти из соревнования «{slug}»?', en: 'Leave the competition "{slug}"?' },

  // MySubmissionsCabinet table
  'mysub.col.when':         { ru: 'Когда',     en: 'When' },
  'mysub.col.competition':  { ru: 'Соревнование', en: 'Competition' },
  'mysub.col.task':         { ru: 'Задача',    en: 'Task' },
  'mysub.col.file':         { ru: 'Файл',      en: 'File' },
  'mysub.col.status':       { ru: 'Статус',    en: 'Status' },
  'mysub.col.public':       { ru: 'Public',    en: 'Public' },
  'mysub.col.private':      { ru: 'Private',   en: 'Private' },
  'mysub.col.selected':     { ru: 'Selected',  en: 'Selected' },

  // Join button
  'join.signin_to_join': { ru: 'Войти чтобы участвовать', en: 'Sign in to participate' },
  'join.is_member':      { ru: 'Вы участник',             en: 'You are a participant' },
  'join.join':           { ru: 'Участвовать',             en: 'Join' },

  // Public LB columns / labels
  'lb.col.bonus':         { ru: 'Бонус',         en: 'Bonus' },
  'lb.col.total':         { ru: 'Total points',  en: 'Total points' },
  'lb.col.board_total':   { ru: 'Board points',  en: 'Board points' },
  'lb.col.team':          { ru: 'Team Name',     en: 'Team' },
  'lb.col.nickname':      { ru: 'Nickname',      en: 'Nickname' },
  'lb.col.place':         { ru: '#',             en: '#' },
  'lb.title.overall':     { ru: 'Общий рейтинг', en: 'Overall ranking' },
  'lb.mode.public':       { ru: 'Public',        en: 'Public' },
  'lb.mode.private':      { ru: 'Private',       en: 'Private' },
  'lb.filter.all':        { ru: 'Все',           en: 'All' },
  'lb.filter.ours':       { ru: 'Только наши',   en: 'Ours only' },

  // Auth pages
  'auth.login.title':       { ru: 'Войти',           en: 'Sign in' },
  'auth.register.title':    { ru: 'Регистрация',     en: 'Sign up' },
  'auth.email':             { ru: 'Email',           en: 'Email' },
  'auth.password':          { ru: 'Пароль',          en: 'Password' },
  'auth.display_name':      { ru: 'Имя',             en: 'Display name' },
  'auth.kaggle_id_optional':{ ru: 'Kaggle ID (опц.)', en: 'Kaggle ID (optional)' },
  'auth.submit.login':      { ru: 'Войти',           en: 'Sign in' },
  'auth.submit.register':   { ru: 'Зарегистрироваться', en: 'Create account' },
};
