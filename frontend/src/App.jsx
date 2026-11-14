import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { hideBoot } from './lib/boot.js'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation, useNavigationType } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { setWeightDecimals } from './lib/format.js'
import { accentValue, applyAccent } from './lib/accent.js'
import { seasonAccent } from './lib/seasonal.js'
import { setLang, useLang, baseLang } from './lib/i18n.js'
import { effectiveLang } from './lib/default-lang.js'
import { setPlayOnSilent, setVibrate, setAlarmBuzzer, setNativeBuzzer } from './lib/sound.js'
import { buzzAsAlarm } from './lib/rest-alert.js'
import { setNav, notePath, keyBefore, navToWorkout, nav } from './lib/nav.js'
import { onGymReminderOpen } from './lib/gym-reminder.js'
import { autoGymHere } from './lib/gym-auto.js'
import { workoutVolume } from './lib/history.js'
import { setSystemBarsLight } from './lib/system-bars.js'
import { initBackButton } from './lib/back.js'
import { installEdgeSwipeBack, BACK_PREVIEW_EVENT } from './lib/edge-swipe-back.js'
import { pageMotion } from './lib/page-motion.js'
import { startWatchSync, bindWatchAppActions, patchSetIn, watchStatus, watchClaimed, onWatchClaim } from './lib/watch-sync.js'
import { readWatchPrefs, readWatchStatus } from './lib/watch-settings.js'
import { startWatchRelay } from './lib/watch-relay.js'
import { startPhoneWorkout } from './lib/phone-workout.js'
import { stampWorkout } from './lib/sync-merge.js'
import { logWeighIn } from './lib/bodyweight.js'
import { startWidgetSync } from './lib/widgets.js'
import { startWidgetLinks } from './lib/widget-links.js'
import { startVoice, todayRoutineIds } from './lib/voice.js'
import { startLiveActivitySync } from './lib/live-activity.js'
import { useWakeLock } from './lib/wakelock.js'
import { installViewportGuard } from './lib/viewport-guard.js'
import { installChipDrag } from './lib/hchips.js'
import { syncPushSubscription } from './lib/push.js'
import { MOBILE, nativePlatform } from './lib/mobile.js'
import { isOn } from './lib/modules.js'
import { useTour, tourState, openTour, readTour, shouldOffer, resumeAt } from './lib/tour.js'
import { exitWorkoutEdit, startFlow, beginWorkout, bwSheet } from './sheets.jsx'
import Icon from './components/Icon.jsx'
import TabBar from './components/TabBar.jsx'
import ScrollTopButton from './components/ScrollTopButton.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import SyncBanner from './components/SyncBanner.jsx'
import RestTimer from './components/RestTimer.jsx'
import TimerFlash from './components/TimerFlash.jsx'
import { SeasonalLayer } from './components/Seasonal.jsx'
import { WrappedLayer } from './components/WrappedEntry.jsx'
import { openDeviceLinkRedeem } from './components/Passkeys.jsx'
import { useAnimPacksBoot } from './components/Animations.jsx'
import { useNfcTagLinks } from './components/Nfc.jsx'
import { useRoutineLinks } from './components/RoutineShare.jsx'
import Login from './views/Login.jsx'
import MobileOnboarding from './views/MobileOnboarding.jsx'
import PermissionSteps from './views/PermissionSteps.jsx'
import Home from './views/Home.jsx'
import Plan from './views/Plan.jsx'
import Workout from './views/Workout.jsx'

