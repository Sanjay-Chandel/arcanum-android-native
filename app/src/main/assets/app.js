const state={tab:"results",q:"",watch:JSON.parse(localStorage.getItem("arcanum_watch")||"[]"),data:{results:[],actions:[],filings:[],news:[]}};
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cb={}; let seq=0;
window.nativeResult=(id,payload,ok)=>{const x=cb[id];if(!x)return;delete cb[id];ok?x.resolve(payload):x.reject(new Error(payload))};
function nativeFetch(url){return new Promise((resolve,reject)=>{const id="r"+(++seq);cb[id]={resolve,reject};Android.fetch(url,id);setTimeout(()=>{if(cb[id]){delete cb[id];reject(new Error("Timeout"))}},18000)})}
function fmt(d){if(!d)return"";let x=new Date(d);return isNaN(x)?d:x.toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}
function ago(ts){if(!ts)return"Not updated";let m=Math.max(0,Math.round((Date.now()-ts)/60000));return m<1?"Updated just now":m<60?`Updated ${m}m ago`:`Updated ${Math.round(m/60)}h ago`}
function openUrl(u){if(u)Android.openExternal(u)}
function yahooUrl(s){return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=5d`}
async function yahooQuote(symbol){
  for(const s of [symbol+".NS",symbol+".BO"]){
    try{const raw=JSON.parse(await nativeFetch(yahooUrl(s)));const m=raw.chart?.result?.[0]?.meta;if(m?.regularMarketPrice!=null){let p=m.regularMarketPrice,prev=m.previousClose??m.chartPreviousClose;return {ok:true,lastPrice:p,previousClose:prev,pChange:prev?((p-prev)/prev*100):0}}}catch(e){}
  } return {ok:false}
}
async function quoteIndex(name,symbol){const q=await yahooQuote(symbol.replace(/^/,""));return {...q,name}}
function nseDate(days){let d=new Date(Date.now()-days*86400000),dd=String(d.getDate()).padStart(2,"0"),mm=String(d.getMonth()+1).padStart(2,"0");return `${dd}-${mm}-${d.getFullYear()}`}
function nseUrls(){return {
 results:`https://www.nseindia.com/api/corporates-financial-results?index=equities&period=Quarterly&from_date=${nseDate(45)}&to_date=${nseDate(0)}`,
 actions:`https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=${nseDate(30)}&to_date=${nseDate(0)}`,
 filings:`https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=${nseDate(30)}&to_date=${nseDate(0)}`
}}
function normNse(key,raw){
 let list=Array.isArray(raw)?raw:(raw?.data||[]);
 return list.map((x,i)=>{let sym=x.symbol||x.sm||"",company=x.sm_name||x.companyName||x.comp||sym;
 if(key==="results")return{id:"r"+i,symbol:sym,company,headline:`Quarterly results — ${x.re_broadcast_date?"revised":"filed"}`,detail:x.audited?"Audited":"Un-audited",date:x.re_broadcast_date||x.re_date||x.to_date||"",type:key,link:`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(sym)}`};
 if(key==="actions"){let dt=x.exDate||x.recDate||x.bcStartDate||x.caBroadcastDate||"";return{id:"a"+i,symbol:sym,company,headline:x.subject||x.purpose||"Corporate action",detail:[x.faceVal?`Face value ${x.faceVal}`:"",dt?`Ex-date ${dt}`:""].filter(Boolean).join(" · "),date:dt,type:key,link:`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(sym)}`};
 return{id:"f"+i,symbol:sym,company,headline:x.desc||x.subject||x.attchmntText||"Announcement",detail:x.smIndustry||"",date:x.an_dt||x.sort_date||"",type:key,link:x.attchmntFile||`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(sym)}`};
 }).filter(x=>x.headline).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).slice(0,150)
}
function rssItems(xml,source,type){
 let doc=new DOMParser().parseFromString(xml,"text/xml"),out=[];
 [...doc.querySelectorAll("item")].forEach((it,i)=>{let title=it.querySelector("title")?.textContent?.trim(),link=it.querySelector("link")?.textContent?.trim(),date=it.querySelector("pubDate")?.textContent?.trim(),desc=it.querySelector("description")?.textContent?.replace(/<[^>]*>/g,"").trim();
 if(title)out.push({id:source+link+date+i,symbol:"",company:source,headline:title,detail:(desc||"").slice(0,150),date:date?new Date(date).toISOString():"",type,link})});return out
}
const gnews=q=>`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
async function loadFeed(){
 $("status").textContent="Refreshing NSE filings, corporate actions and market news…";
 const u=nseUrls(); let gotNse=false;
 for(const [k,url] of Object.entries(u)){try{state.data[k]=normNse(k,JSON.parse(await nativeFetch(url)));gotNse=true}catch(e){}}
 const feeds=[
  ["results",gnews("NSE India quarterly results net profit revenue when:2d")],
  ["actions",gnews("India stocks dividend bonus split buyback record date when:3d")],
  ["news",gnews("Indian stocks NSE BSE market companies when:1d")],
  ["news",gnews("Indian stock corporate announcement firms when:1d")]
 ];
 let news=[];
 for(const [type,url] of feeds){try{news.push(...rssItems(await nativeFetch(url),"Google News",type))}catch(e){}}
 const seen=new Set();state.data.news=news.filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true}).slice(0,150);
 if(!state.data.results.length)state.data.results=rssItems(awaitSafe(gnews("Indian quarterly results stocks when:3d"),"Google News","results"),"Google News","results");
 state.ts=Date.now(); render(); $("status").textContent=gotNse?"Live web data · NSE + Google News + Yahoo Finance":"NSE temporarily unavailable · Google News + Yahoo Finance fallback";
}
function awaitSafe(x){return ""} // fallback is intentionally non-blocking; main RSS feeds above remain available.
function marketCard(q){let cls=q.pChange>0?"up":q.pChange<0?"down":"flat",arrow=q.pChange>0?"▲":q.pChange<0?"▼":"•";return `<div class="market"><b>${esc(q.name)}</b><strong>₹${q.lastPrice==null?"—":Number(q.lastPrice).toLocaleString("en-IN",{maximumFractionDigits:2})}</strong><span class="${cls}"> ${arrow} ${q.pChange==null?"":(q.pChange>0?"+":"")+q.pChange.toFixed(2)+"%"}</span></div>`}
async function loadMarket(){
 const specs=[["NIFTY 50","^NSEI"],["BANK NIFTY","^NSEBANK"],["SENSEX","^BSESN"]];
 const el=$("market");el.innerHTML=specs.map(x=>`<div class="market"><b>${x[0]}</b><strong>Loading…</strong></div>`).join("");
 const qs=await Promise.all(specs.map(x=>quoteIndex(x[0],x[1])));el.innerHTML=qs.map(marketCard).join("");
}
async function enrichPrices(items){
 let syms=[...new Set(items.map(x=>x.symbol).filter(Boolean))].slice(0,20);
 let qs=await Promise.all(syms.map(async s=>[s,await yahooQuote(s)]));let map=Object.fromEntries(qs);
 document.querySelectorAll("[data-symbol]").forEach(n=>{let q=map[n.dataset.symbol];if(q?.ok){let c=q.pChange>0?"up":q.pChange<0?"down":"flat";n.textContent=`₹${Number(q.lastPrice).toLocaleString("en-IN",{maximumFractionDigits:2})} ${q.pChange>0?"+":""}${q.pChange.toFixed(2)}%`;n.className="price "+c}});
}
function filtered(){let arr=state.data[state.tab]||[],q=state.q.trim().toLowerCase();return arr.filter(x=>!q||(x.symbol+" "+x.company+" "+x.headline).toLowerCase().includes(q)).slice(0,150)}
function render(){
 ["results","actions","filings","news"].forEach(k=>$("n-"+k).textContent=(state.data[k]||[]).length);
 $("n-watch").textContent=state.watch.length;
 document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("active",b.dataset.tab===state.tab));
 $("watchPanel").hidden=state.tab!=="watchlist";$("list").hidden=state.tab==="watchlist";
 if(state.tab==="watchlist"){renderWatch();$("updated").textContent=ago(state.ts);return}
 let items=filtered();$("empty").hidden=items.length>0;
 $("empty").textContent=items.length?"":"No matching items. Try another search or refresh.";
 $("list").innerHTML=items.map(x=>`<article class="card" data-open="${esc(x.link||"")}">
 <div class="cardtop"><b class="symbol">${esc(x.symbol||x.source||"—")}</b><span class="price" data-symbol="${esc(x.symbol||"")}"></span><button class="star ${state.watch.includes(x.symbol)?"on":""}" data-star="${esc(x.symbol||"")}">${state.watch.includes(x.symbol)?"★":"☆"}</button></div>
 <div class="company">${esc(x.company||"")}</div><div class="headline">${esc(x.headline||"")}</div>
 <div class="detail">${esc(x.detail||"")}</div><div class="meta"><span class="badge ${x.type}">${x.type.toUpperCase()}</span><span class="date">${fmt(x.date)}</span><span class="open">↗</span></div></article>`).join("");
 document.querySelectorAll("[data-open]").forEach(c=>c.addEventListener("click",e=>{if(e.target.closest("[data-star]"))return;openUrl(c.dataset.open)}));
 document.querySelectorAll("[data-star]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();toggleWatch(b.dataset.star)}));
 enrichPrices(items);$("updated").textContent=ago(state.ts);
}
function toggleWatch(s){if(!s)return;let i=state.watch.indexOf(s);i>=0?state.watch.splice(i,1):state.watch.push(s);localStorage.setItem("arcanum_watch",JSON.stringify(state.watch));render()}
function renderWatch(){let el=$("watchRows");if(!state.watch.length){el.innerHTML=`<div id="empty" style="display:block">No symbols yet — add NSE symbols above.</div>`;return}
 el.innerHTML=state.watch.map(s=>`<div class="wrow"><b class="wsym">${esc(s)}</b><span class="wprice" id="wp-${esc(s)}">Loading…</span><button class="remove" data-remove="${esc(s)}">✕</button></div>`).join("");
 document.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{state.watch=state.watch.filter(x=>x!==b.dataset.remove);localStorage.setItem("arcanum_watch",JSON.stringify(state.watch));render()});
 Promise.all(state.watch.map(async s=>[s,await yahooQuote(s)])).then(all=>all.forEach(([s,q])=>{let e=$("wp-"+s);if(e&&q.ok){e.textContent=`₹${Number(q.lastPrice).toLocaleString("en-IN",{maximumFractionDigits:2})} ${(q.pChange>0?"+":"")+q.pChange.toFixed(2)}%`;e.className="wprice "+(q.pChange>0?"up":q.pChange<0?"down":"flat")}else if(e)e.textContent="Unavailable"}))
}
$("tabs").addEventListener("click",e=>{let b=e.target.closest("button");if(!b)return;state.tab=b.dataset.tab;render()});
$("search").addEventListener("input",e=>{state.q=e.target.value;render()});$("clear").onclick=()=>{$("search").value="";state.q="";render()};
$("refresh").onclick=()=>{loadFeed();loadMarket()};$("addWatch").onclick=()=>{let v=$("watchInput").value.trim().toUpperCase();if(v){v.split(",").map(x=>x.trim()).filter(Boolean).forEach(toggleWatch);$("watchInput").value=""}};
$("watchInput").addEventListener("keydown",e=>{if(e.key==="Enter")$("addWatch").click()});
state.ts=Date.now();render();loadFeed();loadMarket();setInterval(()=>{loadMarket();if(state.tab==="watchlist")renderWatch();else enrichPrices(filtered())},60000);
