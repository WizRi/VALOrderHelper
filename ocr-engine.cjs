'use strict';
const fs=require('node:fs'),path=require('node:path');
const {execFile}=require('node:child_process');
const {parseOcr,scoreText}=require('./recognition');
const ROOT=__dirname;
const powershell=path.join(process.env.SystemRoot||process.env.WINDIR||`${process.env.SystemDrive||'C:'}\\Windows`,'System32','WindowsPowerShell','v1.0','powershell.exe');

function windowsOcr(file,options={}) {
 const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'ocr.ps1'),'-ImagePath',file];
 if(options.skipWindows)args.push('-SkipWindows');
 if(options.external)args.push('-ExternalOcrPath',options.external);
 return new Promise((resolve,reject)=>execFile(powershell,args,{windowsHide:true,timeout:35000,maxBuffer:24*1024*1024,encoding:'utf8'},(error,out)=>{
  try {const raw=JSON.parse(out.replace(/^\uFEFF/,''));if(error||raw.error)throw new Error(raw.error||'本机识别未完成');resolve(raw);}
  catch {reject(new Error('本机识别未完成'));}
 }));
}

function incomplete(raw,checkSmall=true) {
 if(raw.ocrUnavailable&&!(raw.words?.length||raw.lines?.length))return true;
 const parsed=parseOcr(raw);
 if(!parsed.matches.length)return true;
 // A detailed scoreboard may intentionally have no selected player. Do not
 // infer the player's rank from the other participants in that match.
 if(raw.detail?.players?.length)return parsed.matches.some(m=>!m.score||m.scoreNeedsReview||suspiciousScore(m.score));
 return parsed.matches.some(m=>!m.score||(!m.rank&&m.rankName!=='未定级')||suspiciousScore(m.score))||(checkSmall&&Number(raw.scaleFactor)>1.2);
}

function suspiciousScore(score) {
 const parts=String(score).split('-').map(Number);
 // A large one-sided final score can be a misread digit (for example 12-74
 // instead of 12-14). Request another reading; never invent a replacement.
 return parts.length===2&&parts.every(Number.isFinite)&&Math.max(...parts)>=14&&Math.abs(parts[0]-parts[1])>2;
}

