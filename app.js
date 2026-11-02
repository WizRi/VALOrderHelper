'use strict';
const $=id=>document.getElementById(id);
const RANKS=['匹配及下三','黄金','铂金','钻石','超凡','神话1','神话2','神话3','赋能'];
const PARTIES=['正常','1陪2','1陪4','2陪3','4陪1'];
const DISCOUNTS=[['1','无折扣'],['0.98','98折'],['0.97','97折'],['0.96','96折'],['0.95','95折'],['0.9','原价 × 9折（4陪1）'],['0.882','98折 × 9折（4陪1）'],['0.873','97折 × 9折（4陪1）'],['0.864','96折 × 9折（4陪1）'],['0.855','95折 × 9折（4陪1）']];
const TIERS={男陪:['娱乐','大神','王牌','镇店','金牌镇店','前职业'],女陪:['娱乐','精锐','大神','镇店']};
const token=new URLSearchParams(location.search).get('token')||sessionStorage.getItem('appToken');
if(token)sessionStorage.setItem('appToken',token);
history.replaceState(null,'',location.pathname);
let appliedBossName=null,editingId=null,draftBaseline=null,bulkPartyManual=false,legacyPartyAmbiguous=false,primaryBillingCache=null;
let state,recognition=null,imageUrl=null,busy=false,previewTimer,previewVersion=0,settingsPrices={},timeManual=false,extraManual=false,primaryOvertimeManual=false,primarySettledManual=false,billingManual=false,extraLines=[],screenshots=[],bulkRankManual=false,lastParty='正常';
async function api(route,data,raw=false){
 const r=await fetch('/api/'+route,{method:data===undefined?'GET':'POST',headers:{'x-app-token':token,...(data!==undefined&&!raw?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:raw?data:JSON.stringify(data)});
 const result=await r.json();if(!r.ok)throw new Error(result.error||'操作失败');return result;
}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,3500);}
function options(el,values,selected){el.replaceChildren(...values.map(value=>{const op=document.createElement('option');op.value=value;op.textContent=value;return op;}));if(selected&&values.includes(selected))el.value=selected;}
function sydneyNow(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const v=t=>p.find(x=>x.type===t).value;return {date:v('year')+'-'+v('month')+'-'+v('day'),time:v('hour')+':'+v('minute')};}
function updateOvertime(){const time=$('time').value;if(/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){const [hour,minute]=time.split(':').map(Number);$('extra').value=hour*60+minute>=180&&hour*60+minute<600?'1':'0';}syncOvertime();}
function setNow(){const value=sydneyNow();timeManual=false;extraManual=false;$('date').value=value.date;$('time').value=value.time;updateOvertime();}
function tickTime(){if(timeManual||editingId||busy)return;const value=sydneyNow();if($('date').value!==value.date||$('time').value!==value.time){$('date').value=value.date;$('time').value=value.time;if(!extraManual)updateOvertime();else queuePreview();}}

function quantityChoices(select,includeZero=false){options(select,[...(includeZero?['0']:[]),...Array.from({length:20},(_,i)=>String((i+1)/2)),'custom']);select.options[select.options.length-1].textContent='自定义…';}
function readCount(select,custom){return select.value==='custom'?custom.value:select.value;}
function writeCount(select,custom,value){const text=String(value);const known=[...select.options].some(o=>o.value===text);select.value=known?text:'custom';custom.hidden=known;custom.value=text;}
function bindCount(select,custom,callback){select.addEventListener('change',()=>{custom.hidden=select.value!=='custom';if(!custom.hidden&&!custom.value)custom.value='';callback();});custom.addEventListener('input',callback);}
function primaryQuantity(){return readCount($('quantity'),$('customQuantity'));}
function isTechnical(){return $('tier').value!=='娱乐';}
function primarySettled(){return isTechnical()?readCount($('settledQuantity'),$('customSettledQuantity')):primaryQuantity();}
function refreshSettlementUI(){$('settledField').hidden=!isTechnical();matchList();renderExtraLines();syncOvertime();}
function primaryOvertime(){return readCount($('overtimeQuantity'),$('customOvertimeQuantity'));}
function syncOvertime(){if(!primarySettledManual)writeCount($('settledQuantity'),$('customSettledQuantity'),primaryQuantity());if(!primaryOvertimeManual)writeCount($('overtimeQuantity'),$('customOvertimeQuantity'),Number($('extra').value)?primarySettled():0);for(const line of extraLines){if(!line.manualSettled)line.settledQuantity=line.quantity;if(!line.manualOvertime)line.overtimeQuantity=Number($('extra').value)?(isTechnical()?line.settledQuantity:line.quantity):0;}renderExtraLines();queuePreview();}
function tariff(rank){return state.prices[[$('category').value,$('tier').value,rank].join('|')]??'';}
function addBillingLine(rank=$('rank').value||'',quantity=1,overtimeQuantity){
 const line={id:crypto.randomUUID(),rank,price:tariff(rank),party:$('party').value,discount:$('discount').value,unit:$('unit').value,quantity,settledQuantity:quantity,manualSettled:false,overtimeQuantity:overtimeQuantity??(Number($('extra').value)?quantity:0),manualOvertime:overtimeQuantity!==undefined};extraLines.push(line);return line;
}
function configureDiscount(party,select){
 const add={'1':'0.9','0.98':'0.882','0.97':'0.873','0.96':'0.864','0.95':'0.855'},remove={'0.9':'1','0.882':'0.98','0.873':'0.97','0.864':'0.96','0.855':'0.95'},locked=party==='4陪1';
 for(const option of select.options)option.disabled=locked?Object.hasOwn(add,option.value):Object.hasOwn(remove,option.value);
 if(locked&&add[select.value])select.value=add[select.value];else if(!locked&&remove[select.value])select.value=remove[select.value];
}
function renderExtraLines(){
 const container=$('extraLines');container.replaceChildren();
 for(const [index,line] of extraLines.entries()){
  const row=document.createElement('div');row.className='billing-line';
  const heading=document.createElement('div');heading.className='line-heading';
  const title=document.createElement('strong');title.textContent='第 '+(index+2)+' 段 · '+(line.rank||'待确认段位');
  const remove=document.createElement('button');remove.type='button';remove.className='quiet small';remove.textContent='移除';remove.onclick=()=>{extraLines=extraLines.filter(l=>l.id!==line.id);billingManual=true;renderExtraLines();queuePreview();};heading.append(title,remove);row.append(heading);
  const grid=document.createElement('div');grid.className='grid';
  function selectControl(text,key,values){const label=document.createElement('label');label.textContent=text;const select=document.createElement('select');select.className='line-'+key;select.setAttribute('aria-label','第 '+(index+2)+' 段'+text);options(select,values,line[key]);label.append(select);select.onchange=()=>{const before={...line},context=prepareMatchBilling(undefined,true);line[key]=select.value;if(context)updateLineMatches(before,line);billingManual=true;queuePreview();};return {label,select};}
  const rank=selectControl('段位','rank',['',...RANKS]);rank.select.options[0].textContent='请选择段位';rank.select.onchange=()=>{line.rank=rank.select.value;line.price=tariff(line.rank);billingManual=true;renderExtraLines();queuePreview();};
  const priceLabel=document.createElement('label');priceLabel.textContent='基础单价（AUD）';const rate=document.createElement('input');rate.type='number';rate.min='0';rate.step='.01';rate.className='line-price';rate.value=line.price;priceLabel.append(rate);rate.oninput=()=>{const before={...line},context=prepareMatchBilling(undefined,true);line.price=rate.value;if(context)updateLineMatches(before,line);billingManual=true;queuePreview();};
  const party=selectControl('陪玩人数','party',PARTIES),unit=selectControl('结算方式','unit',['把','小时']);unit.select.options[0].textContent='按把';unit.select.options[1].textContent='按小时';
  const discount=selectControl('折扣','discount',DISCOUNTS.map(d=>d[0]));for(const [i,d] of DISCOUNTS.entries())discount.select.options[i].textContent=d[1];configureDiscount(line.party,discount.select);line.discount=discount.select.value;
  party.select.onchange=()=>{const before={...line},context=!legacyPartyAmbiguous?prepareMatchBilling(undefined,true):null;line.party=party.select.value;configureDiscount(line.party,discount.select);line.discount=discount.select.value;if(context)updateLineMatches(before,line);billingManual=true;bulkPartyManual=false;updateBulkRankButton();queuePreview();};
  function countControl(text,key,allowZero){
   const label=document.createElement('label');label.textContent=text;const select=document.createElement('select'),custom=document.createElement('input');const name={quantity:'quantity',settledQuantity:'settled',overtimeQuantity:'overtime'}[key];select.className='line-'+name;custom.className='line-custom-'+name;custom.type='number';custom.min=allowZero?'0':'.5';custom.step='.5';custom.placeholder='输入自定义数字';quantityChoices(select,allowZero);writeCount(select,custom,line[key]);
   bindCount(select,custom,()=>{line[key]=readCount(select,custom);billingManual=true;if(key==='settledQuantity')line.manualSettled=true;if(key==='overtimeQuantity')line.manualOvertime=true;
    if(key==='quantity'&&!line.manualSettled){line.settledQuantity=line.quantity;const settled=row.querySelector('.line-settled'),settledCustom=row.querySelector('.line-custom-settled');if(settled)writeCount(settled,settledCustom,line.settledQuantity);}
    if(!line.manualOvertime){line.overtimeQuantity=Number($('extra').value)?(isTechnical()?line.settledQuantity:line.quantity):0;writeCount(row.querySelector('.line-overtime'),row.querySelector('.line-custom-overtime'),line.overtimeQuantity);}queuePreview();
   });label.append(select,custom);return label;
  }
  grid.append(rank.label,priceLabel,party.label,unit.label,countControl('局数 / 小时数','quantity',false));if(isTechnical())grid.append(countControl('结单局数 / 小时数','settledQuantity',true));grid.append(discount.label,countControl('加班局数 / 小时数','overtimeQuantity',true));row.append(grid);container.append(row);
 }
}