const views = []
function lazyView(load) {
  let View = null
  const fetchIt = () => load().then(m => { View = m.default; return m })
  const Lazy = lazy(fetchIt)
  views.push(fetchIt)
  return function LazyView(props) {
    return View ? <View {...props} /> : <Suspense fallback={null}><Lazy {...props} /></Suspense>
  }
}
const Admin = lazyView(() => import('./views/Admin.jsx'))
const CoachChat = lazyView(() => import('./views/CoachChat.jsx'))
const Measurements = lazyView(() => import('./views/Measurements.jsx'))
const CoachIntake = lazyView(() => import('./views/CoachIntake.jsx'))
const CoachSetup = lazyView(() => import('./views/CoachSetup.jsx'))
const StructuralBalance = lazyView(() => import('./views/StructuralBalance.jsx'))
const ProgressPhotos = lazyView(() => import('./views/ProgressPhotos.jsx'))
const CheckIn = lazyView(() => import('./views/CheckIn.jsx'))
const RoutineEdit = lazyView(() => import('./views/RoutineEdit.jsx'))
const Programmes = lazyView(() => import('./views/Programmes.jsx'))
const ProgrammeEdit = lazyView(() => import('./views/Programmes.jsx').then(m => ({ default: m.ProgrammeEdit })))
const Stats = lazyView(() => import('./views/Stats.jsx'))
const History = lazyView(() => import('./views/History.jsx'))
const Library = lazyView(() => import('./views/Library.jsx'))
const Muscles = lazyView(() => import('./views/Muscles.jsx'))
const SettingsRoute = lazyView(() => import('./views/Settings.jsx').then(m => ({ default: m.SettingsRoute })))

// --- AQUI ESTÁ A NOVA TELA DE GUILDA ---
const Guild = lazyView(() => import('./views/Guild.jsx'))
// ---------------------------------------

const Tour = lazy(() => import('./components/Tour.jsx'))
let viewsPrefetched = false
const prefetchViews = () => {
  if (viewsPrefetched) return
  viewsPrefetched = true
  const run = () => { for (const f of views) f().catch(() => {}) }
  if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(run, { timeout: 4000 })
  else setTimeout(run, 1500)
}

const scrollPositions = new Map()

bindUI(useUI)

const resolveTheme = theme => theme === 'light' || theme === 'dark'
  ? theme
  : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

