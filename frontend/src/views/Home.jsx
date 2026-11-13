import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutines, effectiveRoutineIds, nextTrainingDay, lastBW, setsDoneActive } from '../lib/history.js'
import { streakInfo } from '../lib/streak.js'
import { StreakFlame, StreakMeta, StreakParty } from '../components/Streak.jsx'
import { fmtNum, fmtDate, todayISO, isoOf, weekStartOf, weekDayOffset, DAYS, DAYN } from '../lib/format.js'
import { t, tn, dateLocale } from '../lib/i18n.js'
import { bwSheet, goalSheet, dayOverrideSheet, calendarSheet, startFlow, starterPlanSheet, bwDeltaColor, weighInsSheet } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import CardHead from '../components/CardHead.jsx'
import QueueRow from '../components/QueueRow.jsx'
import MiniBodyMap from '../components/MiniBodyMap.jsx'
import { queueOf, queueView, weekTally, pinState } from '../lib/queue.js'
import { workoutsLeft } from '../lib/week-left.js'
import { WeeklySetsHomeLine } from '../components/WeeklySets.jsx'
import { RecapHomeCard } from '../components/Recap.jsx'
import { scheduleModeOf } from '../lib/rotation.js'
import { useConnectionTrouble } from '../components/SyncBanner.jsx'
import { Button } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf } from '../lib/glyphs.js'
import { dayNoteOf } from '../lib/day-notes.js'
import { weighInAt } from '../lib/bodyweight.js'
import WeightRate from '../components/WeightRate.jsx'
import { programmeChip } from '../lib/programmes.js'
import { SeasonDeco } from '../components/Seasonal.jsx'
import { WrappedHomeCard } from '../components/WrappedEntry.jsx'
import RecoveryHint from '../components/RecoveryHint.jsx'
import { ChallengesCard } from '../components/Challenges.jsx'
import { isOn } from '../lib/modules.js'

