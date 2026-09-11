/* =========================================================================
   CONFIG — ゲームバランス調整用（ここの数値を変えるだけで調整可能）
   ========================================================================= */
const CONFIG = {
  // 難易度：クリア目標スコア（"低＞高" の順で並べる: n → pn → p）
  difficulties: [
    { id:'n',  label:'n（初級）',  target:1000 },
    { id:'pn', label:'pn（中級）', target:4000 },
    { id:'p',  label:'p（上級）',  target:12000 },
  ],
  // レアドロップ確率（クリア時に判定）。0.1 = 10%
  // Cloud Functionsを使わない構成のため、この抽選はクライアント側で行う。
  // firestore.rules 側でスコア・タイムの範囲と1回あたりの加算上限をチェックし、被害を限定する。
  rareDropRate: 0.10,
  // レアドロップ時の獲得量 = クリア目標スコア × この割合
  rareDropRatio: 0.30,

  // 強化アイテム 全10種類（クリック強化2 + 自動生産8）
  // baseCost: 初期解放コスト / costMultiplier: 解放を重ねるごとのコスト上昇倍率（1〜6倍の範囲で個別設定）
  // value: 1レベルごとに増える効果量
  upgrades: [
    // --- クリック強化（2種） ---
    { id:'c1', type:'click', name:'クリック力+1',  desc:'1クリックの獲得量+1',        baseCost:20,   costMultiplier:1.6, value:1 },
    { id:'c2', type:'click', name:'クリック力+5',  desc:'1クリックの獲得量+5',        baseCost:250,  costMultiplier:1.8, value:5 },

    // --- 自動生産（8種） ---
    { id:'a1', type:'auto', name:'ドナー準位',     desc:'自動生産 +1/秒',   baseCost:15,    costMultiplier:1.15, value:1 },
    { id:'a2', type:'auto', name:'アクセプタ準位', desc:'自動生産 +2/秒',   baseCost:60,    costMultiplier:1.3,  value:2 },
    { id:'a3', type:'auto', name:'接合面拡張',     desc:'自動生産 +4/秒',   baseCost:150,   costMultiplier:1.5,  value:4 },
    { id:'a4', type:'auto', name:'空乏層強化',     desc:'自動生産 +8/秒',   baseCost:400,   costMultiplier:1.8,  value:8 },
    { id:'a5', type:'auto', name:'キャリア増倍',   desc:'自動生産 +15/秒',  baseCost:900,   costMultiplier:2.2,  value:15 },
    { id:'a6', type:'auto', name:'格子欠陥制御',   desc:'自動生産 +30/秒',  baseCost:2000,  costMultiplier:3,    value:30 },
    { id:'a7', type:'auto', name:'量子井戸層',     desc:'自動生産 +60/秒',  baseCost:5000,  costMultiplier:4,    value:60 },
    { id:'a8', type:'auto', name:'超格子構造',     desc:'自動生産 +120/秒', baseCost:9000,  costMultiplier:5,    value:120 },
  ],
};

/* =========================================================================
   STATE
   ========================================================================= */