function independentKdaLines(extra) {
 const words=extra.words||[],lines=[...(extra.lines||[])],triplet=/^\d{1,3}\/\d{1,3}\/\d{1,3}$/;
 const compact=word=>String(word.text||'').normalize('NFKC').replace(/\s/g,'');
 const add=items=>{
  const text=items.map(compact).join(''),left=Math.min(...items.map(w=>w.x)),top=Math.min(...items.map(w=>w.y)),right=Math.max(...items.map(w=>w.x+w.width)),bottom=Math.max(...items.map(w=>w.y+w.height));
  if(lines.some(line=>compact(line)===text&&Math.abs(line.x-left)<3&&Math.abs(line.y-top)<3))return;
  lines.push({text,x:left,y:top,width:right-left,height:bottom-top,language:items[0].language||'en',confidence:Math.min(...items.map(w=>Number(w.confidence)||0)),derivedFromWords:true});
 };
 for(const word of words){
  const value=compact(word);
  if(/^(?:KDA|KOA|K0A|K\/D\/A)$/i.test(value)){add([word]);continue;}
  if(triplet.test(value)){add([word]);continue;}
  if(!/^\d{1,3}\//.test(value)||!/^[\d/]+$/.test(value))continue;
  const group=[word],height=Math.max(1,word.height),center=word.y+word.height/2;
  const adjacent=words.filter(other=>other!==word&&other.x>=word.x+word.width&&Math.abs(other.y+other.height/2-center)<height*.45&&/^[\d/]+$/.test(compact(other))).sort((a,b)=>a.x-b.x);
  for(const next of adjacent){
   const previous=group[group.length-1],gap=next.x-previous.x-previous.width;
   if(gap>height*1.5||next.x+next.width-word.x>height*13||group.length>=3)break;
   group.push(next);const joined=group.map(compact).join('');
   if(triplet.test(joined)){add(group);break;}
   if(joined.length>11)break;
  }
 }
 return {...extra,lines};
}

async function recognize(file,options={}) {
 let raw;
 try {raw=await windowsOcr(file,options);}
 catch {raw=null;}
 if(raw&&!incomplete(raw))return {...raw,engine:'windows'};
 let externalPath,combined=raw,usedScores=false,usedHeader=false;
 const rejectedRegions=[];
 try {
  const fallback=require('./ocr-fallback.cjs');
  // OCR intermediates live beside the uploaded image, in the app's writable
  // data location. The user's original screenshot is never overwritten.
  externalPath=file+'.fallback-'+require('node:crypto').randomUUID()+'.json';
  async function refine(base,extra) {
   const remap=items=>(items||[]).map(item=>({...item,x:item.x*extra.width/base.width,y:item.y*extra.height/base.height,width:item.width*extra.width/base.width,height:item.height*extra.height/base.height}));
   const allowed=item=>!rejectedRegions.some(region=>scoreText(item.text)===region.text&&item.x>=region.x-5&&item.x<=region.x+region.width+5&&item.y>=region.y-5&&item.y<=region.y+region.height+5);
   const merged=base?{...extra,words:[...remap(base.words),...extra.words].filter(allowed),lines:[...remap(base.lines),...extra.lines].filter(allowed),text:[base.text,extra.text].filter(Boolean).join('\n')}:{...extra,words:extra.words.filter(allowed),lines:extra.lines.filter(allowed)};
   fs.writeFileSync(externalPath,JSON.stringify(merged));
   const result=await windowsOcr(file,{skipWindows:true,external:externalPath});
   if(result.detail){
    const verification=extra.headerScoreVerification||base?.detail?.headerScoreVerification;
    if(verification)result.detail.headerScoreVerification=verification;
    const attempts=extra.headerScoreAttempts||base?.detail?.headerScoreAttempts;
    if(attempts)result.detail.headerScoreAttempts=attempts;
   }
   return {...result,languages:[...new Set([...(base?.languages||[]),...(extra.languages||[])])],angles:base?.angles||extra.angles||[],ocrUnavailable:Boolean(raw?.ocrUnavailable||!raw),engine:raw?.ocrUnavailable||!raw?'bundled':'windows+bundled'};
  }
  async function readHeader(base) {
   if(!base?.detail?.headerScoreCrops?.length||typeof fallback.recognizeHeaderNumbers!=='function')return base;
   const match=parseOcr(base).matches[0];
   if(match?.score&&!match.scoreNeedsReview&&!suspiciousScore(match.score))return base;
   const sx=(base.originalWidth||base.width)/base.width,sy=(base.originalHeight||base.height)/base.height;
   const regions=base.detail.headerScoreCrops.slice(0,8).map(c=>({...c,x:c.x*sx,y:c.y*sy,width:c.width*sx,height:c.height*sy,scaleX:c.scale/sx,scaleY:c.scale/sy}));
   const extra=await fallback.recognizeHeaderNumbers(file,regions),verification={...base.detail.headerScoreVerification};usedHeader=true;
   for(const side of ['left','right']){
    const groups=new Map();
    for(const word of extra.words||[]){
     if(word.side!==side||!/^\d{1,2}$/.test(word.text)||word.confidence<60)continue;
     const value=Number(word.text),entry=groups.get(value)||{value,regions:new Set(),confidence:0,modeVotes:0};
     entry.regions.add(word.regionIndex);entry.confidence=Math.max(entry.confidence,word.confidence);entry.modeVotes=Math.max(entry.modeVotes,Number(word.modeVotes)||0);groups.set(value,entry);
    }
    const ranked=[...groups.values()].sort((a,b)=>b.regions.size-a.regions.size||b.confidence-a.confidence),best=ranked[0];
    // Confirm the full number by both exported pixel variants, or by a high
    // confidence, multi-mode reading when the other variant is unreadable.
    // Conflicting numeric readings remain unresolved rather than being guessed.
    if(best&&ranked.length===1&&(best.regions.size>=2||best.confidence>=85&&best.modeVotes>=2))verification[side]={value:best.value,confidence:best.confidence,regionVotes:best.regions.size,modeVotes:best.modeVotes,source:'header-bundled'};
   }
   const attempts={readings:(extra.words||[]).map(({text,side,confidence,regionIndex,modeVotes})=>({text,side,confidence,regionIndex,modeVotes})),rejectedReadings:extra.rejectedReadings||[],unreadableRegions:extra.unreadableRegions||[]};
   if(!Object.keys(verification).length)return {...base,detail:{...base.detail,headerScoreAttempts:attempts}};
   const words=extra.words.filter(word=>verification[word.side]?.value===Number(word.text));
   return refine(base,{...extra,words,lines:words.map(word=>({...word})),headerScoreVerification:verification,headerScoreAttempts:attempts});
  }
  async function readScores(base) {
   if(!base?.scoreCrops?.length||typeof fallback.recognizeScores!=='function')return base;
   const originalWidth=base.originalWidth||base.width,originalHeight=base.originalHeight||base.height,sx=originalWidth/base.width,sy=originalHeight/base.height;
   const rows=parseOcr(base).matches;
   const small=Number(base.scaleFactor)>1.2;
   const regions=base.scoreCrops.filter(c=>small||rows.some(m=>(!m.score||suspiciousScore(m.score))&&Math.abs(m.y-c.rowY)<40*base.width/899)).slice(0,60).map(c=>({...c,x:c.x*sx,y:c.y*sy,width:c.width*sx,height:c.height*sy,rowY:c.rowY*sy,scaleX:c.scale/sx,scaleY:c.scale/sy}));
   if(!regions.length)return base;
   const extra=await fallback.recognizeScores(file,regions,{maxRegions:regions.length});usedScores=true;
   for(const rejected of extra.rejectedReadings||[]){const region=regions[rejected.regionIndex];if(region&&scoreText(rejected.text))rejectedRegions.push({text:scoreText(rejected.text),x:region.x,y:region.y,width:region.width,height:region.height});}
   return extra.words?.length||extra.rejectedReadings?.length?refine(base,extra):base;
  }
  // Only known match rows are offered to the numeric recognizer. A time or
  // unrelated number elsewhere in the image cannot become a new match.
  if(combined?.detail?.headerScoreCrops?.length){try{combined=await readHeader(combined);}catch{}}
  if(combined?.scoreCrops?.length){try{combined=await readScores(combined);}catch{}}
  if(combined&&!incomplete(combined,false))return {...combined,engine:usedHeader?'windows+bundled-header':usedScores?'windows+bundled-scores':'windows'};
  // Tesseract may group the entire scoreboard row into one line. Preserve its
  // literal slash-separated K/D/A words as independent lines so the same
  // existing scoreboard detector works when Windows OCR is unavailable.
  // History screenshots still retain their repeated KDA column headings.
  const extra=independentKdaLines(await fallback.recognize(file));
  combined=await refine(combined,extra);
  if(combined?.detail?.players?.length&&incomplete(combined,false)&&!combined.detail.headerScoreCrops?.length&&typeof fallback.recognizeHeaderText==='function'){
   // AUTO can omit a large decorative result title while reading the table.
   // Re-read only the title area above this already-detected scoreboard;
   // this does not infer rows or fabricate a score from ordinary numbers.
   const width=combined.originalWidth||combined.width,height=combined.originalHeight||combined.height,sy=height/combined.height,tableTop=combined.detail.top*sy;
   const top=Math.max(0,Math.floor(tableTop*.30)),bottom=Math.min(height,Math.ceil(tableTop*.82));
   if(bottom>top){try{const title=await fallback.recognizeHeaderText(file,{left:0,top,width:Math.max(1,Math.floor(width*.30)),height:bottom-top});if(title.words?.length)combined=await refine(combined,title);}catch{}}
  }
  if(incomplete(combined,false)){try{combined=combined?.detail?.players?.length?await readHeader(combined):await readScores(combined);}catch{}}
  return combined;
 } catch {
  if(combined)return {...combined,engine:combined.engine||'windows',fallbackUnavailable:true};
  throw new Error('截图识别未完成，请手动填写或换一张清晰的战绩截图。');
 } finally {if(externalPath){try{fs.unlinkSync(externalPath);}catch{}}}
}

module.exports={recognize,windowsOcr,incomplete,suspiciousScore,independentKdaLines};