export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const trouble = useConnectionTrouble()
  const [weekOffset, setWeekOffset] = useState(0)

  const today = new Date()
  const todayRoutines = effectiveRoutines(S, todayISO())
  const routine = todayRoutines[0] || null
  const todayName = todayRoutines.map(r => r.name).join(' + ')
  const todayOvr = S.dayPlan[todayISO()] !== undefined && pinState(S, S.dayPlan[todayISO()]) !== 'done'
  const editingSaved = !!S.active?.editingWorkoutId
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  const ws = weekStartOf(S)
  const wkStart = new Date(today)
  wkStart.setDate(today.getDate() - weekDayOffset(today.getDay(), ws) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  const loggedToday = S.workouts.filter(w => w.d === todayISO())
  const queueIds = queueOf(S)?.ids || []
  const coveredToday = id => !queueIds.includes(id) && loggedToday.some(w => (Array.isArray(w.routineIds) ? w.routineIds : [w.routineId]).includes(id))
  const doneToday = (todayRoutines.every(r => coveredToday(r.id)) && loggedToday.at(-1)) || null
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(wkStart); d.setDate(wkStart.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineIds(S, iso).length > 0, ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dot = done ? ' done' : dayNoteOf(S, iso) ? ' noted' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '')} {...tappable(() => dayOverrideSheet(iso))}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const wkEnd = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${wkStart.getDate()} ${wkStart.toLocaleDateString(dateLocale(), { month: 'short' })} – ${wkEnd.getDate()} ${wkEnd.toLocaleDateString(dateLocale(), { month: 'short' })}`

  const queue = queueView(S, todayISO())
  const rotating = scheduleModeOf(S) === 'rotation'
  const liveQ = queueOf(S)
  const plannerQueue = !!queue && !liveQ?.rotationId
  const managedQueue = !!liveQ && !!S.rotation && liveQ.rotationId === S.rotation.id
  const next = !S.active && !todayRoutines.length && !(rotating && !plannerQueue) ? nextTrainingDay(S, todayISO()) : null
  const tally = weekTally(S, todayISO())
  const { done: doneThisWeek, planned: plannedPerWeek } = tally
  const left = workoutsLeft(S, todayISO())
  const todayKey = todayISO()
  const streak = useMemo(() => streakInfo(S, todayKey), [S.workouts, S.weekStart, todayKey])
  const on = id => isOn(S, id)
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: weighInAt(b), y: b.w, d: b.d }))

  // --- CORREÇÃO DO CLIQUE ---
  const onToday = () => { 
    if (S.active) {
      nav('/workout');
    } else if (doneToday) {
      nav('/history');
    } else if (todayRoutines.length) {
      startFlow(effectiveRoutineIds(S, todayISO()));
    } else {
      dayOverrideSheet(todayISO());
    }
  }

  const progChip = programmeChip(S)
  const onQueueStart = id => { if (S.active) nav('/workout'); else startFlow([id]) }

  // --- LÓGICA DA IMAGEM DO CARD ---
  const heroImageName = doneToday ? 'descanso' : todayName;
  const heroImageCustom = doneToday ? null : routine?.image;

  const getHeroImage = (name, customImage) => {
    if (customImage) return `url(${customImage})`;
    if (!name) return "url('/descanso.png')";
    
    const lower = name.toLowerCase();
    
    // CORREÇÃO AQUI: Verifica explicitamente se é descanso
    if (lower.includes('descanso') || lower.includes('rest') || lower.includes('off')) {
      return "url('/descanso.png')";
    }
    if (lower.includes('push') || lower.includes('peito') || lower.includes('chest') || lower.includes('supino')) {
      return "url('/peito.png')";
    }
    if (lower.includes('pull') || lower.includes('costa') || lower.includes('back') || lower.includes('remada') || lower.includes('puxada')) {
      return "url('/costas.png')";
    }
    if (lower.includes('leg') || lower.includes('perna') || lower.includes('lower') || lower.includes('agachamento') || lower.includes(' c')) {
      return "url('/perna.png')";
    }
    if (lower.includes('ombro') || lower.includes('shoulder')) {
      return "url('/ombro.png')";
    }
    if (lower.includes('braço') || lower.includes('braco') || lower.includes('arm') || lower.includes('biceps') || lower.includes('triceps')) {
      return "url('/braco.png')";
    }
    
    return "url('https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=1000&auto=format&fit=crop')";
  };

  const getHeroStyle = (name) => {
    if (!name) return { backgroundPosition: 'center', minHeight: '380px' };
    const lower = name.toLowerCase();

    if (lower.includes('descanso') || lower.includes('rest')) {
      return { backgroundPosition: 'center', minHeight: '380px' };
    }
    if (lower.includes('push') || lower.includes('peito') || lower.includes('chest')) {
      return { backgroundPosition: 'center 25%', minHeight: '380px' };
    }
    if (lower.includes('pull') || lower.includes('costa') || lower.includes('back')) {
      return { backgroundPosition: 'center 30%', minHeight: '380px' };
    }
    if (lower.includes('leg') || lower.includes('perna') || lower.includes('lower')) {
      return { backgroundPosition: 'center 15%', minHeight: '450px' };
    }
    if (lower.includes('ombro') || lower.includes('shoulder')) {
      return { backgroundPosition: 'center 20%', minHeight: '380px' };
    }
    if (lower.includes('braço') || lower.includes('braco') || lower.includes('arm')) {
      return { backgroundPosition: 'center 25%', minHeight: '380px' };
    }
    
    return { backgroundPosition: 'center', minHeight: '380px' };
  };

  // --- CÁLCULO REAL DE SÉRIES E DESCANSO ---
  const totalSets = routine?.exercises?.reduce((acc, ex) => acc + (Number(ex.sets) || 3), 0) || 0;
  const restTime = routine?.rest || S.rest || S.defaultRest || 60;

  return <div className="narrow">
    <div className="hdr" style={{ position: 'relative' }}>
      <SeasonDeco spot="header-bats" />
      <div><h1>{user ? t('Hi {0}', user.name) : 'NizuGym'}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <button className="iconbtn" data-tour="settings-gear" onClick={() => nav('/settings')} aria-label={trouble ? t('Settings') + ', ' + t('Connection problem') : t('Settings')}><Icon name="gear" />{trouble && <span className="tab-dot" aria-hidden="true" />}</button>
      
      <svg viewBox="0 0 1000 50" preserveAspectRatio="none" className="linha-divisoria-svg">
        <path d="M0,45 L920,45 Q980,45 1000,10" fill="none" stroke="#00aaff" strokeWidth="2" style={{ filter: 'drop-shadow(0px 0px 8px #00aaff)' }} />
      </svg>
    </div>

    <div className="card">
      {progChip && <button type="button" className="chip ichip prog-chip" onClick={() => nav('/plan/programmes')}><Icon name="calendar" /><span>{progChip}</span></button>}
      {rotating ? (queue ? <QueueRow S={S} today={todayISO()} onStart={onQueueStart} managed={managedQueue} /> : <div className="empty">
        {t('No rotation yet. Add routines to it in Plan.')}
        <div style={{ marginTop: 10 }}><Button size="sm" variant="tinted" onClick={() => nav('/plan')}>{t('Set up in Plan')}</Button></div>
      </div>) : <>
        <div className="row between" style={{ marginBottom: 8 }}>
          <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 'var(--fs-subhead)' }} onClick={() => setWeekOffset(w => w - 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
          <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
          <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 'var(--fs-subhead)' }} onClick={() => setWeekOffset(w => w + 1)} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
        </div>
        <div className="week">{strip}</div>
      </>}
      {left && <div className={'small dim wkleft' + (left.left > 0 ? '' : ' done')}>
        {left.left > 0 ? tn('{0} of {1} left this week', '{0} of {1} left this week', left.left, left.of) : t('All done this week. Nice.')}
      </div>}

      {/* CARD DE TREINO DINÂMICO */}
      <div className="hero-workout-card" onClick={onToday}>
        <div 
          className="hero-bg" 
          style={{ 
            backgroundImage: getHeroImage(heroImageName, heroImageCustom),
            ...getHeroStyle(heroImageName) 
          }}
        ></div>
        
        <div className="hero-content">
          <div className="hero-header">
            <h2>{S.active ? t('{0} (em andamento)', S.active.name) : doneToday ? t('Treino Concluído') : routine ? todayName : t('Dia de Descanso')}</h2>
            <span className="hero-date">{t(DAYS[today.getDay()])}, {today.getDate()} {today.toLocaleDateString(dateLocale(), { month: 'short' })}</span>
          </div>

          {routine && !doneToday && (
            <div className="hero-stats">
              <div className="h-stat">
                <Icon name="calendar" /> <span>Séries</span> <b>{totalSets}</b>
              </div>
              <div className="h-stat">
                <Icon name="activity" /> <span>Exercícios</span> <b>{routine.exercises?.length || 0}</b>
              </div>
              <div className="h-stat">
                <Icon name="clock" /> <span>Descanso</span> <b>{restTime}s</b>
              </div>
            </div>
          )}

          <div className="hero-btn">
            <Icon name={doneToday ? "checkCircle" : "play"} />
            {S.active ? t('Continuar Treino') : doneToday ? t('Ver Detalhes') : routine ? t('Iniciar Treino') : t('Escolher Treino')}
          </div>
        </div>
      </div>

      {!S.active && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
        <Button size="sm" variant="ghost" className="dim" icon="swap" onClick={() => nav('/workout')}>
          {t('Choose a different workout')}
        </Button>
      </div>}
      <SeasonDeco spot="home-hero" />
    </div>

    <RecapHomeCard S={S} />
    <SeasonDeco spot="home-advent" />
    {on('motivation') && <WrappedHomeCard S={S} />}
    {on('health') && <RecoveryHint S={S} />}
    <ChallengesCard S={S} />

    {on('checkin') && (
      <div className="card tap-host checkin-card">
        <CardHead icon="qr" tint="var(--blue)" eyebrow={t('At the gym')} title={t('Check in')} open={{ onClick: () => nav('/checkin') }}
          action={<Icon name="chevronRight" className="chev" />} />
      </div>
    )}

    {!S.routines.length && !S.active && (
      <div className="card">
        <CardHead icon="calendar" title={t('Welcome!')} sub={t('Set up your weekly routine to get going, or grab a ready-made starter plan.')} />
        <Button variant="primary" icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}

    {on('body') && S.showWeightCard !== false && <div className="card">
      <CardHead icon="scale" tint="var(--teal)" title={t('Body weight')} className="bw-head"
        action={<Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>} />
      {bw ? <>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <div className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: 'var(--fs-callout)' }}>{S.unit}</span></div>
          {!!delta && (
            <span className="small row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(delta, bw.w) }}>
              <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 'var(--fs-caption)' }} />
              {fmtNum(Math.abs(delta))}
            </span>
          )}
          <span className="dim small" style={{ marginInlineStart: 'auto' }}>{fmtDate(bw.d, true)}</span>
        </div>
        {S.targetW && (
          <div className="small row" style={{ color: 'var(--gold-ink)', marginTop: 4, gap: 5 }}>
            <Icon name="target" style={{ fontSize: 'var(--fs-footnote)' }} />
            <span>{t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}</span>
          </div>
        )}
        <div className="chart" style={{ marginTop: 8 }}><LineChart points={bwPoints} h={130} unit={S.unit} goal={S.targetW} /></div>
        <WeightRate S={S} />
        <div className="row between" style={{ marginTop: 4 }}>
          <Button size="sm" variant="ghost" icon="target" className="bw-goal" style={S.targetW ? { color: 'var(--gold-ink)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
          <Button size="sm" variant="ghost" trailingIcon="chevronRight" data-tour="home-weighins" onClick={weighInsSheet}>{t('All weigh-ins')}</Button>
        </div>
      </> : <>
        <div className="muted small">{S.weighIn === false
          ? t('No weigh-ins yet. Log your weight to start the curve.')
          : t("No weigh-ins yet. Log your weight to start the curve (we also ask before every workout).")}</div>
        <Button size="sm" variant="ghost" icon="target" className="bw-goal" style={{ marginTop: 6, ...(S.targetW ? { color: 'var(--gold-ink)' } : {}) }} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
      </>}
    </div>}

    {on('motivation') ? <div className="card tap-host streak-card">
      <SeasonDeco spot="home-streak" />
      <CardHead className="streak-head" glyph={<span className="streak-flame-wrap"><StreakFlame lit={streak.current > 0} /><SeasonDeco spot="streak-flame" /></span>}
        title={t('{0} week streak', streak.current)} open={{ onClick: () => calendarSheet(), haspopup: 'dialog' }}
        sub={<>{doneThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')} · {tn('{0} workout total', '{0} workouts total', S.workouts.length)}</>}
        action={<Icon name="calendar" className="chev" style={{ fontSize: 'var(--fs-title3)' }} />} />
      {(streak.best > 0 || streak.freezes > 0) && <div className="muted small card-head-indent streak-meta-line"><StreakMeta info={streak} /></div>}
      <StreakParty S={S} info={streak} tally={tally} />
      {S.homeMuscleSets === true && <WeeklySetsHomeLine S={S} onOpen={() => nav('/stats?section=lifts')} />}
    </div>
      : S.homeMuscleSets === true && <div className="card wsets-solo"><WeeklySetsHomeLine S={S} onOpen={() => nav('/stats?section=lifts')} /></div>}
  </div>
}