var A = require('../src/assignment.cjs');
function rng(seed){var s=seed>>>0;return function(){s=(Math.imul(s,1103515245)+12345)>>>0;return s;};}
/* greedy counterexample from 004.2 §6 */
var edges=[[[0,1],[1,2]],[[0,2]]];
var p=A.assignEdges(2,3,edges);
console.log('counterexample:',JSON.stringify(p),'card',p.length,'cost',A.totalCost(p,edges), p.length===2&&A.totalCost(p,edges)===4?'PASS':'FAIL');
/* randomized conformance vs dense oracle */
var r=rng(1234),fails=0,trials=400;
for(var t=0;t<trials;t++){
  var n=1+r()%14,m=1+r()%14,density=1+r()%9;
  var cost=new Int32Array(n*m).fill(-1),edg=[];
  for(var i=0;i<n;i++){var row=[];
    for(var j=0;j<m;j++){if(r()%10<density){var d=r()%64;cost[i*m+j]=d;row.push([j,d]);}}
    edg.push(row);}
  var dr=A.assign(n,m,cost), sr=A.assignEdges(n,m,edg), sub=A.assignSparse(n,m,cost);
  var cd=A.totalCost(dr,edg),cs=A.totalCost(sr,edg),cb=A.totalCost(sub,edg);
  if(dr.length!==sr.length||cd!==cs||dr.length!==sub.length||cd!==cb){fails++;
    if(fails<4)console.log('MISMATCH t=',t,'n',n,'m',m,'dense',dr.length,cd,'sparse',sr.length,cs,'sub',sub.length,cb);}
}
console.log('randomized conformance:',fails===0?'PASS':'FAIL ('+fails+'/'+trials+')');
/* all-zero-cost ties + rectangular + duplicates */
var z=[[[0,0],[1,0]],[[0,0],[1,0]]];var pz=A.assignEdges(2,2,z);
console.log('zero ties:',pz.length===2&&A.totalCost(pz,z)===0?'PASS':'FAIL',JSON.stringify(pz));
console.log('empty:',A.assignEdges(0,4,[]).length===0&&A.assignEdges(3,3,[[],[],[]]).length===0?'PASS':'FAIL');
/* determinism */
var e2=[[[2,5],[0,5]],[[1,3]],[[2,5],[1,3]]];
var a1=JSON.stringify(A.assignEdges(3,3,e2)),a2=JSON.stringify(A.assignEdges(3,3,e2));
console.log('deterministic:',a1===a2?'PASS':'FAIL',a1);

/* dispatch: honours the density rule and matches the oracle */
var r3=rng(99),dfails=0;
for(var t3=0;t3<200;t3++){
  var n3=1+r3()%12,m3=1+r3()%12,edges3=[];
  for(var i3=0;i3<n3;i3++){var row3=[];
    for(var j3=0;j3<m3;j3++)if(r3()%10<3)row3.push([j3,r3()%50]);
    edges3.push(row3);}
  var dd=A.assignDispatch(n3,m3,edges3), oo=A.assignEdges(n3,m3,edges3);
  if(dd.pairs.length!==oo.length||A.totalCost(dd.pairs,edges3)!==A.totalCost(oo,edges3))dfails++;
  if(dd.path!=='sparse'&&dd.path!=='dense')dfails++;
}
console.log('dispatch conformance:',dfails===0?'PASS':'FAIL ('+dfails+')');
if(dfails)process.exit(1);
