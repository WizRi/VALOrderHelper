'use strict';

function reliableSelfMarker(player){
 const e=player?.highlightEvidence;
 if(!e||e.yellowBar!==true)return false;
 const height=Number(e.sampleHeight),run=Number(e.yellowRun),coverage=Number(e.yellowCoverage),positionError=Number(e.positionError),width=Number(e.sampleWidth);
 if(![height,run,coverage,positionError,width].every(Number.isFinite)||height<6||width<3)return false;
 return run>=Math.max(6,Math.ceil(height*.70))&&coverage>=.75&&positionError>=0&&positionError<=Math.max(2,Math.ceil(height/12));
}

function chooseOwnPlayer(players){
 // The cyan rectangle can follow the mouse. It does not identify the account.
 // Select only a unique, geometrically verified gold self marker; otherwise
 // leave the existing manual player selection available.
 const marked=(Array.isArray(players)?players:[]).filter(reliableSelfMarker);
 return marked.length===1?marked[0]:null;
}

module.exports={chooseOwnPlayer,reliableSelfMarker};
