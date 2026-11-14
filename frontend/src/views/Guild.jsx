import { useState, useMemo } from 'react'
import { useStore } from '../store/useStore.js'
import { streakInfo } from '../lib/streak.js'
import { todayISO, weekStartOf, isoOf, weekDayOffset, fmtNum } from '../lib/format.js'
import { lastBW } from '../lib/history.js'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

/* ───────────────────────── Armazenamento seguro ───────────────────────── */

const KEYS = {
  name: 'nizugym_local_name',
  id: 'nizugym_player_id',
  guild: 'nizugym_guild',
}

const store = {
  get(k) { try { return localStorage.getItem(k) } catch (e) { return null } },
  set(k, v) { try { localStorage.setItem(k, v); return true } catch (e) { return false } },
  remove(k) { try { localStorage.removeItem(k) } catch (e) { /* ignora */ } },
}

const makeId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10)

/* ───────────────────────── Códigos (base64 UTF-8) ───────────────────────── */
// Mesmo formato dos códigos antigos, mas sem escape()/unescape() (depreciados).

const encodeCode = (obj) => {
  const bytes = new TextEncoder().encode(JSON.stringify(obj))
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin)
}

const decodeCode = (code) => {
  const bin = atob(code)
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

// Aceita o código puro OU a mensagem inteira que foi compartilhada
// (texto + código), mesmo com quebras de linha/espaços no meio.
const parseCode = (raw) => {
  const text = String(raw || '')
  const candidates = [text.replace(/\s+/g, '')]
  const tokens = text.match(/[A-Za-z0-9+/=]{16,}/g)
  if (tokens) candidates.push(tokens.reduce((a, b) => (b.length > a.length ? b : a)))

  for (const c of candidates) {
    try {
      const obj = decodeCode(c)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj
    } catch (e) { /* tenta o próximo */ }
  }
  return null
}

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (e) { /* cai no fallback */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch (e) {
    return false
  }
}

const sendCode = async ({ title, text, code, copiedMsg }) => {
  try {
    if (navigator.share) {
      await navigator.share({ title, text })
      return
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return // usuário cancelou
  }
  const ok = await copyText(code)
  if (ok) alert(copiedMsg)
  else window.prompt('Copie o código abaixo:', code)
}

/* ───────────────────────── Validação e migração ───────────────────────── */

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// Garante que um membro vindo de um código/armazenamento não quebre a tela.
const cleanMember = (m) => {
  if (!m || typeof m !== 'object') return null
  const name = typeof m.name === 'string' ? m.name.trim().slice(0, 30) : ''
  if (!name) return null
  return {
    id: typeof m.id === 'string' && m.id ? m.id.slice(0, 64) : null,
    name,
    dias: num(m.dias),
    volSemana: num(m.volSemana),
    volTotal: num(m.volTotal),
    streak: num(m.streak),
    metaPct: Math.min(100, num(m.metaPct)),
    ts: num(m.ts),
  }
}

const isLegacyId = (id) => id.startsWith('legacy:')

// Mescla listas de membros por id. Vence o dado mais novo (ts); em empate, o que chega.
const mergeMembers = (current, incoming) => {
  const byId = new Map()
  for (const m of [...current, ...incoming]) {
    const prev = byId.get(m.id)
    if (!prev || m.ts >= prev.ts) byId.set(m.id, m)
  }
  const list = [...byId.values()]
  // Remove membros "legados" (sem id real) quando o mesmo nome já tem id verdadeiro
  const realNames = new Set(list.filter(m => !isLegacyId(m.id)).map(m => m.name.toLowerCase()))
  return list.filter(m => !(isLegacyId(m.id) && realNames.has(m.name.toLowerCase())))
}

// Normaliza uma guilda (nova, antiga ou importada). Eu (me) nunca fico na lista
// salva: meus dados são sempre calculados na hora.
const normalizeGuild = (raw, me) => {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.members)) return null
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : ''
  if (!name) return null

  const members = []
  for (const m of raw.members) {
    const c = cleanMember(m)
    if (!c) continue
    if (!c.id) {
      // Guildas antigas não tinham id: liga pelo nome
      c.id = c.name.toLowerCase() === me.name.toLowerCase() ? me.id : `legacy:${c.name.toLowerCase()}`
    }
    members.push(c)
  }

  let adminId = typeof raw.adminId === 'string' && raw.adminId ? raw.adminId : null
  if (!adminId) {
    const adminName = String(raw.adminName || raw.admin || '').trim().toLowerCase()
    const found = adminName && members.find(m => m.name.toLowerCase() === adminName)
    if (found) adminId = found.id
  }

  const merged = mergeMembers([], members).filter(m => m.id !== me.id)

  return {
    id: String(raw.id || `legacy:${name.toLowerCase()}`).slice(0, 64),
    name,
    adminId,
    adminName: String(raw.adminName || raw.admin || '').trim().slice(0, 30),
    members: merged,
  }
}

