// ===== Shared =====
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const esc = v => (v===null||v===undefined) ? "" : String(v).replaceAll('"','""');
const toCSV = (rows)=>{ if(!rows||!rows.length) return ""; const headers=Object.keys(rows[0]); return [headers.join(","), ...rows.map(r=>headers.map(h=>`"${esc(r[h])}"`).join(","))].join("\n"); };

// Tabs
window.addEventListener("DOMContentLoaded", ()=>{
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
      document.querySelectorAll(".tabview").forEach(v=>v.classList.remove("active"));
      btn.classList.add("active");
      document.querySelector(btn.dataset.target).classList.add("active");
    });
  });
  document.getElementById("c_runBtn").onclick=c_run;
  document.getElementById("c_loadTop50").onclick=async()=>{ const syms=await cg_fetchTopN(50); document.getElementById("c_symbols").value=syms.join(", "); };
  document.getElementById("c_loadTop100").onclick=async()=>{ const syms=await cg_fetchTopN(100); document.getElementById("c_symbols").value=syms.join(", "); };
  document.getElementById("c_loadTop200").onclick=async()=>{ const syms=await cg_fetchTopN(200); document.getElementById("c_symbols").value=syms.join(", "); };
  document.getElementById("f_runBtn").onclick=f_run;
  document.getElementById("f_dlWeights").onclick=()=>{
    const csv = toCSV(weightHistory);
    const a = Object.assign(document.createElement("a"),{href:URL.createObjectURL(new Blob([csv],{type:"text/csv"})),download:"SURF_fx_weight_history.csv"});
    a.click();
  };
});

// ===== Math =====
function ema(arr, span){ const k=2/(span+1); let e=null; return arr.map(v=> e===null? (e=v) : (e=k*v + (1-k)*e)); }
function rollingMax(arr,n){ return arr.map((_,i)=>{ if(i<n-1) return NaN; let m=-Infinity; for(let j=i-n+1;j<=i;j++) m=Math.max(m,arr[j]); return m; }); }
function rollingStdPctChange(series,n){ const rets=series.map((v,i)=> i===0? NaN : (series[i]/series[i-1]-1)); return rets.map((_,i)=>{ if(i<n) return NaN; let sum=0,sum2=0,cnt=0; for(let j=i-n+1;j<=i;j++){ const x=rets[j]; if(isNaN(x)) continue; sum+=x; sum2+=x*x; cnt++; } if(cnt<=1) return NaN; const mean=sum/cnt; return Math.sqrt(Math.max(0,sum2/cnt - mean*mean)); }); }
function stdevArr(a){ const m=a.reduce((s,v)=>s+v,0)/a.length; return Math.sqrt(a.reduce((s,v)=>s+(v-m)*(v-m),0)/a.length); }

function getStage({ deep_dd, vol_high, whale, breakout }) {
  if (deep_dd && vol_high && whale && breakout) return "GO";
  if ((deep_dd && vol_high) || (whale && breakout)) return "READY";
  if (vol_high || breakout) return "WATCH";
  return "IDLE";
}

function getAction(stage) {
  switch(stage) {
    case "GO": return "BUY";
    case "READY": return "PREP";
    case "WATCH": return "OBSERVE";
    default: return "SKIP";
  }
}

// ===== CRYPTO =====
const CG = "https://api.coingecko.com/api/v3";
async function cg_listCoins(){ const r=await fetch(`${CG}/coins/list`); if(!r.ok) throw new Error("coins/list failed"); return await r.json(); }
function cg_mapSymbolsToIds(coins, symbols){ const idx={}; for(const c of coins){ const s=(c.symbol||"").toLowerCase(); if(!s) continue; (idx[s] ||= []).push(c.id) } const out={}; for(const s of symbols){ const arr=(idx[s]||[]).slice().sort((a,b)=>a.length-b.length); if(arr.length) out[s]=arr[0]; } return out; }
async function cg_fetchPrices90d(coinId){ const r=await fetch(`${CG}/coins/${coinId}/market_chart?vs_currency=usd&days=90&interval=daily`); if(!r.ok) throw new Error("prices failed"); const d=await r.json(); return (d.prices||[]).map(([ts,px])=>({date:new Date(ts).toISOString().slice(0,10), close:+px})); }
async function cg_fetchTopN(n){ const per_page=Math.min(250,Math.max(1,n)); const r=await fetch(`${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${per_page}&page=1`); if(!r.ok) throw new Error("markets failed"); const data=await r.json(); return data.map(x=> (x.symbol||"").toLowerCase()).filter(Boolean); }

