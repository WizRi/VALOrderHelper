(function(root,factory){const rules=factory();if(typeof module==='object'&&module.exports)module.exports=rules;else root.PricingRules=rules;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const revision='2026-11',legacyRevision='legacy-1.2.5';
 const ranks=['匹配及下三','黄金','铂金','钻石','超凡1-2','超凡3','神话1','神话2','神话3','赋能'];
 const tiers=['娱乐','大神','王牌','镇店','明星','明星魔王'],femaleTiers=['娱乐','精锐','大神','镇店','明星'];
 const legacyRanks=['匹配及下三','黄金','铂金','钻石','超凡','神话1','神话2','神话3','赋能'];
 const legacyTiers=['娱乐','大神','王牌','镇店','金牌镇店','前职业'],legacyFemaleTiers=['娱乐','精锐','大神','镇店'];
 const maleRows=[[17,16,17,18,24,25],[18,17,18,19,25,26],[19,18,19,20,27,29],[20,20,21,23,32,34],[21,23,25,27,34,37],[22,24,26,28,36,39],[23,27,29,31,37,42],[25,null,31,35,39,45],[27,null,34,38,44,49],[30,null,null,42,49,55]];
 const femaleRows=[[18,17,18,19,24],[19,18,19,21,25],[21,19,21,23,27],[22,21,23,25,31],[24,null,25,27,34],[25,null,26,29,36],[26,null,null,32,37],[28,null,null,null,39],[30,null,null,null,42],[32,null,null,null,49]];
 const legacyMaleRows=[[16,15,16,17,20,22],[18,17,18,19,22,25],[18,17,18,19,22,25],[19,19,20,21,28,null],[20,22,24,26,31,null],[21,26,28,30,33,null],[23,28,30,33,36,40],[25,30,33,36,40,45],[30,33,36,40,45,50]];
 const legacyFemaleRows=[[17,14,15,16],[18,16,17,18],[19,18,19,20],[20,19,20,22],[21,20,21,23],[22,21,26,30],[25,26,30,33],[27,30,33,36],[29,33,36,40]];
 const isNewRevision=value=>value===revision;
 const ranksFor=(value=revision)=>isNewRevision(value)?ranks:legacyRanks;
 const tiersFor=(category,value=revision)=>category==='女陪'?(isNewRevision(value)?femaleTiers:legacyFemaleTiers):(isNewRevision(value)?tiers:legacyTiers);
 const normalizeTier=tier=>tier==='金牌镇店'?'明星':tier==='前职业'?'明星魔王':tier;
 function defaultPrices(value=revision){
  const modern=isNewRevision(value),rs=modern?ranks:legacyRanks,men=modern?maleRows:legacyMaleRows,women=modern?femaleRows:legacyFemaleRows,prices={};
  rs.forEach((rank,r)=>{tiersFor('男陪',value).forEach((tier,c)=>prices[['男陪',tier,rank].join('|')]=men[r][c]);tiersFor('女陪',value).forEach((tier,c)=>prices[['女陪',tier,rank].join('|')]=women[r][c]);});
  return prices;
 }
 const legacyPrices=()=>defaultPrices(legacyRevision);
 function fixedPartyDiscount(party,value=revision,tier){
  if(isNewRevision(value)&&tier==='娱乐')return 1;
  return party==='4陪1'?.9:party==='5陪0'&&isNewRevision(value)?.88:1;
 }
 function baseDiscount(value){
  const number=Number(value??1);
  for(const base of [1,.98,.97,.96,.95])for(const fixed of [1,.9,.88])if(Math.abs(number-base*fixed)<1e-8)return base;
  return number;
 }
 function partyDiscount(party,value=1,version=revision,tier){return Math.round(baseDiscount(value)*fixedPartyDiscount(party,version,tier)*1000000)/1000000;}
 function partyFee(tier,rank,party,value=revision){
  if(isNewRevision(value)){
   if(tier==='明星'||tier==='明星魔王')return 0;
   if(party==='1陪4')return 3;
   if(tier==='娱乐'||!['1陪2','2陪3'].includes(party))return 0;
   return ranks.indexOf(rank)>=ranks.indexOf('钻石')?2:1;
  }
  if(tier==='前职业')return 0;
  return party==='1陪4'?3:tier!=='娱乐'&&['1陪2','2陪3'].includes(party)&&legacyRanks.indexOf(rank)>=legacyRanks.indexOf('钻石')?2:0;
 }
 function available(category,tier,rank,value=revision){const table=defaultPrices(value),key=[category,tier,rank].join('|');return Object.hasOwn(table,key)&&table[key]!==null;}
 function priceRestriction(category,tier,rank,party,value=revision){
  if(!isNewRevision(value))return '';
  if(category==='男陪'&&((tier==='王牌'&&rank==='神话3')||(tier==='镇店'&&rank==='赋能'))&&party!=='4陪1')return '价目表注明此组合只限4陪1，请确认本单适用。';
  return available(category,tier,rank,value)?'':'价目表未提供此组合价格，请与店长确认后手动填写。';
 }
 function migrateState(loadedState){
  const loaded=loadedState&&typeof loadedState==='object'&&!Array.isArray(loadedState)?loadedState:{};
  if(loaded.priceCatalogVersion===revision)return loaded;
  const oldDefaults=legacyPrices(),oldPrices={...oldDefaults,...(loaded.prices&&typeof loaded.prices==='object'&&!Array.isArray(loaded.prices)?loaded.prices:{})},prices=defaultPrices(),customPreserved=[],unmappedPrices={};
  for(const [key,price]of Object.entries(oldPrices)){
   const [category,oldTier,rank]=key.split('|'),tier=normalizeTier(oldTier),targets=rank==='超凡'?['超凡1-2','超凡3']:[rank];
   if(!Object.hasOwn(oldDefaults,key)){if(Object.hasOwn(prices,key))prices[key]=price;else unmappedPrices[key]=price;continue;}
   if(price===oldDefaults[key])continue;
   for(const target of targets){const mapped=[category,tier,target].join('|');if(Object.hasOwn(prices,mapped)){prices[mapped]=price;customPreserved.push({from:key,to:mapped,value:price});}else unmappedPrices[key]=price;}
  }
  return {...loaded,prices,...(typeof loaded.tier==='string'?{tier:normalizeTier(loaded.tier)}:{}),priceCatalogVersion:revision,priceMigration:{fromRevision:loaded.priceCatalogVersion||legacyRevision,toRevision:revision,at:new Date().toISOString(),previousPrices:oldPrices,customPreserved,unmappedPrices}};
 }
 return {revision,legacyRevision,ranks,tiers,femaleTiers,legacyRanks,legacyTiers,legacyFemaleTiers,isNewRevision,ranksFor,tiersFor,normalizeTier,defaultPrices,legacyPrices,fixedPartyDiscount,baseDiscount,partyDiscount,partyFee,available,priceRestriction,migrateState};
});
