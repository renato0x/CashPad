(function(){
  "use strict";

  window.addEventListener('error', (e) => console.error('Uncaught:', e.message, e.filename, e.lineno));
  window.addEventListener('unhandledrejection', (e) => console.error('Unhandled rejection:', e.reason));

  const YOU_ID = "__you__";
  const YOU_NAME = "Voce";
  const fmt = v => (isNaN(v) ? 0 : v).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

  let state = { people: [], expenses: [], settlements: [] };
  let form = { editingId: null, mode: 'simples', participants: new Set(), items: [], payer: YOU_ID };
  let db = null;
  let unsubscribe = null;
  let isOnline = navigator.onLine;
  let persistenceAvailable = null;
  let hasPendingWrites = false;
  let lastSnapshotFromCache = false;
  let activeCode = null;
  let appCheckStarted = false;

  // ---------- online/offline detection ----------
  function updateConnectionStatus(){
    const banner = document.getElementById('offlineBanner');
    let message = '';

    if(!isOnline){
      if(persistenceAvailable === false){
        message = 'Sem conexao - mantenha o app aberto para nao perder alteracoes';
      } else if(hasPendingWrites){
        message = 'Sem conexao - alteracoes salvas neste dispositivo';
      } else {
        message = 'Sem conexao - usando dados salvos neste dispositivo';
      }
    } else if(hasPendingWrites){
      message = 'Sincronizando alteracoes...';
    } else if(lastSnapshotFromCache){
      message = 'Conexao instavel - usando dados locais';
    }

    banner.textContent = message;
    banner.classList.toggle('visible', Boolean(message));
    if(message){
      const h = banner.scrollHeight || 22;
      document.body.style.setProperty('--banner-h', h + 'px');
    } else {
      document.body.style.removeProperty('--banner-h');
    }
    document.body.classList.toggle('offline-on', !isOnline);
  }

  function updateOnlineStatus(){
    isOnline = navigator.onLine;
    updateConnectionStatus();
  }

  window.addEventListener('online', () => {
    updateOnlineStatus();
    initAppCheck();
    toast(hasPendingWrites ? 'Conectado! Sincronizando alteracoes...' : 'Conectado novamente');
  });
  window.addEventListener('offline', () => {
    updateOnlineStatus();
    toast(persistenceAvailable === false
      ? 'Sem conexao - mantenha o app aberto'
      : 'Sem conexao - alteracoes serao sincronizadas depois');
  });

  // ---------- firebase init ----------
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  const persistenceReady = db.enablePersistence({ synchronizeTabs: true })
    .then(() => {
      persistenceAvailable = true;
      updateConnectionStatus();
      return true;
    })
    .catch(e => {
      persistenceAvailable = false;
      console.warn('Persistence:', e.code);
      updateConnectionStatus();
      return false;
    });

  // ---------- App Check ----------
  function initAppCheck(){
    if(appCheckStarted || !navigator.onLine || typeof firebase.appCheck !== 'function') return;
    try{
      const appCheck = firebase.appCheck();
      appCheck.activate('6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI', true);
      appCheckStarted = true;
      console.log('App Check ativado');
    }catch(e){
      console.warn('App Check:', e.message);
    }
  }
  initAppCheck();

  // ---------- login ----------
  function getAccessCode(){ return localStorage.getItem('cashpad:code'); }
  function setAccessCode(code){ localStorage.setItem('cashpad:code', code); }

  function getDeviceId(){
    let id = localStorage.getItem('cashpad:deviceId');
    if(!id){
      id = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
      localStorage.setItem('cashpad:deviceId', id);
    }
    return id;
  }

  function generateCode(){
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for(let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  function isNetworkError(error){
    const message = String(error && error.message || '');
    return !navigator.onLine || error instanceof TypeError || /fetch|network|offline/i.test(message);
  }

  function showLogin(){
    document.getElementById('screenLogin').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.getElementById('loginStep1').style.display = '';
    document.getElementById('loginStep2').style.display = 'none';
    updateOfflineBlockOption();
  }
  function hideLogin(){
    document.getElementById('screenLogin').style.display = 'none';
    document.getElementById('app').style.display = '';
  }

  function updateOfflineBlockOption(){
    const savedCode = getAccessCode();
    const el = document.getElementById('offlineBlockOption');
    if(savedCode){
      el.style.display = '';
      document.getElementById('offlineCodeDisplay').textContent = savedCode;
    } else {
      el.style.display = 'none';
    }
  }

  // entrar no bloco offline (cache local)
  document.getElementById('btnOfflineLogin').addEventListener('click', async () => {
    const code = getAccessCode();
    if(!code){ toast('Nenhum bloco salvo'); return; }
    try{
      await persistenceReady;
      const snap = await docRef(code).get({ source: 'cache' });
      if(!snap.exists){
        toast('Bloco nao encontrado no cache');
        return;
      }
      hideLogin();
      initFirestore(code);
    }catch(e){
      toast('Erro ao ler cache local');
    }
  });

  // criar bloco novo
  document.getElementById('btnCreateBlock').addEventListener('click', async () => {
    const btn = document.getElementById('btnCreateBlock');
    if(!navigator.onLine){
      toast('Conecte-se para criar um bloco novo');
      return;
    }
    const code = generateCode();
    btn.classList.add('loading'); btn.disabled = true;
    try{
      const res = await fetch('/api/create-block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, deviceId: getDeviceId() })
      });
      const data = await res.json();

      if (data.needsConfirm) {
        btn.classList.remove('loading'); btn.disabled = false;
        const confirmed = await showDeleteConfirmation(data.existing);
        if (confirmed === 'join') {
          setAccessCode(data.existing.code);
          hideLogin();
          initFirestore(data.existing.code);
          return;
        }
        if (!confirmed) return;
        btn.classList.add('loading'); btn.disabled = true;
        const res2 = await fetch('/api/create-block', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, confirmDelete: data.existing.code, deviceId: getDeviceId() })
        });
        const data2 = await res2.json();
        if (!res2.ok) throw new Error(data2.error);
      } else if (!res.ok) {
        throw new Error(data.error);
      }

      setAccessCode(code);
      document.getElementById('loginGeneratedCode').textContent = code;
      document.getElementById('loginStep1').style.display = 'none';
      document.getElementById('loginStep2').style.display = '';
    }catch(e){
      toast(isNetworkError(e) ? 'Sem conexao com o servidor. Tente novamente.' : (e.message || 'Erro ao criar bloco. Tente novamente.'));
    } finally {
      btn.classList.remove('loading'); btn.disabled = false;
    }
  });

  // modal de confirmacao: bloco existente encontrado
  function showDeleteConfirmation(existing) {
    return new Promise(resolve => {
      const el = document.getElementById('screenConfirmDelete');
      const step2 = document.getElementById('deleteStep2');
      const input = document.getElementById('deleteStep2Input');
      const confirmBtn = document.getElementById('btnDeleteStep2Confirm');
      document.getElementById('confirmDeleteCode').textContent = existing.code;
      document.getElementById('deleteStep2Code').textContent = existing.code;
      const d = existing.createdAt ? new Date(existing.createdAt) : null;
      document.getElementById('confirmDeleteDate').textContent = d
        ? 'Criado em: ' + d.toLocaleDateString('pt-BR', {day:'2-digit', month:'short', year:'numeric'})
        : '';

      step2.style.display = 'none';
      input.value = '';
      confirmBtn.disabled = true;
      el.style.display = 'flex';
      requestAnimationFrame(() => el.classList.add('open'));

      function cleanup(result) {
        el.classList.remove('open');
        setTimeout(() => { el.style.display = ''; }, 300);
        step2.style.display = 'none';
        document.getElementById('btnEnterExisting').removeEventListener('click', onEnter);
        document.getElementById('btnConfirmDeleteProceed').removeEventListener('click', onProceedStep1);
        document.getElementById('btnConfirmDeleteCancel').removeEventListener('click', onCancel);
        document.getElementById('btnDeleteStep2Back').removeEventListener('click', onStep2Back);
        document.getElementById('btnDeleteStep2Confirm').removeEventListener('click', onConfirmFinal);
        input.removeEventListener('input', onInputChange);
        el.removeEventListener('click', onOverlay);
        resolve(result);
      }

      function onEnter() { cleanup('join'); }
      function onProceedStep1() {
        step2.style.display = '';
        input.focus();
      }
      function onStep2Back() { step2.style.display = 'none'; }
      function onConfirmFinal() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onOverlay(e) { if (e.target === el) cleanup(false); }
      function onInputChange() {
        confirmBtn.disabled = input.value.trim().toUpperCase() !== existing.code;
      }

      document.getElementById('btnEnterExisting').addEventListener('click', onEnter);
      document.getElementById('btnConfirmDeleteProceed').addEventListener('click', onProceedStep1);
      document.getElementById('btnConfirmDeleteCancel').addEventListener('click', onCancel);
      document.getElementById('btnDeleteStep2Back').addEventListener('click', onStep2Back);
      document.getElementById('btnDeleteStep2Confirm').addEventListener('click', onConfirmFinal);
      input.addEventListener('input', onInputChange);
      el.addEventListener('click', onOverlay);
    });
  }

  // copiar codigo
  document.getElementById('btnCopyCode').addEventListener('click', () => {
    const code = document.getElementById('loginGeneratedCode').textContent;
    navigator.clipboard.writeText(code).then(() => toast('Codigo copiado!'));
  });
  document.getElementById('loginGeneratedCode').addEventListener('click', () => {
    const code = document.getElementById('loginGeneratedCode').textContent;
    navigator.clipboard.writeText(code).then(() => toast('Codigo copiado!'));
  });

  // entrar com codigo
  document.getElementById('btnJoinBlock').addEventListener('click', async () => {
    const btn = document.getElementById('btnJoinBlock');
    const code = document.getElementById('loginCode').value.trim().toUpperCase();
    if(!code){ toast('Digite um codigo'); return; }
    btn.classList.add('loading'); btn.disabled = true;
    try{
      await persistenceReady;
      const snap = navigator.onLine
        ? await docRef(code).get()
        : await docRef(code).get({ source: 'cache' });
      if(!snap.exists){
        toast(navigator.onLine ? 'Codigo nao encontrado' : 'Este bloco nao esta salvo neste dispositivo');
        return;
      }
      setAccessCode(code);
      hideLogin();
      initFirestore(code);
    }catch(e){
      toast(navigator.onLine ? 'Erro ao buscar bloco' : 'Conecte-se uma vez para baixar este bloco');
    } finally {
      btn.classList.remove('loading'); btn.disabled = false;
    }
  });
  document.getElementById('loginCode').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('btnJoinBlock').click(); });

  // começar a usar
  document.getElementById('btnStartUsing').addEventListener('click', () => {
    hideLogin();
    initFirestore(getAccessCode());
  });

  // ---------- firestore storage ----------
  function docRef(code){ return db.collection('users').doc(code); }

  function initFirestore(code){
    if(unsubscribe) unsubscribe();
    activeCode = code;
    unsubscribe = docRef(code).onSnapshot({ includeMetadataChanges: true }, snap => {
      if(activeCode !== code) return;
      lastSnapshotFromCache = snap.metadata.fromCache;
      hasPendingWrites = snap.metadata.hasPendingWrites;
      updateConnectionStatus();

      if(snap.exists){
        const data = snap.data();
        state.people = data.people || [];
        state.expenses = data.expenses || [];
        state.settlements = data.settlements || [];
        if(data.theme) applyTheme(data.theme, false);
      } else {
        // A cache miss is not proof that the remote document does not exist.
        // Never initialize an empty block from an offline/cache-only snapshot.
        if(snap.metadata.fromCache){
          return;
        }

        if(getAccessCode() === code){
          localStorage.removeItem('cashpad:code');
          activeCode = null;
          if(unsubscribe){ unsubscribe(); unsubscribe = null; }
          showLogin();
          toast('Este bloco nao existe mais');
        }
        return;
      }
      renderAll();
    }, err => {
      console.error('Firestore error:', err);
      lastSnapshotFromCache = true;
      updateConnectionStatus();
      toast(navigator.onLine ? 'Erro ao sincronizar dados' : 'Usando os dados salvos neste dispositivo');
    });
  }

  function stateSnapshot(){
    return JSON.parse(JSON.stringify({
      people: state.people,
      expenses: state.expenses,
      settlements: state.settlements
    }));
  }

  function queueStateWrite(failureMessage){
    const code = getAccessCode();
    if(!code || !db){
      toast(failureMessage);
      return Promise.resolve(false);
    }
    hasPendingWrites = true;
    updateConnectionStatus();
    const write = docRef(code).set(stateSnapshot(), { merge: true });
    write.catch(error => {
      console.error(failureMessage, error);
      toast(failureMessage);
    });
    return write;
  }

  function savePeople(){
    queueStateWrite('Nao foi possivel salvar as pessoas');
  }

  function saveExpenses(){
    queueStateWrite('Nao foi possivel salvar o gasto');
  }

  function saveSettlement(payment, remove = false){
    const code = getAccessCode();
    if(!code || !db) return Promise.reject(new Error('Banco de dados indisponivel'));
    const operation = remove
      ? firebase.firestore.FieldValue.arrayRemove(payment)
      : firebase.firestore.FieldValue.arrayUnion(payment);
    hasPendingWrites = true;
    updateConnectionStatus();
    return docRef(code).update({ settlements: operation });
  }

  // ---------- init ----------
  async function bootstrap(){
    await persistenceReady;
    updateOnlineStatus();
    const savedCode = getAccessCode();

    if(!savedCode){
      showLogin();
      return;
    }

    if(!navigator.onLine){
      try{
        const cached = await docRef(savedCode).get({ source: 'cache' });
        if(!cached.exists) throw new Error('cache-miss');
      }catch(error){
        showLogin();
        toast('Conecte-se uma vez para baixar este bloco neste dispositivo');
        return;
      }
    }

    hideLogin();
    initFirestore(savedCode);
  }

  updateOnlineStatus();
  bootstrap();

  let toastTimeout = null;
  function toast(msg, undoFn){
    clearTimeout(toastTimeout);
    const t = document.getElementById('toast');
    t.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = msg;
    t.appendChild(span);
    if(undoFn){
      const btn = document.createElement('button');
      btn.className = 'toast-undo';
      btn.textContent = 'Desfazer';
      btn.addEventListener('click', async () => {
        t.classList.remove('show');
        await undoFn();
      });
      t.appendChild(btn);
    }
    t.classList.add('show');
    toastTimeout = setTimeout(()=>t.classList.remove('show'), undoFn ? 4000 : 1800);
  }

  function personName(id){
    if(id === YOU_ID) return YOU_NAME;
    const p = state.people.find(p=>p.id===id);
    return p ? p.name : '—';
  }

  // ---------- balance computation ----------
  function computeGross(){
    const perPerson = {};
    state.people.forEach(p => perPerson[p.id] = { grossOwed: 0, grossOwe: 0, paidByP: 0, paidToP: 0 });
    state.expenses.forEach(exp => {
      const shares = computeShares(exp);
      const payer = exp.payer || YOU_ID;
      Object.entries(shares).forEach(([pid, amount]) => {
        if(pid === payer) return;
        if(payer === YOU_ID){
          if(perPerson[pid]) perPerson[pid].grossOwed += amount;
        } else if(pid === YOU_ID){
          if(perPerson[payer]) perPerson[payer].grossOwe += amount;
        }
      });
    });
    (state.settlements || []).forEach(s => {
      if(s.to === YOU_ID && perPerson[s.from]) perPerson[s.from].paidByP += s.amount;
      if(s.from === YOU_ID && perPerson[s.to]) perPerson[s.to].paidToP += s.amount;
    });
    let youOwe = 0, owedToYou = 0;
    Object.values(perPerson).forEach(p => {
      p.homeOwed = Math.max(0, p.grossOwed - p.paidByP);
      p.homeOwe = Math.max(0, p.grossOwe - p.paidToP);
      p.net = p.grossOwed - p.grossOwe - p.paidByP + p.paidToP;
      owedToYou += p.homeOwed;
      youOwe += p.homeOwe;
    });
    return { youOwe, owedToYou, perPerson };
  }

  function computeShares(exp){
    const shares = {};
    const participants = exp.participants && exp.participants.length ? exp.participants : [YOU_ID];
    if(exp.mode === 'itens' && exp.items && exp.items.length){
      participants.forEach(p => shares[p] = 0);
      exp.items.forEach(it => {
        const val = parseBRNumber(it.value) || 0;
        let itemParticipants = it.participants;
        if(!itemParticipants && it.owner){
          itemParticipants = it.owner === 'none' ? participants : [it.owner];
        }
        if(!itemParticipants || !itemParticipants.length) itemParticipants = participants;
        const active = itemParticipants.filter(p => participants.includes(p));
        if(active.length && val){
          const each = val / active.length;
          active.forEach(p => shares[p] = (shares[p]||0) + each);
        }
      });
    } else {
      const val = parseBRNumber(exp.value) || 0;
      const each = participants.length ? val / participants.length : val;
      participants.forEach(p => shares[p] = each);
    }
    return shares;
  }

  function expenseTotal(exp){
    if(exp.mode === 'itens' && exp.items && exp.items.length){
      return exp.items.reduce((s,it)=>s+(parseBRNumber(it.value)||0), 0);
    }
    return parseBRNumber(exp.value) || 0;
  }

  // ---------- rendering: home ----------
  function renderAll(){
    renderHome();
  }

  function renderHome(){
    const gross = computeGross();
    document.getElementById('sumOwedToYou').textContent = fmt(gross.owedToYou);
    const netVal = gross.owedToYou - gross.youOwe;
    const netEl = document.getElementById('netLine');
    netEl.textContent = (netVal>=0? '+ ' : '- ') + fmt(Math.abs(netVal));
    netEl.style.color = netVal >= 0 ? 'var(--credit)' : 'var(--debit)';

    const list = document.getElementById('expenseList');
    const sorted = [...state.expenses].sort((a,b)=> b.date - a.date);
    if(!sorted.length){
      list.innerHTML = '<div class="empty-state"><div class="big">🧾</div><p>Nenhum gasto ainda.<br>Toque no + para anotar o primeiro.</p></div>';
      return;
    }
    list.innerHTML = sorted.map(exp => {
      const total = expenseTotal(exp);
      const d = new Date(exp.date);
      const dateStr = d.toLocaleDateString('pt-BR', {day:'2-digit', month:'short'});
      const nParticipants = (exp.participants||[]).length || 1;
      const payer = exp.payer || YOU_ID;
      let meta = dateStr+' . '+nParticipants+' pessoa'+(nParticipants>1?'s':'');
      if(payer !== YOU_ID) meta += ' . pago por '+escapeHtml(personName(payer));
      return '<div class="expense-card" data-id="'+exp.id+'" tabindex="0" role="button" aria-label="'+escapeHtml(exp.description||'Sem descricao')+' - '+fmt(total)+'">'+
        '<div class="info">'+
          '<div class="desc">'+escapeHtml(exp.description||'Sem descricao')+'</div>'+
          '<div class="meta">'+meta+'</div>'+
        '</div>'+
        '<div class="amount">'+fmt(total)+'</div>'+
      '</div>';
    }).join('');
    list.querySelectorAll('.expense-card').forEach(card => {
      card.addEventListener('click', () => openDetail(card.dataset.id));
      card.addEventListener('keydown', (e) => {
        if(e.key === 'Enter' || e.key === ' '){
          e.preventDefault();
          openDetail(card.dataset.id);
        }
      });
    });
  }

  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function parseBRNumber(v){
    if(typeof v !== 'string') return parseFloat(v) || 0;
    return parseFloat(v.replace(',', '.')) || 0;
  }

  // ---------- screens ----------
  function _openScreen(id){
    const screen = document.getElementById(id);
    screen.classList.add('open');
    screen.setAttribute('aria-hidden', 'false');
    if(id === 'screenInfo') document.getElementById('btnInfo').setAttribute('aria-expanded', 'true');
  }
  function _closeScreen(id){
    const screen = document.getElementById(id);
    screen.classList.remove('open');
    screen.setAttribute('aria-hidden', 'true');
    if(id === 'screenInfo') document.getElementById('btnInfo').setAttribute('aria-expanded', 'false');
  }

  function closeAllScreens(exceptId){
    document.querySelectorAll('.screen.open').forEach(screen => {
      if(screen.id !== exceptId) _closeScreen(screen.id);
    });
  }

  function openScreen(id){
    if (isDesktop) closeAllScreens(id);
    _openScreen(id);
    if (isDesktop) {
      if (id === 'screenBalances') updateSidebarActive('navBalancesSidebar');
      else if (id === 'screenPeople') updateSidebarActive('navPeopleSidebar');
      else updateSidebarActive('navHomeSidebar');
    }
  }
  function closeScreen(id){
    _closeScreen(id);
    if (isDesktop) {
      updateSidebarActive('navHomeSidebar');
    }
  }

  // ---------- people screen ----------
  function renderPeopleScreen(){
    const el = document.getElementById('peopleList');
    if(!state.people.length){
      el.innerHTML = '<p class="helper-text">Nenhuma pessoa cadastrada ainda.</p>';
      return;
    }
    el.innerHTML = state.people.map(p => 
      '<div class="person-row" data-id="'+p.id+'">'+
        '<div class="name">'+escapeHtml(p.name)+'</div>'+
        '<button class="icon-btn rm-person" data-id="'+p.id+'" aria-label="Remover '+escapeHtml(p.name)+'">'+
          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>'+
        '</button>'+
      '</div>').join('');
    el.querySelectorAll('.rm-person').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const usedInExpenses = state.expenses.some(ex =>
          (ex.participants || []).includes(id) ||
          ex.payer === id ||
          (ex.items || []).some(it => it.owner === id || (it.participants || []).includes(id))
        );
        const usedInPayments = (state.settlements || []).some(s => s.from === id || s.to === id);
        if(usedInExpenses || usedInPayments){
          toast('Esta pessoa possui movimentacoes e nao pode ser removida');
          return;
        }
        state.people = state.people.filter(p=>p.id!==id);
        savePeople();
        renderPeopleScreen();
        renderAll();
        toast('Pessoa removida');
      });
    });
  }

  document.getElementById('btnPeople').addEventListener('click', () => { renderPeopleScreen(); openScreen('screenPeople'); });
  document.getElementById('peopleClose').addEventListener('click', () => closeScreen('screenPeople'));
  document.getElementById('btnAddPerson').addEventListener('click', addPerson);
  document.getElementById('newPersonName').addEventListener('keydown', e => { if(e.key==='Enter') addPerson(); });
  function addPerson(){
    const input = document.getElementById('newPersonName');
    const name = input.value.trim();
    if(!name) return;
    state.people.push({id: uid(), name});
    input.value = '';
    savePeople();
    renderPeopleScreen();
    renderAll();
    toast('Pessoa adicionada');
  }

  // ---------- balances screen ----------
  function renderBalancesScreen(){
    const gross = computeGross();
    const credit = [];
    state.people.forEach(p => {
      const info = gross.perPerson[p.id];
      const net = info ? info.net : 0;
      if(net > 0.005){
        credit.push({id: p.id, name: p.name, val: net});
      }
    });
    const creditEl = document.getElementById('balCredit');

    if(!state.people.length){
      creditEl.innerHTML = '<div class="empty-state"><div class="big">👥</div><p>Adicione pessoas no menu <b>Pessoas</b> para comecar a dividir gastos.</p></div>';
      renderPaymentsList();
      return;
    }
    if(!credit.length){
      creditEl.innerHTML = '<div class="empty-state"><div class="big">✅</div><p>Tudo certo! Nenhum saldo pendente entre as pessoas.</p></div>';
      renderPaymentsList();
      return;
    }

    creditEl.innerHTML = credit.map(c =>
      '<div class="split-row">'+
        '<div class="name">'+escapeHtml(c.name)+'</div>'+
        '<div class="amt" style="color:var(--credit)">'+fmt(c.val)+'</div>'+
        '<div class="row-actions">'+
          '<button class="icon-btn pay-btn" data-id="'+c.id+'" data-action="receive" aria-label="Confirmar pagamento de '+escapeHtml(c.name)+'">'+
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'+
          '</button>'+
          '<button class="icon-btn share-btn" data-person="'+escapeHtml(c.name)+'" data-val="'+c.val.toFixed(2)+'" aria-label="Compartilhar com '+escapeHtml(c.name)+'">'+
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="18.49"/><line x1="15.41" y1="5.51" x2="8.59" y2="10.49"/></svg>'+
          '</button>'+
        '</div>'+
      '</div>'
    ).join('');

    document.querySelectorAll('.pay-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmPayment(btn.dataset.id, false);
      });
    });
    document.querySelectorAll('.share-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openShareModal(btn.dataset.person);
      });
    });
    renderPaymentsList();
    document.querySelectorAll('.undo-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const payment = (state.settlements || []).find(s => s.id === btn.dataset.id);
        if(payment) undoPayment(payment);
      });
    });
  }

  function confirmPayment(pid, isPaying){
    const gross = computeGross();
    const info = gross.perPerson[pid];
    if(!info) return;
    const net = isPaying ? -info.net : info.net;
    if(net <= 0.005) return;
    const payment = { id: uid(), from: isPaying ? YOU_ID : pid, to: isPaying ? pid : YOU_ID, amount: net, date: Date.now() };
    state.settlements.push(payment);
    renderAll();
    renderBalancesScreen();
    saveSettlement(payment).catch(err => {
      console.error('Pagamento:', err);
      state.settlements = state.settlements.filter(s => s.id !== payment.id);
      renderAll();
      renderBalancesScreen();
      toast('Nao foi possivel salvar o pagamento');
    });
    toast(isPaying
      ? 'Pagamento para ' + personName(pid) + ' registrado'
      : 'Pagamento de ' + personName(pid) + ' confirmado',
      () => undoPayment(payment));
  }

  function expenseAffectsPerson(expense, pid){
    const payer = expense.payer || YOU_ID;
    const participants = expense.participants || [];
    return (payer === YOU_ID && participants.includes(pid)) ||
      (payer === pid && participants.includes(YOU_ID));
  }

  function canUndoPayment(payment){
    const pid = payment.from === YOU_ID ? payment.to : payment.from;
    const hasLaterPayment = (state.settlements || []).some(s =>
      s.id !== payment.id &&
      (s.from === pid || s.to === pid) &&
      Number(s.date || 0) > Number(payment.date || 0)
    );
    const hasLaterExpense = state.expenses.some(exp =>
      expenseAffectsPerson(exp, pid) &&
      Number(exp.updatedAt || exp.date || 0) > Number(payment.date || 0)
    );
    return !hasLaterPayment && !hasLaterExpense;
  }

  function undoPayment(payment){
    if(!state.settlements.some(s => s.id === payment.id)) return;
    if(!canUndoPayment(payment)){
      toast('Nao foi possivel desfazer: o saldo ja mudou');
      return;
    }
    state.settlements = state.settlements.filter(s => s.id !== payment.id);
    renderAll();
    renderBalancesScreen();
    saveSettlement(payment, true).catch(err => {
      console.error('Desfazer pagamento:', err);
      if(!state.settlements.some(s => s.id === payment.id)) state.settlements.push(payment);
      renderAll();
      renderBalancesScreen();
      toast('Nao foi possivel desfazer o pagamento');
    });
    toast('Pagamento desfeito');
  }

  function renderPaymentsList(){
    const el = document.getElementById('paymentsList');
    const payments = (state.settlements || [])
      .filter(s => s.from === YOU_ID || s.to === YOU_ID)
      .sort((a,b) => b.date - a.date);
    if(!payments.length){
      el.innerHTML = '';
      return;
    }
    el.innerHTML = payments.map(s => {
      const incoming = s.to === YOU_ID;
      const label = incoming
        ? escapeHtml(personName(s.from)) + ' pagou ' + fmt(s.amount)
        : 'Voce pagou ' + fmt(s.amount) + ' para ' + escapeHtml(personName(s.to));
      const d = new Date(s.date);
      const dateStr = d.toLocaleDateString('pt-BR', {day:'2-digit', month:'short'});
      const canUndo = canUndoPayment(s);
      return '<div class="split-row settlement-row">'+
        '<div class="settle-info">'+
          '<div class="name">'+label+'</div>'+
          '<div class="meta">confirmado . '+dateStr+'</div>'+
        '</div>'+
        (canUndo ? '<div class="row-actions">'+
          '<button class="icon-btn undo-btn" data-id="'+s.id+'" aria-label="Desfazer pagamento">'+
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>'+
          '</button>'+
        '</div>' : '')+
      '</div>';
    }).join('');
  }
  document.getElementById('navBalances').addEventListener('click', () => {
    renderBalancesScreen();
    openScreen('screenBalances');
  });
  document.getElementById('balancesClose').addEventListener('click', () => closeScreen('screenBalances'));

  // FIXED: navHome handler
  document.getElementById('navHome').addEventListener('click', () => {
    closeScreen('screenBalances');
    closeScreen('screenForm');
    closeScreen('screenDetail');
    closeScreen('screenPeople');
    closeScreen('screenShare');
  });

  // ---------- Sidebar Navigation (Desktop) ----------
  document.getElementById('navHomeSidebar').addEventListener('click', () => {
    closeAllScreens();
    updateSidebarActive('navHomeSidebar');
  });

  document.getElementById('navBalancesSidebar').addEventListener('click', () => {
    renderBalancesScreen();
    openScreen('screenBalances');
    updateSidebarActive('navBalancesSidebar');
  });

  document.getElementById('navPeopleSidebar').addEventListener('click', () => {
    renderPeopleScreen();
    openScreen('screenPeople');
    updateSidebarActive('navPeopleSidebar');
  });

  function updateSidebarActive(activeId) {
    document.querySelectorAll('.sidebar-nav .nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.id === activeId);
    });
  }

  // ---------- expense form ----------
  function resetForm(){
    clearFieldErrors();
    form = { editingId: null, mode: 'simples', participants: new Set(), items: [], payer: YOU_ID };
    document.getElementById('fDesc').value = '';
    document.getElementById('fValor').value = '';
    setMode('simples');
    renderPayerSelect();
    renderParticipantChips();
    renderItems();
    document.getElementById('btnDeleteExpense').style.display = 'none';
    document.getElementById('formTitle').textContent = 'Novo gasto';
  }

  function renderPayerSelect(){
    const sel = document.getElementById('fPayer');
    sel.innerHTML = '<option value="'+YOU_ID+'">Voce</option>' +
      state.people.map(p => '<option value="'+p.id+'">'+escapeHtml(p.name)+'</option>').join('');
    sel.value = form.payer;
  }
  document.getElementById('fPayer').addEventListener('change', e => { form.payer = e.target.value; });

  function setMode(mode){
    form.mode = mode;
    document.getElementById('modeSimples').classList.toggle('active', mode==='simples');
    document.getElementById('modeItens').classList.toggle('active', mode==='itens');
    document.getElementById('simplesBlock').style.display = mode==='simples' ? '' : 'none';
    document.getElementById('itensBlock').style.display = mode==='itens' ? '' : 'none';
  }
  document.getElementById('modeSimples').addEventListener('click', () => setMode('simples'));
  document.getElementById('modeItens').addEventListener('click', () => { setMode('itens'); if(!form.items.length) addItem(); });

  function renderParticipantChips(){
    const el = document.getElementById('participantChips');
    const all = [{id: YOU_ID, name: YOU_NAME}, ...state.people];
    el.innerHTML = all.map(p => 
      '<div class="chip '+(form.participants.has(p.id)?'selected':'')+'" data-id="'+p.id+'">'+escapeHtml(p.name)+'</div>'
    ).join('');
    el.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.id;
        if(form.participants.has(id)){
          form.participants.delete(id);
          form.items.forEach(it => {
            it.participants = (it.participants || []).filter(p => p !== id);
          });
        } else {
          form.participants.add(id);
        }
        renderParticipantChips();
        renderItems();
      });
    });
  }

  function addItem(){
    form.items.push({id: uid(), name:'', value:'', participants: Array.from(form.participants)});
    renderItems();
  }
  document.getElementById('btnAddItem').addEventListener('click', addItem);

  let editingItemId = null;

  function formatCurrencyInput(input){
    let formatting = false;
    input.addEventListener('input', () => {
      if(formatting) return;
      formatting = true;
      let v = input.value.replace(/\./g, ',');
      v = v.replace(/[^0-9,]/g, '');
      const parts = v.split(',');
      if(parts.length > 2) v = parts[0] + ',' + parts.slice(1).join('');
      if(parts[1] && parts[1].length > 2) v = parts[0] + ',' + parts[1].slice(0, 2);
      input.value = v;
      formatting = false;
    });
    input.addEventListener('blur', () => {
      let v = input.value.trim();
      if(!v) return;
      if(!v.includes(',')){
        input.value = v + ',00';
      } else {
        const parts = v.split(',');
        if(parts[1].length === 1) input.value = v + '0';
      }
    });
  }

  function renderItems(){
    const el = document.getElementById('itemsContainer');
    el.innerHTML = form.items.map(it => {
      const n = (it.participants||[]).length;
      let displayVal = it.value;
      if(typeof it.value === 'number' && it.value > 0){
        displayVal = it.value.toFixed(2).replace('.', ',');
      }
      return '<div class="item-row" data-id="'+it.id+'">'+
        '<input type="text" placeholder="Item" value="'+escapeHtml(it.name)+'" class="it-name">'+
        '<input type="text" inputmode="decimal" placeholder="0,00" value="'+escapeHtml(displayVal)+'" class="it-value mono">'+
        '<button type="button" class="it-participants-btn" data-id="'+it.id+'">'+
          n + ' pessoa'+(n!==1?'s':'')+
        '</button>'+
        '<button type="button" class="rm" aria-label="Remover item">'+
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>'+
        '</button>'+
      '</div>';
    }).join('');
    el.querySelectorAll('.item-row').forEach(row => {
      const id = row.dataset.id;
      const item = form.items.find(i=>i.id===id);
      row.querySelector('.it-name').addEventListener('input', e => item.name = e.target.value);
      const valInput = row.querySelector('.it-value');
      valInput.addEventListener('input', e => item.value = e.target.value);
      formatCurrencyInput(valInput);
      row.querySelector('.it-participants-btn').addEventListener('click', () => openItemParticipants(id));
      row.querySelector('.rm').addEventListener('click', () => {
        form.items = form.items.filter(i=>i.id!==id);
        renderItems();
      });
    });
  }

  function openItemParticipants(itemId){
    editingItemId = itemId;
    const item = form.items.find(i=>i.id===itemId);
    if(!item) return;
    const itemParticipants = new Set(item.participants || []);
    const el = document.getElementById('itemParticipantsChips');
    const globalSet = form.participants instanceof Set ? form.participants : new Set(form.participants || []);
    const all = [{id: YOU_ID, name: YOU_NAME}, ...state.people]
      .filter(p => globalSet.has(p.id));
    el.innerHTML = all.map(p =>
      '<div class="chip '+(itemParticipants.has(p.id)?'selected':'')+'" data-id="'+p.id+'">'+escapeHtml(p.name)+'</div>'
    ).join('');
    el.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const pid = chip.dataset.id;
        if(itemParticipants.has(pid)) itemParticipants.delete(pid);
        else itemParticipants.add(pid);
        chip.classList.toggle('selected');
      });
    });
    document.getElementById('itemParticipantsTitle').textContent = item.name || 'Participantes do item';
    openScreen('screenItemParticipants');
  }

  document.getElementById('itemParticipantsClose').addEventListener('click', () => closeScreen('screenItemParticipants'));
  document.getElementById('itemParticipantsConfirm').addEventListener('click', () => {
    if(!editingItemId) return;
    const item = form.items.find(i=>i.id===editingItemId);
    if(!item) return;
    const chips = document.querySelectorAll('#itemParticipantsChips .chip.selected');
    item.participants = Array.from(chips).map(c => c.dataset.id);
    editingItemId = null;
    closeScreen('screenItemParticipants');
    renderItems();
  });

  function openNewExpense(){
    resetForm();
    form.participants = new Set([YOU_ID, ...state.people.map(p=>p.id)]);
    renderParticipantChips();
    openScreen('screenForm');
  }
  document.getElementById('btnAdd').addEventListener('click', openNewExpense);
  document.getElementById('formClose').addEventListener('click', () => {
    closeScreen('screenForm');
    closeScreen('screenDetail');
  });

  function openEditExpense(exp){
    form.editingId = exp.id;
    form.mode = exp.mode;
    form.payer = exp.payer || YOU_ID;
    form.participants = new Set(exp.participants || []);
    form.items = (exp.items||[]).map(it => {
      const item = {...it};
      if(!item.id) item.id = uid();
      if(!item.participants && item.owner){
        item.participants = item.owner === 'none' ? Array.from(form.participants) : [item.owner];
        delete item.owner;
      }
      if(!item.participants) item.participants = Array.from(form.participants);
      return item;
    });
    document.getElementById('fDesc').value = exp.description || '';
    const expVal = exp.value;
    document.getElementById('fValor').value = (typeof expVal === 'number' && expVal > 0) ? expVal.toFixed(2).replace('.', ',') : (expVal || '');
    setMode(exp.mode);
    renderPayerSelect();
    renderParticipantChips();
    renderItems();
    document.getElementById('btnDeleteExpense').style.display = '';
    document.getElementById('formTitle').textContent = 'Editar gasto';
    openScreen('screenForm');
  }

  function clearFieldErrors(){
    document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    document.querySelectorAll('.input-error-msg').forEach(el => el.remove());
  }
  function showFieldError(el, msg){
    el.classList.add('input-error');
    const err = document.createElement('div');
    err.className = 'input-error-msg';
    err.textContent = msg;
    el.parentNode.insertBefore(err, el.nextSibling);
  }

  document.getElementById('btnSaveExpense').addEventListener('click', () => {
    clearFieldErrors();
    const btn = document.getElementById('btnSaveExpense');
    const descEl = document.getElementById('fDesc');
    const valEl = document.getElementById('fValor');
    const description = descEl.value.trim();
    let hasError = false;

    if(!description){
      showFieldError(descEl, 'Digite uma descricao');
      hasError = true;
    }
    if(!form.participants.size){
      toast('Selecione ao menos um participante');
      hasError = true;
    }
    let value = null, items = null;
    if(form.mode === 'simples'){
      value = parseBRNumber(valEl.value);
      if(!value || value <= 0){
        showFieldError(valEl, 'Informe um valor valido');
        hasError = true;
      }
    } else {
      items = form.items.filter(it => it.name.trim() && parseBRNumber(it.value) > 0)
        .map(it => ({id: it.id, name: it.name.trim(), value: parseBRNumber(it.value), participants: it.participants || Array.from(form.participants)}));
      if(!items.length){ toast('Adicione ao menos um item valido'); hasError = true; }
    }
    if(hasError) return;

    btn.classList.add('loading'); btn.disabled = true;
    const expense = {
      id: form.editingId || uid(),
      description,
      mode: form.mode,
      value: form.mode==='simples' ? value : null,
      items: form.mode==='itens' ? items : [],
      participants: Array.from(form.participants),
      payer: form.payer,
      date: form.editingId ? (state.expenses.find(e=>e.id===form.editingId)||{}).date || Date.now() : Date.now(),
      updatedAt: Date.now()
    };
    if(form.editingId){
      state.expenses = state.expenses.map(e => e.id===form.editingId ? expense : e);
    } else {
      state.expenses.push(expense);
    }
    saveExpenses();
    renderAll();
    closeScreen('screenForm');
    toast('Gasto salvo');
    btn.classList.remove('loading'); btn.disabled = false;
  });

  document.getElementById('btnDeleteExpense').addEventListener('click', () => {
    if(!form.editingId) return;
    if(!confirm('Excluir este gasto?')) return;
    const deleted = state.expenses.find(e => e.id === form.editingId);
    state.expenses = state.expenses.filter(e => e.id !== form.editingId);
    saveExpenses();
    renderAll();
    closeScreen('screenForm');
    toast('Gasto excluido', deleted ? () => {
      state.expenses.push(deleted);
      saveExpenses();
      renderAll();
      toast('Gasto restaurado');
    } : null);
  });

  // ---------- detail screen ----------
  let currentDetailId = null;
  function openDetail(id){
    currentDetailId = id;
    const exp = state.expenses.find(e=>e.id===id);
    if(!exp) return;
    const total = expenseTotal(exp);
    document.getElementById('dTotal').textContent = fmt(total);
    document.getElementById('dDesc').textContent = exp.description;
    const d = new Date(exp.date);
    document.getElementById('dDate').textContent = d.toLocaleDateString('pt-BR', {day:'2-digit', month:'long', year:'numeric'}) + ' - pago por ' + personName(exp.payer||YOU_ID);
    const shares = computeShares(exp);
    const payer = exp.payer || YOU_ID;
    const rows = Object.entries(shares).map(([pid, amt]) => 
      '<div class="split-row">'+
        '<div>'+
          '<div class="name">'+escapeHtml(personName(pid))+'</div>'+
          impactLine(pid, amt, payer)+
        '</div>'+
        '<div class="amt">'+fmt(amt)+'</div>'+
      '</div>').join('');
    document.getElementById('dSplits').innerHTML = rows;
    openScreen('screenDetail');
  }
  function impactLine(pid, amt, payer){
    if(pid === payer) return '<div class="who-paid">pagou o total</div>';
    if(payer === YOU_ID) return '<div class="debt-line credit">'+escapeHtml(personName(pid))+' deve '+fmt(amt)+' a voce</div>';
    return '<div class="debt-line">'+escapeHtml(personName(pid))+' deve '+fmt(amt)+' a '+escapeHtml(personName(payer))+'</div>';
  }
  document.getElementById('detailClose').addEventListener('click', () => closeScreen('screenDetail'));
  document.getElementById('detailEdit').addEventListener('click', () => {
    const exp = state.expenses.find(e=>e.id===currentDetailId);
    if(!exp) return;
    openEditExpense(exp);
    closeScreen('screenDetail');
  });

  // ---------- share modal ----------
  function generateShareMessage(personNameVal){
    const recipientId = state.people.find(p=>p.name===personNameVal)?.id;
    if(!recipientId) return '';
    const gross = computeGross();
    const net = (gross.perPerson[recipientId] || {}).net || 0;
    if(net < 0.005) return '';

    const totalSettled = (state.settlements || [])
      .filter(s => (s.from === recipientId && s.to === YOU_ID) || (s.from === YOU_ID && s.to === recipientId))
      .reduce((sum, s) => sum + (s.amount || 0), 0);

    const allEntries = [];
    state.expenses.forEach(exp => {
      const shares = computeShares(exp);
      if(!(shares[recipientId] || 0)) return;
      const payer = exp.payer || YOU_ID;
      if(payer === YOU_ID){
        allEntries.push({ exp, share: shares[recipientId], date: exp.date || 0 });
      }
    });
    allEntries.sort((a,b) => Number(a.date) - Number(b.date));

    let remaining = totalSettled;
    const pending = [];
    for(const entry of allEntries){
      if(remaining <= 0.005){
        pending.push(entry);
        continue;
      }
      if(remaining >= entry.share - 0.005){
        remaining -= entry.share;
      } else {
        pending.push({ ...entry, share: entry.share - remaining });
        remaining = 0;
      }
    }

    if(!pending.length) return '';

    let msg = '*CashPad - Resumo de gastos*\n\n';
    msg += 'Opa, ' + personNameVal + '! Segue o resumo dos gastos:\n\n';

    let receiveTotal = 0;
    pending.forEach(entry => {
      receiveTotal += entry.share;
      msg += '*' + entry.exp.description + '* - ' + fmt(entry.share) + '\n';
      msg += itemBreakdown(entry.exp, recipientId);
    });
    msg += 'Subtotal: ' + fmt(receiveTotal) + '\n\n';

    msg += '----------------------------\n';
    msg += '*Saldo final:* voce me deve ' + fmt(receiveTotal) + '\n';
    msg += '----------------------------\n';

    return msg;
  }

  function itemBreakdown(exp, personId){
    if(exp.mode !== 'itens' || !exp.items || !exp.items.length) return '';
    let s = '';
    exp.items.forEach(item => {
      const itemParts = item.participants || [];
      if(!itemParts.length || itemParts.includes(personId)){
        const val = parseBRNumber(item.value) || 0;
        const activeCount = itemParts.filter(p => {
          const expParts = exp.participants || [];
          return !expParts.length || expParts.includes(p);
        }).length || 1;
        s += '  - ' + item.name + ': ' + fmt(val / activeCount) + '\n';
      }
    });
    return s;
  }

  function openShareModal(personNameVal, isCredit, balanceVal){
    const msg = generateShareMessage(personNameVal);
    if(!msg){ toast('Saldo ja quitado, nada a compartilhar'); return; }
    document.getElementById('sharePreview').textContent = msg;
    document.getElementById('shareTitle').textContent = 'Compartilhar com ' + personNameVal;

    const whatsappUrl = 'https://wa.me/?text=' + encodeURIComponent(msg);
    document.getElementById('btnWhatsAppShare').href = whatsappUrl;
    
    openScreen('screenShare');
  }

  document.getElementById('shareClose').addEventListener('click', () => closeScreen('screenShare'));
  document.getElementById('btnCopyShare').addEventListener('click', () => {
    const msg = document.getElementById('sharePreview').textContent;
    navigator.clipboard.writeText(msg).then(() => {
      toast('Mensagem copiada!');
      closeScreen('screenShare');
    }).catch(() => {
      toast('Erro ao copiar mensagem');
    });
  });
  document.getElementById('btnWhatsAppShare').addEventListener('click', async (e) => {
    if(!navigator.onLine){
      e.preventDefault();
      const msg = document.getElementById('sharePreview').textContent;
      try{
        if(navigator.share){
          await navigator.share({ text: msg });
        } else {
          await navigator.clipboard.writeText(msg);
          toast('Sem internet: mensagem copiada');
        }
      }catch(error){
        if(error && error.name !== 'AbortError') toast('Nao foi possivel compartilhar');
      }
    }
    closeScreen('screenShare');
  });

  // ---------- info modal ----------
  document.getElementById('btnInfo').addEventListener('click', () => {
    const code = getAccessCode();
    if(code){
      document.getElementById('infoCodeDisplay').textContent = code;
      openScreen('screenInfo');
    }
  });
  document.getElementById('infoClose').addEventListener('click', () => closeScreen('screenInfo'));
  document.getElementById('btnCopyInfoCode').addEventListener('click', () => {
    const code = document.getElementById('infoCodeDisplay').textContent;
    navigator.clipboard.writeText(code).then(() => toast('Codigo copiado!'));
  });

  // ---------- logout ----------
  document.getElementById('btnLogout').addEventListener('click', () => {
    if(!confirm('Sair deste bloco?')) return;
    if(unsubscribe) unsubscribe();
    unsubscribe = null;
    activeCode = null;
    hasPendingWrites = false;
    lastSnapshotFromCache = false;
    localStorage.removeItem('cashpad:code');
    localStorage.removeItem('cashpad:theme');
    document.documentElement.classList.remove('dark');
    state = { people: [], expenses: [], settlements: [] };
    updateConnectionStatus();
    closeScreen('screenInfo');
    showLogin();
    toast('Saiu do bloco');
  });

  formatCurrencyInput(document.getElementById('fValor'));

  // ---------- Lazy-load scripts ----------
  function loadScript(url){
    return new Promise((resolve, reject) => {
      if(document.querySelector('script[src="'+url+'"]')){ resolve(); return; }
      const s = document.createElement('script');
      s.src = url; s.crossOrigin = 'anonymous';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function loadQRCodeLib(){ return loadScript('/vendor/qrcode.min.js'); }
  function loadHtml5QrLib(){ return loadScript('/vendor/html5-qrcode.min.js'); }

  // ---------- QR Code generation ----------
  function renderQRCode(canvasId, code){
    const canvas = document.getElementById(canvasId);
    if(!canvas || !code) return;
    loadQRCodeLib().then(() => {
      if(typeof qrcode === 'undefined') return;
      const qr = qrcode(0, 'M');
      qr.addData(code);
      qr.make();
      const ctx = canvas.getContext('2d');
      const size = qr.getModuleCount();
      const cellSize = Math.floor(canvas.width / size);
      canvas.width = size * cellSize;
      canvas.height = size * cellSize;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000000';
      for(let row = 0; row < size; row++){
        for(let col = 0; col < size; col++){
          if(qr.isDark(row, col)){
            ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
          }
        }
      }
    }).catch(e => console.warn('QR load:', e));
  }

  function updateQRCodes(){
    const code = getAccessCode();
    if(!code) return;
    renderQRCode('infoQRCode', code);
    renderQRCode('loginQRCode', document.getElementById('loginGeneratedCode')?.textContent || code);
  }

  // ---------- QR Scanner ----------
  let html5QrScanner = null;
  document.getElementById('btnScanQR').addEventListener('click', () => {
    openScreen('screenQRScanner');
    requestAnimationFrame(() => setTimeout(startScanner, 200));
  });
  document.getElementById('scannerClose').addEventListener('click', () => {
    stopScanner();
    closeScreen('screenQRScanner');
  });

  function startScanner(){
    const el = document.getElementById('scannerVideo');
    if(!el){ return; }
    loadHtml5QrLib().then(() => {
      if(typeof Html5Qrcode === 'undefined'){
        toast('Erro ao carregar scanner. Tente novamente.');
        return;
      }
      html5QrScanner = new Html5Qrcode('scannerVideo');
      html5QrScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1 },
        (decodedText) => {
          const code = decodedText.trim().toUpperCase();
          if(/^[A-Z0-9]{6}$/.test(code)){
            stopScanner();
            closeScreen('screenQRScanner');
            document.getElementById('loginCode').value = code;
            document.getElementById('btnJoinBlock').click();
          }
        },
        () => {}
      ).catch((err) => {
        console.error('QR Scanner error:', err);
      toast('Nao foi possivel acessar a camera. Verifique as permissoes.');
      stopScanner();
      closeScreen('screenQRScanner');
    });
    }).catch(e => console.warn('QR lib load:', e));
  }

  function stopScanner(){
    if(html5QrScanner){
      html5QrScanner.stop().then(() => html5QrScanner.clear()).catch(e => console.warn('Scanner:', e));
      html5QrScanner = null;
    }
  }

  // ---------- Dark Mode ----------
  function applyTheme(theme, save){
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    const btn = document.getElementById('btnToggleDark');
    if(btn){
      btn.setAttribute('aria-checked', isDark);
    }
    if(save){
      localStorage.setItem('cashpad:theme', theme);
      const code = getAccessCode();
      if(code && db){
        docRef(code).set({ theme }, { merge: true }).catch(e => console.warn('Theme save:', e.code));
      }
    }
  }
  function toggleDarkMode(){
    const isDark = document.documentElement.classList.toggle('dark');
    const theme = isDark ? 'dark' : 'light';
    const btn = document.getElementById('btnToggleDark');
    if(btn){
      btn.setAttribute('aria-checked', isDark);
    }
    localStorage.setItem('cashpad:theme', theme);
    const code = getAccessCode();
    if(code && db){
      docRef(code).set({ theme }, { merge: true }).catch(e => console.warn('Theme save:', e.code));
    }
  }
  document.getElementById('btnToggleDark').addEventListener('click', toggleDarkMode);
  function initDarkMode(){
    const saved = localStorage.getItem('cashpad:theme');
    if(saved){
      applyTheme(saved, false);
    }
  }
  initDarkMode();

  // ---------- Desktop Mode Detection ----------
  let isDesktop = false;
  let isDesktopXL = false;

  function checkDesktopMode() {
    const wasDesktop = isDesktop;
    const wasDesktopXL = isDesktopXL;
    isDesktop = window.innerWidth >= 1200;
    isDesktopXL = window.innerWidth >= 1440;

    if (wasDesktop !== isDesktop || wasDesktopXL !== isDesktopXL) {
      updateDesktopUI();
    }
  }

  function updateDesktopUI() {
    if (isDesktop) {
      closeAllScreens();
      updateSidebarActive('navHomeSidebar');
    }
    renderAll();
  }

  window.addEventListener('resize', checkDesktopMode);
  checkDesktopMode();

  // ---------- First-entry guide ----------
  function showFirstGuide(){
    if(localStorage.getItem('cashpad:guided')) return;
    localStorage.setItem('cashpad:guided', '1');
    setTimeout(() => {
      toast('Bem-vindo! Toque em + para adicionar seu primeiro gasto. Acesse Saldos para ver quem deve.', null);
      const t = document.getElementById('toast');
      if(t){
        t.style.fontSize = '13px';
        t.style.maxWidth = '340px';
        t.style.whiteSpace = 'normal';
        t.style.textAlign = 'center';
        setTimeout(() => {
          t.style.fontSize = '';
          t.style.maxWidth = '';
          t.style.whiteSpace = '';
          t.style.textAlign = '';
        }, 6500);
      }
    }, 400);
  }

  // ---------- SW Update Notification ----------
  let swWaiting = null;
  let swReloading = false;
  function showUpdateToast(){
    const existing = document.querySelector('.toast-update');
    if(existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'toast-update';
    el.innerHTML = 'Nova versao disponivel! <button id="btnUpdateApp">Atualizar</button>';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    document.getElementById('btnUpdateApp').addEventListener('click', () => {
      if(!swWaiting){
        location.reload();
        return;
      }
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if(swReloading) return;
        swReloading = true;
        location.reload();
      }, { once: true });
      swWaiting.postMessage({type: 'SKIP_WAITING'});
    });
  }
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').then(reg => {
      if(reg.waiting){
        swWaiting = reg.waiting;
        showUpdateToast();
      }
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if(newWorker){
          newWorker.addEventListener('statechange', () => {
            if(newWorker.state === 'installed' && navigator.serviceWorker.controller){
              swWaiting = newWorker;
              showUpdateToast();
            }
          });
        }
      });
    }).catch(error => {
      console.error('Service Worker:', error);
      toast('Nao foi possivel preparar o modo offline');
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      swWaiting = null;
    });
  }

  // ---------- Hook hideLogin to show guide ----------
  const origHideLogin = hideLogin;
  hideLogin = function(){
    origHideLogin();
    showFirstGuide();
    updateQRCodes();
  };

  // ---------- Hook openScreen to update QR ----------
  const origOpenScreen = openScreen;
  openScreen = function(id){
    origOpenScreen(id);
    if(id === 'screenInfo') updateQRCodes();
  };
})();