function c_status(){ return document.getElementById("c_status"); }
function c_getSettings(){
  return {
    start_cap:+document.getElementById("c_start_capital").value||1000,
    symbols:document.getElementById("c_symbols").value.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean),
    fees_bps:+document.getElementById("c_fees_bps").value||0,
    max_alloc_pct:+document.getElementById("c_max_alloc_pct").value||20,
    max_positions:+document.getElementById("c_max_positions").value||10,
    stop_pct:+document.getElementById("c_stop_pct").value||0,
    trail_pct:+document.getElementById("c_trail_pct").value||0,
    breakout_pct:(+document.getElementById("c_breakout_pct").value||3)/100,
    days:+document.getElementById("c_days").value||90,
    w_base:+document.getElementById("c_w_base").value||1.0,
    w_breakout:+document.getElementById("c_w_breakout").value||0.5,
    w_whale:+document.getElementById("c_w_whale").value||1.0,
    w_deepdd:+document.getElementById("c_w_deepdd").value||0.7,
    w_cap:+document.getElementById("c_w_cap").value||2.5,
    deepdd_thresh_pct:+document.getElementById("c_deepdd_thresh_pct").value||95,
    dd_basis:document.getElementById("c_dd_basis")?.value || "rolling",
    delay_ms:+document.getElementById("c_delay_ms").value||800
  };
}
function getStage({ deep_dd, vol_high, whale, breakout }) {

  if (!deep_dd && !vol_high && !whale && !breakout) {
    return "WAIT";
  }

  if (deep_dd && !vol_high && !whale && !breakout) {
    return "SETUP";
  }

  if (deep_dd && (vol_high || whale) && !breakout) {
    return "PREP";
  }

  if (deep_dd && (vol_high || whale) && breakout) {
    return "GO";
  }

  if (breakout && !deep_dd) {
    return "LATE";
  }

  return "WAIT";
}
let c_equityChartInstance=null;
async function c_run(){
  try{
    c_status().textContent="Loading coin list…";
    const s=c_getSettings();
    const coins=await cg_listCoins();
    const map=cg_mapSymbolsToIds(coins, s.symbols);
    const pricesBySym={};
    for(const sym of s.symbols){
      if(!map[sym]) continue;
      c_status().textContent=`Fetching ${sym}…`;
      pricesBySym[sym]=await cg_fetchPrices90d(map[sym]);
      await sleep(s.delay_ms);
    }
    if(!Object.keys(pricesBySym).length){ c_status().textContent="No symbols fetched."; return; }
    c_status().textContent="Running…";
    const out=c_engine(pricesBySym, s);
    c_render(out);
    c_status().textContent="Done.";
  }catch(e){ c_status().textContent="Error: "+e.message; console.error(e); }
}