function matchCharge(match){
 const result=MatchBilling.calculate(match);
 if(result.quantity!==null||match.billingQuantity!==undefined&&match.billingQuantity!==null)return result;
 return {...result,quantity:1,reason:'暂按1把；投降、红屏或信息不足时可直接手动改把数',needsConfirmation:true};
}
function updateBulkRankButton(){
 const selected=screenshots.flatMap(image=>image.matches).filter(m=>m.selected),rank=$('bulkRank').value;
 $('applyBulkRank').disabled=!selected.length||!rank;
 $('applyBulkRank').textContent=selected.length&&rank?'统一 '+selected.length+' 局为'+rank:'一键应用到已选对局';
 const parties=[...new Set(selected.map(match=>match.party).filter(party=>PARTIES.includes(party)))];
 $('bulkParty').disabled=!selected.length;$('bulkParty').value=bulkPartyManual&&parties.length===1&&selected.every(match=>match.party===parties[0])?parties[0]:'';
}
function partyDiscount(party,value){
 const base={'0.9':'1','0.882':'0.98','0.873':'0.97','0.864':'0.96','0.855':'0.95'}[String(value)]||String(value??1);
 return party==='4陪1'?String(Math.round(Number(base)*.9*1000000)/1000000):base;
}
function billingLines(primaryParty=$('party').value){const primary={rank:$('rank').value,party:$('party').value,price:$('price').value,discount:$('discount').value,unit:$('unit').value,quantity:primaryQuantity()};return [{...primary,...(primaryParty&&typeof primaryParty==='object'?primaryParty:{party:primaryParty})},...extraLines];}
function prepareMatchBilling(primaryParty,quiet=false){
 if(legacyPartyAmbiguous){if(!quiet)toast('这条旧报单未保存每局人数，无法可靠对应原分段；请在下方各计费分段分别修改。');return null;}
 const lines=billingLines(primaryParty),pool=lines.map(line=>({line,left:Number(line.quantity)||0})),used=new Set();
 const all=screenshots.flatMap(image=>image.matches),selected=all.filter(match=>match.selected),previous=all.map(match=>({match,party:match.party,billing:match.billing}));
 for(const match of selected){
  const quantity=matchCharge(match).quantity||0,candidates=pool.filter(item=>item.line.rank===(match.rank||'')),available=candidates.filter(item=>item.left>=quantity&&item.left>0);
  const sameRate=item=>match.billing&&item.line.party===match.party&&Number(item.line.price)===Number(match.billing.price)&&Number(item.line.discount)===Number(match.billing.discount)&&item.line.unit===match.billing.unit;
  const compatible=candidates.filter(item=>item.line.party===match.party);
  const source=match.billing?candidates.find(sameRate):(available.find(item=>item.line.party===match.party)||(compatible.length?compatible[0]:!PARTIES.includes(match.party)?available[0]||candidates[0]:null));
  const line=source?.line||match.billing||{rank:match.rank||'',party:PARTIES.includes(match.party)?match.party:primaryParty||$('party').value,price:tariff(match.rank||''),discount:$('discount').value,unit:$('unit').value};
  match.party=PARTIES.includes(line.party)?line.party:'正常';match.billing={rank:match.rank||'',party:match.party,price:line.price,discount:partyDiscount(match.party,line.discount),unit:line.unit==='小时'?'小时':'把'};
  if(source){source.left=Math.max(0,source.left-quantity);used.add(source.line);}
 }
 for(const match of all.filter(match=>!match.selected)){if(!PARTIES.includes(match.party))match.party=primaryParty||$('party').value;}
 const referenced=line=>all.some(match=>{const rate=match.billing;return rate&&rate.rank===line.rank&&rate.party===line.party&&Number(rate.price)===Number(line.price)&&Number(rate.discount)===Number(line.discount)&&rate.unit===(line.unit==='小时'?'小时':'把');});
 const manualLines=extraLines.filter(line=>!line.fromMatches&&!used.has(line)&&!referenced(line));
 if(billingManual&&manualLines.some(line=>selected.some(match=>match.rank===line.rank))){for(const old of previous){old.match.party=old.party;old.match.billing=old.billing;}if(!quiet)toast('手动计费分段无法可靠对应每局，请保留下方分段分别设置；本次未重建计费。');return null;}
 return {prepared:true,manualLines};
}
function updateLineMatches(before,after){
 for(const image of screenshots)for(const match of image.matches){const billing=match.billing;if(!match.selected||!billing)continue;if(billing.rank===before.rank&&billing.party===before.party&&Number(billing.price)===Number(before.price)&&Number(billing.discount)===Number(before.discount)&&billing.unit===(before.unit==='小时'?'小时':'把')){match.party=after.party;match.billing={rank:after.rank,party:after.party,price:after.price,discount:String(after.discount),unit:after.unit==='小时'?'小时':'把'};}}
 updateBulkRankButton();
}
function applyBulkParty(){
 const party=$('bulkParty').value;if(!party){bulkPartyManual=false;updateBulkRankButton();return;}
 const selected=screenshots.flatMap(image=>image.matches).filter(match=>match.selected);if(!selected.length)return;
 if(billingManual||$('unit').value==='小时'){
  for(const match of selected){match.party=party;if(match.billing)match.billing={...match.billing,party,discount:partyDiscount(party,match.billing.discount)};}
  $('party').value=party;lastParty=party;$('discount').value=partyDiscount(party,$('discount').value);configureDiscount(party,$('discount'));
  for(const line of extraLines){line.party=party;line.discount=partyDiscount(party,line.discount);}
  renderExtraLines();queuePreview();
 }else{
  const context=prepareMatchBilling();if(!context){$('bulkParty').value='';return;}
  for(const match of selected)match.party=party;buildFromMatches(context);
 }
 bulkPartyManual=true;updateBulkRankButton();toast('已将 '+selected.length+' 局的陪玩人数设为'+party);
}
function buildFromMatches(prepared){
 if(billingLines().some(line=>line.unit==='小时')){toast('按小时请填写实际时长，不按截图回合换算。');return;}
 const context=prepared?.prepared?prepared:prepareMatchBilling();if(!context)return;
 const selected=screenshots.flatMap(image=>image.matches).filter(m=>m.selected),groups=new Map();
 const invalid=selected.find(match=>matchCharge(match).quantity===null);
 $('matchBillingError').hidden=!invalid;
 if(invalid){$('matchBillingError').textContent='请填写有效的计费把数，按0.5递增。';setQuantity(0);queuePreview();return;}
 for(const match of selected){const rank=match.rank||'',party=PARTIES.includes(match.party)?match.party:'正常',old=match.billing||{},rate={rank,party,price:old.rank===rank?old.price:tariff(rank),discount:partyDiscount(party,old.discount??$('discount').value),unit:'把'},key=JSON.stringify([rank,party,String(rate.price),rate.discount]),quantity=matchCharge(match).quantity,group=groups.get(key)||{...rate,quantity:0,settledQuantity:0};match.billing={...rate};group.quantity+=quantity;if(match.settled!==false)group.settledQuantity+=quantity;groups.set(key,group);}
 const entries=[...groups.values()];extraLines=[];primaryOvertimeManual=false;primarySettledManual=false;billingManual=false;
 if(entries.length){const first=entries[0];$('rank').value=first.rank;price();$('price').value=first.price;$('party').value=first.party;lastParty=first.party;$('discount').value=first.discount;configureDiscount(first.party,$('discount'));setQuantity(first.quantity);writeCount($('settledQuantity'),$('customSettledQuantity'),first.settledQuantity);primarySettledManual=true;for(const group of entries.slice(1)){extraLines.push({...group,id:crypto.randomUUID(),fromMatches:true,manualSettled:true,manualOvertime:false,overtimeQuantity:Number($('extra').value)?group.settledQuantity:0});}}else setQuantity(0);
 extraLines.push(...(context.manualLines||[]));
 syncOvertime();renderExtraLines();queuePreview();
 updateBulkRankButton();
}
function matchBillingControls(match){
 const field=document.createElement('label');field.className='match-count-label';field.append(document.createTextNode('把数'));
 const select=document.createElement('select');select.className='match-quantity';select.setAttribute('aria-label','计费把数');quantityChoices(select);
 const restore=document.createElement('option');restore.value='auto';restore.textContent='恢复自动';select.append(restore);
 const custom=document.createElement('input');custom.className='match-custom-quantity';custom.type='number';custom.min='.5';custom.step='.5';custom.placeholder='自定义';custom.setAttribute('aria-label','自定义计费把数');
 function refresh(){
  const charge=matchCharge(match),manual=match.billingQuantity!==undefined&&match.billingQuantity!==null;
  writeCount(select,custom,manual?match.billingQuantity:charge.quantity);
  select.dataset.source=manual?'manual':'auto';select.title=(manual?'手动：':'自动：')+charge.reason+'。特殊结算可直接改把数。';
 }
 select.onchange=()=>{
  const context=prepareMatchBilling();if(!context){refresh();return;}
  if(select.value==='auto')match.billingQuantity=null;
  else if(select.value==='custom')match.billingQuantity='';
  else match.billingQuantity=select.value;
  refresh();buildFromMatches(context);if(select.value==='custom')custom.focus();
 };
 custom.onchange=()=>{if(select.value!=='custom')return;const context=prepareMatchBilling();if(!context){refresh();return;}match.billingQuantity=custom.value;refresh();buildFromMatches(context);};
 field.append(select,custom);refresh();return field;
}
function renderGallery(){const gallery=$('imageGallery');gallery.replaceChildren();gallery.hidden=!screenshots.length;$('copyImageBtn').disabled=busy||copyingImage||!screenshots.some(s=>s.image&&!s.missing);for(const image of screenshots){const tile=document.createElement('div');tile.className='image-tile';const thumb=document.createElement('img');if(image.url)thumb.src=image.url;thumb.alt=image.missing?'原图未找到':image.name;thumb.onclick=()=>{if(image.url){$('screenshot').src=image.url;$('screenshot').hidden=false;$('emptyImage').hidden=true;}};const name=document.createElement('span');name.textContent=image.name;const remove=document.createElement('button');remove.type='button';remove.className='quiet small';remove.textContent='×';remove.title='移除截图';remove.onclick=()=>{URL.revokeObjectURL(image.url);screenshots=screenshots.filter(s=>s!==image);if(screenshots.length)$('screenshot').src=screenshots.at(-1).url;else{$('screenshot').hidden=true;$('emptyImage').hidden=false;}renderGallery();matchList();if(!billingManual)buildFromMatches();$('imageStatus').textContent=screenshots.length+' 张截图';};tile.append(thumb,name,remove);gallery.append(tile);}}

