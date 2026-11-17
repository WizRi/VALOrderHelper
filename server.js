'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');
const core=require('./core');
const ROOT=__dirname, DATA=process.env.VAL_HELPER_DATA||path.join(ROOT,'data'), UPLOADS=path.join(DATA,'screenshots'), SESSION=path.join(DATA,'session.json');
fs.mkdirSync(UPLOADS,{recursive:true});
const STATE=path.join(DATA,'settings.json');
let state=core.defaultState(),migrationPending=false;
if(fs.existsSync(STATE)) {
 let loaded;
 try{loaded=JSON.parse(fs.readFileSync(STATE,'utf8'));if(!loaded||typeof loaded!=='object'||Array.isArray(loaded))throw new Error('配置格式不正确');}
 catch{loaded=null;fs.copyFileSync(STATE,path.join(DATA,`settings-recovery-${Date.now()}.json`));}
 if(loaded){
  const migrated=core.pricing.migrateState(loaded);migrationPending=loaded.priceCatalogVersion!==core.pricing.revision;
  if(migrationPending){
   const backupFile=`settings-before-pricing-${core.pricing.revision}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`;
   fs.copyFileSync(STATE,path.join(DATA,backupFile),fs.constants.COPYFILE_EXCL);
   migrated.priceMigration={...migrated.priceMigration,backupFile};
  }
  state={...state,...migrated};
 }
}
const BOSS_DISCOUNTS=[1,0.98,0.97,0.96,0.95];
state.bossDiscounts=Object.fromEntries(Object.entries(state.bossDiscounts&&typeof state.bossDiscounts==='object'&&!Array.isArray(state.bossDiscounts)?state.bossDiscounts:{}).filter(([name,value])=>name.trim()===name&&name.length>0&&name.length<=100&&BOSS_DISCOUNTS.includes(value)));
function save(){const tmp=STATE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(state,null,2));fs.renameSync(tmp,STATE);}
if(migrationPending)save();
const requestedToken=process.env.VAL_HELPER_TOKEN;
const token=/^[a-f0-9]{48}$/.test(requestedToken||'')?requestedToken:crypto.randomBytes(24).toString('hex');
let lastSeen=Date.now(),ocrBusy=false;
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
function body(req,limit=16*1024*1024){return new Promise((resolve,reject)=>{let n=0,chunks=[];req.on('data',c=>{n+=c.length;if(n>limit){reject(new Error('图片过大，请使用小于 16 MB 的截图。'));req.destroy();}else chunks.push(c);});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject);});}
const powershellPath=path.join(process.env.SystemRoot||process.env.WINDIR||`${process.env.SystemDrive||'C:'}\\Windows`,'System32','WindowsPowerShell','v1.0','powershell.exe');
const {recognize:ocr}=require('./ocr-engine.cjs');
function copyImage(file){return new Promise((resolve,reject)=>execFile(path.join(ROOT,'ClipboardImage.exe'),[file],{windowsHide:true,timeout:10000},err=>err?reject(new Error('复制截图失败，请稍后重试。')):resolve()));}
const imageName=value=>typeof value==='string'&&/^[-a-f0-9]{36}\.(png|jpg)$/.test(value);
function savedScreenshots(value){
 if(!Array.isArray(value))return [];
 const pick=(object,keys)=>Object.fromEntries(keys.filter(k=>object?.[k]!==undefined).map(k=>[k,object[k]]));
 const player=p=>({...pick(p,['id','name','rank','rankName','confidence']),icon:p?.icon?{rank:p.icon.rank}:undefined});
 return value.slice(0,100).map(s=>({image:imageName(s.image)?s.image:null,name:String(s.name||'战绩截图').slice(0,200),kind:s.kind==='detail'?'detail':'history',hash:typeof s.hash==='string'?s.hash.slice(0,64):undefined,
  players:Array.isArray(s.players)?s.players.slice(0,10).map(player):[],matches:Array.isArray(s.matches)?s.matches.slice(0,200).map(m=>({...pick(m,['id','score','result','mvp','rank','rankName','party','selected','settled','settledManual','billingQuantity','ending','actualRounds','playerId','pricingRevision','redScreenParty','redScreenStage']),billing:m.billing?pick(m.billing,['rank','party','price','discount','unit','pricingRevision']):undefined,icon:m?.icon?{rank:m.icon.rank}:undefined})):[]}));
}
const server=http.createServer(async(req,res)=>{
 try{
  const host=req.headers.host||'';
  if(!/^127\.0\.0\.1:\d+$/.test(host))return json(res,403,{error:'Access denied'});
  const origin=req.headers.origin;
  if(origin&&origin!==`http://${host}`)return json(res,403,{error:'Access denied'});
  const url=new URL(req.url,`http://${host}`),p=url.pathname;
  if(p==='/health')return json(res,200,{app:'val-order-helper',ready:true});
  if(p.startsWith('/api/')&&req.headers['x-app-token']!==token)return json(res,403,{error:'请从桌面快捷方式重新打开。'});
  lastSeen=Date.now();
  if(p==='/api/state'&&req.method==='GET')return json(res,200,state);
  if(p==='/api/ping')return json(res,200,{ok:true});
  if(p==='/api/history-delete'&&req.method==='POST'){
   const b=JSON.parse((await body(req,1000)).toString());
   const index=state.history.findIndex(entry=>typeof b.id==='string'&&entry.id===b.id);
   if(index<0)return json(res,404,{error:'这条记录已不存在，请刷新报单记录。'});
   state.history.splice(index,1);save();return json(res,200,{ok:true});
  }
  if(p==='/api/copy-image'&&req.method==='POST'){
   const b=JSON.parse((await body(req,1000)).toString());
   if(typeof b.image!=='string'||!/^[-a-f0-9]{36}\.(png|jpg)$/.test(b.image))throw new Error('请选择本单的战绩截图。');
   const file=path.join(UPLOADS,b.image);if(!fs.existsSync(file))throw new Error('截图不存在，请重新导入。');
   await copyImage(file);return json(res,200,{ok:true});
  }
  if(p==='/api/settings'&&req.method==='POST'){
   const b=JSON.parse((await body(req,100000)).toString());
   if(typeof b.id!=='string'||!b.id.trim()||b.id.length>80)throw new Error('请填写有效的陪玩 ID。');
   if(!['男陪','女陪'].includes(b.category)||!(b.category==='男陪'?core.tiers:core.femaleTiers).includes(b.tier))throw new Error('请选择有效档位。');
   if(b.prices){for(const [k,v]of Object.entries(b.prices)){if(!(k in state.prices)||!(v===null||(Number.isFinite(v)&&v>=0)))throw new Error('价格格式不正确。');}}
   state.id=b.id.trim();state.category=b.category;state.tier=b.tier;
   if(b.prices)state.prices={...state.prices,...b.prices};
   save();return json(res,200,state);
  }
  if(p==='/api/boss'&&req.method==='POST'){
   const b=JSON.parse((await body(req,10000)).toString()),name=String(b.name||'').trim();
   if(!name||name.length>100)throw new Error('请填写老板名字。');
   if(b.remove){state.bosses=state.bosses.filter(n=>n!==name);delete state.bossDiscounts[name];}else state.bosses=[name,...state.bosses.filter(n=>n!==name)];
   save();return json(res,200,state.bosses);
  }
  if(p==='/api/boss-discount'&&req.method==='POST'){
   const b=JSON.parse((await body(req,10000)).toString()),name=typeof b.name==='string'?b.name.trim():'';
   if(!name||name.length>100)throw new Error('请先填写老板名字。');
   if(!BOSS_DISCOUNTS.includes(b.discount))throw new Error('老板默认折扣仅支持无折扣、98折、97折、96折和95折。');
   state.bossDiscounts={...state.bossDiscounts,[name]:b.discount};
   state.bosses=[name,...state.bosses.filter(n=>n!==name)];
   save();return json(res,200,{bosses:state.bosses,bossDiscounts:state.bossDiscounts});
  }
  if(p==='/api/recognize'&&req.method==='POST'){
   if(ocrBusy)return json(res,429,{error:'上一张截图还在识别，请稍候。'});
   ocrBusy=true;
   try{
    const bytes=await body(req),png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=bytes[0]===255&&bytes[1]===216;
    if(!png&&!jpeg)throw new Error('请导入 PNG 或 JPG 截图。');
    const id=crypto.randomUUID()+ (png?'.png':'.jpg'),file=path.join(UPLOADS,id);fs.writeFileSync(file,bytes);
    let parsed;try{parsed=core.parseOcr(await ocr(file),state.templates);}catch{parsed={matches:[],icons:[],warning:'截图已保留，识别未完成，可手动填写并复制截图。'};}
    return json(res,200,{...parsed,image:id,hash:crypto.createHash('sha256').update(bytes).digest('hex')});
   }finally{ocrBusy=false;}
  }
  if(p==='/api/report'&&req.method==='POST'){
   const b=JSON.parse((await body(req,2000000)).toString());
   const playerId=typeof b.form?.playerId==='string'&&b.form.playerId.trim()&&b.form.playerId.length<=80?b.form.playerId.trim():state.id;
   const result=core.report(b.form,playerId);
   if(b.save){
    const previous=b.entryId?state.history.find(entry=>entry.id===b.entryId):null;
    if(b.entryId&&!previous)return json(res,404,{error:'原报单已被删除或移出记录。请开始新报单后再保存。'});
    state.bosses=[b.form.boss.trim(),...state.bosses.filter(n=>n!==b.form.boss.trim())];
    const images=Array.isArray(b.images)?b.images.filter(n=>typeof n==='string'&&/^[a-f0-9-]+\.(png|jpg)$/.test(n)).slice(0,100):[];
    const entry={id:previous?.id||crypto.randomUUID(),at:previous?.at||new Date().toISOString(),...(previous?{updatedAt:new Date().toISOString()}:{}),form:{...b.form,playerId},text:result.text,total:result.total,images,image:images[0]||(/^[a-f0-9-]+\.(png|jpg)$/.test(b.image||'')?b.image:null),screenshots:savedScreenshots(b.screenshots)};
    if(previous)state.history[state.history.findIndex(e=>e.id===previous.id)]=entry;
    else state.history=[entry,...state.history];
    result.entryId=entry.id;
    if(b.learn&&core.ranks.includes(b.form.rank)&&Array.isArray(b.icons)){
     for(const icon of b.icons.slice(0,3)){if(Array.isArray(icon.pixels)&&icon.pixels.length===768&&icon.pixels.every(n=>Number.isInteger(n)&&n>=0&&n<=255))state.templates.push({rank:b.form.rank,pixels:icon.pixels});}
     state.templates=state.templates.slice(-120);
    }
    if(b.learn&&Array.isArray(b.samples)){
     for(const sample of b.samples.slice(0,32)){if(core.ranks.includes(sample.rank)&&Array.isArray(sample.pixels)&&sample.pixels.length===768&&sample.pixels.every(n=>Number.isInteger(n)&&n>=0&&n<=255))state.templates.push({rank:sample.rank,pixels:sample.pixels});}
     state.templates=state.templates.slice(-120);
    }
    save();
   }
   return json(res,200,result);
  }
  if(p.startsWith('/api/image/')&&req.method==='GET'){
   const name=p.slice('/api/image/'.length);if(!/^[a-f0-9-]+\.(png|jpg)$/.test(name))return json(res,404,{error:'图片不存在'});
   const file=path.join(UPLOADS,name);if(!fs.existsSync(file))return json(res,404,{error:'图片不存在'});
   res.writeHead(200,{'Content-Type':name.endsWith('.png')?'image/png':'image/jpeg'});return fs.createReadStream(file).pipe(res);
  }
  const names={'/':'index.html','/app.js':'app.js','/pricing-rules.js':'pricing-rules.js','/billing-rules.js':'billing-rules.js','/styles.css':'styles.css','/icon.svg':'icon.svg','/mvp-gaming-logo.png':'mvp-gaming-logo.png'};
  if(req.method==='GET'&&names[p]){
   const name=names[p],mime=name.endsWith('html')?'text/html':name.endsWith('css')?'text/css':name.endsWith('svg')?'image/svg+xml':name.endsWith('png')?'image/png':'text/javascript';
   res.writeHead(200,{'Content-Type':`${mime}; charset=utf-8`,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});return fs.createReadStream(path.join(ROOT,name)).pipe(res);
  }
  json(res,404,{error:'Not found'});
 }catch(err){json(res,400,{error:err.message||'操作失败，请重试。'});}
});
function launch(url){
 const browser=spawn(path.join(ROOT,'BrowserLauncher.exe'),[url],{detached:true,stdio:'ignore',windowsHide:false});
 browser.on('error',()=>console.error('无法启动浏览器，请确认 BrowserLauncher.exe 存在且未被拦截。'));
 browser.unref();
}
async function start(){
 if(process.argv.includes('--launch')&&fs.existsSync(SESSION)){
  try{const old=JSON.parse(fs.readFileSync(SESSION));const r=await fetch(`http://127.0.0.1:${old.port}/api/state`,{headers:{'x-app-token':old.token},signal:AbortSignal.timeout(1500)});if(r.ok){launch(`http://127.0.0.1:${old.port}/?token=${old.token}`);return;}}catch{}
 }
 server.listen(Number(process.env.VAL_HELPER_PORT)||0,'127.0.0.1',()=>{
  const port=server.address().port;fs.writeFileSync(SESSION,JSON.stringify({port,token,pid:process.pid}));
  console.log(JSON.stringify({port,token}));
  if(process.argv.includes('--launch'))launch(`http://127.0.0.1:${port}/?token=${token}`);
  setInterval(()=>{if(!ocrBusy&&Date.now()-lastSeen>180000){server.close();process.exit(0);}},30000).unref();
 });
}
start();
