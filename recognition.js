'use strict';
const rankTemplates=require('./rank-templates.json');
const {classifyEnding}=require('./billing-rules');
const {chooseOwnPlayer}=require('./detail-player.cjs');
const clean=s=>String(s||'').normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[\s.!！。·_]/g,'');
const resultGroups={
 胜利:['VICTORY','WIN','WON','胜利','勝利','获胜','獲勝','勝利しました','勝ち','승리','VICTOIRE','VITORIA','VICTORIA','SIEG','VITTORIA','ПОБЕДА','KAZANDIN','ZAFFER','ZWYCIESTWO','VITEZSTVI','GYŐZELEM','VICTORIE','SEGER','VOITTO','ΝΙΚΗ','ชัยชนะ','MENANG','CHIEN THANG','فوز','انتصار'],
 失败:['DEFEAT','LOSS','LOST','失败','失敗','战败','戰敗','敗北','負け','패배','DEFAITE','DERROTA','NIEDERLAGE','SCONFITTA','ПОРАЖЕНИЕ','KAYBETTIN','YENILGI','PORAZKA','PROHRA','VERESÉG','INFRANGERE','FORLUST','TAPPIO','ΗΤΤΑ','พ่ายแพ้','KALAH','THAT BAI','هزيمة'],
 平局:['DRAW','TIE','平局','引き分け','무승부','EGALITE','MATCH NUL','EMPATE','UNENTSCHIEDEN','PAREGGIO','НИЧЬЯ','BERABERE','REMIS','REMiZA','DÖNTETLEN','EGAL','OAVGJORT','TASAPELI','ΙΣΟΠΑΛΙΑ','เสมอ','SERI','HOA','تعادل']
};
const results=new Map(Object.entries(resultGroups).flatMap(([result,labels])=>labels.map(label=>[clean(label),result])));
function scoreText(text){const normalized=String(text||'').normalize('NFKC').replace(/\s/g,'');const m=normalized.match(/^([0-9OoIl]{1,2})[-–—−:]([0-9OoIl]{1,2})$/);if(!m)return null;const number=s=>Number(s.replace(/[Oo]/g,'0').replace(/[Il]/g,'1'));return `${number(m[1])}-${number(m[2])}`;}
function suspiciousScore(score){const value=scoreText(score);if(!value)return true;const [a,b]=value.split('-').map(Number);return Math.max(a,b)>=14&&Math.abs(a-b)>2;}
function identify(icon,legacy=[]){
 const buckets=new Map();
 for(const sample of icon.normalized||[]){
  if(!Array.isArray(sample.pixels)||sample.pixels.length!==1728||!Array.isArray(sample.background)||sample.background.length!==3)continue;
  for(const template of rankTemplates){let sum=0;for(let i=0;i<1728;i++){const alpha=template.alpha[Math.floor(i/3)]/255;sum+=Math.abs(sample.pixels[i]-(template.rgb[i]*alpha+sample.background[i%3]*(1-alpha)));}const distance=sum/1728,previous=buckets.get(template.rank);if(!previous||distance<previous.distance)buckets.set(template.rank,{rank:template.rank,name:template.label||template.name,tier:template.tier,distance});}
 }
 const sorted=[...buckets.values()].sort((a,b)=>a.distance-b.distance),best=sorted[0];
 if(best&&best.distance<=24&&(best.distance<8||!sorted[1]||sorted[1].distance-best.distance>=1.5))return best.tier===0?{...best,rank:null,confidence:0}:{...best,confidence:Math.round(Math.max(0,1-best.distance/50)*100)};
 // Compatibility for screenshots parsed by an older OCR build.
 if(Array.isArray(icon.pixels)){let winner=null,distance=Infinity;for(const t of legacy){if(!Array.isArray(t.pixels)||t.pixels.length!==icon.pixels.length)continue;const d=icon.pixels.reduce((n,v,i)=>n+Math.abs(v-t.pixels[i]),0)/icon.pixels.length;if(d<distance){distance=d;winner=t.rank;}}if(distance<=24)return {rank:winner,confidence:Math.round((1-distance/100)*100)};}
 return {rank:null,confidence:0};
}
function parseOcr(raw,legacy=[]){
 if(raw.detail?.players?.length)return parseDetail(raw,legacy);
 const words=raw.words||[],lines=raw.lines||[],scale=Math.max(.5,(raw.width||899)/899),tolerance=20*scale;
 const icons=(raw.icons||[]).map(icon=>({...icon,...identify(icon,legacy)}));
 const rows=[];
 function add(candidate){const prior=rows.find(row=>Math.abs(row.y-candidate.y)<tolerance);if(prior){if(candidate.result&&prior.result==='待确认')prior.result=candidate.result;if(candidate.score&&(!prior.score||(suspiciousScore(prior.score)&&!suspiciousScore(candidate.score))))prior.score=candidate.score;if(candidate.source==='text'){prior.result=candidate.result;prior.source='text';}return prior;}const row={...candidate,result:candidate.result||'待确认',score:candidate.score||''};rows.push(row);return row;}
 for(const w of [...words,...lines]){const result=results.get(clean(w.text));if(result)add({y:w.y,x:w.x,result,source:'text'});}
 for(const v of raw.visual||[]){const nearby=rows.some(row=>Math.abs(row.y-v.y)<30*scale);const icon=icons.find(icon=>icon.rank&&Math.abs(icon.y-v.y)<45*scale);if(!v.anchored&&!nearby&&!icon)continue;let result=v.outcome==='win'?'胜利':v.outcome==='loss'?'失败':'待确认';const score=scoreText(v.score);if(score&&score.split('-')[0]===score.split('-')[1])result='平局';add({y:v.y,x:v.scoreX,result,score,source:'color'});}
 for(const anchor of words.filter(w=>/^(?:[KX][D0O]A|K\/D\/A)$/i.test(w.text))){if(!rows.some(row=>Math.abs(row.y-anchor.y)<40*scale))add({y:anchor.y+8*scale,source:'layout'});}
 if(!rows.length&&classifyEnding(raw.text||[...words,...lines].map(w=>w.text).join(' '))==='remake')add({y:0,result:'待确认',source:'ending'});
 rows.sort((a,b)=>a.y-b.y);
 for(let index=0;index<rows.length;index++){
  const row=rows[index],top=index?(rows[index-1].y+row.y)/2:row.y-30*scale,bottom=rows[index+1]?(row.y+rows[index+1].y)/2:row.y+65*scale;
  if(!row.score||suspiciousScore(row.score)){const score=[...words,...lines].filter(w=>w.y>row.y+6*scale&&w.y<bottom&&Number.isFinite(row.x)&&Math.abs(w.x-row.x)<140*scale).map(w=>({word:w,value:scoreText(w.text)})).filter(w=>w.value).sort((a,b)=>Number(suspiciousScore(a.value))-Number(suspiciousScore(b.value)))[0];if(score&&(!row.score||!suspiciousScore(score.value)))row.score=score.value;}
  const nearbyIcons=icons.filter(icon=>Math.abs(icon.y-row.y)<45*scale).sort((a,b)=>Math.abs(a.y-row.y)-Math.abs(b.y-row.y));
  const closestIcon=nearbyIcons[0];
  // Prefer a valid sample of the same row, without borrowing a neighbouring rank.
  const icon=closestIcon&&(nearbyIcons.filter(icon=>icon.rank&&Math.abs(icon.y-closestIcon.y)<10*scale).sort((a,b)=>b.confidence-a.confidence)[0]||closestIcon);
  const badges=[...words,...lines].filter(w=>w.y>=top&&w.y<bottom).map(w=>clean(w.text));
  let mvp=null;if(badges.some(s=>/MATCHMVP|全场最佳|全場最佳|全局最佳|マッチMVP|매치MVP/.test(s)))mvp='全场MVP';else if(badges.some(s=>/TEAMMVP|本队最佳|本隊最佳|团队最佳|團隊最佳|チームMVP|팀MVP/.test(s)))mvp='队内MVP';else if(badges.some(s=>s==='MVP'))mvp='MVP';
  row.id=index;row.rank=icon?.rank||null;row.rankName=icon?.name||null;row.confidence=icon?.confidence||0;row.icon=icon||null;row.mvp=mvp;row.selected=true;row.settled=true;row.ending=classifyEnding([...words,...lines].filter(w=>w.y>=top&&w.y<bottom).map(w=>w.text).join(' '));if(rows.length===1&&row.source==='ending')row.ending='remake';
 }
 const known=[...new Set(rows.map(row=>row.rank).filter(Boolean))],rank=known.length===1&&rows.every(row=>row.rank===known[0])?known[0]:null;
 return {matches:rows,rank,confidence:rank?Math.min(...rows.map(row=>row.confidence)):0,icons,text:raw.text||'',languages:raw.languages||[]};
}
function detailHeaderScore(raw){
 const words=raw.words||[],lines=raw.lines||[];
 const header=words.filter(w=>w.y<raw.detail.top&&results.has(clean(w.text))).sort((a,b)=>b.height-a.height)[0]||raw.detail.header;
 let result=header&&results.get(clean(header.text))||'待确认';
 const candidates={left:[],right:[]},verified=raw.detail.headerScoreVerification||{};
 const read=(text,source)=>{const value=String(text||'').normalize('NFKC').replace(/\s/g,'');if(!/^[0-9OoIl]{1,2}$/.test(value))return null;return {value:Number(value.replace(/[Oo]/g,'0').replace(/[Il]/g,'1')),text:value,source,normalizedAlias:!/^\d{1,2}$/.test(value)};};
 if(header){
  for(const word of words){
   if(Math.abs(word.y-header.y)>=header.height*.4||word.height<=header.height*.6)continue;
   const reading=read(word.text,word.language||'unknown');if(!reading)continue;
   const center=word.x+word.width/2,side=center<header.x?'left':word.x>header.x+header.width?'right':null;
   // Limit readings to the large score adjacent to the result label. A date
   // or a menu counter elsewhere on that horizontal line is not a score.
   if(!side||(side==='left'?header.x-center:center-header.x-header.width)>header.height*3)continue;
   candidates[side].push({...reading,confidence:Number.isFinite(Number(word.confidence))?Number(word.confidence):null,x:word.x,y:word.y,width:word.width,height:word.height});
  }
 }
 // A full title line is independent evidence only when it contains literal
 // digits. In particular, VICTORY I must not silently turn into 13-1.
 for(const line of lines.filter(l=>l.y<raw.detail.top)){
  const m=String(line.text||'').normalize('NFKC').match(/^(\d{1,2})\s+(.+?)\s+(\d{1,2})$/);
  if(!m||!results.has(clean(m[2])))continue;
  if(result==='待确认')result=results.get(clean(m[2]));
  for(const [side,value] of [['left',m[1]],['right',m[3]]])candidates[side].push({...read(value,line.language||'line'),confidence:Number.isFinite(Number(line.confidence))?Number(line.confidence):null,fromLine:true});
 }
 const evidence={},chosen={};let needsReview=false;
 for(const side of ['left','right']){
  const validVerification=verified[side]&&Number.isInteger(verified[side].value)&&verified[side].value>=0&&verified[side].value<=99;
  const literal=candidates[side].filter(c=>!c.normalizedAlias&&c.source!=='header-bundled');
  const values=[...new Set(literal.map(c=>c.value))];
  const selected=validVerification?{...verified[side],source:'header-bundled'}:literal.sort((a,b)=>(b.confidence??0)-(a.confidence??0))[0]||candidates[side][0];
  const review=!validVerification&&(!selected||selected.normalizedAlias||values.length>1||selected.source==='header-bundled');
  chosen[side]=selected;evidence[side]={selected:selected||null,candidates:candidates[side],verified:Boolean(validVerification),needsReview:review};needsReview=needsReview||review;
 }
 const candidate=chosen.left&&chosen.right?`${chosen.left.value}-${chosen.right.value}`:'';
 const score=needsReview?'':candidate;
 if(score&&chosen.left.value===chosen.right.value)result='平局';
 return {result,score,scoreCandidate:candidate,scoreNeedsReview:needsReview,scoreEvidence:evidence};
}
function parseDetail(raw,legacy){
 const players=raw.detail.players.map((player,index)=>{const icon={y:player.y,normalized:player.normalized||[]};Object.assign(icon,identify(icon,legacy));if(icon.confidence<65){icon.rank=null;if(icon.tier!==0)icon.name=null;icon.confidence=0;}return {id:index,y:player.y,screenshotY:player.y*(raw.originalHeight||raw.height)/raw.height,name:player.name||`第 ${index+1} 位玩家`,rank:icon.rank,rankName:icon.name||null,confidence:icon.confidence,icon,highlight:Number(player.highlight)||0,highlightEvidence:player.highlightEvidence||null};});
 const own=chooseOwnPlayer(players),words=raw.words||[],lines=raw.lines||[],headerScore=detailHeaderScore(raw);
 const match={id:0,y:raw.detail.top,...headerScore,rank:own?.rank||null,rankName:own?.rankName||null,confidence:own?.confidence||0,icon:own?.icon||null,mvp:null,selected:true,settled:true,ending:classifyEnding([...words,...lines].filter(w=>w.y<raw.detail.top).map(w=>w.text).join(' ')),playerId:own?.id??null};
 const ys=players.map(p=>p.y).filter(Number.isFinite).sort((a,b)=>a-b),gaps=ys.slice(1).map((y,i)=>y-ys[i]).filter(gap=>gap>0);
 const playerListIncomplete=gaps.length>=2&&gaps.some(gap=>gap>Math.min(...gaps)*1.65);
 const warning=headerScore.scoreNeedsReview?'详情比分未能确认，请手动核对。':playerListIncomplete?'详情页部分玩家未识别，请核对截图中的自己。':'';
 return {kind:'detail',matches:[match],players,playerListIncomplete,warning,rank:match.rank,confidence:match.confidence,icons:players.map(p=>p.icon),text:raw.text||'',languages:raw.languages||[]};
}
module.exports={parseOcr,identify,scoreText,suspiciousScore,rankTemplates};