function bossDiscountFor(name){const discounts=state.bossDiscounts||{};return Object.hasOwn(discounts,name)?Number(discounts[name]):1;}
function discountLabel(value){return DISCOUNTS.find(d=>Number(d[0])===Number(value))?.[1]||'无折扣';}
function updateBossDiscountNote(){
 const name=$('boss').value.trim(),saved=bossDiscountFor(name);
 if(!name){$('bossDiscountNote').textContent='选中老板后自动带入；保存后下次沿用。每个分段的折扣仍可临时修改。';return;}
 const exists=Object.hasOwn(state.bossDiscounts||{},name);
 $('bossDiscountNote').textContent=Number($('bossDiscount').value)!==saved?'默认折扣尚未保存；点击“保存默认折扣”后应用到本单各分段及下次报单。':(exists?'已记住：'+discountLabel(saved)+'。':'尚未设置，默认无折扣。')+' 本单各分段仍可临时改折扣，不会覆盖记忆。';
}
function syncBossDiscount(force=false){
 const name=$('boss').value.trim();if(!force&&name===appliedBossName)return;
 const beforeLines=billingLines().map(line=>({...line}));
 appliedBossName=name;const base=bossDiscountFor(name);$('bossDiscount').value=String(base);
 $('discount').value=String(base);configureDiscount($('party').value,$('discount'));
 for(const line of extraLines)line.discount=String(line.party==='4陪1'?Math.round(base*.9*1000000)/1000000:base);
 const afterLines=billingLines();beforeLines.forEach((line,i)=>updateLineMatches(line,afterLines[i]));
 renderExtraLines();updateBossDiscountNote();queuePreview();
}
async function saveBossDiscount(){
 const name=$('boss').value.trim(),discount=Number($('bossDiscount').value),button=$('saveBossDiscount');button.disabled=true;
 try{const result=await api('boss-discount',{name,discount});Object.assign(state,result);bosses();if($('boss').value.trim()===name)syncBossDiscount(true);else updateBossDiscountNote();toast('已保存 '+name+' 的默认折扣：'+discountLabel(discount));}
 catch(e){toast(e.message);}finally{button.disabled=false;}
}
function bosses(){
 options($('bossOptions'),state.bosses);const manager=$('bossManager');manager.replaceChildren();
 if(!state.bosses.length){manager.textContent='还没有保存的老板。';manager.className='muted';return;}manager.className='';
 for(const name of state.bosses){
  const chip=document.createElement('span');chip.className='boss-chip';chip.append(document.createTextNode(name+' · '+discountLabel(bossDiscountFor(name))));
  const b=document.createElement('button');b.textContent='×';b.title='移除老板及其默认折扣';
  b.addEventListener('click',async()=>{try{state.bosses=await api('boss',{name,remove:true});if(state.bossDiscounts)delete state.bossDiscounts[name];bosses();if($('boss').value.trim()===name)syncBossDiscount(true);}catch(e){toast(e.message);}});
  chip.append(b);manager.append(chip);
 }
}
function form(){return {playerId:$('playerId').value,date:$('date').value,time:$('time').value,boss:$('boss').value,game:$('game').value,rank:$('rank').value,category:$('category').value,tier:$('tier').value,party:$('party').value,price:$('price').value,unit:$('unit').value,quantity:primaryQuantity(),discount:$('discount').value,extra:$('extra').value,matchBilling:screenshots.flatMap(image=>image.matches.filter(m=>m.selected).map(m=>({score:m.score,result:m.result,ending:m.ending||'normal',actualRounds:m.actualRounds??null,quantity:matchCharge(m).quantity,settled:m.settled!==false,rank:m.rank,party:m.party,billing:m.billing}))),lines:[{rank:$('rank').value,price:$('price').value,party:$('party').value,unit:$('unit').value,discount:$('discount').value,quantity:primaryQuantity(),settledQuantity:primarySettled(),overtimeQuantity:primaryOvertime()},...extraLines.map(l=>({rank:l.rank,price:l.price,party:l.party,unit:l.unit,discount:l.discount,quantity:l.quantity,settledQuantity:l.settledQuantity,overtimeQuantity:l.overtimeQuantity}))]};}

