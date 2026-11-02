param([Parameter(Mandatory=$true)][string]$ImagePath,[string]$ExternalOcrPath,[switch]$SkipWindows)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'Vision.dll')
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Storage.FileAccessMode,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrResult,Windows.Media.Ocr,ContentType=WindowsRuntime]
$null=[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
$script:asTask=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await($Operation,$Type){$task=$script:asTask.MakeGenericMethod($Type).Invoke($null,@($Operation));$task.GetAwaiter().GetResult()}
try {
 $readPath=$ImagePath
 $original=[System.Drawing.Bitmap]::new($ImagePath);$factor=1.0;$originalWidth=$original.Width;$originalHeight=$original.Height
 if($original.Width -lt 899){$factor=899.0/$original.Width}
 $maximum=[Windows.Media.Ocr.OcrEngine]::MaxImageDimension
 if($original.Width*$factor -gt $maximum -or $original.Height*$factor -gt $maximum){$factor=$maximum/[double][Math]::Max($original.Width,$original.Height)}
 if([Math]::Abs($factor-1) -gt .01){
  $resized=[System.Drawing.Bitmap]::new([int]($original.Width*$factor),[int]($original.Height*$factor));$g=[System.Drawing.Graphics]::FromImage($resized);$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;$g.DrawImage($original,0,0,$resized.Width,$resized.Height);$readPath=$ImagePath+'.ocr.png';$resized.Save($readPath,[System.Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$resized.Dispose()
 }
 $original.Dispose()
 $file=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($readPath)) ([Windows.Storage.StorageFile])
 $stream=Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
 $decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
 $bitmap=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
 $available=@([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
 $languageGroups=@{};$languages=@()
 foreach($language in ($available | Sort-Object @{Expression={if($_.LanguageTag -eq 'en-US'){0}elseif($_.LanguageTag -like 'en-*'){1}else{2}}})){ $group=$language.LanguageTag.Split('-')[0];if($group -eq 'zh'){$group=($language.LanguageTag.Split('-')[0..1] -join '-')};if(!$languageGroups.ContainsKey($group)){$languages+=$language;$languageGroups[$group]=$true} }
 $words=@();$lines=@();$texts=@();$angles=@()
 foreach($language in $languages){
  if($SkipWindows){continue}
  $engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language);if(!$engine){continue}
  $result=Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult]);$texts+=$result.Text;$angles+=@{language=$language.LanguageTag;angle=$result.TextAngle}
  foreach($line in $result.Lines){
   $lineWords=@();foreach($word in $line.Words){$r=$word.BoundingRect;$bounds=[ValRecognition.Vision]::OriginalBounds($r.X,$r.Y,$r.Width,$r.Height,[double]$result.TextAngle,$bitmap.PixelWidth,$bitmap.PixelHeight);$record=@{text=$word.Text;x=$bounds[0];y=$bounds[1];width=$bounds[2];height=$bounds[3];language=$language.LanguageTag};$words+=$record;$lineWords+=$record}
   if($lineWords.Count){$left=($lineWords.x | Measure-Object -Minimum).Minimum;$top=($lineWords.y | Measure-Object -Minimum).Minimum;$right=($lineWords | ForEach-Object {$_.x+$_.width} | Measure-Object -Maximum).Maximum;$bottom=($lineWords | ForEach-Object {$_.y+$_.height} | Measure-Object -Maximum).Maximum;$lines+=@{text=$line.Text;x=$left;y=$top;width=$right-$left;height=$bottom-$top;language=$language.LanguageTag}}
  }
 }
 if($ExternalOcrPath){
  $external=Get-Content -LiteralPath $ExternalOcrPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $sx=$bitmap.PixelWidth/[double]$external.width;$sy=$bitmap.PixelHeight/[double]$external.height
  foreach($item in @($external.words)){if($null -eq $item){continue};$words+=@{text=$item.text;x=[double]$item.x*$sx;y=[double]$item.y*$sy;width=[double]$item.width*$sx;height=[double]$item.height*$sy;language=$item.language;confidence=$item.confidence}}
  foreach($item in @($external.lines)){if($null -eq $item){continue};$lines+=@{text=$item.text;x=[double]$item.x*$sx;y=[double]$item.y*$sy;width=[double]$item.width*$sx;height=[double]$item.height*$sy;language=$item.language;confidence=$item.confidence}}
  if($external.text){$texts+=$external.text}
 }
 $source=[System.Drawing.Bitmap]::new($readPath);$icons=@();$visual=@();$seenAnchors=@();$scoreCrops=@()
 $detail=$null
 # A scoreboard has one KDA column header and several player rows. A history
 # screenshot repeats KDA headers beside each match and must keep its old parser.
 $kdaRows=@($lines | Where-Object {($_.text.Normalize([Text.NormalizationForm]::FormKC) -replace '\s','') -match '^\d{1,3}/\d{1,3}/\d{1,3}$'} | Sort-Object @{Expression={[double]$_.y}})
 $uniqueRows=@();foreach($row in $kdaRows){if(!@($uniqueRows | Where-Object {[Math]::Abs($_.y-$row.y) -lt 8 -and [Math]::Abs($_.x-$row.x) -lt 40}).Count){$uniqueRows+=$row}}
 if($uniqueRows.Count -ge 4){
  $columnX=$uniqueRows[0].x;$column=@($uniqueRows | Where-Object {[Math]::Abs($_.x-$columnX) -lt 60})
  $headers=@($lines | Where-Object {($_.text -replace '\s','') -match '^(KDA|KOA|K0A|K/D/A)$' -and [Math]::Abs($_.x-$columnX) -lt 100 -and $_.y -lt $column[-1].y})
  $headerYs=@();foreach($h in $headers){if(!@($headerYs | Where-Object {[Math]::Abs($_-$h.y) -lt 8}).Count){$headerYs+=$h.y}}
  if(!$headerYs.Count){$tableHeader=@($lines | Where-Object {($_.text -replace '\s','') -match 'SCOREBOARD|INDIVIDUALLYSORTED|计分板|計分板' -and $_.y -lt $column[0].y} | Sort-Object @{Expression={[double]$_.y}} -Descending);if($tableHeader.Count){$headerYs=@($tableHeader[0].y)}}
  if($column.Count -ge 4 -and $headerYs.Count -eq 1){
   $gaps=@();for($i=1;$i -lt $column.Count;$i++){$gap=$column[$i].y-$column[$i-1].y;if($gap -gt 8){$gaps+=$gap}}
   $gaps=@($gaps | Sort-Object);$rowScale=if($gaps.Count){$gaps[0]/48.0}else{$source.Width/1920.0}
   $players=@()
   foreach($row in $column){
    $names=@($lines | Where-Object {[Math]::Abs($_.y-$row.y) -lt 12*$rowScale -and $_.x -gt $columnX-640*$rowScale -and $_.x -lt $columnX-280*$rowScale -and $_.text -notmatch '^[\d\s/]+$'} | Sort-Object @{Expression={[double]$_.width}} -Descending)
    $name=$null;if($names.Count){$name=$names[0]}
    $nameX=if($name){$name.x}else{$columnX-527*$rowScale}
    $cy=$row.y+$row.height/2;$cx=$nameX-40*$rowScale;$samples=@()
    foreach($offset in @(@(0,0),@(-3,0),@(3,0),@(0,-3),@(0,3))){foreach($patch in @(38,42,46,50)){$size=[int]($patch*$rowScale);$sample=[ValRecognition.Vision]::SampleIcon($source,[int]($cx-$size/2+$offset[0]*$rowScale),[int]($cy-$size/2+$offset[1]*$rowScale),$size);if($sample.Valid){$samples+=@{pixels=@($sample.Pixels);background=@($sample.Background)}}}}
    $highlight=[ValRecognition.Vision]::Highlight($source,[int]($nameX-125*$rowScale),[int]($cy-12*$rowScale),[int](8*$rowScale),[int](24*$rowScale))
    $selfMarker=[ValRecognition.Vision]::PlayerHighlight($source,[int]($row.x+$row.width/2-686*$rowScale),[int]$cy,[double]$rowScale)
    $outline=[ValRecognition.Vision]::HighlightOutline($source,[int]($nameX-122*$rowScale),[int]$cy,[int](($columnX+800*$rowScale)-($nameX-122*$rowScale)),[int](48*$rowScale))
    if($outline -ge 500){$highlight=10000+$outline}
    $highlightEvidence=@{yellowCount=$selfMarker.YellowCount;yellowRun=$selfMarker.YellowRun;yellowColumnRows=$selfMarker.YellowColumnRows;yellowCoverage=$selfMarker.YellowCoverage;yellowBar=$selfMarker.YellowBar;sampleWidth=$selfMarker.SampleWidth;sampleHeight=$selfMarker.SampleHeight;positionError=$selfMarker.PositionError;hoverOutlineCoverage=$outline}
    $players+=@{y=$cy;name=if($name){$name.text}else{''};normalized=@($samples);highlight=$highlight;highlightEvidence=$highlightEvidence}
   }
   $detail=@{top=$headerYs[0];players=@($players)}
  }
 }
 if($detail){
  # Read the full digit area beside the result word, never just a narrow OCR
  # character box: an I-shaped first digit may actually belong to 10 or 11.
  $outcomes=@('VICTORY','WIN','WON','DEFEAT','LOSS','LOST','DRAW','TIE','胜利','勝利','获胜','獲勝','失败','失敗','战败','戰敗','平局','승리','패배','무승부','VICTOIRE','DEFAITE','EGALITE','VITORIA','DERROTA','EMPATE','VICTORIA','SIEG','NIEDERLAGE','UNENTSCHIEDEN','VITTORIA','SCONFITTA','PAREGGIO','ПОБЕДА','ПОРАЖЕНИЕ','НИЧЬЯ')
  $headings=@($words | Where-Object { $_.y -lt $detail.top -and ($outcomes -contains ($_.text.Normalize([Text.NormalizationForm]::FormKC).Normalize([Text.NormalizationForm]::FormD).ToUpperInvariant() -replace '[\p{Mn}\s.!！。·_]','')) } | Sort-Object @{Expression={[double]$_.height}} -Descending)
  $headerCrops=@()
  if($headings.Count){
   $heading=$headings[0];$h=[double]$heading.height
   $detail.header=@{text=$heading.text;x=$heading.x;y=$heading.y;width=$heading.width;height=$heading.height}
   $top=[int][Math]::Max(0,[Math]::Floor($heading.y-$h*.15));$cropHeight=[int][Math]::Min($source.Height-$top,[Math]::Ceiling($h*1.3))
   foreach($side in @('left','right')){
    if($side -eq 'left'){$left=[int][Math]::Max(0,[Math]::Floor($heading.x-$h*1.9));$right=[int][Math]::Max($left+1,[Math]::Floor($heading.x-$h*.12))}
    else{$left=[int][Math]::Max(0,[Math]::Floor($heading.x+$heading.width+$h*.12));$right=[int][Math]::Min($source.Width,[Math]::Ceiling($left+$h*1.9))}
    $cropWidth=$right-$left
    if($cropWidth -lt 8 -or $cropHeight -lt 8){continue}
    foreach($variant in @(-2,-1)){
     $crop=[ValRecognition.Vision]::ScoreCropVariant($source,$left,$top,$cropWidth,$cropHeight,$variant,3)
     $memory=[IO.MemoryStream]::new()
     try{$crop.Save($memory,[System.Drawing.Imaging.ImageFormat]::Png);$headerCrops+=@{image=[Convert]::ToBase64String($memory.ToArray());side=$side;x=$left;y=$top;width=$cropWidth;height=$cropHeight;scale=3;padding=12;coordinateSpace='raw';variant=$variant}}
     finally{$memory.Dispose();$crop.Dispose()}
    }
   }
  }
  $detail.headerScoreCrops=@($headerCrops)
 }
 if(!$detail){
 function Compact([string]$text){return ($text.Normalize([Text.NormalizationForm]::FormKC).Normalize([Text.NormalizationForm]::FormD).ToUpperInvariant() -replace '[\p{Mn}\s.!！。·_]','')}
 function ReadScore([string]$text){
  $compact=($text.Normalize([Text.NormalizationForm]::FormKC) -replace '\s','')
  if($compact -cmatch '^([0-9OoIl]{1,2})[-–—:：]([0-9OoIl]{1,2})$'){
   $a=$Matches[1] -creplace '[Oo]','0' -creplace '[Il]','1';$b=$Matches[2] -creplace '[Oo]','0' -creplace '[Il]','1'
   return ('{0}-{1}' -f [int]$a,[int]$b)
  }
  return $null
 }
 function SuspectScore([string]$text){$value=ReadScore $text;if(!$value){return $true};$parts=$value.Split('-');$a=[int]$parts[0];$b=[int]$parts[1];return ([Math]::Max($a,$b) -ge 14 -and [Math]::Abs($a-$b) -gt 2)}
 function RankScores($records,[double]$referenceY){
  $votes=@{}
  foreach($record in @($records)){$key=$record.text;$origin=if($record.language){$record.language}else{'unknown'};$votes[$key]=@(@($votes[$key])+@($origin) | Where-Object {$_} | Select-Object -Unique)}
  return @($records | Sort-Object @{Expression={if(SuspectScore $_.text){1}else{0}}},@{Expression={if($_.language -eq 'numeric-bundled' -and [double]$_.confidence -ge 65){1}else{0}};Descending=$true},@{Expression={@($votes[$_.text]).Count};Descending=$true},@{Expression={[Math]::Abs($_.y-$referenceY)}})
 }
 $resultLabels=@('VICTORY','WIN','WON','胜利','勝利','获胜','獲勝','勝利しました','勝ち','승리','VICTOIRE','VITORIA','VICTORIA','SIEG','VITTORIA','ПОБЕДА','KAZANDIN','ZAFFER','ZWYCIESTWO','VITEZSTVI','GYŐZELEM','VICTORIE','SEGER','VOITTO','ΝΙΚΗ','ชัยชนะ','MENANG','CHIENTHANG','فوز','انتصار','DEFEAT','LOSS','LOST','失败','失敗','战败','戰敗','敗北','負け','패배','DEFAITE','DERROTA','NIEDERLAGE','SCONFITTA','ПОРАЖЕНИЕ','KAYBETTIN','YENILGI','PORAZKA','PROHRA','VERESÉG','INFRANGERE','FORLUST','TAPPIO','ΗΤΤΑ','พ่ายแพ้','KALAH','THATBAI','هزيمة','DRAW','TIE','平局','引き分け','무승부','EGALITE','MATCHNUL','EMPATE','UNENTSCHIEDEN','PAREGGIO','НИЧЬЯ','BERABERE','REMIS','REMIZA','DÖNTETLEN','EGAL','OAVGJORT','TASAPELI','ΙΣΟΠΑΛΙΑ','เสมอ','SERI','HOA','تعادل')
 $globalScale=$source.Width/899.0;$scale=$globalScale
 $all=@($words)+@($lines)
 $scoreWords=@();foreach($word in $all){$value=ReadScore $word.text;if($value){$scoreWords+=@{text=$value;x=$word.x;y=$word.y;width=$word.width;height=$word.height;language=$word.language;confidence=$word.confidence}}}
 $resultWords=@($all | Where-Object {$resultLabels -contains (Compact $_.text)})
 # Multiple independent anchors prevent one misread KDA header from hiding a row.
 $candidates=@()
 foreach($word in $all){if((Compact $word.text) -cmatch '^[KX][D0O]A$|^K/D/A$'){$candidates+=@{x=$word.x;y=$word.y;width=$word.width;priority=3;synthetic=$false}}}
 $genuine=@($candidates)
 foreach($resultWord in $resultWords){
  if(@($candidates | Where-Object {[Math]::Abs($_.y-($resultWord.y-6*$globalScale)) -lt 20*$globalScale}).Count){continue}
  $near=@($genuine | Sort-Object @{Expression={[Math]::Abs($_.y-$resultWord.y)}})
  $ax=if($near.Count){$near[0].x}else{$resultWord.x-205*$globalScale}
  $candidates+=@{x=$ax;y=$resultWord.y-6*$globalScale;width=26*$globalScale;priority=2;synthetic=$false}
 }
 foreach($word in $all){
  if((Compact $word.text) -match '^\d{1,3}/\d{1,3}/\d{1,3}$'){
   $cy=$word.y-16*$globalScale
   if(@($resultWords | Where-Object {[Math]::Abs($_.y-($cy+6*$globalScale)) -lt 20*$globalScale -and $_.x -gt $word.x+60*$globalScale}).Count){$candidates+=@{x=$word.x;y=$cy;width=26*$globalScale;priority=1;synthetic=$false}}
  }
 }
 foreach($score in $scoreWords){
  if(@($candidates | Where-Object {$score.x -gt $_.x+50*$globalScale -and [Math]::Abs($score.y-$_.y-29*$globalScale) -lt 20*$globalScale}).Count){continue}
  # A score supplies a provisional location; parseOcr requires supporting text or a recognised icon before accepting this row.
  $candidates+=@{x=$score.x+$score.width/2-242*$globalScale;y=$score.y-29*$globalScale;width=26*$globalScale;priority=0;synthetic=$true}
 }
 $anchors=@()
 foreach($candidate in ($candidates | Sort-Object @{Expression={$_.priority};Descending=$true})){if(!@($anchors | Where-Object {[Math]::Abs($_.y-$candidate.y) -lt 18*$globalScale}).Count){$anchors+=$candidate}}
 $anchors=@($anchors | Sort-Object @{Expression={[double]$_.y}})
 $numericEngine=$null
 if(!$SkipWindows -and $languages.Count){$numericEngine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($languages[0])}
 foreach($anchor in $anchors){
  $scale=$globalScale
  if($anchor.width/26.0 -gt $scale*.7 -and $anchor.width/26.0 -lt $scale*1.3){$scale=$anchor.width/26.0}
  $resultWord=@($resultWords | Where-Object {[Math]::Abs($_.y-($anchor.y+6*$globalScale)) -lt 22*$globalScale -and $_.x -gt $anchor.x+60*$globalScale} | Sort-Object @{Expression={[Math]::Abs($_.y-($anchor.y+6*$globalScale))}} | Select-Object -First 1)
  $nearScores=@(RankScores @($scoreWords | Where-Object {$_.x -gt $anchor.x+50*$globalScale -and [Math]::Abs($_.y-$anchor.y-29*$globalScale) -lt 22*$globalScale}) ($anchor.y+29*$globalScale))
  $smallInput=($factor -gt 1.2)
  if((!$nearScores.Count -or (SuspectScore $nearScores[0].text) -or @($nearScores.text | Select-Object -Unique).Count -gt 1 -or $smallInput) -and $numericEngine){
   $regions=@()
   if($resultWord.Count){$rw=$resultWord[0];$regions+=@{x=$rw.x+$rw.width/2-46*$globalScale;y=$rw.y+$rw.height+1*$globalScale;width=92*$globalScale;height=29*$globalScale}}
   $regions+=@{x=$anchor.x+185*$globalScale;y=$anchor.y+19*$globalScale;width=115*$globalScale;height=31*$globalScale}
   $cropReads=0
   :regions foreach($region in $regions){
    foreach($threshold in @(-1,-2,100,0,130,160)){
     $left=[int]$region.x;$top=[int]$region.y
     $scoreCrop=[ValRecognition.Vision]::ScoreCropVariant($source,$left,$top,[int]$region.width,[int]$region.height,$threshold,4)
     $scorePath=$readPath+'.score.png';$scoreCrop.Save($scorePath,[System.Drawing.Imaging.ImageFormat]::Png);$scoreCrop.Dispose()
     $scoreFile=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($scorePath)) ([Windows.Storage.StorageFile]);$scoreStream=Await ($scoreFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream]);$scoreDecoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($scoreStream)) ([Windows.Graphics.Imaging.BitmapDecoder]);$scoreBitmap=Await ($scoreDecoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap]);$scoreResult=Await ($numericEngine.RecognizeAsync($scoreBitmap)) ([Windows.Media.Ocr.OcrResult])
     foreach($scoreLine in $scoreResult.Lines){$value=ReadScore $scoreLine.Text;if($value){$r=$scoreLine.Words[0].BoundingRect;$record=@{text=$value;x=$left+($r.X-12)/4;y=$top+($r.Y-12)/4;width=($scoreLine.Words[-1].BoundingRect.X+$scoreLine.Words[-1].BoundingRect.Width-$r.X)/4;height=$r.Height/4;language='numeric-crop'};$scoreWords+=$record;$words+=$record;$cropReads++;$nearScores=@(RankScores (@($nearScores)+@($record)) ($anchor.y+29*$globalScale));if(!(SuspectScore $value)){break}}}
     $scoreBitmap.Dispose();$scoreStream.Dispose()
     if($nearScores.Count -and !(SuspectScore $nearScores[0].text) -and (!$smallInput -or $cropReads -ge 2)){break regions}
    }
   }
  }
  $samples=@()
  # Search a small neighbourhood instead of relying on one exact KDA bounding box.
  foreach($offset in @(@(0,0),@(-3,0),@(3,0),@(0,-3),@(0,3))){foreach($patchSize in @(42,46,50)){
   $sample=[ValRecognition.Vision]::SampleIcon($source,[int]($anchor.x-(49+$patchSize/2)*$scale+$offset[0]*$scale),[int]($anchor.y+(15-$patchSize/2)*$scale+$offset[1]*$scale),[int]($patchSize*$scale))
   if($sample.Valid){$samples+=@{pixels=@($sample.Pixels);background=@($sample.Background)}}
  }}
  if($samples.Count){$icons+=@{y=$anchor.y+8*$globalScale;normalized=@($samples)}}
  $score=if($nearScores.Count){$nearScores[0]}else{$null}
  $scoreX=if($score){$score.x}elseif($resultWord.Count){$resultWord[0].x}else{$anchor.x+205*$globalScale}
  $color=[ValRecognition.Vision]::Outcome($source,[int]($scoreX-25*$globalScale),[int]($anchor.y),[int](140*$globalScale),[int](48*$globalScale))
  $visual+=@{y=$anchor.y+8*$globalScale;score=if($score){$score.text}else{''};scoreX=$scoreX;scoreY=if($score){$score.y}else{$null};outcome=$color;anchored=(!$anchor.synthetic)}
  if($scoreCrops.Count -lt 60 -and (!$anchor.synthetic -or $resultWord.Count -or $color -ne 'unknown')){
   $exportRegions=@()
   if($resultWord.Count){$rw=$resultWord[0];$exportRegions+=@{x=$rw.x+$rw.width/2-46*$globalScale;y=$rw.y+$rw.height+1*$globalScale;width=92*$globalScale;height=29*$globalScale;mode=-1}}
   $grayTop=$anchor.y+19*$globalScale;$grayBottom=$anchor.y+50*$globalScale
   if($resultWord.Count){$grayTop=[Math]::Max($grayTop,$resultWord[0].y+$resultWord[0].height+2*$globalScale)}
   $exportRegions+=@{x=$anchor.x+185*$globalScale;y=$grayTop;width=115*$globalScale;height=[Math]::Max(8*$globalScale,$grayBottom-$grayTop);mode=-2}
   if($exportRegions.Count -eq 1){$er=$exportRegions[0];$exportRegions+=@{x=$er.x;y=$er.y;width=$er.width;height=$er.height;mode=-1}}
   foreach($exportRegion in ($exportRegions | Select-Object -First 2)){
    if($scoreCrops.Count -ge 60){break}
    $ex=[Math]::Max(0,[int]$exportRegion.x);$ey=[Math]::Max(0,[int]$exportRegion.y);$ew=[Math]::Min([int]$exportRegion.width,$source.Width-$ex);$eh=[Math]::Min([int]$exportRegion.height,$source.Height-$ey)
    if($ew -lt 12 -or $eh -lt 8){continue}
    $exportCrop=[ValRecognition.Vision]::ScoreCropVariant($source,$ex,$ey,$ew,$eh,[int]$exportRegion.mode,3);$exportStream=[System.IO.MemoryStream]::new()
    try{$exportCrop.Save($exportStream,[System.Drawing.Imaging.ImageFormat]::Png);$encoded=[Convert]::ToBase64String($exportStream.ToArray());if($encoded.Length -le 65536){$scoreCrops+=@{image=$encoded;x=$ex;y=$ey;width=$ew;height=$eh;scale=3;padding=12;rowY=$anchor.y+8*$globalScale;currentScore=if($score){$score.text}else{''};coordinateSpace='raw';mode=if($exportRegion.mode -eq -1){'row-background-binary'}else{'row-background-grayscale'}}}}finally{$exportStream.Dispose();$exportCrop.Dispose()}
   }
  }
 }
 }
 $source.Dispose();$bitmap.Dispose();$stream.Dispose()
 @{text=($texts -join "`n");words=@($words);lines=@($lines);icons=@($icons);visual=@($visual);detail=$detail;scoreCrops=@($scoreCrops);angles=@($angles);languages=@($languages.LanguageTag);ocrUnavailable=([bool]($SkipWindows -or !$languages.Count));width=$decoder.PixelWidth;height=$decoder.PixelHeight;originalWidth=$originalWidth;originalHeight=$originalHeight;scaleFactor=$decoder.PixelWidth/[double]$originalWidth} | ConvertTo-Json -Depth 8 -Compress
}catch{
 @{error=$_.Exception.Message} | ConvertTo-Json -Compress
 exit 1
}finally{
 if($source){$source.Dispose()};if($bitmap){$bitmap.Dispose()};if($stream){$stream.Dispose()}
 if($scoreBitmap){$scoreBitmap.Dispose()};if($scoreStream){$scoreStream.Dispose()}
 if($scorePath -and (Test-Path -LiteralPath $scorePath)){Remove-Item -LiteralPath $scorePath -Force}
 if($readPath -and $readPath -ne $ImagePath -and (Test-Path -LiteralPath $readPath)){Remove-Item -LiteralPath $readPath -Force}
}
