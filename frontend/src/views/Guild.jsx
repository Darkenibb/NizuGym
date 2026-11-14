import { useState, useEffect, useMemo } from 'react'
import { useStore } from '../store/useStore.js'
import { streakInfo } from '../lib/streak.js'
import { todayISO, weekStartOf, isoOf, weekDayOffset, fmtNum } from '../lib/format.js'
import { lastBW } from '../lib/history.js'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

const safeEncode = (str) => btoa(unescape(encodeURIComponent(str)))
const safeDecode = (str) => decodeURIComponent(escape(atob(str)))

export default function Guild() {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const [guildData, setGuildData] = useState(null)
  const [activeTab, setActiveTab] = useState('dias')
  const [importCode, setImportCode] = useState('')
  const [guildName, setGuildName] = useState('')

  useEffect(() => {
    try {
      const saved = localStorage.getItem('nizugym_guild')
      if (saved) setGuildData(JSON.parse(saved))
    } catch (e) {
      localStorage.removeItem('nizugym_guild')
    }
  }, [])

  const myStats = useMemo(() => {
    if (!S) return { name: 'Visitante', isMe: true, dias: 0, volSemana: 0, volTotal: 0, streak: 0, metaPct: 0 }

    const today = todayISO()
    const ws = weekStartOf(S)
    const todayDate = new Date()
    
    const wkStart = new Date(todayDate)
    wkStart.setDate(todayDate.getDate() - weekDayOffset(todayDate.getDay(), ws))
    const wsISO = isoOf(wkStart)

    const allWorkouts = [...(S.workouts || []), ...(S.active ? [S.active] : [])]
    
    // Volume Semana e Dias
    const thisWeekWorkouts = allWorkouts.filter(w => w.d >= wsISO)
    const daysSet = new Set(thisWeekWorkouts.map(w => w.d))
    let volSemana = 0
    thisWeekWorkouts.forEach(w => { volSemana += (w.vol || w.volume || 0) })

    // Volume Total
    let volTotal = 0
    allWorkouts.forEach(w => { volTotal += (w.vol || w.volume || 0) })

    // Streak
    let streak = 0
    try { streak = streakInfo(S, today).current || 0 } catch (e) {}

    // --- EVOLUÇÃO DE META (PESO CORPORAL) ---
    const currentWeight = lastBW(S)?.w || 0;
    const targetWeight = S.targetW || 0;
    let metaPct = 0;

    if (targetWeight > 0 && currentWeight > 0) {
      const diff = Math.abs(targetWeight - currentWeight);
      // Porcentagem de conclusão: 100% significa que a meta foi batida.
      // Se a diferença for grande em relação à meta, a porcentagem cai.
      metaPct = Math.max(0, 100 - ((diff / targetWeight) * 100));
    }

    return { 
      name: user?.name || (user ? 'Atleta' : 'Visitante'), 
      isMe: true, 
      dias: daysSet.size, 
      volSemana, 
      volTotal,
      streak, 
      metaPct
    }
  }, [S, user])

  const myStatsString = JSON.stringify(myStats);
  useEffect(() => {
    if (!guildData) return
    const updatedMembers = guildData.members.filter(m => !m.isMe && m.name !== myStats.name)
    const newData = { ...guildData, members: [...updatedMembers, myStats] }
    if (JSON.stringify(guildData) !== JSON.stringify(newData)) {
      setGuildData(newData)
      localStorage.setItem('nizugym_guild', JSON.stringify(newData))
    }
  }, [myStatsString, guildData])

  const createGuild = () => {
    if (!guildName.trim()) return alert('Digite um nome para a guilda.')
    const newGuild = { id: Date.now().toString(36), name: guildName, admin: myStats.name, members: [myStats] }
    setGuildData(newGuild)
    localStorage.setItem('nizugym_guild', JSON.stringify(newGuild))
    setGuildName('')
  }

  const generateInvite = () => {
    const updatedMembers = guildData.members.filter(m => !m.isMe && m.name !== myStats.name)
    const dataToShare = { ...guildData, members: [...updatedMembers, myStats] }
    const code = safeEncode(JSON.stringify(dataToShare))
    navigator.clipboard.writeText(code).then(() => alert('Código copiado! Envie para seus amigos no WhatsApp.'))
  }

  const joinGuild = () => {
    try {
      const decoded = JSON.parse(safeDecode(importCode.trim()))
      if (!decoded.name || !decoded.members) throw new Error('Inválido')
      const allMembers = [...decoded.members.filter(m => m.name !== myStats.name), myStats]
      const mergedGuild = { ...decoded, members: allMembers }
      setGuildData(mergedGuild)
      localStorage.setItem('nizugym_guild', JSON.stringify(mergedGuild))
      setImportCode('')
      alert(`Você entrou na guilda ${mergedGuild.name}!`)
    } catch (e) {
      alert('Código inválido ou corrompido.')
    }
  }

  const leaveGuild = () => {
    if (window.confirm('Tem certeza que deseja sair da guilda?')) {
      setGuildData(null)
      localStorage.removeItem('nizugym_guild')
    }
  }

  const getInitial = (name) => name ? name.charAt(0).toUpperCase() : '?'

  if (!guildData) {
    return (
      <div className="narrow" style={{ paddingBottom: 100 }}>
        <div className="hdr" style={{ marginBottom: 24, marginTop: 20 }}>
          <div><h1>Guildas</h1><div className="sub">Competição Offline com Amigos</div></div>
          <div style={{ background: 'var(--acc-soft)', color: 'var(--acc)', padding: 12, borderRadius: '50%' }}><Icon name="users" style={{ fontSize: 24 }} /></div>
        </div>
        
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--surface)', padding: 20 }}>
          <div><h2 style={{ fontSize: 18, marginBottom: 4 }}>Criar uma Guilda</h2><p className="small muted" style={{ marginBottom: 12 }}>Seja o líder e convide seus amigos.</p></div>
          <input className="field" placeholder="Ex: Guerreiros do Ferro" value={guildName} onChange={e => setGuildName(e.target.value)} />
          <Button variant="primary" icon="plus" onClick={createGuild}>Criar Guilda</Button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', margin: '24px 0', gap: 10 }}><div style={{ flex: 1, height: 1, background: 'var(--sep)' }}></div><span className="small muted">OU</span><div style={{ flex: 1, height: 1, background: 'var(--sep)' }}></div></div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--surface)', padding: 20 }}>
          <div><h2 style={{ fontSize: 18, marginBottom: 4 }}>Entrar em uma Guilda</h2><p className="small muted" style={{ marginBottom: 12 }}>Cole o código de convite recebido.</p></div>
          <input className="field" placeholder="Cole o código aqui..." value={importCode} onChange={e => setImportCode(e.target.value)} />
          <Button variant="tinted" icon="login" onClick={joinGuild}>Entrar na Guilda</Button>
        </div>
      </div>
    )
  }

  const displayMembers = [...guildData.members.filter(m => !m.isMe && m.name !== myStats.name), myStats]
  const sortedMembers = displayMembers.sort((a, b) => (b[activeTab] || 0) - (a[activeTab] || 0))
  
  const top3 = sortedMembers.slice(0, 3)
  const rest = sortedMembers.slice(3)

  let podiumOrder = [];
  if (top3.length === 1) podiumOrder = [top3[0]];
  else if (top3.length === 2) podiumOrder = [top3[1], top3[0]];
  else podiumOrder = [top3[1], top3[0], top3[2]];

  const podiumHeights = { 1: 130, 2: 100, 3: 85 }
  const podiumColors = { 
    1: { bg: 'rgba(255, 215, 0, 0.15)', border: '#ffd700', text: '#ffd700' }, 
    2: { bg: 'rgba(192, 192, 192, 0.15)', border: '#c0c0c0', text: '#c0c0c0' }, 
    3: { bg: 'rgba(205, 127, 50, 0.15)', border: '#cd7f32', text: '#cd7f32' } 
  }

  const formatStat = (m) => {
    if (activeTab === 'dias') return `${m.dias || 0} dias`
    if (activeTab === 'volSemana') return `${fmtNum(m.volSemana || 0)} kg`
    if (activeTab === 'volTotal') return `${fmtNum(m.volTotal || 0)} kg`
    if (activeTab === 'streak') return `${m.streak || 0} sem.`
    if (activeTab === 'metaPct') {
      const pct = Math.round(m.metaPct || 0);
      return `${pct}% da meta`
    }
  }

  return (
    <div className="narrow" style={{ paddingBottom: 100 }}>
      <div className="hdr" style={{ marginBottom: 20, marginTop: 20 }}>
        <div>
          <h1 style={{ fontSize: 28 }}>{guildData.name}</h1>
          <div className="sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="users" style={{ fontSize: 14 }} /> {guildData.members.length} membros</div>
        </div>
        <button className="iconbtn" onClick={leaveGuild} title="Sair da Guilda" style={{ background: 'var(--surface)', color: 'var(--red)' }}><Icon name="logout" /></button>
      </div>

      {/* Painel de Destaque do Próprio Usuário */}
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
          const pos = sortedMembers.indexOf(m) + 1;
          const style = podiumColors[pos];
          return (
            <div key={m.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '32%', maxWidth: '120px' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: m.isMe ? 'var(--acc)' : 'var(--surface-3)', color: m.isMe ? '#000' : 'var(--label)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 20, border: `2px solid ${style.border}`, marginBottom: 8, boxShadow: m.isMe ? '0 0 16px var(--acc)' : 'none' }}>{getInitial(m.name)}</div>
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
            const pos = sortedMembers.indexOf(m) + 1;
            return (
              <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: m.isMe ? '2px solid var(--acc)' : '1px solid var(--sep)' }}>
                <div style={{ fontSize: 16, fontWeight: 800, width: 25, color: 'var(--label-2)' }}>{pos}º</div>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: m.isMe ? 'var(--acc)' : 'var(--surface-3)', color: m.isMe ? '#000' : 'var(--label)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 14 }}>{getInitial(m.name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 15, color: 'var(--label)' }}>{m.name} {m.isMe && <span style={{ color: 'var(--acc)', fontSize: 11 }}>(Você)</span>}</div></div>
                <div style={{ fontWeight: 600, color: 'var(--label-2)', fontSize: 14 }}>{formatStat(m)}</div>
              </div>
            )
          })}
        </div>
      )}

      <div className="card" style={{ background: 'var(--surface)', border: '1px dashed var(--sep)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 24, gap: 12 }}>
        <div style={{ background: 'var(--acc-soft)', padding: 12, borderRadius: '50%', color: 'var(--acc)', marginBottom: 4 }}><Icon name="share" style={{ fontSize: 24 }} /></div>
        <h2 style={{ fontSize: 18, textAlign: 'center' }}>Convidar Amigos</h2>
        <p className="small muted" style={{ textAlign: 'center', marginBottom: 8 }}>Copie o código abaixo e envie no grupo da academia.</p>
        <Button variant="primary" icon="copy" onClick={generateInvite} style={{ width: '100%' }}>Copiar Código da Guilda</Button>
      </div>
    </div>
  )
}