function price(){const key=[$('category').value,$('tier').value,$('rank').value].join('|'),n=state.prices[key];$('price').value=n===null||n===undefined?'':n;options($('priceOptions'),[...new Set(Object.entries(state.prices).filter(([k,v])=>k.startsWith($('category').value+'|'+$('tier').value+'|')&&v!==null).map(([,v])=>String(v)))]);let note='';if(n===null)note='这档价格是一个区间，请按本单约定手动填写单价。';if($('category').value==='男陪'&&((['大神','王牌'].includes($('tier').value)&&['神话2','神话3','赋能'].includes($('rank').value))||($('tier').value==='镇店'&&$('rank').value==='赋能')))note+=' 价目表标注此档限 4 陪 1，请确认本单适用。';$('priceNote').textContent=note;queuePreview();}
function setQuantity(value){writeCount($('quantity'),$('customQuantity'),value);syncOvertime();}
function tiers(){options($('tier'),TIERS[$('category').value],state.tier);$('unit').value=$('tier').value==='娱乐'?'小时':'把';price();refreshSettlementUI();}
async function renderPreview(){const current=++previewVersion;const f=form();if(f.lines.some(line=>!line.rank)){$('preview').textContent='选择段位并补齐报单信息后，这里会生成预览。';$('total').textContent='—';$('unitPriceNote').textContent='';$('previewError').hidden=true;return;}try{const result=await api('report',{form:{...f,boss:f.boss.trim()||'待填写'},save:false});if(current!==previewVersion)return;$('preview').textContent=result.text;$('unitPriceNote').textContent=result.lines.map(l=>l.rank+' '+l.quantity+(l.unit==='小时'?'小时':'局')+(isTechnical()?'，结单 '+l.settledQuantity:'')+'，其中加班 '+l.overtimeQuantity+'，基础价 '+l.price+(l.partyFee?' + '+l.partyFee+'（'+l.party+'）':'')+' AUD，'+l.party+(l.discount!==1?'，'+(DISCOUNTS.find(d=>Number(d[0])===l.discount)?.[1]||''):'' )).join('；');$('total').replaceChildren(document.createTextNode(String(result.total)),Object.assign(document.createElement('span'),{textContent:'AUD'}));$('previewError').hidden=true;}catch(e){if(current!==previewVersion)return;$('previewError').textContent=e.message;$('previewError').hidden=false;$('unitPriceNote').textContent='';$('total').textContent='—';$('preview').textContent='补齐报单信息后，这里会自动生成文字。';}}
function syncPartyDiscount(){const before=primaryBillingCache||billingLines(lastParty)[0],context=!legacyPartyAmbiguous&&screenshots.some(image=>image.matches.length)?prepareMatchBilling(before,true):null;configureDiscount($('party').value,$('discount'));const after=billingLines()[0];if(context)updateLineMatches(before,after);lastParty=$('party').value;bulkPartyManual=false;updateBulkRankButton();queuePreview();}
function syncPrimaryBillingRate(){const before=primaryBillingCache||billingLines()[0],context=prepareMatchBilling(before,true),after=billingLines()[0];if(context)updateLineMatches(before,after);billingManual=true;queuePreview();}
function queuePreview(event){if(!event||!['party','discount','unit','price'].includes(event.target?.id))primaryBillingCache=billingLines()[0];clearTimeout(previewTimer);previewTimer=setTimeout(renderPreview,100);}
function syncDetectedBulkRank(){if(bulkRankManual){updateBulkRankButton();return;}const counts=new Map();for(const image of screenshots)for(const match of image.matches){const rank=match.icon?.rank||null;if(rank)counts.set(rank,(counts.get(rank)||0)+1);}const detected=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0];if(detected)$('bulkRank').value=detected;else if(!screenshots.length)$('bulkRank').value=$('rank').value||'';else $('bulkRank').value='';updateBulkRankButton();}
function detailPlayerControl(image){
 const field=document.createElement('div');field.className='detail-player';
 const label=document.createElement('label');label.textContent='截图中的自己';
 const select=document.createElement('select');select.className='detail-own-player';
 const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='请选择你在这局使用的游戏 ID';select.append(placeholder);
 for(const player of image.players||[]){const op=document.createElement('option');op.value=String(player.id);op.textContent=player.name+(player.rankName?' · '+player.rankName:' · 段位待确认');select.append(op);}
 select.value=image.matches[0].playerId===null||image.matches[0].playerId===undefined?'':String(image.matches[0].playerId);
 select.onchange=()=>{const context=prepareMatchBilling();if(!context)return;const player=select.value===''?null:image.players.find(p=>String(p.id)===select.value);const match=image.matches[0];match.playerId=player?.id??null;match.rank=player?.rank||null;match.rankName=player?.rankName||null;match.icon=player?.icon||null;match.confidence=player?.confidence||0;matchList();syncDetectedBulkRank();buildFromMatches(context);};
 const note=document.createElement('p');note.textContent='请核对默认选中的高亮玩家；可修改玩家、计费段位和特殊结算把数。';
 label.append(select);field.append(label,note);return field;
}
let copyingImage=false;
async function copyScreenshot(image){
 if(copyingImage)return;copyingImage=true;$('copyImageBtn').disabled=true;
 try{await api('copy-image',{image:image.image});toast('战绩截图已复制，到 DC 按 Ctrl+V 粘贴');$('copyImages').close();}
 catch(e){toast(e.message);}finally{copyingImage=false;$('copyImageBtn').disabled=busy||!screenshots.some(s=>s.image&&!s.missing);}
}
function chooseScreenshot(){
 if(busy||copyingImage)return;const images=screenshots.filter(s=>s.image&&!s.missing);
 if(!images.length){toast('请先导入战绩截图');return;}
 if(images.length===1){copyScreenshot(images[0]);return;}
 const list=$('copyImageList');list.replaceChildren();
 for(const image of images){const row=document.createElement('div');row.className='copy-image-choice';const thumb=document.createElement('img');thumb.src=image.url;thumb.alt=image.name;const name=document.createElement('span');name.textContent=image.name;const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='复制这张';button.onclick=()=>copyScreenshot(image);row.append(thumb,name,button);list.append(row);}
 $('copyImages').showModal();
}
function matchList(){const panel=$('matchPanel'),list=$('matches');list.replaceChildren();panel.hidden=!screenshots.some(s=>s.matches.length);for(const image of screenshots){if(!image.matches.length)continue;const title=document.createElement('div');title.className='matches-heading';title.textContent=image.name;list.append(title);if(image.kind==='detail')list.append(detailPlayerControl(image));image.matches.forEach((match,i)=>{if(match.settled===undefined)match.settled=true;const row=document.createElement('div');row.className='match';const check=document.createElement('input');check.type='checkbox';check.checked=match.selected;check.setAttribute('aria-label','选择第'+(i+1)+'局');check.onchange=()=>{const context=prepareMatchBilling();if(!context){check.checked=!!match.selected;return;}match.selected=check.checked;updateBulkRankButton();buildFromMatches(context);};const label=document.createElement('span');label.textContent='第 '+(i+1)+' 局';const result=document.createElement('span');result.className='result'+(match.result==='失败'?' loss':match.result==='待确认'?' pending':'');result.textContent=match.result+' '+match.score+(match.mvp?' · '+match.mvp:'');const rank=document.createElement('select');rank.className='match-rank';options(rank,['',...RANKS],match.rank);rank.options[0].textContent='确认段位';rank.title=match.rankName?'图标识别：'+match.rankName+'；可按老板段位修改':'图标未确定，请手动确认';rank.onchange=()=>{const context=prepareMatchBilling();if(!context){rank.value=match.rank||'';return;}match.rank=rank.value;buildFromMatches(context);};row.append(check,label,result,rank);if(isTechnical()){const field=document.createElement('label');field.className='match-settled-label';field.textContent='是否结单';const settled=document.createElement('select');settled.className='match-settled';options(settled,['是','否'],match.settled?'是':'否');settled.onchange=()=>{const context=prepareMatchBilling();if(!context){settled.value=match.settled?'是':'否';return;}match.settled=settled.value==='是';buildFromMatches(context);};field.append(settled);row.append(field);}if($('unit').value!=='小时')row.append(matchBillingControls(match));list.append(row);});}updateBulkRankButton();}
async function importImage(files){if(busy){toast('截图正在识别，请稍候。');return;}const batch=Array.from(files||[]);if(!batch.length)return;busy=true;$('copyBtn').disabled=$('saveBtn').disabled=$('copyImageBtn').disabled=true;try{for(const file of batch){if(!['image/png','image/jpeg'].includes(file.type)||file.size>16*1024*1024){toast('请使用小于 16 MB 的 PNG/JPG 截图');continue;}$('imageStatus').textContent='正在识别 '+file.name+'…';let parsed;try{parsed=await api('recognize',file,true);}catch(e){parsed={matches:[],icons:[]};toast(file.name+' 识别失败，可手动填写明细');}if(parsed.hash&&screenshots.some(s=>s.hash===parsed.hash)){toast('相同截图已经添加，已跳过');continue;}const url=URL.createObjectURL(file);screenshots.push({...parsed,url,name:file.name||'粘贴的截图',matches:(parsed.matches||[]).map(match=>({...match,party:PARTIES.includes(match.party)?match.party:$('party').value}))});if(parsed.warning)toast(parsed.warning);$('screenshot').src=url;$('screenshot').hidden=false;$('emptyImage').hidden=true;renderGallery();matchList();}if(!billingManual&&screenshots.some(s=>s.matches.length))buildFromMatches();else if(billingManual)toast('截图已添加，按需点击“按所选对局填入”更新明细');syncDetectedBulkRank();$('imageStatus').textContent=screenshots.length+' 张截图 · '+screenshots.reduce((n,s)=>n+s.matches.length,0)+' 局待核对';queuePreview();}finally{busy=false;$('file').value='';$('copyBtn').disabled=$('saveBtn').disabled=false;$('copyImageBtn').disabled=copyingImage||!screenshots.some(s=>s.image&&!s.missing);}}
function reset(){bulkPartyManual=false;legacyPartyAmbiguous=false;$('bulkParty').value='';editingMode();for(const image of screenshots)URL.revokeObjectURL(image.url);screenshots=[];bulkRankManual=false;extraLines=[];billingManual=false;primaryOvertimeManual=false;primarySettledManual=false;$('file').value='';$('screenshot').hidden=true;$('screenshot').removeAttribute('src');$('emptyImage').hidden=false;$('matchPanel').hidden=true;$('matchBillingError').hidden=true;$('imageStatus').textContent='也可以直接手动填写';$('playerId').value=state.id;$('boss').value='';$('game').value='val';$('rank').value='';$('category').value=state.category;tiers();setQuantity(1);$('party').value='正常';lastParty='正常';$('discount').value='1';syncPartyDiscount();setNow();renderGallery();syncDetectedBulkRank();refreshSettlementUI();syncBossDiscount(true);queuePreview();rememberDraft();}
async function copyText(text){if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return;}catch{}}const el=document.createElement('textarea');el.value=text;document.body.append(el);el.select();const ok=document.execCommand('copy');el.remove();if(!ok)throw new Error('复制失败，请在预览中选中文字复制。');}
async function commit(copy){
 if(busy)return;
 if($('unit').value!=='小时'&&screenshots.some(image=>image.matches.some(m=>m.selected&&matchCharge(m).quantity===null))){toast('请先填好自定义把数，按0.5递增。');return;}
 busy=true;$('copyBtn').disabled=$('saveBtn').disabled=true;
 try{
  const wasEditing=!!editingId,payload={form:form(),entryId:editingId,images:screenshots.map(s=>s.image).filter(Boolean),screenshots:screenshotSnapshot(),samples:[],learn:false,save:false},savedDraft=draftSnapshot();
  const result=await api('report',payload);if(copy)await copyText(result.text);
  const saved=await api('report',{...payload,save:true});editingMode(saved.entryId);timeManual=true;rememberDraft(savedDraft);
  state=await api('state');bosses();toast(wasEditing?(copy?'修改已保存，报单已复制':'报单修改已保存'):(copy?'报单已复制，老板和记录已保存':'报单已保存'));
 }catch(e){toast(e.message);}finally{busy=false;$('copyBtn').disabled=$('saveBtn').disabled=false;}
}
function priceEditor(){const cat=$('settingCategory').value,tier=$('settingTier').value;$('priceEditor').replaceChildren();for(const rank of RANKS){const key=[cat,tier,rank].join('|');const label=document.createElement('label');label.textContent=rank;const input=document.createElement('input');input.type='number';input.min='0';input.step='.01';input.placeholder='按约定填写';input.value=settingsPrices[key]??'';input.addEventListener('input',()=>settingsPrices[key]=input.value===''?null:Number(input.value));label.append(input);$('priceEditor').append(label);}}
function openSettings(){settingsPrices={...state.prices};$('settingId').value=state.id;$('settingCategory').value=state.category;options($('settingTier'),TIERS[state.category],state.tier);priceEditor();bosses();$('settings').showModal();}
function historyQuantity(f){const counts=new Map();for(const line of f.lines||[{quantity:f.quantity,unit:f.unit}]){const unit=(line.unit??f.unit)==='小时'?'小时':'局';counts.set(unit,(counts.get(unit)||0)+Number(line.quantity));}return [...counts].map(([unit,n])=>n+unit).join(' / ');}
function editingMode(id=null){
 editingId=id;$('historyEdit').hidden=!id;$('orderTitle').textContent=id?'历史报单':'新报单';
 $('copyBtn').textContent=id?'复制并保存修改':'复制报单并保存';$('saveBtn').textContent=id?'保存修改':'仅保存报单';
}
function screenshotSnapshot(){return screenshots.map(s=>({image:s.image,name:s.name,kind:s.kind,hash:s.hash,players:s.players,matches:s.matches}));}
function draftSnapshot(){
 const value=structuredClone(form()),number=n=>n===''||n===null||n===undefined?n:Number.isFinite(Number(n))?Number(n):n;
 for(const key of ['price','quantity','discount','extra'])value[key]=number(value[key]);
 for(const line of value.lines)for(const key of ['price','quantity','settledQuantity','overtimeQuantity','discount'])line[key]=number(line[key]);
 const images=screenshotSnapshot().map(image=>({image:image.image??null,name:image.name||'',kind:image.kind||'history',hash:image.hash||'',players:image.players||[],matches:image.matches.map(match=>({id:match.id??null,score:match.score||'',result:match.result||'',mvp:match.mvp||'',rank:match.rank||null,rankName:match.rankName||null,party:match.party||null,billing:match.billing?{rank:match.billing.rank||'',party:match.billing.party||'正常',price:number(match.billing.price),discount:number(match.billing.discount),unit:match.billing.unit}:null,selected:!!match.selected,settled:match.settled!==false,billingQuantity:number(match.billingQuantity??null),ending:match.ending||'normal',actualRounds:match.actualRounds??null,playerId:match.playerId??null,iconRank:match.icon?.rank||null}))}));
 return structuredClone({form:value,screenshots:images});
}
function rememberDraft(snapshot=draftSnapshot()){draftBaseline=snapshot;primaryBillingCache=billingLines()[0];}
function hasUnsavedDraft(){
 if(!draftBaseline)return false;
 const current=draftSnapshot(),baseline=structuredClone(draftBaseline);
 // Only the clock may refresh these fields without a user's edit. Compare all other values.
 if(!timeManual&&!editingId){
  for(const value of [current,baseline]){delete value.form.date;delete value.form.time;}
  if(!extraManual){
   for(const value of [current,baseline]){
    delete value.form.extra;
    if(!primaryOvertimeManual&&value.form.lines[0])delete value.form.lines[0].overtimeQuantity;
    extraLines.forEach((line,i)=>{if(!line.manualOvertime&&value.form.lines[i+1])delete value.form.lines[i+1].overtimeQuantity;});
   }
  }
 }
 return JSON.stringify(current)!==JSON.stringify(baseline);
}
function confirmDiscardDraft(){return !hasUnsavedDraft()||confirm('当前报单有未保存的修改，确定放弃这些修改吗？');}
window.addEventListener('beforeunload',event=>{if(hasUnsavedDraft()){event.preventDefault();event.returnValue='';}});
async function restoreHistory(entry){
 if(busy){toast('当前操作还未完成，请稍候。');return;}
 if(!confirmDiscardDraft())return;
 busy=true;$('copyBtn').disabled=$('saveBtn').disabled=true;
 const restored=[];
 try{
  bulkPartyManual=false;$('bulkParty').value='';const f=structuredClone(entry.form),files=entry.images?.length?entry.images:entry.image?[entry.image]:[];
  const saved=Array.isArray(entry.screenshots)&&entry.screenshots.length?entry.screenshots:files.map((image,i)=>({image,name:'历史截图 '+(i+1),matches:[]}));
  if(!saved.length&&f.matchBilling?.length)saved.push({name:'历史对局',matches:[]});
  // Older versions kept only selected matches, without their image mapping.
  if(!entry.screenshots?.length&&saved.length)saved[0].matches=(f.matchBilling||[]).map((m,i)=>({...m,id:i,selected:true,billingQuantity:m.quantity}));
  for(const s of saved){
   const item={...structuredClone(s),url:'',matches:structuredClone(s.matches||[]),missing:false};
   if(item.image){try{const response=await fetch('/api/image/'+encodeURIComponent(item.image),{headers:{'x-app-token':token}});if(!response.ok)throw new Error();item.url=URL.createObjectURL(await response.blob());}catch{item.missing=true;}}
   restored.push(item);
  }
  clearTimeout(previewTimer);previewVersion++;
  for(const image of screenshots)URL.revokeObjectURL(image.url);
  screenshots=restored;extraLines=[];billingManual=true;primarySettledManual=true;primaryOvertimeManual=true;timeManual=true;extraManual=true;bulkRankManual=false;
  $('file').value='';$('matchBillingError').hidden=true;
  $('date').value=f.date;$('time').value=f.time||'12:00';$('boss').value=f.boss||'';$('game').value=f.game||'val';
  $('playerId').value=f.playerId||entry.text?.match(/^陪(?:陪|玩)：\s*(.+)$/m)?.[1]?.trim()||state.id;
  $('category').value=f.category||state.category;options($('tier'),TIERS[$('category').value],f.tier||state.tier);
  const legacyParty=f.party||([.9,.882,.873,.864,.855].includes(Number(f.discount))?'4陪1':'正常');
  const lines=f.lines?.length?f.lines:[{rank:f.rank,price:f.price,quantity:f.quantity,settledQuantity:f.quantity,overtimeQuantity:Number(f.extra||0)*Number(f.quantity),party:legacyParty,discount:f.discount,unit:f.unit}];
  const first=lines[0];$('rank').value=first.rank||f.rank||'';price();$('price').value=first.price;
  $('party').value=first.party||f.party||'正常';lastParty=$('party').value;$('discount').value=String(first.discount??f.discount??1);configureDiscount($('party').value,$('discount'));
  $('unit').value=(first.unit||f.unit)==='小时'?'小时':'把';$('extra').value=String(f.extra??(lines.some(l=>Number(l.overtimeQuantity)>0)?1:0));
  writeCount($('quantity'),$('customQuantity'),first.quantity);
  writeCount($('settledQuantity'),$('customSettledQuantity'),first.settledQuantity??first.quantity);
  writeCount($('overtimeQuantity'),$('customOvertimeQuantity'),first.overtimeQuantity??0);
  extraLines=lines.slice(1).map(l=>({...l,id:crypto.randomUUID(),party:l.party||f.party||'正常',unit:l.unit==='小时'?'小时':'把',discount:String(l.discount??f.discount??1),settledQuantity:l.settledQuantity??l.quantity,overtimeQuantity:l.overtimeQuantity??0,manualSettled:true,manualOvertime:true}));
  legacyPartyAmbiguous=screenshots.some(image=>image.matches.some(match=>!PARTIES.includes(match.party)))&&lines.some((line,i)=>lines.some((other,j)=>j!==i&&other.rank===line.rank&&(other.party!==line.party||Number(other.price)!==Number(line.price)||Number(other.discount)!==Number(line.discount))));
  appliedBossName=$('boss').value.trim();$('bossDiscount').value=String(bossDiscountFor(appliedBossName));updateBossDiscountNote();
  $('settledField').hidden=!isTechnical();renderExtraLines();renderGallery();matchList();syncDetectedBulkRank();
  const available=screenshots.filter(s=>s.url),missing=screenshots.filter(s=>s.missing).length;
  $('screenshot').hidden=!available.length;$('emptyImage').hidden=!!available.length;
  if(available.length)$('screenshot').src=available.at(-1).url;else $('screenshot').removeAttribute('src');
  $('imageStatus').textContent=missing?'已恢复报单信息；'+missing+' 张历史原图未找到':available.length?'已恢复 '+available.length+' 张历史截图':'已恢复历史报单信息';
  editingMode(entry.id);$('history').close();clearTimeout(previewTimer);await renderPreview();rememberDraft();window.scrollTo({top:0,behavior:'instant'});
 }catch(e){for(const s of restored)if(!screenshots.includes(s))URL.revokeObjectURL(s.url);toast('打开记录失败：'+e.message);}
 finally{busy=false;$('copyBtn').disabled=$('saveBtn').disabled=false;$('copyImageBtn').disabled=copyingImage||!screenshots.some(s=>s.image&&!s.missing);}
}
function historyFilterResults(){
 const range=$('historyDateMode').value==='range',day=$('historyDate').value,from=$('historyFrom').value,to=$('historyTo').value,boss=$('historyBoss').value.trim().normalize('NFKC').toLocaleLowerCase(),rank=$('historyRank').value;
 const exactBoss=!!boss&&[...(state.bosses||[]),...state.history.map(entry=>entry.form?.boss)].some(name=>String(name||'').normalize('NFKC').toLocaleLowerCase()===boss);
 const error=range&&from&&to&&from>to?'开始日期不能晚于结束日期，请调整日期范围。':'';
 const entries=error?[]:state.history.filter(entry=>{
  const f=entry.form||{},date=f.date||'',name=String(f.boss||'').normalize('NFKC').toLocaleLowerCase();
  const ranks=Array.isArray(f.lines)&&f.lines.length?f.lines.map(l=>l.rank):[f.rank];
  return (range?(!from||date>=from)&&(!to||!!date&&date<=to):!day||date===day)&&(!boss||(exactBoss?name===boss:name.includes(boss)))&&(!rank||ranks.includes(rank));
 });
 return {entries,error,active:!!(range||day||$('historyBoss').value||rank)};
}
function updateHistoryBossOptions(){
 const names=[...new Set(state.history.map(e=>e.form?.boss).filter(Boolean))];
 $('historyBossOptions').replaceChildren(...names.map(name=>Object.assign(document.createElement('option'),{value:name})));
}
function syncHistoryDateMode(seed=true){
 const range=$('historyDateMode').value==='range';
 if(seed){if(range&&!$('historyFrom').value&&!$('historyTo').value){$('historyFrom').value=$('historyDate').value;$('historyTo').value=$('historyDate').value;}else if(!range&&!$('historyDate').value)$('historyDate').value=$('historyFrom').value||$('historyTo').value;}
 $('historySingleDate').hidden=range;$('historyRangeDates').hidden=!range;
 document.querySelector('.history-filters').classList.toggle('range-mode',range);renderHistoryList();
}
function clearHistoryFilters(){for(const id of ['historyDate','historyFrom','historyTo','historyBoss','historyRank'])$(id).value='';$('historyDateMode').value='day';syncHistoryDateMode(false);}
function renderHistoryTotals(entries){
 let games=0,hours=0,cents=0;
 for(const entry of entries){
  const amount=Number(entry.total);if(Number.isFinite(amount))cents+=Math.round((amount+Number.EPSILON)*100);
  const form=entry.form||{},lines=Array.isArray(form.lines)&&form.lines.length?form.lines:[{quantity:form.quantity,unit:form.unit}];
  for(const line of lines){const quantity=Number(line.quantity);if(!Number.isFinite(quantity)||quantity<0)continue;if((line.unit??form.unit)==='小时')hours+=quantity;else games+=quantity;}
 }
 const fmt=value=>Number(value.toFixed(6)).toString();
 $('historyQuantityLabel').textContent=hours?(games?'总局数 / 时长':'总时长'):'总局数';
 $('historyQuantityTotal').textContent=hours?(games?fmt(games)+' 局 / ':'')+fmt(hours)+' 小时':fmt(games)+' 局';
 $('historyMoneyTotal').textContent=Number((cents/100).toFixed(2)).toString()+' AUD';
}
function renderHistoryList(){
 const {entries,error,active}=historyFilterResults();$('historyList').replaceChildren();renderHistoryTotals(entries);
 $('historyFilterError').hidden=!error;$('historyFilterError').textContent=error;
 $('historySummary').textContent='符合条件 '+entries.length+' 条，共 '+state.history.length+' 条记录';
 $('clearHistoryFilters').disabled=!active;
 if(!entries.length){const empty=document.createElement('p');empty.className='history-empty';empty.textContent=error?'请调整日期后查看记录。':state.history.length?'没有符合筛选条件的报单记录。':'还没有报单记录。';$('historyList').append(empty);}
 for(const entry of entries){
  const row=document.createElement('div');row.className='history-row';row.dataset.entryId=entry.id;
  const open=document.createElement('button');open.type='button';open.className='history-open';open.setAttribute('aria-label','打开报单：'+entry.form.boss+'，'+entry.form.date);open.onclick=()=>restoreHistory(entry);
  const name=document.createElement('strong');name.textContent=entry.form.boss;
  const small=document.createElement('small');small.textContent=`${entry.form.date}${entry.form.time?' '+entry.form.time:''} · ${entry.form.game}${entry.form.lines?[...new Set(entry.form.lines.map(l=>l.rank))].join(' / '):entry.form.rank} · ${historyQuantity(entry.form)}`;
  const amount=document.createElement('span');amount.className='history-price';amount.textContent=entry.total+' AUD';open.append(name,small,amount);
  const actions=document.createElement('div');actions.className='history-actions';
  const copy=document.createElement('button');copy.type='button';copy.className='quiet small';copy.textContent='复制';copy.onclick=()=>copyText(entry.text).then(()=>toast('已复制这条报单')).catch(e=>toast(e.message));
  const remove=document.createElement('button');remove.type='button';remove.className='quiet small history-delete';remove.textContent='删除';remove.onclick=async()=>{
   if(busy)return;
   if(!confirm('删除 '+entry.form.date+' · '+entry.form.boss+' · '+entry.total+' AUD 的报单记录？\n仅删除这条记录，不删除老板或截图文件。'))return;
   busy=true;remove.disabled=true;
   try{await api('history-delete',{id:entry.id});state=await api('state');if(editingId===entry.id)reset();updateHistoryBossOptions();renderHistoryList();toast('报单记录已删除');}
   catch(e){toast(e.message);}finally{busy=false;remove.disabled=false;}
  };
  actions.append(copy,remove);row.append(open,actions);$('historyList').append(row);
 }
}
async function openHistory(){
 if(busy){toast('当前操作还未完成，请稍候。');return;}
 try{state=await api('state');updateHistoryBossOptions();renderHistoryList();$('history').showModal();}catch(e){toast(e.message);}
}

