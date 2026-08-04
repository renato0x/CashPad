(function(){
  "use strict";
  const YOU_ID = "__you__";
  const YOU_NAME = "Voce";
  const fmt = v => (isNaN(v) ? 0 : v).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

  let state = { people: [], expenses: [] };
  let form = { editingId: null, mode: 'simples', participants: new Set(), items: [], payer: YOU_ID };
  let db = null;
  let unsubscribe = null;

  // ---------- firebase init ----------
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

  // ---------- login ----------
  function getAccessCode(){ return localStorage.getItem('divideai:code'); }
  function setAccessCode(code){ localStorage.setItem('divideai:code', code); }

  function generateCode(){
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for(let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  function showLogin(){
    document.getElementById('screenLogin').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.getElementById('loginStep1').style.display = '';
    document.getElementById('loginStep2').style.display = 'none';
  }
  function hideLogin(){
    document.getElementById('screenLogin').style.display = 'none';
    document.getElementById('app').style.display = '';
  }

  // criar bloco novo
  document.getElementById('btnCreateBlock').addEventListener('click', async () => {
    const code = generateCode();
    try{
      await docRef(code).set({ people: [], expenses: [] });
      setAccessCode(code);
      document.getElementById('loginGeneratedCode').textContent = code;
      document.getElementById('loginStep1').style.display = 'none';
      document.getElementById('loginStep2').style.display = '';
    }catch(e){
      toast('Erro ao criar bloco. Tente novamente.');
    }
  });

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
    const code = document.getElementById('loginCode').value.trim().toUpperCase();
    if(!code){ toast('Digite um codigo'); return; }
    try{
      const snap = await docRef(code).get();
      if(!snap.exists){
        toast('Codigo nao encontrado');
        return;
      }
      setAccessCode(code);
      hideLogin();
      initFirestore(code);
    }catch(e){
      toast('Erro ao buscar bloco');
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
    unsubscribe = docRef(code).onSnapshot(snap => {
      if(snap.exists){
        const data = snap.data();
        state.people = data.people || [];
        state.expenses = data.expenses || [];
      } else {
        state.people = [];
        state.expenses = [];
        docRef(code).set({ people: [], expenses: [] });
      }
      renderAll();
    }, err => {
      console.error('Firestore error:', err);
      toast('Erro ao sincronizar dados');
    });
  }

  function savePeople(){
    const code = getAccessCode();
    if(!code || !db) return;
    docRef(code).set({ people: state.people, expenses: state.expenses }, { merge: true })
      .catch(() => toast('Nao foi possivel salvar as pessoas'));
  }
  function saveExpenses(){
    const code = getAccessCode();
    if(!code || !db) return;
    docRef(code).set({ people: state.people, expenses: state.expenses }, { merge: true })
      .catch(() => toast('Nao foi possivel salvar o gasto'));
  }

  // ---------- init ----------
  const savedCode = getAccessCode();
  if(savedCode){
    hideLogin();
    initFirestore(savedCode);
  } else {
    showLogin();
  }

  function toast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'), 1800);
  }

  function personName(id){
    if(id === YOU_ID) return YOU_NAME;
    const p = state.people.find(p=>p.id===id);
    return p ? p.name : '—';
  }

  // ---------- balance computation ----------
  function computeNet(){
    const net = {};
    state.people.forEach(p => net[p.id] = 0);
    state.expenses.forEach(exp => {
      const shares = computeShares(exp);
      const payer = exp.payer || YOU_ID;
      Object.entries(shares).forEach(([pid, amount]) => {
        if(pid === payer) return;
        if(payer === YOU_ID){
          net[pid] = (net[pid]||0) + amount;
        } else if(pid === YOU_ID){
          net[payer] = (net[payer]||0) - amount;
        } else {
          // third-party payer
        }
      });
    });
    return net;
  }

  function computeShares(exp){
    const shares = {};
    const participants = exp.participants && exp.participants.length ? exp.participants : [YOU_ID];
    if(exp.mode === 'itens' && exp.items && exp.items.length){
      participants.forEach(p => shares[p] = 0);
      const noOwnerItems = [];
      exp.items.forEach(it => {
        const val = parseFloat(it.value) || 0;
        if(it.owner && it.owner !== 'none'){
          shares[it.owner] = (shares[it.owner]||0) + val;
        } else {
          noOwnerItems.push(val);
        }
      });
      const poolTotal = noOwnerItems.reduce((a,b)=>a+b,0);
      if(participants.length && poolTotal){
        const each = poolTotal / participants.length;
        participants.forEach(p => shares[p] = (shares[p]||0) + each);
      }
    } else {
      const val = parseFloat(exp.value) || 0;
      const each = participants.length ? val / participants.length : val;
      participants.forEach(p => shares[p] = each);
    }
    return shares;
  }

  function expenseTotal(exp){
    if(exp.mode === 'itens' && exp.items && exp.items.length){
      return exp.items.reduce((s,it)=>s+(parseFloat(it.value)||0), 0);
    }
    return parseFloat(exp.value) || 0;
  }

  // ---------- rendering: home ----------
  function renderAll(){
    renderHome();
  }

  function renderHome(){
    const net = computeNet();
    let owedToYou = 0, youOwe = 0;
    Object.values(net).forEach(v => { if(v > 0) owedToYou += v; else youOwe += -v; });
    document.getElementById('sumYouOwe').textContent = fmt(youOwe);
    document.getElementById('sumOwedToYou').textContent = fmt(owedToYou);
    const netVal = owedToYou - youOwe;
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
      return '<div class="expense-card" data-id="'+exp.id+'">'+
        '<div class="info">'+
          '<div class="desc">'+escapeHtml(exp.description||'Sem descricao')+'</div>'+
          '<div class="meta">'+dateStr+' . '+nParticipants+' pessoa'+(nParticipants>1?'s':'')+'</div>'+
        '</div>'+
        '<div class="amount">'+fmt(total)+'</div>'+
      '</div>';
    }).join('');
    list.querySelectorAll('.expense-card').forEach(card => {
      card.addEventListener('click', () => openDetail(card.dataset.id));
    });
  }

  function escapeHtml(s){
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---------- screens ----------
  function openScreen(id){ document.getElementById(id).classList.add('open'); }
  function closeScreen(id){ document.getElementById(id).classList.remove('open'); }

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
        const usedIn = state.expenses.some(ex => (ex.participants||[]).includes(id) || ex.payer === id || (ex.items||[]).some(it=>it.owner===id));
        if(usedIn && !confirm('Esta pessoa aparece em gastos existentes. Remover mesmo assim?')) return;
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
    const net = computeNet();
    const credit = [], debit = [];
    state.people.forEach(p => {
      const v = net[p.id] || 0;
      if(v > 0.005) credit.push({id:p.id, name:p.name, val:v});
      else if(v < -0.005) debit.push({id:p.id, name:p.name, val:-v});
    });
    const creditEl = document.getElementById('balCredit');
    const debitEl = document.getElementById('balDebit');
    creditEl.innerHTML = credit.length ? credit.map(c=>
      '<div class="split-row">'+
        '<div class="name">'+escapeHtml(c.name)+'</div>'+
        '<div class="amt" style="color:var(--credit)">'+fmt(c.val)+'</div>'+
        '<button class="icon-btn share-btn" data-person="'+escapeHtml(c.name)+'" data-type="credit" data-val="'+c.val.toFixed(2)+'" aria-label="Compartilhar com '+escapeHtml(c.name)+'">'+
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="18.49"/><line x1="15.41" y1="5.51" x2="8.59" y2="10.49"/></svg>'+
        '</button>'+
      '</div>'
    ).join('') : '<p class="helper-text">Ninguem te deve nada por aqui.</p>';
    debitEl.innerHTML = debit.length ? debit.map(c=>
      '<div class="split-row">'+
        '<div class="name">'+escapeHtml(c.name)+'</div>'+
        '<div class="amt" style="color:var(--debit)">'+fmt(c.val)+'</div>'+
        '<button class="icon-btn share-btn" data-person="'+escapeHtml(c.name)+'" data-type="debit" data-val="'+c.val.toFixed(2)+'" aria-label="Compartilhar com '+escapeHtml(c.name)+'">'+
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="18.49"/><line x1="15.41" y1="5.51" x2="8.59" y2="10.49"/></svg>'+
        '</button>'+
      '</div>'
    ).join('') : '<p class="helper-text">Voce nao deve nada por aqui.</p>';

    document.querySelectorAll('.share-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openShareModal(btn.dataset.person, btn.dataset.type === 'credit', parseFloat(btn.dataset.val));
      });
    });
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

  // ---------- expense form ----------
  function resetForm(){
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
        if(form.participants.has(id)) form.participants.delete(id);
        else form.participants.add(id);
        renderParticipantChips();
        renderItemOwnerOptions();
      });
    });
  }

  function addItem(){
    form.items.push({id: uid(), name:'', value:'', owner:'none'});
    renderItems();
  }
  document.getElementById('btnAddItem').addEventListener('click', addItem);

  function renderItems(){
    const el = document.getElementById('itemsContainer');
    el.innerHTML = form.items.map(it => 
      '<div class="item-row" data-id="'+it.id+'">'+
        '<input type="text" placeholder="Item" value="'+escapeHtml(it.name)+'" class="it-name">'+
        '<input type="number" placeholder="0,00" step="0.01" min="0" value="'+it.value+'" class="it-value mono">'+
        '<select class="it-owner">'+ownerOptions(it.owner)+'</select>'+
        '<button type="button" class="rm" aria-label="Remover item">'+
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>'+
        '</button>'+
      '</div>').join('');
    el.querySelectorAll('.item-row').forEach(row => {
      const id = row.dataset.id;
      const item = form.items.find(i=>i.id===id);
      row.querySelector('.it-name').addEventListener('input', e => item.name = e.target.value);
      row.querySelector('.it-value').addEventListener('input', e => item.value = e.target.value);
      row.querySelector('.it-owner').addEventListener('change', e => item.owner = e.target.value);
      row.querySelector('.rm').addEventListener('click', () => {
        form.items = form.items.filter(i=>i.id!==id);
        renderItems();
      });
    });
  }
  function ownerOptions(selected){
    const all = [{id:'none', name:'Sem dono (dividir)'}, {id:YOU_ID, name:YOU_NAME}, ...state.people];
    return all.map(p => '<option value="'+p.id+'" '+(p.id===selected?'selected':'')+'>'+escapeHtml(p.name)+'</option>').join('');
  }
  function renderItemOwnerOptions(){ renderItems(); }

  function openNewExpense(){
    resetForm();
    form.participants = new Set([YOU_ID, ...state.people.map(p=>p.id)]);
    renderParticipantChips();
    openScreen('screenForm');
  }
  document.getElementById('btnAdd').addEventListener('click', openNewExpense);
  document.getElementById('formClose').addEventListener('click', () => closeScreen('screenForm'));

  function openEditExpense(exp){
    form.editingId = exp.id;
    form.mode = exp.mode;
    form.payer = exp.payer || YOU_ID;
    form.participants = new Set(exp.participants || []);
    form.items = (exp.items||[]).map(it => ({...it}));
    document.getElementById('fDesc').value = exp.description || '';
    document.getElementById('fValor').value = exp.value || '';
    setMode(exp.mode);
    renderPayerSelect();
    renderParticipantChips();
    renderItems();
    document.getElementById('btnDeleteExpense').style.display = '';
    document.getElementById('formTitle').textContent = 'Editar gasto';
    openScreen('screenForm');
  }

  document.getElementById('btnSaveExpense').addEventListener('click', () => {
    const description = document.getElementById('fDesc').value.trim();
    if(!description){ toast('Digite uma descricao'); return; }
    if(!form.participants.size){ toast('Selecione ao menos um participante'); return; }
    let value = null, items = null;
    if(form.mode === 'simples'){
      value = parseFloat(document.getElementById('fValor').value);
      if(!value || value <= 0){ toast('Informe um valor valido'); return; }
    } else {
      items = form.items.filter(it => it.name.trim() && parseFloat(it.value) > 0)
        .map(it => ({name: it.name.trim(), value: parseFloat(it.value), owner: it.owner}));
      if(!items.length){ toast('Adicione ao menos um item valido'); return; }
    }
    const expense = {
      id: form.editingId || uid(),
      description,
      mode: form.mode,
      value: form.mode==='simples' ? value : null,
      items: form.mode==='itens' ? items : [],
      participants: Array.from(form.participants),
      payer: form.payer,
      date: form.editingId ? (state.expenses.find(e=>e.id===form.editingId)||{}).date || Date.now() : Date.now()
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
  });

  document.getElementById('btnDeleteExpense').addEventListener('click', () => {
    if(!form.editingId) return;
    if(!confirm('Excluir este gasto?')) return;
    state.expenses = state.expenses.filter(e => e.id !== form.editingId);
    saveExpenses();
    renderAll();
    closeScreen('screenForm');
    toast('Gasto excluido');
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
    const rows = Object.entries(shares).map(([pid, amt]) => 
      '<div class="split-row">'+
        '<div>'+
          '<div class="name">'+escapeHtml(personName(pid))+'</div>'+
          (pid===(exp.payer||YOU_ID) ? '<div class="who-paid">pagou o total</div>' : '')+
        '</div>'+
        '<div class="amt">'+fmt(amt)+'</div>'+
      '</div>').join('');
    document.getElementById('dSplits').innerHTML = rows;
    openScreen('screenDetail');
  }
  document.getElementById('detailClose').addEventListener('click', () => closeScreen('screenDetail'));
  document.getElementById('detailEdit').addEventListener('click', () => {
    const exp = state.expenses.find(e=>e.id===currentDetailId);
    if(!exp) return;
    closeScreen('screenDetail');
    openEditExpense(exp);
  });

  // ---------- share modal ----------
  function generateShareMessage(personNameVal, isCredit, balanceVal){
    const personExpenses = [];
    state.expenses.forEach(exp => {
      const shares = computeShares(exp);
      const participants = exp.participants || [];
      if(participants.includes(state.people.find(p=>p.name===personNameVal)?.id)){
        const share = shares[state.people.find(p=>p.name===personNameVal)?.id] || 0;
        personExpenses.push({
          description: exp.description,
          total: expenseTotal(exp),
          share: share,
          mode: exp.mode,
          items: exp.items || []
        });
      }
    });

    let msg = '*DivideAi - Resumo de gastos*\n\n';
    msg += 'Opa, ' + personNameVal + '! Segue o resumo dos gastos:\n\n';
    
    personExpenses.forEach(exp => {
      msg += '*' + exp.description + '* - ' + fmt(exp.share) + '\n';
      if(exp.mode === 'itens' && exp.items.length){
        exp.items.forEach(item => {
          msg += '  - ' + item.name + ': ' + fmt(item.value) + '\n';
        });
      }
    });

    msg += '\n----------------------------\n';
    if(isCredit){
      msg += '*Saldo final:* ' + ' voce deve ' + fmt(balanceVal) + ' pra mim ' + '\n';
    } else {
      msg += '*Saldo final:* Eu devo ' + fmt(balanceVal) + ' para você, ' + personNameVal + '\n';
    }
    msg += '----------------------------\n';

    return msg;
  }

  function openShareModal(personNameVal, isCredit, balanceVal){
    const msg = generateShareMessage(personNameVal, isCredit, balanceVal);
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
  document.getElementById('btnWhatsAppShare').addEventListener('click', (e) => {
    closeScreen('screenShare');
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then((reg) => console.log('SW registered:', reg.scope))
      .catch((err) => console.error('SW registration failed:', err));
  }
})();