let state = null;      // 現在進行中のプレイのstate
let semiconductorCount = 0; // 恒久所持数（n型半導体）。Firestoreの users/{uid} と同期
let playerName = '';        // ランキング表示名。Firestoreの users/{uid} と同期
let tickHandle = null;

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, (c)=>({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

// Firebase初期化完了後、保存済みのプレイヤーデータ（n型半導体数・名前）を読み込む
window.addEventListener('firebase-init-loaded', async ()=>{
  try{
    const data = await window.FirebaseAPI.getUserData();
    semiconductorCount = data.semiconductorCount;
    playerName = data.displayName || '';
    renderDifficultyScreen();
  }catch(err){
    console.error('プレイヤーデータの読み込みに失敗しました', err);
  }
});

function newRunState(diffIndex){
  return {
    diffIndex,
    elapsed: 0,
    score: 0,
    clickPower: 1 + semiconductorCount, // n型半導体1個につきクリック力+1（恒久ボーナス）
    autoPerSec: 0,
    levels: CONFIG.upgrades.map(()=>0),
    finished: false,
  };
}

function upgradeCost(u, level){
  return Math.ceil(u.baseCost * Math.pow(u.costMultiplier, level));
}

/* =========================================================================
   画面遷移
   ========================================================================= */
function go(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+name).classList.add('active');
  if(name === 'difficulty') renderDifficultyScreen();
}

/* =========================================================================
   難易度選択画面
   ========================================================================= */
let selectedDiff = 0;

function renderDifficultyScreen(){
  const dc = document.getElementById('diff-choices');
  dc.innerHTML = '';
  CONFIG.difficulties.forEach((d,i)=>{
    const chip = document.createElement('div');
    chip.className = 'chip' + (i===selectedDiff ? ' selected' : '');
    chip.textContent = d.label + '（目標 ' + d.target + '）';
    chip.onclick = ()=>{ selectedDiff = i; renderDifficultyScreen(); };
    dc.appendChild(chip);
  });

  document.getElementById('diff-summary').textContent =
    CONFIG.difficulties[selectedDiff].label + ' ／ 所持n型半導体: ' + semiconductorCount + '個（開始時クリック力+' + semiconductorCount + '）';

  const nameInput = document.getElementById('player-name');
  if(nameInput && document.activeElement !== nameInput){
    nameInput.value = playerName;
  }
  if(nameInput && !nameInput.dataset.bound){
    nameInput.dataset.bound = '1';
    nameInput.addEventListener('input', (e)=>{ playerName = e.target.value; });
  }
}

/* =========================================================================
   ゲーム開始・進行
   ========================================================================= */
function startGame(){
  state = newRunState(selectedDiff);
  renderUpgrades();
  updateHud();
  go('game');
  if(tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(gameTick, 1000);
}

function gameTick(){
  if(!state || state.finished) return;
  state.elapsed += 1;
  state.score += state.autoPerSec;
  const target = CONFIG.difficulties[state.diffIndex].target;

  if(state.score >= target){
    finishGame();
    return;
  }
  updateHud();
}

function onClick(){
  if(!state || state.finished) return;
  state.score += state.clickPower;
  const target = CONFIG.difficulties[state.diffIndex].target;
  if(state.score >= target){
    finishGame();
    return;
  }
  updateHud();
}

function updateHud(){
  const target = CONFIG.difficulties[state.diffIndex].target;
  document.getElementById('hud-score').textContent = state.score;
  document.getElementById('hud-dps').textContent = '自動生産 ' + state.autoPerSec + ' /秒';
  document.getElementById('hud-timer').textContent = '経過 ' + fmtTime(state.elapsed);

  const pct = Math.min(100, Math.floor((state.score/target)*100));
  document.getElementById('gauge-fill').style.width = pct + '%';
  document.getElementById('gauge-text').textContent = '達成率 ' + pct + '%';
  document.getElementById('gauge-target').textContent = state.score + ' / ' + target;

  renderUpgrades();
}

function fmtTime(sec){
  const m = Math.floor(sec/60).toString().padStart(2,'0');
  const s = Math.floor(sec%60).toString().padStart(2,'0');
  return m+':'+s;
}

function renderUpgrades(){
  const wrap = document.getElementById('upgrade-list');
  wrap.innerHTML = '';
  CONFIG.upgrades.forEach((u, idx)=>{
    const level = state.levels[idx];
    const cost = upgradeCost(u, level);
    const affordable = state.score >= cost;

    const row = document.createElement('div');
    row.className = 'upg' + (affordable ? '' : ' disabled');
    row.onclick = ()=> buyUpgrade(idx);

    const left = document.createElement('div');
    left.className = 'u-name';
    left.innerHTML = '<b>' + u.name + ' Lv.' + level + '</b><span>' + u.desc + '</span>';

    const right = document.createElement('div');
    right.className = 'u-cost';
    right.textContent = cost + ' pt';

    row.appendChild(left);
    row.appendChild(right);
    wrap.appendChild(row);
  });
}

function buyUpgrade(idx){
  const u = CONFIG.upgrades[idx];
  const level = state.levels[idx];
  const cost = upgradeCost(u, level);
  if(state.score < cost) return;

  state.score -= cost;
  state.levels[idx] += 1;
  if(u.type === 'click') state.clickPower += u.value;
  else state.autoPerSec += u.value;

  updateHud();
}

function abortGame(){
  if(tickHandle) clearInterval(tickHandle);
  state = null;
  go('home');
}

/* =========================================================================
   終了処理・リザルト
   ========================================================================= */
async function finishGame(){
  state.finished = true;
  if(tickHandle) clearInterval(tickHandle);

  const diff = CONFIG.difficulties[state.diffIndex];
  let dropped = false;
  let dropAmount = 0;

  if(Math.random() < CONFIG.rareDropRate){
    dropped = true;
    dropAmount = Math.floor(diff.target * CONFIG.rareDropRatio);
    semiconductorCount += dropAmount;
  }

  const badge = document.getElementById('result-badge');
  badge.className = 'result-badge clear';
  document.getElementById('result-title').textContent = 'クリア';
  document.getElementById('result-sub').textContent = '目標スコア ' + diff.target + ' に到達しました';
  document.getElementById('r-diff').textContent = diff.label;
  document.getElementById('r-score').textContent = state.score;
  document.getElementById('r-time').textContent = fmtTime(state.elapsed);
  document.getElementById('r-sc').textContent = semiconductorCount + ' 個';

  const banner = document.getElementById('drop-banner');
  if(dropped){
    banner.style.display = 'block';
    banner.textContent = 'レアドロップ： n型半導体 +' + dropAmount + '個';
  } else {
    banner.style.display = 'none';
  }
  go('result');

  if(!window.FirebaseAPI) return;
  try{
    await window.FirebaseAPI.saveResult({
      difficultyId: diff.id,
      difficultyIndex: state.diffIndex,
      score: state.score,
      timeSec: state.elapsed,
      dropAmount,
      displayName: playerName,
    });
  }catch(err){
    console.error('記録の保存に失敗しました', err);
    document.getElementById('result-sub').textContent = '目標スコア ' + diff.target + ' に到達しました（※ランキングへの記録送信に失敗しました）';
  }
}

/* =========================================================================
   ランキング画面
   ========================================================================= */
async function renderRanking(){
  const body = document.getElementById('ranking-body');
  body.innerHTML = '<div class="empty-note">読み込み中…</div>';

  if(!window.FirebaseAPI){
    body.innerHTML = '<div class="empty-note">ランキング機能を準備中です</div>';
    return;
  }

  let records;
  try{
    records = await window.FirebaseAPI.fetchRankings();
  }catch(err){
    console.error('ランキングの取得に失敗しました', err);
    body.innerHTML = '<div class="empty-note">ランキングの取得に失敗しました（通信環境をご確認ください）</div>';
    return;
  }

  if(records.length === 0){
    body.innerHTML = '<div class="empty-note">まだクリア記録がありません</div>';
    return;
  }

  const sorted = [...records].sort((a,b)=>{
    if(b.difficulty_index !== a.difficulty_index) return b.difficulty_index - a.difficulty_index; // 難易度高いほど上位
    if(b.score !== a.score) return b.score - a.score;                                             // スコア高いほど上位
    return a.time_sec - b.time_sec;                                                                // タイム短いほど上位
  });

  let html = '<table><thead><tr><th>#</th><th>名前</th><th>難易度</th><th>スコア</th><th>タイム</th></tr></thead><tbody>';
  sorted.forEach((r,i)=>{
    const diffLabel = (CONFIG.difficulties[r.difficulty_index] || {}).label || r.difficulty_id;
    html += '<tr><td>'+(i+1)+'</td><td>'+escapeHtml(r.display_name || '名無し')+'</td><td>'+diffLabel+'</td><td class="num">'+r.score+'</td><td class="num">'+fmtTime(r.time_sec)+'</td></tr>';
  });
  html += '</tbody></table>';
  body.innerHTML = html;
}

/* 初期表示 */
renderDifficultyScreen();
