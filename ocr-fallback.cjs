'use strict';
// CPU-only fallback. Every code/model dependency is shipped beside this file.
const fs=require('node:fs'),path=require('node:path');
const {execFile}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const RUNTIME=path.join(__dirname,'ocr-runtime');

function dimensions(file){
 const bytes=fs.readFileSync(file);
 if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
 if(bytes.length>4&&bytes[0]===255&&bytes[1]===216){
  let position=2;
  while(position+9<bytes.length){
   if(bytes[position]!==255){position++;continue;}
   while(bytes[position]===255)position++;
   const marker=bytes[position++];if(marker===217||marker===218)break;
   if(marker===1||marker>=208&&marker<=215)continue;
   if(position+2>bytes.length)break;const length=bytes.readUInt16BE(position);if(length<2||position+length>bytes.length)break;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return {width:bytes.readUInt16BE(position+5),height:bytes.readUInt16BE(position+3)};
   position+=length;
  }
 }
 throw new Error('备用识别仅支持有效的PNG/JPG截图。');
}
function validate(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||!fs.existsSync(file))throw new Error('备用识别找不到截图文件。');
 const size=dimensions(file);if(!size.width||!size.height||size.width*size.height>16000000)throw new Error('截图尺寸过大，请裁切战绩区域后再试。');
 const required=['offline-worker.cjs','lang/eng.traineddata','node_modules/tesseract.js/src/index.js','node_modules/tesseract.js/src/worker-script/node/index.js'];
 for(const suffix of ['','-simd','-relaxedsimd'])for(const extension of ['.js','.wasm'])required.push('node_modules/tesseract.js-core/tesseract-core'+suffix+extension);
 for(const relative of required)if(!fs.existsSync(path.join(RUNTIME,relative)))throw new Error('备用识别文件缺失，请重新安装完整安装包。');
 return size;
}
async function recognize(file,options={}){
 // Keep worker faults and deadlines away from the local order server. A broken
 // model cannot leave an unhandled worker error or an endless initialization.
 const size=validate(file),workerOptions={};
 if(options.rectangle){
  const rectangle=options.rectangle;
  if(!['left','top','width','height'].every(key=>Number.isInteger(rectangle[key]))||rectangle.left<0||rectangle.top<0||rectangle.width<1||rectangle.height<1||rectangle.left+rectangle.width>size.width||rectangle.top+rectangle.height>size.height)throw new Error('备用识别区域无效。');
  workerOptions.rectangle=rectangle;workerOptions.pageSegMode=options.pageSegMode==='line'?'line':options.pageSegMode==='block'?'block':'sparse';
 }
 const requested=Number(options.timeoutMs),timeout=Number.isFinite(requested)&&requested>0?Math.min(requested,60000):30000;
 return new Promise((resolve,reject)=>execFile(process.execPath,[__filename,'--worker',file,JSON.stringify(workerOptions)],{cwd:__dirname,windowsHide:true,timeout,maxBuffer:12*1024*1024,encoding:'utf8'},(error,out)=>{
  if(error)return reject(new Error(error.killed?'备用识别超时，请裁切战绩区域或手动填写。':'备用识别未完成，请重新安装完整安装包或手动填写。'));
  try{const result=JSON.parse(out);if(!Array.isArray(result.words)||!Array.isArray(result.lines))throw new Error();resolve(result);}catch{reject(new Error('备用识别返回异常，请手动填写。'));}
 }));
}
async function recognizeHeaderText(file,rectangle,options={}){return recognize(file,{...options,rectangle,pageSegMode:'sparse'});}
async function recognizeScores(file,regions,options={}){
 const size=validate(file),requested=Number(options.timeoutMs);
 const headerNumbers=options.headerNumbers===true,language=headerNumbers?'header-bundled':'numeric-bundled';
 const timeout=Number.isFinite(requested)&&requested>0?Math.min(requested,30000):30000;
 const limit=Math.max(1,Math.min(60,Math.floor(Number(options.maxRegions)||20)));
 if(!Array.isArray(regions))throw new Error('备用比分区域格式无效。');
 const selected=regions.slice(0,limit).filter(region=>{
  if(!region||typeof region.image!=='string'||region.image.length>1500000)return false;
  return ['x','y','width','height'].every(key=>Number.isFinite(Number(region[key])))&&Number(region.width)>0&&Number(region.height)>0;
 });
 const empty={...size,text:'',words:[],lines:[],languages:[language],angles:[],visual:[],icons:[],engine:'bundled-tesseract-numeric',processedRegions:0};
 if(!selected.length)return empty;
 const temporary=file+'.score-fallback-'+randomUUID()+'.json';let created=false;
 try{
  fs.writeFileSync(temporary,JSON.stringify({regions:selected,budgetMs:Math.max(1,timeout-1000),headerNumbers}),{flag:'wx'});created=true;
  return await new Promise((resolve,reject)=>execFile(process.execPath,[__filename,'--scores',file,temporary],{cwd:__dirname,windowsHide:true,timeout,maxBuffer:12*1024*1024,encoding:'utf8'},(error,out)=>{
   if(error)return reject(new Error(error.killed?'备用比分识别超时，请手动确认。':'备用比分识别未完成，请手动确认。'));
   try{const result=JSON.parse(out);if(!Array.isArray(result.words)||!Array.isArray(result.lines))throw new Error();resolve(result);}catch{reject(new Error('备用比分结果异常，请手动确认。'));}
  }));
 }finally{if(created){try{fs.unlinkSync(temporary);}catch{}}}
}
async function recognizeHeaderNumbers(file,regions,options={}){
 return recognizeScores(file,regions,{...options,maxRegions:Math.min(8,Number(options.maxRegions)||8),headerNumbers:true});
}
function scoreValue(text){
 const found=String(text||'').normalize('NFKC').replace(/\s/g,'').match(/^(\d{1,2})[-–—−:](\d{1,2})$/);
 return found?Number(found[1])+'-'+Number(found[2]):null;
}
function scoreInk(bytes){
 // The exporter produces small non-interlaced PNGs. Decode only 8-bit local
 // pixels; no image library or native platform component is needed here.
 try{
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),type=bytes[25],channels=({0:1,2:3,4:2,6:4})[type];
  if(bytes[24]!==8||bytes[28]!==0||!channels||width*height>4000000)return null;
  const chunks=[];for(let p=8;p+12<=bytes.length;){const length=bytes.readUInt32BE(p),kind=bytes.toString('ascii',p+4,p+8);if(p+12+length>bytes.length)return null;if(kind==='IDAT')chunks.push(bytes.subarray(p+8,p+8+length));p+=12+length;}
  const stride=width*channels,raw=require('node:zlib').inflateSync(Buffer.concat(chunks),{maxOutputLength:(stride+1)*height});
  if(raw.length!==(stride+1)*height)return null;
  const pixels=new Uint8Array(stride*height),mask=new Uint8Array(width*height),columns=new Uint32Array(width);
  let left=width,top=height,right=-1,bottom=-1;
  for(let y=0;y<height;y++){
   const filter=raw[y*(stride+1)];if(filter>4)return null;
   for(let x=0;x<stride;x++){
    const a=x>=channels?pixels[y*stride+x-channels]:0,b=y?pixels[(y-1)*stride+x]:0,c=y&&x>=channels?pixels[(y-1)*stride+x-channels]:0;
    let predictor=0;if(filter===1)predictor=a;else if(filter===2)predictor=b;else if(filter===3)predictor=Math.floor((a+b)/2);else if(filter===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);predictor=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
    pixels[y*stride+x]=(raw[y*(stride+1)+1+x]+predictor)&255;
   }
   for(let x=0;x<width;x++){
    const p=y*stride+x*channels,alpha=(type===4||type===6)?pixels[p+channels-1]:255;
    const shade=(type===0||type===4)?pixels[p]:Math.max(pixels[p],pixels[p+1],pixels[p+2]);
    if(alpha>180&&shade<150){mask[y*width+x]=1;columns[x]++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
   }
  }
  if(right<left)return null;
  const rectangle={left:Math.max(0,left-12),top:Math.max(0,top-12),width:Math.min(width-1,right+12)-Math.max(0,left-12)+1,height:Math.min(height-1,bottom+12)-Math.max(0,top-12)+1};
  const glyphs=[];
  for(let x=left;x<=right;){if(!columns[x]){x++;continue;}const x0=x;while(x<=right&&columns[x])x++;const x1=x-1;let y0=height,y1=-1;for(let xx=x0;xx<=x1;xx++)for(let yy=top;yy<=bottom;yy++)if(mask[yy*width+xx]){y0=Math.min(y0,yy);y1=Math.max(y1,yy);}
   const w=x1-x0+1,h=y1-y0+1,visited=new Uint8Array(w*h),minimum=Math.max(4,Math.ceil(w*h*.015));let holes=0;
   for(let i=0;i<w*h;i++){if(visited[i]||mask[(y0+Math.floor(i/w))*width+x0+i%w])continue;let area=0,edge=false;const queue=[i];visited[i]=1;for(let head=0;head<queue.length;head++){const at=queue[head],xx=at%w,yy=Math.floor(at/w);area++;if(xx===0||xx===w-1||yy===0||yy===h-1)edge=true;for(const next of [xx?at-1:-1,xx<w-1?at+1:-1,yy?at-w:-1,yy<h-1?at+w:-1])if(next>=0&&!visited[next]&&!mask[(y0+Math.floor(next/w))*width+x0+next%w]){visited[next]=1;queue.push(next);}}
    if(!edge&&area>=minimum)holes++;
   }
   glyphs.push({height:h,holes});
  }
  return {rectangle,glyphs};
 }catch{return null;}
}
function glyphConflict(score,ink){
 if(!ink)return false;const characters=score.split(''),separator=score.indexOf('-'),glyphs=ink.glyphs;
 if(glyphs.length!==characters.length||separator<0||glyphs[separator].height>=Math.max(...glyphs.map(g=>g.height))*.45)return false;
 return characters.some((character,i)=>character!=='-'&&(glyphs[i].holes>=2&&character!=='8'||glyphs[i].holes>=1&&/[12357]/.test(character)));
}
function headerNumberValue(text){const value=String(text||'').normalize('NFKC').replace(/\s/g,'');return /^\d{1,2}$/.test(value)?String(Number(value)):null;}
function headerGlyphConflict(text,ink){
 if(!ink||!ink.glyphs.length)return false;
 const glyphs=ink.glyphs,maxHeight=Math.max(...glyphs.map(g=>g.height));
 // A header crop contains only the large number. When it has two complete
 // glyphs, a reading of its thin first digit alone is not a verified score.
 if(glyphs.length<=2&&glyphs.every(g=>g.height>=maxHeight*.65)&&glyphs.length!==text.length)return true;
 if(glyphs.length!==text.length)return false;
 return text.split('').some((character,index)=>glyphs[index].holes>=2&&character!=='8'||glyphs[index].holes>=1&&/[12357]/.test(character));
}
async function workerRecognizeScores(file,regionPath){
 const size=validate(file),started=Date.now(),payload=JSON.parse(fs.readFileSync(regionPath,'utf8'));
 const headerNumbers=payload.headerNumbers===true,language=headerNumbers?'header-bundled':'numeric-bundled';
 const {createWorker,PSM}=require(path.join(RUNTIME,'node_modules/tesseract.js'));
 const words=[],lines=[],rejectedReadings=[],unreadableRegions=[];let worker,processed=0;
 try{
  worker=await createWorker('eng',1,{workerPath:path.join(RUNTIME,'offline-worker.cjs'),langPath:path.join(RUNTIME,'lang'),gzip:false,cacheMethod:'none',logger:()=>{},errorHandler:()=>{}});
  await worker.setParameters({tessedit_char_whitelist:headerNumbers?'0123456789':'0123456789-:',preserve_interword_spaces:'0'});
  for(const [index,region] of payload.regions.entries()){
   if(Date.now()-started>=payload.budgetMs)break;
   const image=String(region.image).replace(/^data:image\/png;base64,/,''),bytes=Buffer.from(image,'base64');
   if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>4000000)continue;
   const readings=new Map(),ink=scoreInk(bytes),current=headerNumbers?null:scoreValue(region.currentScore);
   if(current&&glyphConflict(current,ink))rejectedReadings.push({text:current,confidence:null,rowY:region.rowY,regionIndex:index,reason:'current-score-closed-glyph-conflict'});
   const modes=headerNumbers?[[PSM.SINGLE_LINE,'single-line'],[PSM.RAW_LINE,'raw-line'],[PSM.SINGLE_WORD,'single-word']]:[[PSM.SINGLE_LINE,'single-line'],[PSM.RAW_LINE,'raw-line']];
   for(const [mode,label] of modes){
    if(Date.now()-started>=payload.budgetMs)break;
    await worker.setParameters({tessedit_pageseg_mode:mode});
    const {data}=await worker.recognize(bytes,ink?{rectangle:ink.rectangle}:{},{text:true,blocks:true});
    const candidates=[{text:data.text,confidence:data.confidence}];
    for(const block of data.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[])candidates.push({text:line.text,confidence:line.confidence});
    for(const item of candidates){const score=headerNumbers?headerNumberValue(item.text):scoreValue(item.text);if(score===null)continue;const confidence=Number(item.confidence)||0;if(headerNumbers?headerGlyphConflict(score,ink):glyphConflict(score,ink)){rejectedReadings.push({text:score,confidence,rowY:region.rowY,side:region.side,regionIndex:index,reason:headerNumbers?'header-glyph-conflict':'closed-glyph-conflict'});continue;}const prior=readings.get(score);if(!prior)readings.set(score,{score,confidence,psm:label,modes:new Set([label])});else{prior.modes.add(label);if(confidence>prior.confidence){prior.confidence=confidence;prior.psm=label;}}}
   }
   // Region bounds already belong to an existing match. Keep its fixed bounds
   // instead of turning arbitrary digit boxes into new match anchors. This
   // also avoids ambiguity from crop padding and per-axis resize factors.
   for(const reading of [...readings.values()].sort((a,b)=>b.confidence-a.confidence)){
    const word={text:reading.score,x:Number(region.x),y:Number(region.y),width:Number(region.width),height:Number(region.height),language,confidence:reading.confidence,regionIndex:index,psm:reading.psm,targetedScore:true};
    if(headerNumbers){word.side=region.side;word.variant=region.variant;word.modeVotes=reading.modes.size;}
    if(Number.isFinite(Number(region.rowY)))word.rowY=Number(region.rowY);
    words.push(word);lines.push({...word});
   }
   if(!readings.size)unreadableRegions.push({regionIndex:index,rowY:region.rowY,x:Number(region.x),y:Number(region.y),width:Number(region.width),height:Number(region.height),currentScore:region.currentScore||'',reason:'no-verified-numeric-reading'});
   processed++;
  }
  const uniqueRejected=rejectedReadings.filter((item,index)=>rejectedReadings.findIndex(other=>other.text===item.text&&other.regionIndex===item.regionIndex&&other.reason===item.reason)===index);
  return {...size,text:words.map(word=>word.text).join('\n'),words,lines,languages:[language],angles:[],visual:[],icons:[],ocrUnavailable:false,engine:headerNumbers?'bundled-tesseract-header':'bundled-tesseract-numeric',processedRegions:processed,requestedRegions:payload.regions.length,rejectedReadings:uniqueRejected,unreadableRegions,elapsedMs:Date.now()-started};
 }finally{if(worker)await worker.terminate();}
}
async function workerRecognize(file,options={}){
 const size=validate(file),started=Date.now();
 const {createWorker,PSM}=require(path.join(RUNTIME,'node_modules/tesseract.js'));
 let worker;
 try{
  worker=await createWorker('eng',1,{workerPath:path.join(RUNTIME,'offline-worker.cjs'),langPath:path.join(RUNTIME,'lang'),gzip:false,cacheMethod:'none',logger:()=>{},errorHandler:()=>{}});
  const mode=options.rectangle?(options.pageSegMode==='line'?PSM.SINGLE_LINE:options.pageSegMode==='block'?PSM.SINGLE_BLOCK:PSM.SPARSE_TEXT):PSM.AUTO;
  await worker.setParameters({tessedit_pageseg_mode:mode});
  const {data}=await worker.recognize(file,options.rectangle?{rectangle:options.rectangle}:{},{text:true,blocks:true});
  const words=[],lines=[];
  const language=options.rectangle?'header-text-bundled':'en';
  const converted=item=>({text:String(item.text||'').trim(),x:item.bbox.x0,y:item.bbox.y0,width:item.bbox.x1-item.bbox.x0,height:item.bbox.y1-item.bbox.y0,language,confidence:Number(item.confidence)||0});
  for(const block of data.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[]){
   if(line.bbox&&String(line.text||'').trim())lines.push(converted(line));
   for(const word of line.words||[])if(word.bbox&&String(word.text||'').trim())words.push(converted(word));
  }
  return {...size,text:data.text||'',words,lines,languages:[language],angles:[],visual:[],icons:[],ocrUnavailable:false,engine:'bundled-tesseract-cpu',confidence:Number(data.confidence)||0,elapsedMs:Date.now()-started};
 }finally{if(worker)await worker.terminate();}
}
if(require.main===module){
 const action=process.argv[2]==='--worker'?()=>workerRecognize(process.argv[3],process.argv[4]?JSON.parse(process.argv[4]):{}):process.argv[2]==='--scores'?()=>workerRecognizeScores(process.argv[3],process.argv[4]):null;
 if(!action){console.error('Internal OCR worker only.');process.exitCode=2;}
 else action().then(value=>process.stdout.write(JSON.stringify(value))).catch(()=>{console.error('Bundled OCR worker failed.');process.exit(1);});
}
module.exports={recognize,recognizeScores,recognizeHeaderNumbers,recognizeHeaderText};