function c_engine(pricesBySym, s){
  const dates = Array.from(new Set(Object.values(pricesBySym).flat().map(r=>r.date))).sort();
  const syms = Object.keys(pricesBySym);
  const close={}; syms.forEach(k=> close[k]=dates.map(d=> (pricesBySym[k].find(r=>r.date===d)||{}).close || NaN));

  const ind={}; syms.forEach(k=>{
    const c=close[k]; const macd12=ema(c,12), macd26=ema(c,26);
    const macd=macd12.map((v,i)=>v-macd26[i]); const signal=ema(macd,9);
    const sma20=c.map((_,i)=>{ if(i<19) return NaN; let s=0; for(let j=i-19;j<=i;j++) s+=c[j]; return s/20; });
    const high10=rollingMax(c,10); const vol10=rollingStdPctChange(c,10);
    const ret=c.map((v,i)=> i===0? NaN : (c[i]/c[i-1]-1));
    // drawdowns vs rolling high
    const win=Math.min(s.days, c.length); const rollHigh=c.map((_,i)=>{const st=Math.max(0,i-win+1); let m=-Infinity; for(let j=st;j<=i;j++) m=Math.max(m,c[j]); return m;});
    const dd=c.map((v,i)=> (isNaN(v)||!isFinite(rollHigh[i])||rollHigh[i]==0)? NaN : (v/rollHigh[i]-1)*100);
    ind[k]={c,macd,signal,sma20,high10,vol10,ret,dd};
  });

  // Whale proxy: top decile return in universe
  const whale={}; syms.forEach(sy=> whale[sy]=dates.map(_=>false));
  for(let i=0;i<dates.length;i++){ const rets=syms.map(sy=>({sy,r:ind[sy].ret[i]})).filter(x=>!isNaN(x.r)); if(!rets.length) continue; rets.sort((a,b)=>a.r-b.r); const thr=rets[Math.floor(0.9*(rets.length-1))]?.r ?? NaN; for(const {sy,r} of rets){ if(r>=thr || (rets.length<10 && r===rets[rets.length-1].r)) whale[sy][i]=true; } }

  // Compute deep-DD percentile rank at latest
  const latestIdx=dates.length-1;
  const ddLatest = syms.map(sy=> ind[sy].dd[latestIdx]).filter(x=>!isNaN(x));
  const sorted=ddLatest.slice().sort((a,b)=>a-b);
  const rankPct = (x)=>{ let cnt=0; for(const v of sorted){ if(v<=x) cnt++; } return 100*cnt/sorted.length; };
  const ddRanks={}; syms.forEach(sy=> ddRanks[sy]=rankPct(ind[sy].dd[latestIdx]));

  let cash=s.start_cap; const units=Object.fromEntries(syms.map(sy=>[sy,0])); const entry=Object.fromEntries(syms.map(sy=>[sy,null]));
  const trades=[], equity=[];
  const crossUp=(sy,i)=> ind[sy].macd[i-1] < ind[sy].signal[i-1] && ind[sy].macd[i] > ind[sy].signal[i];
  const crossDn=(sy,i)=> ind[sy].macd[i-1] > ind[sy].signal[i-1] && ind[sy].macd[i] < ind[sy].signal[i];
  const openCount=()=> Object.values(units).filter(u=>u>0).length;
  const portVal=(i)=> cash + syms.reduce((sum,sy)=> sum + (units[sy]*(ind[sy].c[i]||0)), 0);

  for(let i=1;i<dates.length;i++){
    const dt=dates[i];
    // exits
    const sells=[];
    for(const sy of syms){
      if(units[sy]<=0) continue;
      const exitCross=crossDn(sy,i);
      if(exitCross) sells.push(sy);
    }
    for(const sy of sells){
      const px=ind[sy].c[i]; const u=units[sy]; cash += u*px; units[sy]=0; entry[sy]=null;
      trades.push({date:dt,symbol:sy,action:"SELL",price:px,units:u});
    }
    // entries
    let buys=[];
    for(const sy of syms){
      if(units[sy]>0) continue; if(!crossUp(sy,i)) continue;
      const row=ind[sy]; const prevHigh10=row.high10[i-1];
      const breakout = (!isNaN(row.ret[i]) && (row.ret[i] >= s.breakout_pct || (!isNaN(prevHigh10) && row.c[i] > prevHigh10)));
      const medVol = (()=>{ const vals=row.vol10.filter(v=>!isNaN(v)).slice().sort((a,b)=>a-b); return vals.length? vals[Math.floor(vals.length/2)] : NaN; })();
      const vol_high = !isNaN(row.vol10[i]) && !isNaN(medVol) && row.vol10[i] >= medVol;
      const whaleFlag = whale[sy][i]===true;
      const deepddFlag = (!isNaN(ddRanks[sy]) && ddRanks[sy] >= (s.deepdd_thresh_pct||95));
    const stage = getStage({
  deep_dd: deepddFlag,
  vol_high: vol_high,
  whale: whaleFlag,
  breakout: breakout
});

const action = getAction(stage);

const allowed = stage === "GO";
      if(allowed){
        let w = s.w_base + (breakout?s.w_breakout:0) + (whaleFlag?s.w_whale:0) + (deepddFlag?s.w_deepdd:0);
        w = Math.min(w, s.w_cap);
        buys.push({sy,w,tags:{breakout,vol_high,whale:whaleFlag,deep_dd:deepddFlag}});
      }
    }
    const room=Math.max(0, s.max_positions - openCount());
    if(buys.length>room) buys=buys.slice(0,room);
    if(buys.length){
      const total_w=buys.reduce((a,b)=>a+b.w,0); const pv=portVal(i-1);
      for(const b of buys){
        const px=ind[b.sy].c[i]; let alloc = cash*(b.w/total_w); const cap = pv*(s.max_alloc_pct/100); alloc=Math.min(alloc,cap);
        if(px>0 && alloc>0){
          const u=alloc/px; cash-=alloc; units[b.sy]+=u; entry[b.sy]=px;
          trades.push({date:dt,symbol:b.sy,action:"BUY",price:px,units:u,...b.tags});
        }
      }
    }
    equity.push({date:dt,equity:portVal(i)});
  }

  // factor outcomes
  const outcomes=[]; const by={}; for(const t of trades){ (by[t.symbol] ||= []).push(t); }
  for(const k of Object.keys(by)){ let e=null, tag=null; for(const t of by[k]){ if(t.action==="BUY" && !e){ e=t.price; tag={breakout:t.breakout,vol_high:t.vol_high,whale:t.whale,deep_dd:t.deep_dd}; } else if(t.action==="SELL" && e!=null){ outcomes.push({...tag,pnl:t.price-e,symbol:k}); e=null; } } }
  const factors=["breakout","vol_high","whale","deep_dd"];
  const fsum=factors.map(f=>{ const sub=outcomes.filter(o=>o[f]===true); const wins=sub.filter(o=>o.pnl>0).length; const wr=sub.length? (100*wins/sub.length):0; const avg=sub.length? (sub.reduce((a,b)=>a+b.pnl,0)/sub.length):0; const total=sub.reduce((a,b)=>a+b.pnl,0); return {factor:f,trades:sub.length,win_rate:wr.toFixed(1)+"%",avg_pnl:avg.toFixed(6),total_pnl:total.toFixed(6)}; });

  const summary={final_equity: equity.at(-1)?.equity || s.start_cap, roi_pct: ((equity.at(-1)?.equity || s.start_cap)/s.start_cap -1)*100, num_trades: trades.length};
  return {trades,equity,summary,factorSummary:fsum};
}

