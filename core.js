'use strict';
const ranks = ['匹配及下三','黄金','铂金','钻石','超凡','神话1','神话2','神话3','赋能'];
const tiers = ['娱乐','大神','王牌','镇店','金牌镇店','前职业'];
const rows = [[16,15,16,17,20,22],[18,17,18,19,22,25],[18,17,18,19,22,25],[19,19,20,21,28,null],[20,22,24,26,31,null],[21,26,28,30,33,null],[23,28,30,33,36,40],[25,30,33,36,40,45],[30,33,36,40,45,50]];
const femaleRows = [[17,14,15,16],[18,16,17,18],[19,18,19,20],[20,19,20,22],[21,20,21,23],[22,21,26,30],[25,26,30,33],[27,30,33,36],[29,33,36,40]];
const femaleTiers = ['娱乐','精锐','大神','镇店'];
function defaultState() {
 const prices={};
 for(let r=0;r<ranks.length;r++) {
  tiers.forEach((t,i)=>prices[`男陪|${t}|${ranks[r]}`]=rows[r][i]);
  femaleTiers.forEach((t,i)=>prices[`女陪|${t}|${ranks[r]}`]=femaleRows[r][i]);
 }
 let seed=[];try{seed=require('./seed.json');}catch{}
 return {version:1,id:'',category:'男陪',tier:'大神',prices,bosses:[],bossDiscounts:{},history:[],templates:seed};
}
const {parseOcr}=require('./recognition');
function overtimeForTime(time) {
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||'')) throw new Error('请填写有效的悉尼时间（小时:分钟）。');
 const [hour,minute]=time.split(':').map(Number);
 const minutes=hour*60+minute;
 return minutes>=180&&minutes<600?1:0;
}
function formatTotal(value) {
 const amount=Number(value);
 return Number.isInteger(amount)?String(amount):(Math.round((amount+1e-9)*10)/10).toFixed(1);
}
function report(form, id) {
 if(form.time!==undefined)overtimeForTime(form.time);
 if(Array.isArray(form.lines))return reportLines(form,id);
 const price=Number(form.price), quantity=Number(form.quantity), discount=Number(form.discount??1), extra=Number(form.extra??(form.time?overtimeForTime(form.time):0));
 if(!form.date||!form.boss?.trim()||!id?.trim()||!form.game?.trim()||!form.rank) throw new Error('请补齐日期、陪玩 ID、老板、游戏和段位。');
 if(form.price===''||!Number.isFinite(price)||price<0||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(discount)||discount<=0||discount>1||![0,1].includes(extra)) throw new Error('请检查单价、局数、折扣；加班费只能选择有（1）或无（0）。');
 if(!Number.isInteger(quantity*2)) throw new Error('局数 / 小时数请按 0.5 递增填写。');
 const parts=form.date.split('-');
 if(parts.length!==3||!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) throw new Error('日期格式不正确。');
 const date=`${Number(parts[1])}/${Number(parts[2])}`;
 const unitPrice=price+extra;
 const total=Math.round((unitPrice*quantity*discount+1e-9)*100)/100;
 const fmt=v=>Number(v).toString();
 const totalLine=formatTotal(total);
 return {total,unitPrice,basePrice:price,extra,text:`日期：${date}\n陪陪：${id.trim()}\n老板：${form.boss.trim()}\n游戏：${form.game.trim()}${form.rank}\n单价：${fmt(unitPrice)}${form.unit==='小时'?'/H':''}\n局数（小时数）：${fmt(quantity)}${form.unit==='小时'?'小时':''}\n总价格：${totalLine}`};
}
function reportLines(form,id){
 if(!form.date||!form.boss?.trim()||!id?.trim()||!form.game?.trim())throw new Error('请补齐日期、陪玩 ID、老板和游戏。');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(form.date))throw new Error('日期格式不正确。');
 if(!form.lines.length||form.lines.length>100)throw new Error('请填写 1 到 100 个计费分段。');
 const technical=form.tier!=='娱乐';
 const lines=form.lines.map((line,index)=>{
  const party=line.party??form.party??'正常';
  if(!['正常','1陪2','1陪4','2陪3','4陪1'].includes(party))throw new Error(`第 ${index+1} 段请选择有效的陪玩人数。`);
  const requestedUnit=line.unit??form.unit??'把';
  if(!['把','局','小时'].includes(requestedUnit))throw new Error(`第 ${index+1} 段请选择按把或按小时结算。`);
  const unit=requestedUnit==='小时'?'小时':'把';
  let discount=Number(line.discount??form.discount??1);
  if(!Number.isFinite(discount)||discount<=0||discount>1)throw new Error(`第 ${index+1} 段折扣格式不正确。`);
  const nine=[0.9,0.882,0.873,0.864,0.855];
  if(party==='4陪1'&&!nine.includes(discount))discount=Math.round(discount*.9*1000000)/1000000;
  if((line.party!==undefined||form.party!==undefined)&&party!=='4陪1'&&nine.includes(discount))throw new Error(`第 ${index+1} 段九折仅适用于4陪1。`);
  const quantity=Number(line.quantity),price=Number(line.price),overtimeQuantity=Number(line.overtimeQuantity??0);
  const settledQuantity=technical?Number(line.settledQuantity??quantity):quantity;
  if(!ranks.includes(line.rank))throw new Error(`第 ${index+1} 项请选择段位。`);
  if(line.price===''||line.price===null||line.price===undefined||!Number.isFinite(price)||price<0)throw new Error(`第 ${index+1} 项请填写有效单价。`);
  if(!Number.isFinite(quantity)||quantity<=0||!Number.isInteger(quantity*2))throw new Error(`第 ${index+1} 项局数请填写大于 0 的数字，按 0.5 递增。`);
  if(!Number.isFinite(settledQuantity)||settledQuantity<0||settledQuantity>quantity||!Number.isInteger(settledQuantity*2))throw new Error(`第 ${index+1} 项结单局数须在 0 到 ${quantity} 之间，按 0.5 递增。`);
  if(!Number.isFinite(overtimeQuantity)||overtimeQuantity<0||overtimeQuantity>settledQuantity||!Number.isInteger(overtimeQuantity*2))throw new Error(`第 ${index+1} 项加班局数须在 0 到${technical?'结单':''}局数 ${settledQuantity} 之间，按 0.5 递增。`);
  const partyFee=form.tier==='前职业'?0:party==='1陪4'?3:technical&&['1陪2','2陪3'].includes(party)&&ranks.indexOf(line.rank)>=ranks.indexOf('钻石')?2:0;
  const billedPrice=price+partyFee;
  const subtotal=billedPrice*settledQuantity+overtimeQuantity;
  return {rank:line.rank,quantity,settledQuantity,price,party,unit,discount,partyFee,billedPrice,overtimeQuantity,subtotal,total:subtotal*discount};
 });
 const fmt=n=>Number(n).toString(),round=n=>Math.round((n+1e-9)*100)/100;
 const units=[...new Set(lines.map(l=>l.unit))],parties=[...new Set(lines.map(l=>l.party))],discounts=[...new Set(lines.map(l=>l.discount))];
 const party=parties.length===1?parties[0]:'混合',discount=discounts.length===1?discounts[0]:null;
 const quantities={},settledQuantities={},overtimeQuantities={};
 for(const line of lines){quantities[line.unit]=(quantities[line.unit]||0)+line.quantity;settledQuantities[line.unit]=(settledQuantities[line.unit]||0)+line.settledQuantity;overtimeQuantities[line.unit]=(overtimeQuantities[line.unit]||0)+line.overtimeQuantity;}
 const quantity=units.length===1?quantities[units[0]]:null,settledQuantity=units.length===1?settledQuantities[units[0]]:null,overtimeQuantity=units.length===1?overtimeQuantities[units[0]]:null;
 const subtotal=lines.reduce((n,l)=>n+l.subtotal,0),total=round(lines.reduce((n,l)=>n+l.total,0));
 const [year,month,day]=form.date.split('-'),date=`${Number(month)}/${Number(day)}`;
 const discountDescription=line=>{const labels={0.98:'98折',0.97:'97折',0.96:'96折',0.95:'95折',0.9:'9折',0.882:'98折×9折',0.873:'97折×9折',0.864:'96折×9折',0.855:'95折×9折'};return labels[line.discount]||`${fmt(line.discount*10)}折`;};
 // Keep game, price and quantity entries in the same order. Merge only identical rates.
 const summary=new Map();for(const line of lines){const key=JSON.stringify([line.rank,line.party,line.unit,line.discount,line.price]);const prior=summary.get(key)||{...line,quantity:0,settledQuantity:0,overtimeQuantity:0};prior.quantity+=line.quantity;prior.settledQuantity+=line.settledQuantity;prior.overtimeQuantity+=line.overtimeQuantity;summary.set(key,prior);}
 const groups=[...summary.values()];
 const baseLabel=line=>line.rank+(line.party==='正常'?'':line.party);
 const segmentLabel=line=>{
  const peers=groups.filter(l=>baseLabel(l)===baseLabel(line)&&l.unit===line.unit);
  const differentDiscounts=new Set(peers.map(l=>l.discount)).size>1;
  const sameDiscountPrices=new Set(peers.filter(l=>l.discount===line.discount).map(l=>l.price)).size>1;
  return baseLabel(line)+(differentDiscounts?`（${line.discount===1?'原价':discountDescription(line)}）`:'')+(sameDiscountPrices?`（基础价${fmt(line.price)}）`:'');
 };
 const overtimeDescription=line=>line.overtimeQuantity>0?`（${fmt(line.overtimeQuantity)}${line.unit==='小时'?'小时':'局'}加班）`:'';
 const breakdown=groups.map(l=>`${segmentLabel(l)}×${fmt(l.quantity)}${units.length>1?l.unit==='小时'?'小时':'局':''}${technical?'结'+fmt(l.settledQuantity):''}${overtimeDescription(l)}`).join('，');
 const rate=n=>fmt(Math.round((n+1e-9)*1000000)/1000000);
 const priceDescription=line=>{
  const additions=(line.partyFee?`+${rate(line.partyFee*line.discount)}`:'')+(line.overtimeQuantity>0?`+${rate(line.discount)}（加班）`:'');
  const price=additions?`${rate(line.price*line.discount)}${additions}=${rate((line.billedPrice+(line.overtimeQuantity>0?1:0))*line.discount)}`:rate(line.billedPrice*line.discount);
  return price+(line.unit==='小时'?'/H':'');
 };
 const priceLine=groups.map(priceDescription).join('，');
 const quantityPrefix=units.map(unit=>`${fmt(quantities[unit])}${unit==='小时'?'小时':units.length>1?'局':''}${technical?'结'+fmt(settledQuantities[unit]):''}`).join('，');
 const quantityLine=quantityPrefix+(groups.length>1?`（${breakdown}）`:overtimeDescription(groups[0]));
 const totalLine=formatTotal(total);
 return {total,quantity,settledQuantity,overtimeQuantity,quantities,settledQuantities,overtimeQuantities,party,discount,subtotal:round(subtotal),lines,breakdown,text:`日期：${date}\n陪陪：${id.trim()}\n老板：${form.boss.trim()}\n游戏：${form.game.trim()}${groups.map(segmentLabel).join('，')}\n单价：${priceLine}\n局数（小时数）：${quantityLine}\n总价格：${totalLine}`};
}
module.exports={ranks,tiers,femaleTiers,defaultState,parseOcr,report,overtimeForTime,reportLines};
