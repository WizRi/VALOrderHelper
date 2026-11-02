(function(root,factory){const rules=factory();if(typeof module==='object'&&module.exports)module.exports=rules;else root.MatchBilling=rules;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function scoreRounds(score){const match=String(score||'').normalize('NFKC').replace(/\s/g,'').match(/^(\d{1,2})[-:–—](\d{1,2})$/);return match?Number(match[1])+Number(match[2]):null;}
 function classifyEnding(text){
  const upper=String(text||'').normalize('NFKC').toUpperCase(),clean=upper.replace(/\s/g,'');
  if(/\b(?:CHEATER\s+DETECTED|MATCH\s+TERMINATED|REMAKE)\b/.test(upper)||/检测到作弊|檢測到作弊|发现作弊者|發現作弊者|红屏|紅屏|重新比赛|重新比賽|重赛|重賽/.test(clean))return 'remake';
  if(/ENEMYTEAMSURRENDERED|OPPONENTSSURRENDERED|敌方投降|敵方投降|对方投降|對方投降|对面投降|對面投降/.test(clean))return 'surrender';
  if(/SURRENDER|FORFEIT|投降/.test(clean))return 'early';
  return 'normal';
 }
 function calculate(match){
  if(match.billingQuantity!==undefined&&match.billingQuantity!==null){
   const quantity=Number(match.billingQuantity);
   return Number.isFinite(quantity)&&quantity>0&&Number.isInteger(quantity*2)?{quantity,rounds:null,reason:'手动计费',needsConfirmation:false}:{quantity:null,rounds:null,reason:'计费把数须大于0，按0.5递增',needsConfirmation:true};
  }
  const ending=match.ending||'normal';
  if(!['normal','surrender','remake','early'].includes(ending))return {quantity:null,rounds:null,reason:'请选择有效的结束方式',needsConfirmation:true};
  if(ending==='early')return {quantity:null,rounds:null,reason:'请确认是否为对面投降或红屏／重赛，再填写实际回合数',needsConfirmation:true};
  const entered=match.actualRounds!==undefined&&match.actualRounds!==null&&match.actualRounds!=='';
  const rounds=entered?Number(match.actualRounds):ending==='normal'?scoreRounds(match.score):null;
  if(rounds===null)return ending==='normal'?{quantity:1,rounds:null,reason:'比分未识别，暂计1把；可修正比分或手动计费',needsConfirmation:true}:{quantity:null,rounds:null,reason:'请填写实际打完的回合数，投降结算比分可能含赠送回合',needsConfirmation:true};
  if(!Number.isInteger(rounds)||rounds<0||rounds>999)return {quantity:null,rounds:null,reason:'实际回合数须为0至999的整数',needsConfirmation:true};
  if(ending!=='normal')return {quantity:rounds<10?.5:1,rounds,reason:(ending==='surrender'?'对面投降':'红屏／重赛')+' · '+rounds+'回合'+(rounds<10?'少于10，计半把':'达到10，计1把'),needsConfirmation:false};
  const score=String(match.score||'').normalize('NFKC').replace(/\s/g,'').match(/^(\d{1,2})[-:–—](\d{1,2})$/);
  const draw=score?Number(score[1])===Number(score[2]):match.result==='平局'?true:['胜利','失败'].includes(match.result)?false:null;
  if(draw===null&&rounds>=32)return {quantity:null,rounds,reason:'请补充比分或手动计费；平局和胜负的加时边界不同',needsConfirmation:true};
  const overtime=Math.max(0,rounds-24),added=Math.floor(Math.max(0,overtime-(draw?0:1))/8)*.5;
  const boundary=draw?'平局每满8回合计半把':'有胜负须超过每个8回合边界';
  return {quantity:1+added,rounds,reason:added?'加时'+overtime+'回合，多计'+added+'把（'+boundary+'）':rounds<13?'回合较少，请确认是否投降／重赛；当前计1把':overtime>=8?boundary+'，当前计1把':'正常计1把',needsConfirmation:rounds<13};
 }
 return {scoreRounds,classifyEnding,calculate};
});