function c_render(out){
  const sum=document.getElementById("c_summary"); sum.innerHTML="";
  const kv=(k,v)=>`<div class="kv"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  sum.insertAdjacentHTML("beforeend", kv("Final Equity", `$${out.summary.final_equity.toFixed(2)}`));
  sum.insertAdjacentHTML("beforeend", kv("ROI", `${out.summary.roi_pct.toFixed(2)}%`));
  sum.insertAdjacentHTML("beforeend", kv("# Trades", out.summary.num_trades));

  const ctx=document.getElementById("c_equityChart").getContext("2d");
  if(window.c_equityChartInstance){ window.c_equityChartInstance.destroy(); }
  window.c_equityChartInstance = new Chart(ctx,{type:"line",data:{labels:out.equity.map(e=>e.date),datasets:[{label:"Equity ($)",data:out.equity.map(e=>e.equity)}]}});

  const ft=document.getElementById("c_factorTable");
  ft.innerHTML="<tr><th>Factor</th><th>Trades</th><th>Win Rate</th><th>Avg PnL</th><th>Total PnL</th></tr>";
  for(const r of out.factorSummary){ ft.insertAdjacentHTML("beforeend", `<tr><td>${r.factor}</td><td>${r.trades}</td><td>${r.win_rate}</td><td>${r.avg_pnl}</td><td>${r.total_pnl}</td></tr>`); }

  const tt=document.getElementById("c_tradesTable");
  if(out.trades.length){ const headers=Object.keys(out.trades[0]); tt.innerHTML="<tr>"+headers.map(h=>`<th>${h}</th>`).join("")+"</tr>"; for(const row of out.trades){ tt.insertAdjacentHTML("beforeend","<tr>"+headers.map(h=>`<td>${row[h]}</td>`).join("")+"</tr>"); } } else { tt.innerHTML="<tr><td>No trades.</td></tr>"; }

  document.getElementById("c_dlTrades").onclick=()=>{ const blob=new Blob([toCSV(out.trades)],{type:"text/csv"}); const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(blob),download:"SURF_crypto_trades.csv"}); a.click(); };
  document.getElementById("c_dlEquity").onclick=()=>{ const blob=new Blob([toCSV(out.equity)],{type:"text/csv"}); const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(blob),download:"SURF_crypto_equity.csv"}); a.click(); };
  document.getElementById("c_dlFactors").onclick=()=>{ const blob=new Blob([toCSV(out.factorSummary)],{type:"text/csv"}); const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(blob),download:"SURF_crypto_factors.csv"}); a.click(); };
}

// ===== FX (Adaptive) =====
const FX = "https://api.exchangerate.host";
async function fx_fetch_pair_series(pair, days){
  const base = pair.slice(0,3).toUpperCase();
  const quote = pair.slice(3).toUpperCase();
  const end = new Date(); const start=new Date(end.getTime()-days*24*3600*1000);
  const endStr=end.toISOString().slice(0,10); const startStr=start.toISOString().slice(0,10);
  const url = `${FX}/timeseries?start_date=${startStr}&end_date=${endStr}&base=${base}&symbols=${quote}`;
  const r=await fetch(url); if(!r.ok) throw new Error("fx fetch failed");
  const d=await r.json(); if(!d.rates) throw new Error("no rates");
  const arr = Object.keys(d.rates).sort().map(date=>({date, close: d.rates[date][quote]})).filter(x=>x.close);
  return arr;
}

function f_status(){ return document.getElementById("f_status"); }
function f_getSettings(){
  return {
    start_cap:+document.getElementById("f_start_capital").value||10000,
    pairs:document.getElementById("f_pairs").value.split(",").map(s=>s.trim().toUpperCase()).filter(Boolean),
    days:+document.getElementById("f_days").value||180,
    breakout_bp:+document.getElementById("f_breakout_bp").value||30,
    w_base:+document.getElementById("f_w_base").value||1.0,
    w_breakout:+document.getElementById("f_w_breakout").value||0.7,
    w_vol:+document.getElementById("f_w_vol").value||0.5,
    w_cap:+document.getElementById("f_w_cap").value||2.0,
    max_positions:+document.getElementById("f_max_positions").value||6,
    adapt_on: document.getElementById("f_adapt_on").checked,
    adapt_window:+document.getElementById("f_adapt_window").value||100,
    adapt_lr:+document.getElementById("f_adapt_lr").value||0.2
  };
}

function mean(a){ return a.length? a.reduce((s,v)=>s+v,0)/a.length : 0; }
let f_equityChartInstance=null;
let weightHistory=[];

async function f_run(){
  try{
    const s=f_getSettings();
    f_status().textContent="Fetching FX timeseries…";
    const seriesByPair={};
    for(const p of s.pairs){
      try{ seriesByPair[p]=await fx_fetch_pair_series(p, s.days); }catch(_){}
      await sleep(150);
    }
    f_status().textContent="Running FX engine…";
    weightHistory = [];
    const out=f_engine(seriesByPair, s);
    f_render(out, s);
    f_status().textContent="Done.";
  }catch(e){ f_status().textContent="Error: "+e.message; console.error(e); }
}

function f_engine(seriesByPair, s){
  const pairs=Object.keys(seriesByPair);
  const dates=Array.from(new Set(Object.values(seriesByPair).flat().map(r=>r.date))).sort();
  const price={}, ret={}, vol10={};
  pairs.forEach(p=>{
    price[p]=dates.map(d=> (seriesByPair[p].find(r=>r.date===d)||{}).close || NaN);
    ret[p]=price[p].map((v,i)=> i===0? NaN : (price[p][i]/price[p][i-1]-1));
    vol10[p]=ret[p].map((_,i)=>{ if(i<10) return NaN; const slice=ret[p].slice(i-9,i+1).filter(x=>!isNaN(x)); return slice.length? stdevArr(slice):NaN; });
  });

  // relative strength by currency (last 20d perf)
  const currencies = Array.from(new Set(pairs.flatMap(p=>[p.slice(0,3), p.slice(3)])));
  const rsScore = Object.fromEntries(currencies.map(c=>[c,0]));
  pairs.forEach(p=>{
    const a=price[p]; if(a.length<21) return;
    const perf = a.at(-1)/a.at(-21)-1;
    const base=p.slice(0,3), quote=p.slice(3);
    rsScore[base]+=perf; rsScore[quote]-=perf;
  });
  const rsTable = Object.entries(rsScore).map(([ccy,score])=>({ccy, score})).sort((a,b)=>b.score-a.score);

  // engine (breakout + vol) with adaptive weights
  let cash=s.start_cap; const posUnits=Object.fromEntries(pairs.map(p=>[p,0])); const trades=[], equity=[];
  let w_breakout = s.w_breakout, w_vol = s.w_vol;
  const openCount=()=> Object.values(posUnits).filter(x=>x!=0).length;
  const factorOutcomes=[];

  for(let i=1;i<dates.length;i++){
    const dt=dates[i];
    // exits
    const covers=[];
    for(const p of pairs){
      if(posUnits[p]==0) continue;
      const r = ret[p][i]; if(isNaN(r)) continue;
      const bp = Math.abs(r)*10000;
      if(bp < s.breakout_bp/2){ covers.push(p); }
    }
    for(const p of covers){
      const px=price[p][i]; const u=posUnits[p];
      const side = u>0? "LONG":"SHORT";
      cash += u*px; posUnits[p]=0;
      trades.push({date:dt,pair:p,action:"COVER",side,price:px,units:u});
      // link back to opening trade to compute pnl
      const openIdx = trades.slice().reverse().findIndex(t=>t.pair===p && (t.action==="BUY"||t.action==="SHORT"));
      const idx = openIdx>=0 ? trades.length-1-openIdx : -1;
      if(idx>=0){
        const tOpen = trades[idx];
        const pnl = (px - tOpen.price) * (tOpen.action==="BUY"? 1 : -1);
        factorOutcomes.push({breakout:tOpen.breakout, vol_high:tOpen.vol_high, pnl});
      }
    }

    // entries
    let buys=[];
    for(const p of pairs){
      if(posUnits[p]!=0) continue;
      const r=ret[p][i]; const v=vol10[p][i]; if(isNaN(r)||isNaN(v)) continue;
      const bp = Math.abs(r)*10000;
      const breakout = bp >= s.breakout_bp;
      const vol_high = v >= (isNaN(vol10[p][i-1])? v : vol10[p][i-1]);
      if(breakout && vol_high){
        let w = s.w_base + w_breakout + w_vol; w=Math.min(w, s.w_cap);
        const dir = (r>0)? 1 : -1;
        buys.push({p, w, dir, breakout, vol_high});
      }
    }
    const room=Math.max(0, s.max_positions - openCount());
    if(buys.length>room) buys=buys.slice(0,room);
    if(buys.length){
      const total_w = buys.reduce((a,b)=>a+b.w,0);
      for(const b of buys){
        const px=price[b.p][i];
        const alloc = cash*(b.w/total_w);
        const units = (alloc/px)*b.dir;
        cash -= alloc;
        posUnits[b.p]+=units;
        trades.push({date:dt,pair:b.p,action:(b.dir>0?"BUY":"SHORT"),price:px,units:units,breakout:b.breakout,vol_high:b.vol_high});
      }
    }

    // adaptive update (last N closed trades)
    if(s.adapt_on){
      const win = s.adapt_window;
      const windowTrades = factorOutcomes.slice(-win);
      if(windowTrades.length>=10){
        const brEdge = mean(windowTrades.filter(x=>x.breakout).map(x=>x.pnl));
        const voEdge = mean(windowTrades.filter(x=>x.vol_high).map(x=>x.pnl));
        const scale = (arr)=>{
          if(!arr.length) return 1;
          const med = arr.slice().sort((a,b)=>a-b)[Math.floor(arr.length/2)];
          const dev = arr.map(x=>Math.abs(x-med)).sort((a,b)=>a-b)[Math.floor(arr.length/2)] || 1;
          return Math.max(1e-6, dev);
        };
        const brSignal = Math.max(-1, Math.min(1, brEdge/scale(windowTrades.map(x=>x.pnl))));
        const voSignal = Math.max(-1, Math.min(1, voEdge/scale(windowTrades.map(x=>x.pnl))));
        w_breakout = Math.max(0, Math.min(s.w_cap, (1-s.adapt_lr)*w_breakout + s.adapt_lr*(s.w_breakout*(1+brSignal)) ));
        w_vol      = Math.max(0, Math.min(s.w_cap, (1-s.adapt_lr)*w_vol      + s.adapt_lr*(s.w_vol     *(1+voSignal)) ));
        weightHistory.push({date:dt, w_breakout, w_vol});
      }
    }

    const pv = cash + pairs.reduce((s2,p)=> s2 + (posUnits[p]*(price[p][i]||0)), 0);
    equity.push({date:dt,equity:pv});
  }

  const factors=["breakout","vol_high"];
  const agg={breakout:{},vol_high:{}};
  const winsb=factorOutcomes.filter(x=>x.breakout && x.pnl>0).length, totalb=factorOutcomes.filter(x=>x.breakout).length;
  const winsv=factorOutcomes.filter(x=>x.vol_high && x.pnl>0).length, totalv=factorOutcomes.filter(x=>x.vol_high).length;
  const factorSummary=[
    {factor:"breakout", trades:totalb, win_rate: totalb? (100*winsb/totalb).toFixed(1)+"%":"0%", avg_pnl: (totalb? mean(factorOutcomes.filter(x=>x.breakout).map(x=>x.pnl)):0).toFixed(6)},
    {factor:"vol_high", trades:totalv, win_rate: totalv? (100*winsv/totalv).toFixed(1)+"%":"0%", avg_pnl: (totalv? mean(factorOutcomes.filter(x=>x.vol_high).map(x=>x.pnl)):0).toFixed(6)}
  ];

  return {trades,equity,rsTable,factorSummary};
}

function f_render(out, s){
  const sum=document.getElementById("f_summary"); sum.innerHTML="";
  const startCap = +document.getElementById("f_start_capital").value||10000;
  const endEq = out.equity.at(-1)?.equity || startCap;
  const roi = (endEq/startCap - 1)*100;
  const kv=(k,v)=>`<div class="kv"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  sum.insertAdjacentHTML("beforeend", kv("Final Equity", `$${endEq.toFixed(2)}`));
  sum.insertAdjacentHTML("beforeend", kv("ROI", `${roi.toFixed(2)}%`));
  sum.insertAdjacentHTML("beforeend", kv("# Trades", out.trades.length));
  sum.insertAdjacentHTML("beforeend", kv("Adaptive", s.adapt_on? "On":"Off"));

  const ctx=document.getElementById("f_equityChart").getContext("2d");
  if(window.f_equityChartInstance){ window.f_equityChartInstance.destroy(); }
  window.f_equityChartInstance = new Chart(ctx,{type:"line",data:{labels:out.equity.map(e=>e.date),datasets:[{label:"FX Equity ($)",data:out.equity.map(e=>e.equity)}]}});

  const rst=document.getElementById("f_rs_table");
  rst.innerHTML="<tr><th>Rank</th><th>Currency</th><th>Relative Strength</th></tr>";
  out.rsTable.forEach((r,i)=> rst.insertAdjacentHTML("beforeend", `<tr><td>${i+1}</td><td>${r.ccy}</td><td>${r.score.toFixed(4)}</td></tr>`));

  const ft=document.getElementById("f_factorTable");
  ft.innerHTML="<tr><th>Factor</th><th>Trades</th><th>Win Rate</th><th>Avg PnL</th></tr>";
  out.factorSummary.forEach(r=> ft.insertAdjacentHTML("beforeend", `<tr><td>${r.factor}</td><td>${r.trades}</td><td>${r.win_rate}</td><td>${r.avg_pnl}</td></tr>`));

  const tt=document.getElementById("f_tradesTable");
  if(out.trades.length){ const headers=Object.keys(out.trades[0]); tt.innerHTML="<tr>"+headers.map(h=>`<th>${h}</th>`).join("")+"</tr>"; for(const row of out.trades){ tt.insertAdjacentHTML("beforeend","<tr>"+headers.map(h=>`<td>${row[h]}</td>`).join("")+"</tr>"); } } else { tt.innerHTML="<tr><td>No trades.</td></tr>"; }
}