/* ───────────────────────── Componente ───────────────────────── */

const codeInputProps = {
  autoComplete: 'off',
  autoCapitalize: 'off',
  autoCorrect: 'off',
  spellCheck: false,
}

export default function Guild() {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)

  const [localName, setLocalName] = useState(() => store.get(KEYS.name) || '')

  const [playerId] = useState(() => {
    let id = store.get(KEYS.id)
    if (!id) {
      id = makeId()
      store.set(KEYS.id, id)
    }
    return id
  })

  const myName = (user?.name || localName || 'Visitante').trim().slice(0, 30) || 'Visitante'

  // Carrega a guilda já no primeiro render (evita piscar a tela "Criar Guilda")
  const [guildData, setGuildData] = useState(() => {
    const saved = store.get(KEYS.guild)
    if (!saved) return null
    try {
      const g = normalizeGuild(JSON.parse(saved), { id: playerId, name: myName })
      if (!g) { store.remove(KEYS.guild); return null }
      store.set(KEYS.guild, JSON.stringify(g)) // grava já migrada
      return g
    } catch (e) {
      store.remove(KEYS.guild)
      return null
    }
  })

  const [activeTab, setActiveTab] = useState('dias')
  const [importCode, setImportCode] = useState('')
  const [guildName, setGuildName] = useState('')
  const [nameInput, setNameInput] = useState(localName)
  const [showSync, setShowSync] = useState(false)

  /* ── Meus números (sempre calculados na hora) ── */
  const myStats = useMemo(() => {
    const base = { id: playerId, name: myName, dias: 0, volSemana: 0, volTotal: 0, streak: 0, metaPct: 0 }
    if (!S) return base

    const today = todayISO()
    const ws = weekStartOf(S)
    const todayDate = new Date()

    const wkStart = new Date(todayDate)
    wkStart.setDate(todayDate.getDate() - weekDayOffset(todayDate.getDay(), ws))
    const wsISO = isoOf(wkStart)

    const allWorkouts = [...(S.workouts || []), ...(S.active ? [S.active] : [])].filter(Boolean)
    const volOf = (w) => Number(w.vol || w.volume) || 0

    const thisWeek = allWorkouts.filter(w => w.d && w.d >= wsISO)
    const daysSet = new Set(thisWeek.map(w => w.d))
    const volSemana = thisWeek.reduce((acc, w) => acc + volOf(w), 0)
    const volTotal = allWorkouts.reduce((acc, w) => acc + volOf(w), 0)

    let streak = 0
    try { streak = streakInfo(S, today).current || 0 } catch (e) { /* mantém 0 */ }

    const currentWeight = lastBW(S)?.w || 0
    const targetWeight = S.targetW || 0
    let metaPct = 0
    if (targetWeight > 0 && currentWeight > 0) {
      const diff = Math.abs(targetWeight - currentWeight)
      metaPct = Math.max(0, 100 - (diff / targetWeight) * 100)
    }

    return { ...base, dias: daysSet.size, volSemana, volTotal, streak, metaPct }
  }, [S, myName, playerId])

  /* ── Persistência: só guarda os OUTROS membros ── */
  const persistGuild = (g) => {
    if (!g) {
      setGuildData(null)
      store.remove(KEYS.guild)
      return
    }
    const clean = { ...g, members: g.members.filter(m => m.id !== playerId) }
    setGuildData(clean)
    store.set(KEYS.guild, JSON.stringify(clean))
  }

  const isAdmin = !!guildData && !!guildData.adminId && guildData.adminId === playerId

  /* ── Ações ── */
  const saveLocalName = () => {
    const cleanName = nameInput.trim().slice(0, 30)
    if (!cleanName) return alert('Digite um nome válido.')
    store.set(KEYS.name, cleanName)
    setLocalName(cleanName)
  }

  const createGuild = () => {
    const name = guildName.trim().slice(0, 40)
    if (!name) return alert('Digite um nome para a guilda.')
    if (guildData && !window.confirm('Você já está em uma guilda. Deseja criar uma nova e apagar a atual?')) return

    persistGuild({
      id: makeId(),
      name,
      adminId: playerId,
      adminName: myStats.name,
      members: [],
    })
    setGuildName('')
  }

  const shareProfile = () => {
    if (!S) return alert('Seus dados ainda estão carregando. Tente de novo em instantes.')
    const code = encodeCode({ ...myStats, ts: Date.now() })
    sendCode({
      title: 'NizuGym - Meu Código',
      text: `Meus dados atualizados no NizuGym (${myStats.name}). Envie para o líder da guilda:\n\n${code}`,
      code,
      copiedMsg: 'Seu código pessoal foi copiado!',
    })
  }

  const shareMasterCode = () => {
    if (!guildData) return
    const now = Date.now()
    const members = [...guildData.members, { ...myStats, ts: now }]
    const code = encodeCode({
      isMaster: true,
      id: guildData.id,
      name: guildData.name,
      adminId: guildData.adminId,
      adminName: guildData.adminName,
      members,
    })
    sendCode({
      title: 'NizuGym - Guilda Atualizada',
      text: `A guilda ${guildData.name} foi atualizada! Cole este código no app:\n\n${code}`,
      code,
      copiedMsg: 'Código Mestre copiado! Envie no grupo da guilda.',
    })
  }

  const syncGuild = () => {
    const invalid = 'Código inválido. Verifique se copiou o código correto.'
    if (!importCode.trim()) return alert('Cole um código para sincronizar.')

    const decoded = parseCode(importCode)
    if (!decoded) return alert(invalid)

    const finish = (msg) => {
      setImportCode('')
      setShowSync(false)
      alert(msg)
    }
    const me = { id: playerId, name: myStats.name }

    // Código Mestre (guilda inteira)
    if (decoded.isMaster === true) {
      const incoming = normalizeGuild(decoded, me)
      if (!incoming) return alert(invalid)

      let next
      if (!guildData) {
        next = incoming
      } else if (guildData.id !== incoming.id) {
        if (!window.confirm(`Esse código é da guilda "${incoming.name}". Deseja sair de "${guildData.name}" e entrar nela?`)) return
        next = incoming
      } else {
        // Mesma guilda: junta os dados (vence o mais novo) e mantém o líder atual
        next = { ...guildData, members: mergeMembers(guildData.members, incoming.members) }
      }
      persistGuild(next)
      const total = next.members.filter(m => m.id !== playerId).length + 1
      return finish(`Ranking atualizado com sucesso! (${total} membros)`)
    }

    // Código pessoal de um amigo
    const friend = cleanMember(decoded)
    if (!friend || !friend.id) return alert(invalid)
    if (!guildData) {
      return alert('Esse é o código pessoal de um amigo. Para entrar em uma guilda, cole o Código Mestre enviado pelo líder.')
    }
    if (friend.id === playerId) return alert('Esse é o seu próprio código.')

    friend.ts = friend.ts || Date.now()
    persistGuild({ ...guildData, members: mergeMembers(guildData.members, [friend]) })
    finish(`Dados de ${friend.name} atualizados!`)
  }

  const leaveGuild = () => {
    const msg = isAdmin
      ? 'Você é o líder. Se sair, ninguém mais poderá gerar o Código Mestre desta guilda. Deseja sair mesmo assim?'
      : 'Tem certeza que deseja sair da guilda?'
    if (window.confirm(msg)) persistGuild(null)
  }

  const getInitial = (name) => (name ? name.charAt(0).toUpperCase() : '?')

  /* ── Telas ── */
  if (!user?.name && !localName) {
    return (
      <div className="narrow" style={{ paddingBottom: 120, paddingTop: 40 }}>
        <div className="hdr" style={{ marginBottom: 24 }}>
          <div><h1>Bem-vindo</h1><div className="sub">Como quer ser chamado?</div></div>
        </div>
        <div className="card">
          <p className="small muted" style={{ marginBottom: 16 }}>Para entrar na Guilda, precisamos de um apelido para o seu ranking.</p>
          <input className="field" placeholder="Ex: João, Jhow, etc..." maxLength={30} value={nameInput} onChange={e => setNameInput(e.target.value)} />
          <Button variant="primary" onClick={saveLocalName} style={{ marginTop: 16 }}>Salvar Nome</Button>
        </div>
      </div>
    )
  }

  if (!guildData) {
    return (
      <div className="narrow" style={{ paddingBottom: 120 }}>
        <div className="hdr" style={{ marginBottom: 24, marginTop: 20 }}>
          <div><h1>Guildas</h1><div className="sub">Competição Offline com Amigos</div></div>
          <div style={{ background: 'var(--acc-soft)', color: 'var(--acc)', padding: 12, borderRadius: '50%' }}><Icon name="users" style={{ fontSize: 24 }} /></div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--surface)', padding: 20 }}>
          <div><h2 style={{ fontSize: 18, marginBottom: 4 }}>Criar uma Guilda</h2><p className="small muted" style={{ marginBottom: 12 }}>Seja o líder e convide seus amigos.</p></div>
          <input className="field" placeholder="Ex: Guerreiros do Ferro" maxLength={40} value={guildName} onChange={e => setGuildName(e.target.value)} />
          <Button variant="primary" icon="plus" onClick={createGuild}>Criar Guilda</Button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', margin: '24px 0', gap: 10 }}><div style={{ flex: 1, height: 1, background: 'var(--sep)' }}></div><span className="small muted">OU</span><div style={{ flex: 1, height: 1, background: 'var(--sep)' }}></div></div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--surface)', padding: 20 }}>
          <div><h2 style={{ fontSize: 18, marginBottom: 4 }}>Entrar em uma Guilda</h2><p className="small muted" style={{ marginBottom: 12 }}>Cole o Código Mestre enviado pelo líder.</p></div>
          <input className="field" placeholder="Cole o código aqui..." value={importCode} onChange={e => setImportCode(e.target.value)} style={{ width: '100%' }} {...codeInputProps} />
          <Button variant="tinted" icon="login" onClick={syncGuild}>Entrar na Guilda</Button>
        </div>
      </div>
    )
  }

  // Eu sempre entro com os dados frescos; os outros vêm do que foi salvo
  const displayMembers = [...guildData.members.filter(m => m.id !== playerId), myStats]
  const sortedMembers = [...displayMembers].sort((a, b) =>
    ((b[activeTab] || 0) - (a[activeTab] || 0)) || a.name.localeCompare(b.name)
  )

  const top3 = sortedMembers.slice(0, 3)
  const rest = sortedMembers.slice(3)

  let podiumOrder = []
  if (top3.length === 1) podiumOrder = [top3[0]]
  else if (top3.length === 2) podiumOrder = [top3[1], top3[0]]
  else podiumOrder = [top3[1], top3[0], top3[2]]

  const podiumHeights = { 1: 130, 2: 100, 3: 85 }
  const podiumColors = {
    1: { bg: 'rgba(255, 215, 0, 0.15)', border: '#ffd700', text: '#ffd700' },
    2: { bg: 'rgba(192, 192, 192, 0.15)', border: '#c0c0c0', text: '#c0c0c0' },
    3: { bg: 'rgba(205, 127, 50, 0.15)', border: '#cd7f32', text: '#cd7f32' },
  }

  const formatStat = (m) => {
    if (activeTab === 'dias') return `${m.dias || 0} dias`
    if (activeTab === 'volSemana') return `${fmtNum(m.volSemana || 0)} kg`
    if (activeTab === 'volTotal') return `${fmtNum(m.volTotal || 0)} kg`
    if (activeTab === 'streak') return `${m.streak || 0} sem.`
    if (activeTab === 'metaPct') return `${Math.round(m.metaPct || 0)}% da meta`
    return ''
  }

  return (
    <div className="narrow" style={{ paddingBottom: 140 }}>
      <div className="hdr" style={{ marginBottom: 20, marginTop: 20 }}>
        <div>
          <h1 style={{ fontSize: 28 }}>{guildData.name}</h1>
          <div className="sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="users" style={{ fontSize: 14 }} /> {displayMembers.length} membros
            {isAdmin && <span style={{ background: 'var(--acc-soft)', color: 'var(--acc)', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 'bold' }}>LÍDER</span>}
          </div>
        </div>
        <button className="iconbtn" onClick={leaveGuild} title="Sair da Guilda" style={{ background: 'var(--surface)', color: 'var(--red)' }}><Icon name="logout" /></button>
      </div>

      {isAdmin && (
        <div className="card" style={{ background: 'rgba(255, 215, 0, 0.1)', border: '1px solid rgba(255, 215, 0, 0.3)', marginBottom: 24, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ background: 'rgba(255, 215, 0, 0.2)', padding: 10, borderRadius: '50%', color: '#ffd700' }}><Icon name="award" style={{ fontSize: 20 }} /></div>
            <div>
              <h2 style={{ fontSize: 16, marginBottom: 2, color: '#ffd700' }}>Painel do Líder</h2>
              <p className="small muted" style={{ margin: 0 }}>Envie o código mestre para atualizar a guilda toda.</p>
            </div>
          </div>
          <Button variant="tinted" icon="send" onClick={shareMasterCode} style={{ width: '100%', color: '#ffd700', background: 'rgba(255, 215, 0, 0.15)' }}>Compartilhar Código Mestre</Button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <div className="card" style={{ flex: 1, padding: 16, margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'var(--surface-2)', border: '1px solid var(--acc)' }}>
          <span className="small muted" style={{ marginBottom: 4 }}>Levantado na Semana</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--acc)' }}>{fmtNum(myStats.volSemana)} kg</span>
        </div>
        <div className="card" style={{ flex: 1, padding: 16, margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--sep)' }}>
          <span className="small muted" style={{ marginBottom: 4 }}>Levantado no Total</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--label)' }}>{fmtNum(myStats.volTotal)} kg</span>
        </div>
      </div>

      <div className="seg" style={{ marginBottom: 24, overflowX: 'auto', whiteSpace: 'nowrap' }}>
        <button className={activeTab === 'dias' ? 'on' : ''} onClick={() => setActiveTab('dias')}>Dias</button>
        <button className={activeTab === 'volSemana' ? 'on' : ''} onClick={() => setActiveTab('volSemana')}>Vol. Semana</button>
        <button className={activeTab === 'volTotal' ? 'on' : ''} onClick={() => setActiveTab('volTotal')}>Vol. Total</button>
        <button className={activeTab === 'streak' ? 'on' : ''} onClick={() => setActiveTab('streak')}>Streak</button>
        <button className={activeTab === 'metaPct' ? 'on' : ''} onClick={() => setActiveTab('metaPct')}>Meta de Peso</button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: 8, marginBottom: 40, marginTop: 20, minHeight: 200 }}>
        {podiumOrder.map((m) => {
          const pos = sortedMembers.indexOf(m) + 1
          const style = podiumColors[pos]
          const isMe = m.id === playerId
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '32%', maxWidth: '120px' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: isMe ? 'var(--acc)' : 'var(--surface-3)', color: isMe ? '#000' : 'var(--label)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 20, border: `2px solid ${style.border}`, marginBottom: 8, boxShadow: isMe ? '0 0 16px var(--acc)' : 'none' }}>{getInitial(m.name)}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--label)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>{m.name.split(' ')[0]}</div>
              <div style={{ width: '100%', height: podiumHeights[pos], background: style.bg, borderTop: `3px solid ${style.border}`, borderTopLeftRadius: 10, borderTopRightRadius: 10, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <div style={{ fontSize: 26, fontWeight: 900, color: style.text, lineHeight: 1 }}>{pos}º</div>
                <div style={{ fontSize: 12, fontWeight: 700, background: 'rgba(0,0,0,0.5)', color: '#fff', padding: '4px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>{formatStat(m)}</div>
              </div>
            </div>
          )
        })}
      </div>

      {rest.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 30 }}>
          {rest.map((m) => {
            const pos = sortedMembers.indexOf(m) + 1
            const isMe = m.id === playerId
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: isMe ? '2px solid var(--acc)' : '1px solid var(--sep)' }}>
                <div style={{ fontSize: 16, fontWeight: 800, width: 25, color: 'var(--label-2)' }}>{pos}º</div>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: isMe ? 'var(--acc)' : 'var(--surface-3)', color: isMe ? '#000' : 'var(--label)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 14 }}>{getInitial(m.name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 15, color: 'var(--label)' }}>{m.name} {isMe && <span style={{ color: 'var(--acc)', fontSize: 11 }}>(Você)</span>}</div></div>
                <div style={{ fontWeight: 600, color: 'var(--label-2)', fontSize: 14 }}>{formatStat(m)}</div>
              </div>
            )
          })}
        </div>
      )}

      <div className="card" style={{ background: 'var(--surface)', border: '1px dashed var(--sep)', display: 'flex', flexDirection: 'column', padding: 24, gap: 20 }}>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ background: 'var(--acc-soft)', padding: 10, borderRadius: '50%', color: 'var(--acc)' }}><Icon name="share" style={{ fontSize: 20 }} /></div>
            <div>
              <h2 style={{ fontSize: 16, marginBottom: 2 }}>Meus Dados</h2>
              <p className="small muted" style={{ margin: 0 }}>Envie para o líder juntar com o resto da guilda.</p>
            </div>
          </div>
          <Button variant="primary" icon="share" onClick={shareProfile} style={{ width: '100%' }}>Compartilhar Meu Código</Button>
        </div>

        <div style={{ height: 1, background: 'var(--sep)' }}></div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ background: 'var(--surface-2)', padding: 10, borderRadius: '50%', color: 'var(--label)' }}><Icon name="refresh" style={{ fontSize: 20 }} /></div>
            <div>
              <h2 style={{ fontSize: 16, marginBottom: 2 }}>{isAdmin ? 'Coletar Códigos' : 'Receber Atualização'}</h2>
              <p className="small muted" style={{ margin: 0 }}>{isAdmin ? 'Cole os códigos dos amigos aqui.' : 'Cole o Código Mestre do líder.'}</p>
            </div>
          </div>

          {!showSync ? (
            <Button variant="tinted" icon="download" onClick={() => setShowSync(true)} style={{ width: '100%' }}>Colar Código</Button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input className="field" placeholder="Cole o código aqui..." value={importCode} onChange={e => setImportCode(e.target.value)} style={{ width: '100%' }} {...codeInputProps} />
              <div style={{ display: 'flex', gap: 10 }}>
                <Button variant="ghost" onClick={() => setShowSync(false)} style={{ flex: 1 }}>Cancelar</Button>
                <Button variant="primary" onClick={syncGuild} style={{ flex: 2 }}>Sincronizar</Button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}