async function init(){state=await api('state');quantityChoices($('quantity'));quantityChoices($('overtimeQuantity'),true);quantityChoices($('settledQuantity'),true);options($('bulkParty'),['',...PARTIES]);$('bulkParty').options[0].textContent='分别设置';$('bulkParty').onchange=applyBulkParty;options($('bulkRank'),['',...RANKS]);$('bulkRank').options[0].textContent='未识别，请选择';writeCount($('settledQuantity'),$('customSettledQuantity'),1);writeCount($('quantity'),$('customQuantity'),1);writeCount($('overtimeQuantity'),$('customOvertimeQuantity'),0);options($('rank'),['',...RANKS]);$('rank').options[0].textContent='请选择段位';setNow();$('playerId').value=state.id;$('category').value=state.category;tiers();bosses();$('quantity').value='1';refreshSettlementUI();syncPartyDiscount();syncBossDiscount(true);queuePreview();
 $('drop').onclick=()=>$('file').click();$('drop').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('file').click();}};$('replaceBtn').onclick=()=>$('file').click();$('file').onchange=()=>{importImage($('file').files);};
 for(const event of ['dragenter','dragover'])$('drop').addEventListener(event,e=>{e.preventDefault();$('drop').classList.add('drag');});$('drop').ondragleave=()=>$('drop').classList.remove('drag');$('drop').ondrop=e=>{e.preventDefault();$('drop').classList.remove('drag');importImage(e.dataTransfer.files);};window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());window.addEventListener('paste',e=>{const items=[...(e.clipboardData?.items||[])].filter(i=>i.type.startsWith('image/'));if(items.length){e.preventDefault();importImage(items.map(i=>i.getAsFile()));}});
 $('orderForm').onsubmit=e=>e.preventDefault();$('orderForm').addEventListener('input',queuePreview);$('category').onchange=()=>{tiers();for(const l of extraLines)l.price=tariff(l.rank);refreshSettlementUI();};$('tier').onchange=()=>{$('unit').value=$('tier').value==='娱乐'?'小时':'把';price();for(const l of extraLines)l.price=tariff(l.rank);refreshSettlementUI();};$('rank').onchange=()=>{billingManual=true;price();};$('price').addEventListener('input',syncPrimaryBillingRate);$('unit').onchange=()=>{syncPrimaryBillingRate();matchList();};$('discount').onchange=syncPartyDiscount;$('party').onchange=syncPartyDiscount;for(const id of ['date','time'])$(id).addEventListener('input',()=>{timeManual=true;extraManual=false;updateOvertime();});$('nowBtn').onclick=setNow;$('extra').onchange=()=>{extraManual=true;primaryOvertimeManual=false;for(const l of extraLines)l.manualOvertime=false;syncOvertime();};bindCount($('quantity'),$('customQuantity'),()=>{billingManual=true;syncOvertime();});bindCount($('overtimeQuantity'),$('customOvertimeQuantity'),()=>{primaryOvertimeManual=true;billingManual=true;queuePreview();});$('addLine').onclick=()=>{billingManual=true;addBillingLine();renderExtraLines();queuePreview();};$('fillFromMatches').onclick=buildFromMatches;bindCount($('settledQuantity'),$('customSettledQuantity'),()=>{primarySettledManual=true;billingManual=true;syncOvertime();});$('bulkRank').onchange=()=>{bulkRankManual=true;updateBulkRankButton();};$('applyBulkRank').onclick=()=>{if(!$('bulkRank').value){toast('请选择整单段位');return;}const context=prepareMatchBilling();if(!context)return;bulkRankManual=true;let count=0;for(const image of screenshots)for(const match of image.matches)if(match.selected){match.rank=$('bulkRank').value;count++;}if(count){matchList();buildFromMatches(context);toast('已将 '+count+' 局统一为 '+$('bulkRank').value);}else toast('请先选择要应用的对局');};
 $('boss').addEventListener('input',()=>syncBossDiscount());$('boss').addEventListener('change',()=>syncBossDiscount());$('bossDiscount').onchange=updateBossDiscountNote;$('saveBossDiscount').onclick=saveBossDiscount;
 $('saveBoss').onclick=async()=>{try{state.bosses=await api('boss',{name:$('boss').value});bosses();toast('老板已加入列表');}catch(e){toast(e.message);}};
 $('copyImageBtn').onclick=chooseScreenshot;$('copyBtn').onclick=()=>commit(true);$('saveBtn').onclick=()=>commit(false);$('newBtn').onclick=$('exitHistory').onclick=()=>{if(!busy&&confirmDiscardDraft())reset();};$('settingsBtn').onclick=$('editId').onclick=openSettings;$('historyBtn').onclick=openHistory;
 options($('historyRank'),['',...RANKS]);$('historyRank').options[0].textContent='全部段位';
 for(const id of ['historyDate','historyFrom','historyTo','historyBoss','historyRank'])$(id).addEventListener('input',renderHistoryList);
 $('historyDateMode').onchange=()=>syncHistoryDateMode();syncHistoryDateMode(false);
 $('clearHistoryFilters').onclick=clearHistoryFilters;
 document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());$('settingCategory').onchange=()=>{options($('settingTier'),TIERS[$('settingCategory').value]);priceEditor();};$('settingTier').onchange=priceEditor;
 $('saveSettings').onclick=async()=>{const wasDirty=hasUnsavedDraft();try{state=await api('settings',{id:$('settingId').value,category:$('settingCategory').value,tier:$('settingTier').value,prices:settingsPrices});if(!editingId){$('playerId').value=state.id;$('category').value=state.category;tiers();if(!wasDirty)rememberDraft();}$('settings').close();toast('设置已保存');}catch(e){toast(e.message);}};
 rememberDraft();setInterval(()=>api('ping').catch(()=>{}),30000);setInterval(tickTime,1000);if(!state.id)openSettings();
}
init().catch(e=>{$('previewError').textContent=e.message;$('previewError').hidden=false;toast('连接失败，请从桌面快捷方式重新打开。');});