function applyPrefs(theme, accent) {
  const de = document.documentElement
  de.dataset.theme = resolveTheme(theme)
  applyAccent(de, accent, de.dataset.theme)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f2f2f7' : '#000000'
  if (MOBILE) setSystemBarsLight(de.dataset.theme === 'light')
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const navType = useNavigationType()
  const { S, user, ready } = useStore()

  useEffect(() => { setPlayOnSilent(!!S.soundOnSilent) }, [S.soundOnSilent])
  useEffect(() => { setVibrate(S.vibrate !== false) }, [S.vibrate])
  useEffect(() => { setAlarmBuzzer(MOBILE && S.vibrate !== false && S.vibrateOnSilent ? buzzAsAlarm : null) }, [S.vibrate, S.vibrateOnSilent])
  useEffect(() => { if (MOBILE) nativePlatform().then(p => { if (p === 'ios') setNativeBuzzer(buzzAsAlarm) }) }, [])
  useAnimPacksBoot()
  const isGuest = useStore(s => s.isGuest())
  const needsMobileOnboarding = useStore(s => s.needsMobileOnboarding)
  const permSteps = useStore(s => s.permSteps)
  const langV = useLang()
  useEffect(() => { setNav(navigate) }, [navigate])
  const lastEditPath = useRef(loc.pathname)
  
  useEffect(() => {
    const previous = lastEditPath.current
    lastEditPath.current = loc.pathname
    if (previous !== '/workout' || !useStore.getState().S.active?.editingWorkoutId || loc.pathname === '/workout') return
    const destination = loc.pathname + loc.search
    navigate('/workout', { replace: true })
    exitWorkoutEdit(() => navigate(destination, { replace: true }))
  }, [loc.pathname, loc.search, S.active?.editingWorkoutId, navigate])
  
  const accent = seasonAccent(S) || accentValue(S)
  useEffect(() => { applyPrefs(S.theme, accent) }, [S.theme, accent])
  
  useEffect(() => {
    if (S.theme !== 'system' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyPrefs(S.theme, accent)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [S.theme, accent])
  
  const config = useStore(s => s.config)
  const lang = effectiveLang(S, config)
  useEffect(() => { setLang(lang, S.enParens?.[baseLang(lang)] ?? true, S.enOnly?.[baseLang(lang)] === true) }, [lang, S.enParens, S.enOnly])
  useEffect(() => { setWeightDecimals(S.wdec) }, [S.wdec])
  useEffect(() => { document.documentElement.lang = lang }, [langV, lang])
  
  const pathRef = useRef(null)
  useEffect(() => installViewportGuard(), [])
  useEffect(() => installChipDrag(), [])
  useEffect(() => {
    if (MOBILE || !user || !ready) return
    syncPushSubscription().catch(() => {})
  }, [user?.id, ready])
  
  const linkCode = useStore(s => s.linkCode)
  const linkOffered = useRef(false)
  useEffect(() => {
    if (!ready || !linkCode || linkOffered.current) return
    linkOffered.current = true
    openDeviceLinkRedeem()
  }, [ready, linkCode])
  
  useEffect(() => {
    const onScroll = () => {
      if (document.body.style.position === 'fixed') return
      scrollPositions.set(pathRef.current, window.scrollY)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  
  const [preview, setPreview] = useState(null)
  const returning = useRef(null)
  useEffect(() => {
    const on = e => {
      const d = e.detail || {}
      if ('commit' in d) returning.current = d.commit
      else setPreview(d.path || null)
    }
    window.addEventListener(BACK_PREVIEW_EVENT, on)
    return () => window.removeEventListener(BACK_PREVIEW_EVENT, on)
  }, [])
  
  useEffect(() => {
    const onClick = e => {
      const to = e.target.closest?.('#app > .page:not(.under) [data-back]')?.getAttribute('data-back')
      if (to) returning.current = to
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
  
  useEffect(() => { setPreview(null) }, [loc.pathname])
  
  useLayoutEffect(() => {
    const first = pathRef.current === null
    const samePath = pathRef.current === loc.pathname
    pathRef.current = loc.pathname
    notePath(loc.pathname, loc.key)
    if (returning.current && returning.current === loc.pathname && !first) {
      returning.current = null
      const y = scrollPositions.get(loc.pathname) || 0
      if (document.querySelector('#app > .page[data-promoted]')) { window.scrollTo(0, y); return }
      const frame = window.requestAnimationFrame(() => window.scrollTo(0, y))
      return () => window.cancelAnimationFrame(frame)
    }
    returning.current = null
    if (navType !== 'POP' || first) { window.scrollTo(0, 0); scrollPositions.set(loc.pathname, 0); return }
    if (samePath) return
    const y = scrollPositions.get(loc.pathname) || 0
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, y))
    return () => window.cancelAnimationFrame(frame)
  }, [loc.pathname, navType])
  
  useWakeLock(!!S.active && !S.active.editingWorkoutId && S.keepAwake !== false)
  
  const inWorkout = loc.pathname === '/workout' && !!S.active
  useEffect(() => {
    document.body.classList.toggle('no-tabbar', inWorkout)
    return () => document.body.classList.remove('no-tabbar')
  }, [inWorkout])
  
  const noTabs = inWorkout || loc.pathname === '/coach' || needsMobileOnboarding || permSteps
  const authed = user || isGuest
  const tour = useTour()
  const tourAsked = useRef(false)
  const setupDone = authed && ready && !needsMobileOnboarding && !permSteps
  useNfcTagLinks(setupDone)
  useRoutineLinks(setupDone)
  
  useEffect(() => {
    if (!setupDone || tourAsked.current) return
    const tm = setTimeout(() => {
      const st = useStore.getState()
      if (tourAsked.current || tourState() || st.S.active || useUI.getState().sheets.length || /^#\/workout/.test(window.location.hash || '')) return
      const rec = readTour()
      const at = resumeAt(rec)
      const synced = !st.user || (st.sync?.status === 'ok' && st.sync.lastSynced > 0)
      if (at) openTour({ kind: 'resume', at })
      else if (shouldOffer(rec, st.S, { synced })) openTour({ kind: 'offer' })
      else return
      tourAsked.current = true
    }, 1200)
    return () => clearTimeout(tm)
  }, [setupDone, S])
  
  useEffect(() => { if (ready || authed) hideBoot() }, [ready, authed])
  
  if (!ready && !authed) return (
    <div id="app">
      <div style={{ paddingTop: '44vh', display: 'flex', justifyContent: 'center', fontSize: 34, color: 'var(--label-3)' }}>
        <Icon name="dumbbell" />
      </div>
    </div>
  )

  const view = l => (!authed ? <Login /> : needsMobileOnboarding ? <MobileOnboarding /> : permSteps ? <PermissionSteps /> : (
    <Routes location={l}>
      <Route path="/home" element={<Home />} />
      {isOn(S, 'checkin') && <Route path="/checkin" element={<CheckIn />} />}
      <Route path="/plan" element={<Plan />} />
      <Route path="/plan/r/:id" element={<RoutineEdit />} />
      <Route path="/plan/programmes" element={<Programmes />} />
      <Route path="/plan/prog/:id" element={<ProgrammeEdit />} />
      <Route path="/workout" element={<Workout />} />
      <Route path="/stats" element={<Stats />} />
      <Route path="/history" element={<History />} />
      
      {/* --- AQUI ESTÁ A NOVA ROTA DE GUILDA --- */}
      <Route path="/guild" element={<Guild />} />
      {/* --------------------------------------- */}
      
      <Route path="/library" element={<Library />} />
      <Route path="/muscles" element={<Muscles />} />
      <Route path="/structural-balance" element={<StructuralBalance />} />
      {isOn(S, 'body') && <Route path="/progress-photos" element={<ProgressPhotos />} />}
      {isOn(S, 'body') && <Route path="/measurements" element={<Measurements />} />}
      <Route path="/settings" element={<SettingsRoute />} />
      <Route path="/settings/:page" element={<SettingsRoute />} />
      {isOn(S, 'coach') && <Route path="/coach" element={<CoachChat />} />}
      {isOn(S, 'coach') && <Route path="/coach/intake" element={<CoachIntake />} />}
      {isOn(S, 'coach') && <Route path="/coach/proposal" element={<Navigate to="/coach" replace />} />}
      {isOn(S, 'coach') && <Route path="/coach/setup" element={<CoachSetup />} />}
      <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to="/home" replace />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  ))
  const showPreview = !!preview && preview !== loc.pathname && authed && !needsMobileOnboarding && !permSteps

  return (
    <>
      <div id="app">
        <Page key={loc.pathname} loc={loc} render={view} motion={pageMotion(pathRef.current, loc.pathname, navType)} />
        {showPreview && <Page key={preview} loc={previewLoc(preview)} render={view} under scrollY={scrollPositions.get(preview) || 0} />}
      </div>
      <SyncBanner />
      {!noTabs && <TabBar onStart={startFlow} />}
      {!noTabs && authed && <ScrollTopButton off={loc.pathname === '/workout'} path={loc.pathname} />}
      <RestTimer />
      <Modals />
      <Toast />
      <TimerFlash />
      {tour && authed && <Suspense fallback={null}><Tour /></Suspense>}
      {authed && !needsMobileOnboarding && !permSteps && <SeasonalLayer hidden={inWorkout || loc.pathname === '/workout'} />}
      {authed && isOn(S, 'motivation') && <WrappedLayer ready={setupDone} />}
    </>
  )
}

const previewLoc = pathname => ({ pathname, search: '', hash: '', state: null, key: keyBefore(pathname) || 'back-preview' })

function Page({ loc, render, under = false, scrollY = 0, motion = 'fade' }) {
  const ref = useRef(null)
  const wasUnder = useRef(under)
  const arrival = useRef(motion)
  const promoted = wasUnder.current && !under
  useLayoutEffect(() => {
    if (under || !wasUnder.current) return
    const el = ref.current
    if (el) { el.style.transform = ''; el.style.transition = ''; el.style.visibility = '' }
  }, [under])
  return <div ref={ref} className={'page' + (under ? ' under' : wasUnder.current ? '' : arrival.current === 'push' ? ' vpush' : arrival.current === 'pop' ? ' vpop' : ' vfade')}
    data-path={loc.pathname} data-promoted={promoted ? '' : undefined}
    aria-hidden={under || undefined} inert={under || undefined}>
    <div className="page-in" style={under && scrollY ? { transform: `translateY(${-scrollY}px)` } : undefined}>
      <ErrorBoundary>{render(loc)}</ErrorBoundary>
    </div>
  </div>
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  useEffect(() => { prefetchViews() }, [])
  useEffect(() => {
    let stop = null, gone = false
    initBackButton().then(fn => { if (gone) fn(); else stop = fn })
    return () => { gone = true; stop?.() }
  }, [])
  useEffect(() => installEdgeSwipeBack(), [])
  useEffect(() => {
    let stop = null, gone = false, stopRelay = null
    if (MOBILE) startWatchSync({ useStore, useUI }).then(fn => { if (gone) fn(); else stop = fn })
    startWatchRelay({ useStore, useUI }).then(fn => { if (gone) fn(); else stopRelay = fn }).catch(() => {})
    const unbind = bindWatchAppActions({
      start: (ids, { bw = null, ...opts } = {}) => beginWorkout(ids, bw, opts),
      weighIn: ({ w, at }) => useStore.getState().update(s => { logWeighIn(s, w, at) }),
      healthDeleted: () => { import('./lib/health-sync.js').then(m => m.syncHealth(useStore.getState().S)).catch(() => {}) },
      patchSet: (where, fields, opts = {}) => useStore.getState().update(s => {
        patchSetIn(s, where, fields, stampWorkout, { ...opts, recount: w => { w.vol = workoutVolume(w) } })
      }),
      openWorkout: () => { if (!String(window.location.hash || '').startsWith('#/workout')) navToWorkout() },
    })
    return () => { gone = true; stop?.(); stopRelay?.(); unbind() }
  }, [])
  useEffect(() => {
    if (!MOBILE) return
    let stop = null, gone = false
    startPhoneWorkout({
      useStore, useUI,
      apply: patches => useStore.getState().update(s => {
        for (const { where, fields } of patches) patchSetIn(s, where, fields, stampWorkout, { recount: w => { w.vol = workoutVolume(w) } })
      }),
      watch: { status: watchStatus, claimed: watchClaimed, onClaim: onWatchClaim, prefs: readWatchPrefs, reported: readWatchStatus },
    }).then(fn => { if (gone) fn(); else stop = fn }).catch(() => {})
    return () => { gone = true; stop?.() }
  }, [])
  useEffect(() => {
    if (!MOBILE) return
    const stops = [], gone = { v: false }
    const keep = fn => { if (gone.v) fn(); else stops.push(fn) }
    startWidgetSync({ useStore }).then(keep).catch(() => {})
    startLiveActivitySync({ useStore, useUI }).then(keep).catch(() => {})
    return () => { gone.v = true; stops.forEach(fn => fn()) }
  }, [])
  useEffect(() => {
    if (!MOBILE) return
    let stop = null, gone = false
    startWidgetLinks({ getS: () => useStore.getState().S, nav, navToWorkout, startFlow, bwSheet, todayIds: todayRoutineIds })
      .then(fn => { if (gone) fn(); else stop = fn }).catch(() => {})
    return () => { gone = true; stop?.() }
  }, [])
  useEffect(() => {
    if (!MOBILE) return
    let stop = null, gone = false
    startVoice({ useStore, toast: msg => useUI.getState().toast(msg) })
      .then(fn => { if (gone) fn(); else stop = fn }).catch(() => {})
    return () => { gone = true; stop?.() }
  }, [])
  useEffect(() => {
    if (!MOBILE) return
    return onGymReminderOpen(() => {
      if (!String(window.location.hash || '').startsWith('#/workout')) navToWorkout()
      autoGymHere()
    })
  }, [])
  return <HashRouter><Shell /></HashRouter>
}